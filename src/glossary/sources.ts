import { isSafeNotePath } from './manifest'

export type AuthMethod = 'https' | 'git' | 'token'

export interface SourceConfig {
  repoUrl: string
  ref: string
  method: AuthMethod
  /** Read-only personal access token; only used by the `token` method. */
  token?: string
}

/**
 * The swappable fetch seam: every way of getting the glossary (anonymous HTTPS, local git, token API, a future
 * registry service) implements this. The importer only ever sees repo-relative paths and text.
 */
export interface GlossarySource {
  method: AuthMethod
  fetchManifest(): Promise<string>
  fetchNote(repoPath: string): Promise<string>
}

export interface HttpResponse {
  status: number
  text: string
}

export interface GitRun {
  stdout: string
}

export interface SourceDeps {
  httpGet(url: string, headers: Record<string, string>): Promise<HttpResponse>
  /** Run an executable without a shell; rejects with an Error carrying `code` ('ENOENT' when missing) and `stderr`. */
  run(file: string, args: string[], opts?: { cwd?: string }): Promise<GitRun>
  readFile(absPath: string): Promise<string>
  exists(absPath: string): Promise<boolean>
  platform: string
  /** Absolute folder outside the vault that holds the shallow clone for this repo and ref. */
  cacheDir: string
}

/** Failure that names the method that was tried, so the user knows which setting to change. */
export class GlossaryError extends Error {
  constructor(public method: AuthMethod, message: string) {
    super(`Glossary (${method}): ${message}`)
  }
}

export interface RepoRef {
  host: string
  /** `owner/repo` or `group/sub/repo`, no `.git`. */
  path: string
}

export function parseRepoUrl(url: string): RepoRef | null {
  const m = /^https:\/\/(?:[^/@]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (!m || m[2].split('/').length < 2 || m[2].split('/').some((s) => !s || s === '..')) return null
  return { host: m[1].toLowerCase(), path: m[2] }
}

/** Anonymous raw-file URL for GitHub or a GitLab-style host. */
export function rawUrl(repo: RepoRef, ref: string, file: string): string {
  const r = encodeURIComponent(ref)
  return repo.host === 'github.com'
    ? `https://raw.githubusercontent.com/${repo.path}/${r}/${file}`
    : `https://${repo.host}/${repo.path}/-/raw/${r}/${file}`
}

function describeStatus(status: number, anonymous: boolean): string {
  if (status === 401 || status === 403) return `authentication failed (HTTP ${status}); check the repo is accessible with this method`
  if (status === 404) {
    return anonymous
      ? 'not found (HTTP 404); check the URL and branch. A private repo needs the git or token method'
      : 'not found (HTTP 404); check the URL, branch and token scope'
  }
  return `request failed (HTTP ${status})`
}

function checkPath(file: string): void {
  if (file !== 'glossary.json' && !isSafeNotePath(file)) throw new Error(`refusing unsafe path ${file}`)
}

function httpSource(cfg: SourceConfig, deps: SourceDeps): GlossarySource {
  const repo = parseRepoUrl(cfg.repoUrl)
  const token = cfg.method === 'token'
  const fail = (m: string) => new GlossaryError(cfg.method, m)
  const url = (file: string): { url: string; headers: Record<string, string> } => {
    if (!repo) throw fail('repo URL must look like https://github.com/owner/repo')
    if (!token) return { url: rawUrl(repo, cfg.ref, file), headers: {} }
    if (!cfg.token) throw fail('no token configured')
    if (repo.host === 'github.com') {
      return {
        url: `https://api.github.com/repos/${repo.path}/contents/${file}?ref=${encodeURIComponent(cfg.ref)}`,
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw+json' },
      }
    }
    return {
      url: `https://${repo.host}/api/v4/projects/${encodeURIComponent(repo.path)}/repository/files/${encodeURIComponent(file)}/raw?ref=${encodeURIComponent(cfg.ref)}`,
      headers: { 'PRIVATE-TOKEN': cfg.token },
    }
  }
  const get = async (file: string): Promise<string> => {
    checkPath(file)
    const { url: u, headers } = url(file)
    let res: HttpResponse
    try {
      res = await deps.httpGet(u, headers)
    } catch (e) {
      // network errors can echo the request URL; the token only travels in headers, so the message is safe to show
      throw fail(`network error (${(e as Error).message})`)
    }
    if (res.status !== 200) throw fail(describeStatus(res.status, !token))
    return res.text
  }
  return { method: cfg.method, fetchManifest: () => get('glossary.json'), fetchNote: get }
}

/** `where git` on Windows, `which git` elsewhere. Resolves false when git is not on PATH. */
export async function gitAvailable(deps: Pick<SourceDeps, 'run' | 'platform'>): Promise<boolean> {
  try {
    await deps.run(deps.platform === 'win32' ? 'where' : 'which', ['git'])
    return true
  } catch {
    return false
  }
}

function gitSource(cfg: SourceConfig, deps: SourceDeps): GlossarySource {
  const fail = (m: string) => new GlossaryError('git', m)
  let ready: Promise<void> | undefined
  const sync = async (): Promise<void> => {
    if (!parseRepoUrl(cfg.repoUrl)) throw fail('repo URL must start with https://')
    if (!(await gitAvailable(deps))) throw fail('git was not found on PATH; install git or choose another method')
    const url = cfg.repoUrl.trim()
    try {
      if (await deps.exists(`${deps.cacheDir}/.git`)) {
        await deps.run('git', ['-C', deps.cacheDir, 'fetch', '--depth', '1', 'origin', cfg.ref])
        await deps.run('git', ['-C', deps.cacheDir, 'reset', '--hard', 'FETCH_HEAD'])
      } else {
        await deps.run('git', ['clone', '--depth', '1', '--branch', cfg.ref, url, deps.cacheDir])
      }
    } catch (e) {
      const err = e as Error & { stderr?: string }
      const detail = (err.stderr || err.message).split('\n').find((l) => l.trim()) ?? 'unknown error'
      throw fail(`git failed: ${detail.replace(/\/\/[^/@\s]+@/g, '//')}`)
    }
  }
  const read = async (file: string): Promise<string> => {
    checkPath(file)
    ready ??= sync()
    await ready
    try {
      return await deps.readFile(`${deps.cacheDir}/${file}`)
    } catch {
      throw fail(`${file} not found in the repo at ${cfg.ref}`)
    }
  }
  return { method: 'git', fetchManifest: () => read('glossary.json'), fetchNote: read }
}

export function createSource(cfg: SourceConfig, deps: SourceDeps): GlossarySource {
  return cfg.method === 'git' ? gitSource(cfg, deps) : httpSource(cfg, deps)
}
