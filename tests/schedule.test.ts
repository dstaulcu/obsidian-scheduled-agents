import { getLatestOccurrence, isJobDue } from '../src/core/schedule'

const d = (s: string) => new Date(s.replace(' ', 'T')) // local time, like [datetime]'...'

describe('getLatestOccurrence', () => {
  it('weekly: most recent Sunday 06:00 (Thu 2026-10-22 -> Sun 10-18)', () => {
    const job = { schedule: 'weekly', day: 'sunday', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2026-10-22 12:00'))).toEqual(d('2026-10-18 06:00'))
  })
  it('weekly: on the day but before the time rolls back a week', () => {
    const job = { schedule: 'weekly', day: 'sunday', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2026-10-25 05:00'))).toEqual(d('2026-10-18 06:00'))
  })
  it('daily: before the time uses yesterday', () => {
    const job = { schedule: 'daily', day: '', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2026-10-22 05:00'))).toEqual(d('2026-10-21 06:00'))
  })
  it('hourly: top of the current hour', () => {
    const job = { schedule: 'hourly', day: '', at: '' } as const
    expect(getLatestOccurrence(job, d('2026-10-22 13:47'))).toEqual(d('2026-10-22 13:00'))
  })
  it('monthly: day 31 clamps to month end', () => {
    const job = { schedule: 'monthly', day: '31', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2026-11-30 12:00'))).toEqual(d('2026-11-30 06:00'))
  })
  it("monthly: before this month's day uses the previous month", () => {
    const job = { schedule: 'monthly', day: '15', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2026-10-10 12:00'))).toEqual(d('2026-09-15 06:00'))
  })
  it('monthly: crosses a year boundary', () => {
    const job = { schedule: 'monthly', day: '15', at: '06:00' } as const
    expect(getLatestOccurrence(job, d('2027-01-10 12:00'))).toEqual(d('2026-12-15 06:00'))
  })
  it('defaults to 06:00 when at is empty', () => {
    const job = { schedule: 'daily', day: '', at: '' } as const
    expect(getLatestOccurrence(job, d('2026-10-22 12:00'))).toEqual(d('2026-10-22 06:00'))
  })
  it('rejects bad input', () => {
    expect(() => getLatestOccurrence({ schedule: 'weekly', day: 'funday', at: '06:00' }, new Date())).toThrow()
    expect(() => getLatestOccurrence({ schedule: 'daily', day: '', at: '25:00' }, new Date())).toThrow()
  })
})

describe('isJobDue', () => {
  const job = { schedule: 'weekly', day: 'sunday', at: '06:00' } as const
  it('is due when the PC was off over the occurrence (catch-up, once)', () => {
    const state = { firstSeen: '2026-10-01T09:00:00', lastRun: '2026-10-11T06:01:00', failures: 0 }
    expect(isJobDue(job, state, d('2026-10-20 08:00'))).toBe(true)
  })
  it('is not due again after running for that occurrence', () => {
    const state = { firstSeen: '2026-10-01T09:00:00', lastRun: '2026-10-18T06:02:00', failures: 0 }
    expect(isJobDue(job, state, d('2026-10-22 08:00'))).toBe(false)
  })
  it('does not fire an occurrence from before the job was first seen', () => {
    expect(isJobDue(job, { firstSeen: '2026-10-20T09:00:00', failures: 0 }, d('2026-10-22 08:00'))).toBe(false)
  })
  it('fires the first occurrence after first seen', () => {
    expect(isJobDue(job, { firstSeen: '2026-10-20T09:00:00', failures: 0 }, d('2026-10-25 06:30'))).toBe(true)
  })
  it('tolerates .NET 7-digit fractional timestamps from the old state.json', () => {
    const state = { firstSeen: '2026-10-01T09:00:00.1234567-05:00', lastRun: '2026-10-18T06:02:00.7654321-05:00', failures: 0 }
    expect(isJobDue(job, state, d('2026-10-22 08:00'))).toBe(false)
  })
})
