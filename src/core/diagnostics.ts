import { DEFAULT_PLUGIN_FOLDER } from '../brand'
import { ExecutorCapabilities } from '../executors/types'

/** Plain data gathered by the plugin; everything the report may contain is listed here, nothing else leaks in. */
export interface DiagnosticsSnapshot {
  pluginVersion: string
  obsidianVersion: string
  platform: string
  arch: string
  harnessId: string
  harnessPath: string
  /** Output of the harness's version command, or why it could not be read. */
  harnessVersion: string
  capabilities: ExecutorCapabilities
  schedulerEnabled: boolean
  pollSeconds: number
  defaultTimeoutMinutes: number
  maxBudgetUsd: number
  maxRetries: number
  pluginFolder: string
  jobs: DiagnosticsJob[]
  /** Absolute vault root and home directory, used only to scrub paths out of the report. */
  vaultPath: string
  homeDir: string
}

export interface DiagnosticsJob {
  /** Built-in id, or empty for a user-made job (its name is private and never reported). */
  builtin?: string
  enabled: boolean
  schedule: string
  day: string
  at: string
  mode: string
  harness?: string
  hasCustomModel: boolean
  skillCount: number
  outputInPluginFolder: boolean
  lastRun?: string
  failures: number
  lastError?: string
}

const MAX_ERROR = 300

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace the vault and home paths (either slash style, any case) and drop wiki links, which name private notes.
 * Anything under the vault root is a note or folder name, so the whole path collapses to `<vault>/…`.
 */
export function redact(text: string, vaultPath: string, homeDir: string): string {
  let out = text
  const swap = (dir: string, label: string, rest = '') => {
    const d = dir.replace(/[\\/]+$/, '')
    if (!d) return
    const pattern = escapeRegExp(d).replace(/\\\\|\//g, '[\\\\/]')
    out = out.replace(new RegExp(pattern + rest, 'gi'), label)
  }
  // vault first: it usually lives inside the home directory
  swap(vaultPath, '<vault>/…', '(?:[\\\\/][^\\s\'"`|,;)\\]]*)?')
  swap(homeDir, '~')
  return out.replace(/\[\[[^\]]*\]\]/g, '[[…]]')
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function yn(b: boolean): string {
  return b ? 'yes' : 'no'
}

/** Markdown block for pasting into a GitHub issue. Contains no prompts, job names, note content or vault name. */
export function buildDiagnostics(s: DiagnosticsSnapshot): string {
  const r = (t: string) => redact(t, s.vaultPath, s.homeDir)
  const c = s.capabilities
  const lines = [
    `- Plugin: ${s.pluginVersion}`,
    `- Obsidian: ${s.obsidianVersion}`,
    `- OS: ${s.platform} ${s.arch}`,
    `- Harness: ${s.harnessId}`,
    `- Harness path: ${r(s.harnessPath)}`,
    `- Harness version: ${r(clip(s.harnessVersion, 120))}`,
    `- Capabilities: read-only enforced ${yn(c.enforcesReadOnly)}, budget ${yn(c.supportsBudget)}, skills ${yn(c.supportsSkills)}, cost ${yn(c.reportsCost)}`,
    `- Scheduler: ${s.schedulerEnabled ? 'on' : 'off'}, poll ${s.pollSeconds}s, timeout ${s.defaultTimeoutMinutes}m, budget $${s.maxBudgetUsd}, attempts ${s.maxRetries}`,
    `- Plugin folder: ${s.pluginFolder === DEFAULT_PLUGIN_FOLDER ? 'default' : 'custom'}`,
  ]
  const jobs = s.jobs.map((j, i) => {
    const when = j.schedule === 'hourly' ? 'hourly' : `${j.schedule} ${j.day} ${j.at}`
    const parts = [
      j.builtin ? `built-in ${j.builtin}` : `custom job ${i + 1}`,
      j.enabled ? 'enabled' : 'disabled',
      when,
      `mode ${j.mode}`,
      j.harness ? `harness ${j.harness}` : '',
      j.hasCustomModel ? 'custom model' : '',
      j.skillCount ? `${j.skillCount} skill(s)` : '',
      j.outputInPluginFolder ? 'output in plugin folder' : 'output elsewhere',
      `last run ${j.lastRun ?? 'never'}`,
      j.failures ? `${j.failures} recent failure(s)` : '',
    ].filter(Boolean)
    const err = j.lastError ? `\n  - last error: ${r(clip(j.lastError, MAX_ERROR))}` : ''
    return `- ${parts.join(', ')}${err}`
  })
  return ['### Diagnostics', '', ...lines, '', `### Jobs (${s.jobs.length})`, '', ...(jobs.length ? jobs : ['- none'])].join('\n') + '\n'
}
