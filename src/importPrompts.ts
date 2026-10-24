import * as fs from 'fs'
import * as path from 'path'
import { App, TFile } from 'obsidian'
import { parseFrontMatter } from './core/frontmatter'
import { JobConfig, JobState, MODES, SCHEDULES } from './core/types'
import { newJob, BrainAgentSettings } from './settings'

export interface ImportReport {
  imported: string[]
  skipped: string[] // "name: reason"
  stateMigrated: number
}

function legacyStatePath(): string {
  const base = process.env.LOCALAPPDATA ?? ''
  return path.join(base, 'BrainAgent', 'state.json')
}

function readLegacyState(): Record<string, { FirstSeen?: string; LastRun?: string; Failures?: number }> {
  try {
    return JSON.parse(fs.readFileSync(legacyStatePath(), 'utf8'))
  } catch {
    return {}
  }
}

/** Import `BrainAgent/Prompts/*.md` notes (and the old state.json) as jobs. Existing jobs with the same name are kept. */
export async function importPromptNotes(app: App, settings: BrainAgentSettings): Promise<ImportReport> {
  const report: ImportReport = { imported: [], skipped: [], stateMigrated: 0 }
  const folder = settings.promptsFolder.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
  const legacy = readLegacyState()
  const files = app.vault.getMarkdownFiles().filter((f: TFile) => f.path.startsWith(folder))

  for (const f of files) {
    const name = f.basename
    if (settings.jobs.some((j) => j.name === name)) {
      report.skipped.push(`${name}: already exists`)
      continue
    }
    const { meta, body } = parseFrontMatter(await app.vault.cachedRead(f))
    const schedule = String(meta.schedule ?? '')
    if (!(SCHEDULES as string[]).includes(schedule)) {
      report.skipped.push(`${name}: missing/unknown schedule '${schedule}'`)
      continue
    }
    if (!meta.output) {
      report.skipped.push(`${name}: no output key`)
      continue
    }
    const skillsRaw = meta.skills
    const job: JobConfig = {
      ...newJob(),
      name,
      enabled: meta.enabled === true,
      schedule: schedule as JobConfig['schedule'],
      at: meta.at !== undefined ? String(meta.at) : '06:00',
      day: meta.day !== undefined ? String(meta.day) : '',
      output: String(meta.output),
      mode: (MODES as string[]).includes(String(meta.mode)) ? (meta.mode as JobConfig['mode']) : 'new',
      model: meta.model !== undefined ? String(meta.model) : '',
      timeoutMinutes: typeof meta.timeout_minutes === 'number' ? meta.timeout_minutes : 0,
      skills: Array.isArray(skillsRaw)
        ? skillsRaw
        : typeof skillsRaw === 'string'
          ? skillsRaw.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      prompt: body,
    }
    settings.jobs.push(job)
    report.imported.push(name)

    const old = legacy[name]
    if (old) {
      const st: JobState = { failures: old.Failures ?? 0, firstSeen: old.FirstSeen, lastRun: old.LastRun }
      settings.state[job.id] = st
      report.stateMigrated++
    }
  }
  return report
}
