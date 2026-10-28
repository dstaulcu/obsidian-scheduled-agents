import { applyImport, GlossaryVault } from '../src/glossary/apply'
import { Manifest, parseManifest } from '../src/glossary/manifest'
import { planImport, summarize } from '../src/glossary/plan'
import { renameTagInText } from '../src/glossary/rename'
import { createSource, parseRepoUrl, rawUrl, SourceDeps } from '../src/glossary/sources'
import { readStamp, sha256, stamp, stripStamp } from '../src/glossary/stamp'

const note = (tag: string, extra = '') => `---\ntag: ${tag}\nstatus: active\n---\n\n# ${tag}\n${extra}\n`
const entry = (path: string, text: string) => ({
  tag: path.replace(/\.md$/, ''),
  facet: path.split('/')[0],
  status: 'active' as const,
  replaced_by: null,
  path,
  hash: sha256(text),
})

class FakeVault implements GlossaryVault {
  files = new Map<string, string>()
  writes = 0
  async read(p: string) {
    return this.files.get(p) ?? null
  }
  async create(p: string, c: string) {
    this.writes++
    this.files.set(p, c)
  }
  async modify(p: string, c: string) {
    this.writes++
    this.files.set(p, c)
  }
}

describe('stamp', () => {
  it('round-trips: stripping a stamp restores the original text', () => {
    const t = note('tools/git')
    const h = sha256(t)
    expect(stripStamp(stamp(t, h))).toBe(t)
    expect(readStamp(stamp(t, h))).toBe(h)
  })
  it('adds front matter to a note that has none', () => {
    expect(stripStamp(stamp('# plain\n', 'a'.repeat(64)))).toBe('---\n---\n# plain\n')
  })
})

describe('parseManifest', () => {
  const ok = { version: 1, tags: [{ tag: 'tools/git', facet: 'tools', status: 'active', replaced_by: null, path: 'tools/git.md', hash: 'a'.repeat(64) }] }
  it('accepts a valid manifest', () => expect(parseManifest(JSON.stringify(ok)).tags).toHaveLength(1))
  it.each(['../x.md', '/abs.md', 'tools/../x.md', '.hidden/x.md', 'other/x.md', 'tools/x.txt', 'tools/a/b.md', 'tools\\x.md'])('rejects path %s', (path) => {
    const bad = { ...ok, tags: [{ ...ok.tags[0], path }] }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow()
  })
  it('rejects bad hashes and bad JSON', () => {
    expect(() => parseManifest(JSON.stringify({ ...ok, tags: [{ ...ok.tags[0], hash: 'zz' }] }))).toThrow()
    expect(() => parseManifest('{')).toThrow()
  })
})

describe('plan and apply', () => {
  const a = note('tools/git')
  const b = note('tools/github')
  const manifest = (): Manifest => ({ version: 1, tags: [entry('tools/git.md', a), entry('tools/github.md', b)] })
  const fetchNote = async (p: string) => (p === 'tools/git.md' ? a : b)
  const run = async (v: FakeVault, m = manifest(), choice?: 'keep' | 'theirs' | 'copy', f = fetchNote) => {
    const plan = await planImport(m, 'Glossary', (p) => v.read(p))
    const res = await applyImport(plan.items.map((item) => ({ item, choice })), f, v)
    return { plan, res }
  }

  it('imports everything into a fresh vault', async () => {
    const v = new FakeVault()
    const { plan, res } = await run(v)
    expect(plan.counts.new).toBe(2)
    expect(res.created).toBe(2)
    expect(v.files.get('Glossary/tools/git.md')).toBe(stamp(a, sha256(a)))
  })

  it('reports up to date and writes nothing on a re-run', async () => {
    const v = new FakeVault()
    await run(v)
    v.writes = 0
    const { plan } = await run(v)
    expect(summarize(plan.counts)).toBe('Glossary: up to date')
    expect(v.writes).toBe(0)
  })

  it('updates a note the user did not touch', async () => {
    const v = new FakeVault()
    await run(v)
    const a2 = note('tools/git', 'more')
    const m = { version: 1, tags: [entry('tools/git.md', a2), entry('tools/github.md', b)] }
    const { res } = await run(v, m, undefined, async (p) => (p === 'tools/git.md' ? a2 : b))
    expect(res.updated).toBe(1)
    expect(stripStamp(v.files.get('Glossary/tools/git.md')!)).toBe(a2)
  })

  it('flags a locally edited note as a conflict and does not overwrite it', async () => {
    const v = new FakeVault()
    await run(v)
    const mine = v.files.get('Glossary/tools/git.md')! + 'my edit\n'
    v.files.set('Glossary/tools/git.md', mine)
    const a2 = note('tools/git', 'upstream change')
    const m = { version: 1, tags: [entry('tools/git.md', a2), entry('tools/github.md', b)] }
    const f = async (p: string) => (p === 'tools/git.md' ? a2 : b)
    v.writes = 0
    const { plan } = await run(v, m, undefined, f)
    expect(plan.counts.conflict).toBe(1)
    expect(summarize(plan.counts)).toBe('Glossary: 1 conflict')
    expect(v.files.get('Glossary/tools/git.md')).toBe(mine)
    expect(v.writes).toBe(0)

    await run(v, m, 'copy', f)
    expect(v.files.get('Glossary/tools/git.md')).toBe(mine)
    expect(stripStamp(v.files.get('Glossary/tools/git (glossary).md')!)).toBe(a2)

    await run(v, m, 'theirs', f)
    expect(stripStamp(v.files.get('Glossary/tools/git.md')!)).toBe(a2)
  })

  it('treats an existing unstamped note that differs as a conflict', async () => {
    const v = new FakeVault()
    v.files.set('Glossary/tools/git.md', 'my own page')
    const { plan } = await run(v, undefined, 'keep')
    expect(plan.items[0].category).toBe('conflict')
    expect(v.files.get('Glossary/tools/git.md')).toBe('my own page')
  })

  it('writes nothing when any fetch fails', async () => {
    const v = new FakeVault()
    const f = async (p: string) => {
      if (p.endsWith('github.md')) throw new Error('401')
      return a
    }
    await expect(run(v, undefined, undefined, f)).rejects.toThrow('401')
    expect(v.writes).toBe(0)
  })

  it('refuses content that does not match the manifest hash', async () => {
    const v = new FakeVault()
    await expect(run(v, undefined, undefined, async () => 'tampered')).rejects.toThrow('manifest hash')
    expect(v.writes).toBe(0)
  })
})

