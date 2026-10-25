export interface ExecRequest {
  prompt: string
  /** Working directory for the executor (the vault root). */
  cwd: string
  model: string
  timeoutMs: number
  /** Honoured only when the executor `supportsBudget`. */
  maxBudgetUsd: number
  /** Honoured only when the executor `supportsSkills`. */
  skills: string[]
}

export interface ExecResult {
  ok: boolean
  text: string
  costUsd?: number
  error?: string
}

/** What a harness can actually guarantee, so the plugin never claims more than the harness enforces. */
export interface ExecutorCapabilities {
  /** The harness itself blocks writes/shell for the run (not just a prompt asking nicely). */
  enforcesReadOnly: boolean
  supportsBudget: boolean
  supportsSkills: boolean
  reportsCost: boolean
}

/** A backend able to run a read-only agentic prompt against the vault. */
export interface JobExecutor {
  readonly id: string
  readonly capabilities: ExecutorCapabilities
  execute(req: ExecRequest): Promise<ExecResult>
}

/** Returns why a job cannot run on this executor, or null when it can. */
export function checkCapabilities(job: { skills: string[] }, caps: ExecutorCapabilities): string | null {
  if (!caps.enforcesReadOnly) return 'this harness cannot enforce read-only access, so jobs will not run on it'
  if (job.skills.length && !caps.supportsSkills) return 'this harness does not support skills; remove them from the job'
  return null
}
