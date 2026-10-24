import { DAY_NAMES, JobConfig, JobState } from './types'

type ScheduleFields = Pick<JobConfig, 'schedule' | 'at' | 'day'>

function parseAt(at: string | undefined): { h: number; m: number } {
  if (!at) return { h: 6, m: 0 }
  const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim())
  if (!match) throw new Error(`Invalid time '${at}' (expected HH:mm)`)
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) throw new Error(`Invalid time '${at}'`)
  return { h, m }
}

/** Most recent scheduled time <= now for a job's schedule. */
export function getLatestOccurrence(job: ScheduleFields, now: Date): Date {
  const { h, m } = parseAt(job.at)
  const y = now.getFullYear()
  const mo = now.getMonth()
  const d = now.getDate()

  switch (job.schedule) {
    case 'hourly':
      return new Date(y, mo, d, now.getHours())
    case 'daily': {
      const t = new Date(y, mo, d, h, m)
      if (t > now) t.setDate(t.getDate() - 1)
      return t
    }
    case 'weekly': {
      const dow = DAY_NAMES.indexOf(String(job.day).trim().toLowerCase())
      if (dow < 0) throw new Error(`Invalid weekday '${job.day}'`)
      const back = (now.getDay() - dow + 7) % 7
      const t = new Date(y, mo, d - back, h, m)
      if (t > now) t.setDate(t.getDate() - 7)
      return t
    }
    case 'monthly': {
      const want = Number(job.day)
      if (!Number.isInteger(want) || want < 1 || want > 31) {
        throw new Error(`Invalid day of month '${job.day}'`)
      }
      for (let n = 0; n < 3; n++) {
        const dim = new Date(y, mo - n + 1, 0).getDate()
        const t = new Date(y, mo - n, Math.min(want, dim), h, m) // day 31 clamps to month end
        if (t <= now) return t
      }
      throw new Error('unreachable: no monthly occurrence found')
    }
    default:
      throw new Error(`Unknown schedule '${String(job.schedule)}'`)
  }
}

/** Parse stored timestamps, tolerating .NET's 7-digit fractional seconds. */
export function parseStamp(s: string | undefined): Date | undefined {
  if (!s) return undefined
  const t = new Date(s.replace(/(\.\d{3})\d+/, '$1'))
  return isNaN(t.getTime()) ? undefined : t
}

/** Due when the latest occurrence is after both lastRun and firstSeen (gives catch-up + no back-firing). */
export function isJobDue(job: ScheduleFields, state: Partial<JobState>, now: Date): boolean {
  const occ = getLatestOccurrence(job, now)
  const first = parseStamp(state.firstSeen)
  const last = parseStamp(state.lastRun)
  let floor = new Date(0)
  if (first) floor = first
  if (last && last > floor) floor = last
  return occ > floor
}