describe('sources', () => {
  const deps = (over: Partial<SourceDeps> = {}): SourceDeps => ({
    httpGet: async () => ({ status: 200, text: 'x' }),
    run: async () => ({ stdout: '' }),
    readFile: async () => 'file',
    exists: async () => false,
    platform: 'win32',
    cacheDir: '/cache',
    ...over,
  })
  const cfg = (method: 'https' | 'git' | 'token', extra = {}) => ({ repoUrl: 'https://github.com/o/r', ref: 'main', method, ...extra })

  it('derives raw URLs for GitHub and GitLab', () => {
    expect(rawUrl(parseRepoUrl('https://github.com/o/r.git')!, 'main', 'glossary.json')).toBe('https://raw.githubusercontent.com/o/r/main/glossary.json')
    expect(rawUrl(parseRepoUrl('https://gitlab.corp/g/sub/r')!, 'v1', 'tools/git.md')).toBe('https://gitlab.corp/g/sub/r/-/raw/v1/tools/git.md')
    expect(parseRepoUrl('git@github.com:o/r.git')).toBeNull()
  })

  it('names the method and status on failure', async () => {
    const s = createSource(cfg('https'), deps({ httpGet: async () => ({ status: 404, text: '' }) }))
    await expect(s.fetchManifest()).rejects.toThrow(/Glossary \(https\).*404/)
    const t = createSource(cfg('token', { token: 't' }), deps({ httpGet: async () => ({ status: 401, text: '' }) }))
    await expect(t.fetchManifest()).rejects.toThrow(/Glossary \(token\).*401/)
  })

  it('sends the token only as a header and never in the URL or error', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const httpGet = async (url: string, headers: Record<string, string>) => {
      seen.push({ url, headers })
      return { status: 500, text: '' }
    }
    const s = createSource(cfg('token', { token: 'SECRET' }), deps({ httpGet }))
    const err = await s.fetchManifest().catch((e: Error) => e)
    expect(seen[0].url).not.toContain('SECRET')
    expect(seen[0].headers.Authorization).toBe('Bearer SECRET')
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('probes git with where on Windows and which elsewhere, and reports it missing', async () => {
    const calls: string[] = []
    const run = async (file: string): Promise<{ stdout: string }> => {
      calls.push(file)
      throw Object.assign(new Error('nope'), { code: 'ENOENT' })
    }
    for (const platform of ['win32', 'linux']) {
      const s = createSource(cfg('git'), deps({ run, platform }))
      await expect(s.fetchManifest()).rejects.toThrow(/Glossary \(git\).*git was not found/)
    }
    expect(calls).toEqual(['where', 'which'])
  })

  it('clones then reads from the cache, and rejects unsafe paths', async () => {
    const runs: string[][] = []
    const run = async (f: string, a: string[]) => {
      runs.push([f, ...a])
      return { stdout: '' }
    }
    const s = createSource({ ...cfg('git'), ref: 'v1' }, deps({ run }))
    expect(await s.fetchManifest()).toBe('file')
    expect(runs[1]).toEqual(['git', 'clone', '--depth', '1', '--branch', 'v1', 'https://github.com/o/r', '/cache'])
    await expect(s.fetchNote('../secret.md')).rejects.toThrow('unsafe')
  })
})

describe('renameTagInText', () => {
  it('renames whole tags and children only', () => {
    const t = 'a #tools/git b #tools/gitlab c #tools/git/sub, #tools/git.\n'
    expect(renameTagInText(t, 'tools/git', 'tools/vcs')).toBe('a #tools/vcs b #tools/gitlab c #tools/vcs/sub, #tools/vcs.\n')
  })
  it('handles front-matter lists and skips code', () => {
    const t = '---\ntags:\n  - tools/git\n  - tools/gitlab\n---\n`#tools/git` #tools/git\n```\n#tools/git\n```\n'
    const want = '---\ntags:\n  - tools/vcs\n  - tools/gitlab\n---\n`#tools/git` #tools/vcs\n```\n#tools/git\n```\n'
    expect(renameTagInText(t, 'tools/git', 'tools/vcs')).toBe(want)
  })
})
