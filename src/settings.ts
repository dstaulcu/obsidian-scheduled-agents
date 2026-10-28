import { DEFAULT_PLUGIN_FOLDER, LEGACY_PLUGIN_FOLDER } from './brand'
import { JobConfig, JobState } from './core/types'
import { DEFAULT_EXECUTOR_ID, EXECUTORS, HarnessConfig } from './executors/registry'
import type { AuthMethod } from './glossary/sources'
import type { TagReviewState } from './tagreview/panel'

export const SCHEMA_VERSION = 1

export interface GlossarySettings {
  repoUrl: string
  /** Branch or tag. */
  ref: string
  /** Vault folder the imported notes land in. */
  destFolder: string
  authMethod: AuthMethod
  /** Notify (never write) at startup when upstream has changes. */
  checkOnStartup: boolean
  /** Only used when Obsidian's secret storage is unavailable; plain text in data.json. */
  token: string
}

export interface AgentSettings {
  schemaVersion: number
  /** Default harness id (jobs may override with `harness`). */
  executor: string
  harnesses: Record<string, HarnessConfig>
  defaultTimeoutMinutes: number
  maxBudgetUsd: number
  maxRetries: number
  pollSeconds: number
  /** Vault folder for the plugin's own pages (run log, default job output). Set once; never follows a rename. */
  pluginFolder: string
  /** Extra vault folders that jobs must not read for suggestions or edit (the plugin folder, glossary and .obsidian are always protected). */
  protectedFolders: string[]
  /** Outputs may only be written under these vault-relative folders. */
  allowedOutputFolders: string[]
  schedulerEnabled: boolean
  /** Controlled-vocabulary note that tag-review edits are validated against. */
  tagVocabularyPath: string
  tagReview: TagReviewState
  glossary: GlossarySettings
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
    pluginFolder: DEFAULT_PLUGIN_FOLDER,
    protectedFolders: ['Templates'],
    allowedOutputFolders: [],
    schedulerEnabled: true,
    tagVocabularyPath: `${DEFAULT_PLUGIN_FOLDER}/Tag Glossary.md`,
    tagReview: { decisions: {} },
    glossary: { repoUrl: '', ref: 'main', destFolder: 'Glossary', authMethod: 'https', checkOnStartup: false, token: '' },
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
  // a vocabulary path is only inferred for installs that predate the setting; fresh installs follow the plugin folder
  if (!(raw as { tagVocabularyPath?: string } | null)?.tagVocabularyPath) {
    s.tagVocabularyPath = inferredFolder ? 'Glossary/_tags.md' : `${s.pluginFolder}/Tag Glossary.md`
  }
  if (!Array.isArray(s.protectedFolders)) s.protectedFolders = ['Templates']
  delete (s as { promptsFolder?: string }).promptsFolder // setting removed with the prompt-note importer
  s.jobs = Array.isArray(s.jobs) ? s.jobs : []
  s.state = s.state && typeof s.state === 'object' ? s.state : {}
  delete (s as { seededBuiltins?: string[] }).seededBuiltins // built-ins are now ensured on every load
  s.tagReview = { ...(s.tagReview ?? {}), decisions: s.tagReview?.decisions ?? {} }
  s.glossary = { ...defaultSettings().glossary, ...(s.glossary ?? {}) }
  if (!['https', 'git', 'token'].includes(s.glossary.authMethod)) s.glossary.authMethod = 'https'
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
