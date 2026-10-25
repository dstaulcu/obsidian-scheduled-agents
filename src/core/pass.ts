import { isJobDue } from './schedule'
import { JobConfig, JobState, RunResult, SCHEDULES } from './types'

export type LogStatus = 'ok' | 'failed' | 'gave-up' | 'skipped' | 'error'

export interface PassOptions {
  jobs: JobConfig[]
  state: Record<string, JobState>
  now: Date
  maxRetries: number
  /** Run regardless of schedule / enabled flag (optionally for one job id). */
  force?: boolean
  onlyId?: string
  run: (job: JobConfig, now: Date) => Promise<RunResult>
  log: (job: JobConfig, status: LogStatus, detail: string) => Promise<void>
  save: () => Promise<void>
}

/** One scheduler pass (port of Invoke-Pass). Returns the results of jobs that ran. */
export async function runPass(o: PassOptions): Promise<Array<{ job: JobConfig; result: RunResult }>> {
  const ran: Array<{ job: JobConfig; result: RunResult }> = []
  for (const job of o.jobs) {
    if (o.onlyId && job.id !== o.onlyId) continue
    if (!o.force && !job.enabled) continue
    if (!SCHEDULES.includes(job.schedule)) {
      await o.log(job, 'skipped', `missing/unknown schedule '${job.schedule}'`)
      continue
    }

    const s = (o.state[job.id] ??= { failures: 0 })
    if (!s.firstSeen) s.firstSeen = o.now.toISOString()

    let due: boolean
    try {
      due = !!o.force || isJobDue(job, s, o.now)
    } catch (e) {
      await o.log(job, 'skipped', (e as Error).message)
      continue
    }
    if (!due) continue

    const result = await o.run(job, o.now)
    ran.push({ job, result })
    if (result.ok) {
      s.lastRun = o.now.toISOString()
      s.failures = 0
      delete s.lastError
      const cost = result.cost !== undefined ? `, $${result.cost.toFixed(3)}` : ''
      const page = (result.outputPath ?? '').replace(/\.md$/, '').split('/').pop()
      await o.log(job, 'ok', `${result.seconds}s${cost} -> [[${page}]]`)
    } else {
      s.failures += 1
      s.lastError = result.message
      if (s.failures >= o.maxRetries) {
        // give up until the next occurrence
        s.lastRun = o.now.toISOString()
        s.failures = 0
        await o.log(job, 'gave-up', result.message)
      } else {
        await o.log(job, 'failed', `attempt ${s.failures}/${o.maxRetries}: ${result.message}`)
      }
    }
    await o.save()
  }
  await o.save()
  return ran
}

/** One row for the run-log table. */
export function formatLogRow(now: Date, name: string, status: string, detail: string): string {
  const d = detail.replace(/\|/g, '/').replace(/\r?\n/g, ' ')
  const pad = (n: number) => String(n).padStart(2, '0')
  const t = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `| ${t} | [[${name}]] | ${status} | ${d} |`
}

export const RUN_LOG_HEADER = '# Run Log\n\n| Time | Prompt | Status | Detail |\n|---|---|---|---|\n'
