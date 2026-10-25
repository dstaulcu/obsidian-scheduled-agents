import * as os from 'os'
import * as path from 'path'
import { CLAUDE_CAPABILITIES, ClaudeCliExecutor } from './claudeCli'
import { ExecutorCapabilities, JobExecutor } from './types'

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
  create(getConfig: () => HarnessConfig): JobExecutor
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
    create: (getConfig) => new ClaudeCliExecutor(() => getConfig().path),
  },
]

export const DEFAULT_EXECUTOR_ID = 'claude-cli'

export function getDescriptor(id: string): ExecutorDescriptor | undefined {
  return EXECUTORS.find((e) => e.id === id)
}
