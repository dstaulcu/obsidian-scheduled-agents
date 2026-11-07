import * as os from 'os'
import * as path from 'path'
import { CLAUDE_CAPABILITIES, ClaudeCliExecutor, getClaudeVersion } from './claudeCli'
import { DebugLog, ExecutorCapabilities, JobExecutor } from './types'

/** Per-harness user configuration (binary location and default model; models are harness-specific names). */
export interface HarnessConfig {
  path: string
  defaultModel: string
}

export interface ExecutorDescriptor {
  id: string
  label: string
  capabilities: ExecutorCapabilities
  defaultConfig(): HarnessConfig
  /** Version string of the installed harness, for issue reports. */
  getVersion(config: HarnessConfig, debug?: DebugLog): Promise<string>
  create(getConfig: () => HarnessConfig, debug?: DebugLog): JobExecutor
}

export function defaultClaudePath(): string {
  return process.platform === 'win32' ? path.join(os.homedir(), '.local', 'bin', 'claude.exe') : 'claude'
}

/** Add new harnesses here; nothing else in the plugin needs to know their names. */
export const EXECUTORS: ExecutorDescriptor[] = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    capabilities: CLAUDE_CAPABILITIES,
    defaultConfig: () => ({ path: defaultClaudePath(), defaultModel: 'sonnet' }),
    getVersion: (config, debug) => getClaudeVersion(config.path, debug),
    create: (getConfig, debug) => new ClaudeCliExecutor(() => getConfig().path, debug),
  },
]

export const DEFAULT_EXECUTOR_ID = 'claude-cli'

export function getDescriptor(id: string): ExecutorDescriptor | undefined {
  return EXECUTORS.find((e) => e.id === id)
}
