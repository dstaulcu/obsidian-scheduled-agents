import { checkCapabilities, JobExecutor } from '../executors/types'
import { DEFAULT_PLUGIN_FOLDER } from '../brand'
import { DailyNotesConfig, dailyNotesVars, DEFAULT_DAILY_NOTES } from './dailyNotes'
import { expandTemplate, fmtDate, fmtStamp, fmtTime } from './templates'
import { JobConfig, MODES, RunResult } from './types'
import { resolveVaultPath, PathRules } from './vaultPath'
import { VaultIO } from './vaultIO'

export interface RunSettings {
  vaultPath: string
  defaultModel: string
  defaultTimeoutMinutes: number
  maxBudgetUsd: number
  rules: PathRules
  /** Where daily notes live; exposed to prompts and output paths as {{dailyNotes*}}. */
  dailyNotes?: DailyNotesConfig
  /** Plugin-folder and naming values exposed to prompts and output paths. */
  brand?: BrandVars
}

const DEFAULT_BRAND: BrandVars = {
  pluginFolder: DEFAULT_PLUGIN_FOLDER,
  pluginName: 'This plugin',
  skipPaths: `\`.obsidian/\`, \`${DEFAULT_PLUGIN_FOLDER}/\``,
  vocabularyPath: `${DEFAULT_PLUGIN_FOLDER}/Tag Glossary.md`,
  bootstrap: '',
}

export interface BrandVars {
  pluginFolder: string
  pluginName: string
  /** Comma-separated, backticked folder list for prompts to skip. */
  skipPaths: string
  /** Vault-relative path of the tag vocabulary note (the single source for tags, definitions and status). */
  vocabularyPath: string
  /** Extra prompt text for Tag Review when the vocabulary is empty or missing; empty otherwise. */
  bootstrap: string
}

const vars = (s: { dailyNotes?: DailyNotesConfig; brand?: BrandVars }) => ({
  ...dailyNotesVars(s.dailyNotes ?? DEFAULT_DAILY_NOTES),
  ...(s.brand ?? DEFAULT_BRAND),
})

export interface RunDeps {
  settings: RunSettings
  io: VaultIO
  executor: JobExecutor
}

export function buildPrompt(job: JobConfig, now: Date, vault: string, s?: { dailyNotes?: DailyNotesConfig; brand?: BrandVars }): string {
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const preamble = [
    `Today is ${today}. The Obsidian vault is at: ${vault}`,
    'You have read-only access to it. Respond with ONLY the markdown to be written to the output page,',
    'with no preamble or commentary. Link to vault notes with [[wikilinks]].',
    '',
  ].join('\n')
  return preamble + '\n' + expandTemplate(job.prompt, now, vault, vars(s ?? {}))
}

/** Resolve where a job would write (also used for validation and previews). */
export function resolveOutput(job: JobConfig, now: Date, s: RunSettings): string {
  return resolveVaultPath(expandTemplate(job.output, now, s.vaultPath, vars(s)), s.rules)
}

/** Run one job through the executor and write its result into the vault. Never throws. */
export async function runJob(job: JobConfig, now: Date, deps: RunDeps): Promise<RunResult> {
  const { settings: s, io, executor } = deps
  const started = Date.now()
  const secs = () => Math.round((Date.now() - started) / 100) / 10
  try {
    if (!MODES.includes(job.mode)) throw new Error(`Unknown mode '${job.mode}'`)
    const unfit = checkCapabilities(job, executor.capabilities)
    if (unfit) throw new Error(unfit)
    let outPath = resolveOutput(job, now, s)
    const timeoutMin = job.timeoutMinutes > 0 ? job.timeoutMinutes : s.defaultTimeoutMinutes

    const r = await executor.execute({
      prompt: buildPrompt(job, now, s.vaultPath, s),
      cwd: s.vaultPath,
      model: job.model.trim() || s.defaultModel,
      timeoutMs: timeoutMin * 60_000,
      maxBudgetUsd: s.maxBudgetUsd,
      skills: job.skills,
    })
    if (!r.ok) return { ok: false, message: r.error ?? 'executor failed', seconds: secs() }

    const text = r.text.trim()
    const front = `---\nsource: "${sourceRef(job)}"\ngenerated: ${fmtStamp(now)}\n---\n`
    if (job.mode === 'new') {
      if (await io.exists(outPath)) outPath = outPath.replace(/\.md$/, ` ${fmtTime(now).replace(':', '')}.md`)
      await io.writeAtomic(outPath, front + text + '\n')
    } else if (job.mode === 'append') {
      const existing = (await io.exists(outPath)) ? await io.read(outPath) : ''
      const section = `\n## ${fmtDate(now)} ${fmtTime(now)} (${sourceRef(job)})\n${text}\n`
      await io.writeAtomic(outPath, existing.trimEnd() + '\n' + section)
    } else {
      await io.writeAtomic(outPath, front + text + '\n')
    }
    return { ok: true, message: 'ok', seconds: secs(), cost: r.costUsd, outputPath: outPath }
  } catch (e) {
    return { ok: false, message: (e as Error).message, seconds: secs() }
  }
}

/** Wikilink to the job's name; built-ins use plain text so they cannot capture a user's note of the same name. */
export function sourceRef(job: Pick<JobConfig, 'name' | 'builtin'>): string {
  return job.builtin ? job.name : `[[${job.name}]]`
}
