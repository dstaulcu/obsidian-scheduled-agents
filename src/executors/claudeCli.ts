import { execFile, spawn } from 'child_process'
import { parseSkills } from '../core/validate'
import { ExecRequest, ExecResult, ExecutorCapabilities, JobExecutor } from './types'

/** Read-only comes from --tools Read,Glob,Grep + dontAsk, which Claude Code enforces itself. */
export const CLAUDE_CAPABILITIES: ExecutorCapabilities = {
  enforcesReadOnly: true,
  supportsBudget: true,
  supportsSkills: true,
  reportsCost: true,
}

/** Port of Get-ClaudeArguments: read-only tools, no MCP, no prompts, user settings only. */
export function buildClaudeArgs(req: Pick<ExecRequest, 'model' | 'maxBudgetUsd' | 'skills'>): string[] {
  const skills = parseSkills(req.skills)
  let tools = 'Read,Glob,Grep'
  let skillArgs: string[] = []
  if (skills.length) {
    // only authorized skills may run; any other Skill call is denied by dontAsk
    tools += ',Skill'
    skillArgs = ['--allowedTools', ['Read', 'Glob', 'Grep', ...skills.map((s) => `Skill(${s})`)].join(' ')]
  }
  return [
    '-p',
    '--output-format',
    'json',
    '--tools',
    tools,
    ...skillArgs,
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--setting-sources',
    'user',
    '--model',
    req.model,
    '--max-budget-usd',
    String(req.maxBudgetUsd),
  ]
}

interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

function runProcess(claudePath: string, args: string[], req: ExecRequest): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const done = (r: Partial<ProcResult>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr, timedOut, ...r })
    }

    const child = spawn(claudePath, args, {
      cwd: req.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => (stdout += c))
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', (e) => done({ spawnError: e.message }))
    child.on('close', (code) => done({ exitCode: code }))

    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
    }, req.timeoutMs)

    child.stdin.on('error', () => undefined) // EPIPE if the process dies early
    child.stdin.end(req.prompt, 'utf8')
  })
}

/** First line of `claude --version`, or a short reason it could not be read. */
export function getClaudeVersion(claudePath: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(claudePath, ['--version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) resolve(`unavailable (${err.message.split('\n')[0]})`)
      else resolve(stdout.trim().split('\n')[0] || 'unknown')
    })
  })
}

export class ClaudeCliExecutor implements JobExecutor {
  readonly id = 'claude-cli'
  readonly capabilities = CLAUDE_CAPABILITIES

  constructor(private readonly getClaudePath: () => string) {}

  async execute(req: ExecRequest): Promise<ExecResult> {
    const r = await runProcess(this.getClaudePath(), buildClaudeArgs(req), req)
    if (r.spawnError) return { ok: false, text: '', error: `could not start claude: ${r.spawnError}` }
    if (r.timedOut) return { ok: false, text: '', error: `timed out after ${Math.round(req.timeoutMs / 60000)} min` }
    if (r.exitCode !== 0) {
      const tail = r.stderr.trim().split('\n').slice(-3).join(' | ')
      return { ok: false, text: '', error: `exit ${r.exitCode}: ${tail}` }
    }
    let json: { result?: string; is_error?: boolean; subtype?: string; total_cost_usd?: number }
    try {
      json = JSON.parse(r.stdout)
    } catch {
      return { ok: false, text: '', error: 'unparseable JSON from claude' }
    }
    if (json.is_error || !json.result || !json.result.trim()) {
      return { ok: false, text: '', error: `claude reported error: ${json.subtype ?? ''} ${json.result ?? ''}`.trim() }
    }
    return { ok: true, text: json.result.trim(), costUsd: json.total_cost_usd }
  }
}
