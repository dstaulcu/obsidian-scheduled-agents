import * as os from 'os'
import * as path from 'path'
import { JobConfig, JobState } from './core/types'

export const SCHEMA_VERSION = 1

export interface BrainAgentSettings {
  schemaVersion: number
  executor: 'claude-cli'
  claudePath: string
  defaultModel: string
  defaultTimeoutMinutes: number
  maxBudgetUsd: number
  maxRetries: number
  pollSeconds: number
  runLogPage: string
  /** Legacy prompt-note folder: import source, and never a valid output target. */
  promptsFolder: string
  /** Outputs may only be written under these vault-relative folders. */
  allowedOutputFolders: string[]
  schedulerEnabled: boolean
  jobs: JobConfig[]
  state: Record<string, JobState>
}

export function defaultClaudePath(): string {
  return process.platform === 'win32' ? path.join(os.homedir(), '.local', 'bin', 'claude.exe') : 'claude'
}

export function defaultSettings(): BrainAgentSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    executor: 'claude-cli',
    claudePath: defaultClaudePath(),
    defaultModel: 'sonnet',
    defaultTimeoutMinutes: 10,
    maxBudgetUsd: 0.5,
    maxRetries: 3,
    pollSeconds: 300,
    runLogPage: 'BrainAgent/Run Log.md',
    promptsFolder: 'BrainAgent/Prompts',
    allowedOutputFolders: ['BrainAgent', 'Weekly Summaries'],
    schedulerEnabled: true,
    jobs: [],
    state: {},
  }
}

/** Merge saved data over defaults; hook for future versioned migrations. */
export function normalizeSettings(raw: Partial<BrainAgentSettings> | null | undefined): BrainAgentSettings {
  const s = { ...defaultSettings(), ...(raw ?? {}) }
  s.schemaVersion = SCHEMA_VERSION
  s.jobs = Array.isArray(s.jobs) ? s.jobs : []
  s.state = s.state && typeof s.state === 'object' ? s.state : {}
  return s
}

export function newJob(): JobConfig {
  return {
    id: `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    enabled: false,
    schedule: 'weekly',
    at: '06:00',
    day: 'sunday',
    output: 'Weekly Summaries/{{week}} Summary',
    mode: 'new',
    model: '',
    timeoutMinutes: 0,
    skills: [],
    prompt: '',
  }
}
