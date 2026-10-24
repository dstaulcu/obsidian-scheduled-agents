export type ScheduleKind = 'hourly' | 'daily' | 'weekly' | 'monthly'
export type OutputMode = 'new' | 'append' | 'replace'

export interface JobConfig {
  id: string
  name: string
  enabled: boolean
  schedule: ScheduleKind
  at: string // "HH:mm", ignored for hourly
  day: string // weekly: day name; monthly: day of month
  output: string // vault-relative, templates allowed
  mode: OutputMode
  model: string // empty = default
  timeoutMinutes: number // 0 = default
  skills: string[]
  prompt: string
}

export interface JobState {
  firstSeen?: string
  lastRun?: string
  failures: number
}

export interface RunResult {
  ok: boolean
  message: string
  seconds: number
  cost?: number
  outputPath?: string
}

export const SCHEDULES: ScheduleKind[] = ['hourly', 'daily', 'weekly', 'monthly']
export const MODES: OutputMode[] = ['new', 'append', 'replace']
export const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]
