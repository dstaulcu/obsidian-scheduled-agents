import { DEFAULT_PLUGIN_FOLDER, LEGACY_PLUGIN_FOLDER } from './brand'
import { JobConfig, JobState } from './core/types'
import { DEFAULT_EXECUTOR_ID, EXECUTORS, HarnessConfig } from './executors/registry'

export const SCHEMA_VERSION = 2

export interface AgentSettings {
  schemaVersion: number
  /** Default harness id (jobs may override with `harness`). */
  executor: string
  harnesses: Record<string, HarnessConfig>
  defaultTimeoutMinutes: number
  maxBudgetUsd: number
  maxRetries: number
  pollSeconds: number
  /** Log job lifecycle (ids, harness, timings; never prompts or note content) to the developer console. */
  debugLogging: boolean
  /** Vault folder for the plugin's own pages (run log, default job output). Set once; never follows a rename. */
  pluginFolder: string
  /** Extra vault folders that jobs are told to skip (the plugin folder and .obsidian are always protected). */
  protectedFolders: string[]
  /** Outputs may only be written under these vault-relative folders. */
  allowedOutputFolders: string[]
  schedulerEnabled: boolean
  /** The first-install tip has been shown (or this install predates it). */
  introShown: boolean
  /** Dev hook: set by scripts/reset-test.mjs so the next load adds built-ins enabled. Consumed once, then removed. */
  seedBuiltinsEnabled?: boolean
  jobs: JobConfig[]
  state: Record<string, JobState>
}

export function defaultSettings(): AgentSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    executor: DEFAULT_EXECUTOR_ID,
    harnesses: Object.fromEntries(EXECUTORS.map((e) => [e.id, e.defaultConfig()])),
    defaultTimeoutMinutes: 10,
    maxBudgetUsd: 0.5,
    maxRetries: 3,
    pollSeconds: 300,
    debugLogging: false,
    introShown: false,
    pluginFolder: DEFAULT_PLUGIN_FOLDER,
    protectedFolders: ['Templates'],
    allowedOutputFolders: [],
    schedulerEnabled: true,
    jobs: [],
    state: {},
  }
}

/** Merge saved data over defaults; hook for future versioned migrations. */
export function normalizeSettings(raw: Partial<AgentSettings> | null | undefined): AgentSettings {
  const legacy = (raw ?? {}) as { claudePath?: string; defaultModel?: string }
  // An install that predates the plugin-folder setting keeps the folder it was already writing to.
  const old = (raw ?? {}) as { runLogPage?: string; pluginFolder?: string; jobs?: unknown[] }
  const inferredFolder =
    old.runLogPage || old.jobs?.length
      ? old.runLogPage?.split('/').slice(0, -1).join('/') || LEGACY_PLUGIN_FOLDER
      : undefined
  const s = { ...defaultSettings(), ...(raw ?? {}) }
  // fill in every known harness; fold the pre-harness flat fields into claude-cli
  const saved = (raw?.harnesses ?? {}) as Record<string, Partial<HarnessConfig>>
  s.harnesses = {}
  for (const e of EXECUTORS) {
    const d = e.defaultConfig()
    const mine = saved[e.id] ?? (e.id === 'claude-cli' ? { path: legacy.claudePath, defaultModel: legacy.defaultModel } : {})
    s.harnesses[e.id] = { path: mine.path || d.path, defaultModel: mine.defaultModel || d.defaultModel }
  }
  if (!EXECUTORS.some((e) => e.id === s.executor)) s.executor = DEFAULT_EXECUTOR_ID
  s.schemaVersion = SCHEMA_VERSION
  delete (s as { runLogPage?: string }).runLogPage // now derived from pluginFolder
  s.pluginFolder = old.pluginFolder?.trim() || inferredFolder || DEFAULT_PLUGIN_FOLDER
  if (!Array.isArray(s.protectedFolders)) s.protectedFolders = ['Templates']
  delete (s as { promptsFolder?: string }).promptsFolder // setting removed with the prompt-note importer
  s.jobs = Array.isArray(s.jobs) ? s.jobs : []
  s.state = s.state && typeof s.state === 'object' ? s.state : {}
  delete (s as { seededBuiltins?: string[] }).seededBuiltins // built-ins are now ensured on every load
  // only a brand-new install (no saved data) gets the first-run tip
  s.introShown = raw ? raw.introShown ?? true : false
  // settings of the removed tag features
  for (const k of ['tagVocabularyPath', 'tagReview', 'glossary']) delete (s as Record<string, unknown>)[k]
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
    output: '{{pluginFolder}}/{{week}} Summary',
    mode: 'new',
    model: '',
    timeoutMinutes: 0,
    skills: [],
    prompt: '',
  }
}
