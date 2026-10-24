import { JobExecutor } from '../executors/types'
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
}

export interface RunDeps {
  settings: RunSettings
  io: VaultIO
  executor: JobExecutor
}

export function buildPrompt(job: JobConfig, now: Date, vault: string): string {
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
  return preamble + '\n' + expandTemplate(job.prompt, now, vault)
}

/** Resolve where a job would write (also used for validation and previews). */
export function resolveOutput(job: JobConfig, now: Date, s: RunSettings): string {
  return resolveVaultPath(expandTemplate(job.output, now, s.vaultPath), s.rules)
}

/** Run one job through the executor and write its result into the vault. Never throws. */
export async function runJob(job: JobConfig, now: Date, deps: RunDeps): Promise<RunResult> {
  const { settings: s, io, executor } = deps
  const started = Date.now()
  const secs = () => Math.round((Date.now() - started) / 100) / 10
  try {
    if (!MODES.includes(job.mode)) throw new Error(`Unknown mode '${job.mode}'`)
    let outPath = resolveOutput(job, now, s)
    const timeoutMin = job.timeoutMinutes > 0 ? job.timeoutMinutes : s.defaultTimeoutMinutes

    const r = await executor.execute({
      prompt: buildPrompt(job, now, s.vaultPath),
      cwd: s.vaultPath,
      model: job.model.trim() || s.defaultModel,
      timeoutMs: timeoutMin * 60_000,
      maxBudgetUsd: s.maxBudgetUsd,
      skills: job.skills,
    })
    if (!r.ok) return { ok: false, message: r.error ?? 'executor failed', seconds: secs() }

    const text = r.text.trim()
    const front = `---\nsource: "[[${job.name}]]"\ngenerated: ${fmtStamp(now)}\n---\n`
    if (job.mode === 'new') {
      if (await io.exists(outPath)) outPath = outPath.replace(/\.md$/, ` ${fmtTime(now).replace(':', '')}.md`)
      await io.writeAtomic(outPath, front + text + '\n')
    } else if (job.mode === 'append') {
      const existing = (await io.exists(outPath)) ? await io.read(outPath) : ''
      const section = `\n## ${fmtDate(now)} ${fmtTime(now)} ([[${job.name}]])\n${text}\n`
      await io.writeAtomic(outPath, existing.trimEnd() + '\n' + section)
    } else {
      await io.writeAtomic(outPath, front + text + '\n')
    }
    return { ok: true, message: 'ok', seconds: secs(), cost: r.costUsd, outputPath: outPath }
  } catch (e) {
    return { ok: false, message: (e as Error).message, seconds: secs() }
  }
}
