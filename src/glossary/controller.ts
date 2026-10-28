import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as nodePath from 'path'
import { Notice, normalizePath, requestUrl, TFile } from 'obsidian'
import { LOG_TAG } from '../brand'
import type AgentPlugin from '../main'
import { GlossaryPreviewModal } from '../ui/GlossaryPreviewModal'
import { applyImport, GlossaryVault } from './apply'
import { parseManifest } from './manifest'
import { planImport, summarize } from './plan'
import { renameTagInText } from './rename'
import { createSource, GlossaryError, SourceConfig, SourceDeps } from './sources'
import { sha256 } from './stamp'

const SECRET_ID = 'scheduled-agents-glossary-token'

interface SecretStorage {
  getSecret(id: string): string | null
  setSecret(id: string, value: string): void
}

/** Obsidian's secret storage exists only on newer versions; older ones fall back to data.json. */
function secretStorage(plugin: AgentPlugin): SecretStorage | null {
  const s = (plugin.app as unknown as { secretStorage?: SecretStorage }).secretStorage
  return s && typeof s.getSecret === 'function' && typeof s.setSecret === 'function' ? s : null
}

export function hasSecretStorage(plugin: AgentPlugin): boolean {
  return secretStorage(plugin) !== null
}

export function getToken(plugin: AgentPlugin): string {
  return secretStorage(plugin)?.getSecret(SECRET_ID) ?? plugin.settings.glossary.token
}

export async function setToken(plugin: AgentPlugin, token: string): Promise<void> {
  const store = secretStorage(plugin)
  if (store) {
    store.setSecret(SECRET_ID, token)
    plugin.settings.glossary.token = ''
  } else {
    plugin.settings.glossary.token = token
  }
  await plugin.saveSettings()
}

function nodeDeps(cfg: SourceConfig): SourceDeps {
  const key = sha256(`${cfg.repoUrl}#${cfg.ref}`).slice(0, 12)
  return {
    platform: process.platform,
    cacheDir: nodePath.join(os.tmpdir(), `scheduled-agents-glossary-${key}`),
    httpGet: async (url, headers) => {
      const r = await requestUrl({ url, headers, throw: false })
      return { status: r.status, text: r.text }
    },
    run: (file, args, opts) =>
      new Promise((resolve, reject) => {
        // GIT_TERMINAL_PROMPT=0: fail instead of waiting on a credential prompt nobody can see
        execFile(
          file,
          args,
          { cwd: opts?.cwd, windowsHide: true, timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
          (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout })),
        )
      }),
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    exists: (p) =>
      fs.promises.access(p).then(
        () => true,
        () => false,
      ),
  }
}

/** Reject destinations that are empty, absolute, or hidden (nothing is ever written to hidden folders). */
export function destError(dest: string): string | null {
  const d = dest.trim().replace(/^\/+|\/+$/g, '')
  if (!d) return 'Choose a destination folder'
  if (d.split('/').some((s) => !s || s === '..' || s.startsWith('.'))) return 'Choose a normal vault folder (no hidden folders)'
  return null
}

function vaultAdapter(plugin: AgentPlugin): GlossaryVault {
  const vault = plugin.app.vault
  return {
    read: async (path) => ((await vault.adapter.exists(normalizePath(path))) ? vault.adapter.read(normalizePath(path)) : null),
    create: async (path, content) => {
      const p = normalizePath(path)
      const parts = p.split('/').slice(0, -1)
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/')
        if (!(await vault.adapter.exists(d))) await vault.createFolder(d)
      }
      await vault.create(p, content)
    },
    modify: async (path, content) => {
      const f = vault.getAbstractFileByPath(normalizePath(path))
      if (!(f instanceof TFile)) throw new Error(`${path} is not in the vault index yet; try again`)
      await vault.modify(f, content)
    },
  }
}

let running = false

/** Fetch, plan, preview and apply. With `checkOnly` it only reports what is pending and never opens the modal or writes. */
export async function importGlossary(plugin: AgentPlugin, opts: { checkOnly?: boolean } = {}): Promise<void> {
  const g = plugin.settings.glossary
  const name = 'Glossary'
  if (running) return
  if (!g.repoUrl.trim()) {
    if (!opts.checkOnly) new Notice(`${name}: set the glossary repo URL in the plugin settings first`)
    return
  }
  const bad = destError(g.destFolder)
  if (bad) {
    if (!opts.checkOnly) new Notice(`${name}: ${bad}`)
    return
  }
  running = true
  try {
    const cfg: SourceConfig = { repoUrl: g.repoUrl.trim(), ref: g.ref.trim() || 'main', method: g.authMethod, token: getToken(plugin) }
    const source = createSource(cfg, nodeDeps(cfg))
    const manifest = parseManifest(await source.fetchManifest())
    const vault = vaultAdapter(plugin)
    const plan = await planImport(manifest, g.destFolder, (p) => vault.read(p))
    const pending = plan.counts.new + plan.counts.updated + plan.counts.conflict
    if (opts.checkOnly) {
      if (pending) new Notice(`${summarize(plan.counts)}. Run "Import / update tag glossary" to review.`, 8000)
      return
    }
    const hasDeprecated = plan.items.some((i) => i.entry.status === 'deprecated' && i.entry.replaced_by)
    if (!pending && !hasDeprecated) {
      new Notice(summarize(plan.counts))
      return
    }
    const dest = normalizePath(g.destFolder)
    new GlossaryPreviewModal(
      plugin.app,
      plan,
      async (tag) => (await usages(plugin, dest, tag)).length,
      async ({ decisions, renames }) => {
        try {
          const r = await applyImport(decisions, (p) => source.fetchNote(p), vault)
          const conflicts = decisions.filter((d) => d.item.category === 'conflict' && (d.choice ?? 'keep') === 'keep').length
          const parts = [r.created && `${r.created} new`, r.updated && `${r.updated} updated`, r.copies.length && `${r.copies.length} saved as copy`, conflicts && `${conflicts} kept as yours`].filter(Boolean)
          let msg = parts.length ? `Glossary: ${parts.join(', ')}` : 'Glossary: nothing written'
          for (const rn of renames) {
            const n = await renameUsages(plugin, dest, rn.from, rn.to)
            msg += `. Renamed #${rn.from} in ${n} note${n === 1 ? '' : 's'}`
          }
          new Notice(msg, 8000)
        } catch (e) {
          fail(e)
        }
      },
    ).open()
  } catch (e) {
    if (!opts.checkOnly) fail(e)
    else console.warn(`[${LOG_TAG}] glossary startup check failed`, e)
  } finally {
    running = false
  }
}

function fail(e: unknown): void {
  console.error(`[${LOG_TAG}] glossary import failed`, e)
  const msg = e instanceof GlossaryError ? e.message : `Glossary: ${(e as Error).message}`
  new Notice(`${msg}. No notes were changed.`, 10000)
}

/** Markdown notes outside the glossary folder that mention the tag. */
async function usages(plugin: AgentPlugin, dest: string, tag: string): Promise<TFile[]> {
  const out: TFile[] = []
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (f.path.startsWith(dest + '/')) continue
    const text = await plugin.app.vault.cachedRead(f)
    if (renameTagInText(text, tag, '\u0000') !== text) out.push(f)
  }
  return out
}

async function renameUsages(plugin: AgentPlugin, dest: string, from: string, to: string): Promise<number> {
  let n = 0
  for (const f of await usages(plugin, dest, from)) {
    await plugin.app.vault.process(f, (t) => renameTagInText(t, from, to))
    n++
  }
  return n
}
