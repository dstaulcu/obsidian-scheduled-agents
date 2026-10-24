export interface ExecRequest {
  prompt: string
  /** Working directory for the executor (the vault root). */
  cwd: string
  model: string
  timeoutMs: number
  maxBudgetUsd: number
  skills: string[]
}

export interface ExecResult {
  ok: boolean
  text: string
  costUsd?: number
  error?: string
}

/** A backend able to run a read-only agentic prompt against the vault. */
export interface JobExecutor {
  readonly id: string
  execute(req: ExecRequest): Promise<ExecResult>
}
