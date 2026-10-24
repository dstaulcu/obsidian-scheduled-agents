import { JobConfig, MODES, SCHEDULES } from './types'
import { getLatestOccurrence } from './schedule'

export const SKILL_NAME = /^[\w][\w:.-]*$/

/** Parse a comma/newline separated skills string (or list); throws on invalid names. */
export function parseSkills(raw: string[] | string): string[] {
  const list = (Array.isArray(raw) ? raw : raw.split(/[,\n]/)).flatMap((s) => String(s).split(','))
  const names = list.map((s) => s.trim()).filter(Boolean)
  for (const n of names) if (!SKILL_NAME.test(n)) throw new Error(`Invalid skill name '${n}'`)
  return names
}

/** Returns an error message, or null when the job is runnable/schedulable. */
export function validateJob(job: JobConfig): string | null {
  if (!job.name.trim()) return 'Name is required'
  if (/[\\/:*?"<>|[\]#^]/.test(job.name)) return 'Name may not contain \\ / : * ? " < > | [ ] # ^'
  if (!SCHEDULES.includes(job.schedule)) return `Unknown schedule '${job.schedule}'`
  if (!MODES.includes(job.mode)) return `Unknown mode '${job.mode}'`
  if (!job.output.trim()) return 'Output page is required'
  if (!job.prompt.trim()) return 'Prompt is empty'
  try {
    getLatestOccurrence(job, new Date())
    parseSkills(job.skills)
  } catch (e) {
    return (e as Error).message
  }
  return null
}
