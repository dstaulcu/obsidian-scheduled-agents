import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runPass } from '../src/core/pass'
import { runJob, RunSettings } from '../src/core/runner'
import { FsVaultIO } from '../src/core/vaultIO'
import { JobConfig, JobState } from '../src/core/types'
import { ExecRequest, ExecResult, ExecutorCapabilities, JobExecutor } from '../src/executors/types'

class FakeExecutor implements JobExecutor {
  readonly id = 'fake'
  capabilities: ExecutorCapabilities = { enforcesReadOnly: true, supportsBudget: true, supportsSkills: true, reportsCost: true }
  calls: ExecRequest[] = []
  constructor(private results: ExecResult[]) {}
  async execute(req: ExecRequest): Promise<ExecResult> {
    this.calls.push(req)
    return this.results.shift() ?? { ok: true, text: 'default' }
  }
}

let vault: string
let settings: RunSettings
const job: JobConfig = {
  id: 'j1', name: 'Weekly Summary', enabled: true, schedule: 'weekly', at: '06:00', day: 'sunday',
  output: 'Weekly Summaries/{{week}} Summary', mode: 'new', model: '', timeoutMinutes: 0, skills: [],
  prompt: 'Summarize {{date}}',
}
const now = new Date(2026, 9, 22, 8, 30) // Thu 2026-10-22 08:30

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-'))
  settings = {
    vaultPath: vault, defaultModel: 'sonnet', defaultTimeoutMinutes: 10, maxBudgetUsd: 0.5,
    rules: { allowedFolders: ['BrainAgent', 'Weekly Summaries'] },
  }
})
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }))

const deps = (ex: JobExecutor) => ({ settings, io: new FsVaultIO(vault), executor: ex })

describe('runJob', () => {
  it('writes a new page with front matter and passes expanded prompt + defaults', async () => {
    const ex = new FakeExecutor([{ ok: true, text: ' # Hello [[X]] ', costUsd: 0.04 }])
    const r = await runJob(job, now, deps(ex))
    expect(r.ok).toBe(true)
    expect(r.outputPath).toBe('Weekly Summaries/2026-W43 Summary.md')
    const out = fs.readFileSync(path.join(vault, r.outputPath!), 'utf8')
    expect(out).toBe('---\nsource: "[[Weekly Summary]]"\ngenerated: 2026-10-22T08:30:00\n---\n# Hello [[X]]\n')
    expect(ex.calls[0].prompt).toContain('Summarize 2026-10-22')
    expect(ex.calls[0].prompt).toContain('Thursday, October 22, 2026')
    expect(ex.calls[0].model).toBe('sonnet')
    expect(ex.calls[0].timeoutMs).toBe(600000)
    expect(ex.calls[0].cwd).toBe(vault)
  })
  it('suffixes HHmm when the page already exists in new mode', async () => {
    const io = new FsVaultIO(vault)
    await io.writeAtomic('Weekly Summaries/2026-W43 Summary.md', 'old')
    const r = await runJob(job, now, deps(new FakeExecutor([{ ok: true, text: 'x' }])))
    expect(r.outputPath).toBe('Weekly Summaries/2026-W43 Summary 0830.md')
    expect(fs.readFileSync(path.join(vault, 'Weekly Summaries/2026-W43 Summary.md'), 'utf8')).toBe('old')
  })
  it('append adds a dated section; replace overwrites', async () => {
    const a = { ...job, mode: 'append' as const, output: 'BrainAgent/Notes' }
    await runJob(a, now, deps(new FakeExecutor([{ ok: true, text: 'one' }])))
    await runJob(a, now, deps(new FakeExecutor([{ ok: true, text: 'two' }])))
    const txt = fs.readFileSync(path.join(vault, 'BrainAgent/Notes.md'), 'utf8')
    expect(txt.match(/## 2026-10-22 08:30 \(\[\[Weekly Summary\]\]\)/g)).toHaveLength(2)
    const rep = { ...a, mode: 'replace' as const }
    await runJob(rep, now, deps(new FakeExecutor([{ ok: true, text: 'only' }])))
    expect(fs.readFileSync(path.join(vault, 'BrainAgent/Notes.md'), 'utf8')).toContain('only')
    expect(fs.readFileSync(path.join(vault, 'BrainAgent/Notes.md'), 'utf8')).not.toContain('two')
  })
  it('refuses disallowed output paths without calling the executor', async () => {
    const ex = new FakeExecutor([])
    const r = await runJob({ ...job, output: 'Glossary/_tags' }, now, deps(ex))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/allowed output folders/)
    expect(ex.calls).toHaveLength(0)
  })
  it('refuses jobs the harness cannot safely run', async () => {
    const ex = new FakeExecutor([])
    ex.capabilities = { ...ex.capabilities, enforcesReadOnly: false }
    const r1 = await runJob(job, now, deps(ex))
    expect(r1.message).toMatch(/read-only/)
    ex.capabilities = { ...ex.capabilities, enforcesReadOnly: true, supportsSkills: false }
    const r2 = await runJob({ ...job, skills: ['x'] }, now, deps(ex))
    expect(r2.message).toMatch(/skills/)
    expect(ex.calls).toHaveLength(0)
  })
  it('expands {{lastRun}} from the last success, else one schedule period back', async () => {
    const j = { ...job, prompt: 'since {{lastRun}} known={{lastRunKnown}}' }
    const ex = new FakeExecutor([])
    await runJob(j, now, deps(ex), new Date(2026, 9, 21, 6, 0, 0).toISOString())
    expect(ex.calls[0].prompt).toContain('since 2026-10-21T06:00:00 known=true')
    await runJob(j, now, deps(ex))
    expect(ex.calls[1].prompt).toContain('since 2026-10-15T08:30:00 known=false') // weekly job: 7 days back
    await runJob({ ...j, schedule: 'daily' }, now, deps(ex), 'garbage')
    expect(ex.calls[2].prompt).toContain('since 2026-10-21T08:30:00 known=false')
  })
  it('surfaces executor failure and writes nothing', async () => {
    const r = await runJob(job, now, deps(new FakeExecutor([{ ok: false, text: '', error: 'boom' }])))
    expect(r).toMatchObject({ ok: false, message: 'boom' })
    expect(fs.existsSync(path.join(vault, 'Weekly Summaries'))).toBe(false)
  })
})

describe('runPass', () => {
  const mk = (results: Array<{ ok: boolean; message?: string }>, state: Record<string, JobState>, extra = {}) => {
    const logs: string[] = []
    let i = 0
    const opts = {
      jobs: [job], state, now, maxRetries: 3,
      run: async () => {
        const r = results[i++] ?? { ok: true }
        return { ok: r.ok, message: r.message ?? 'ok', seconds: 1, outputPath: 'Weekly Summaries/x.md' }
      },
      log: async (_j: JobConfig, status: string, detail: string) => void logs.push(`${status}: ${detail}`),
      save: async () => undefined,
      ...extra,
    }
    return { opts, logs }
  }

  it('records firstSeen and does not fire for a brand-new job', async () => {
    const state: Record<string, JobState> = {}
    const { opts, logs } = mk([], state)
    expect(await runPass(opts)).toHaveLength(0)
    expect(state.j1.firstSeen).toBeDefined()
    expect(logs).toHaveLength(0)
  })
  it('runs a due job once and sets lastRun', async () => {
    const state: Record<string, JobState> = { j1: { firstSeen: '2026-10-01T09:00:00', failures: 0 } }
    const { opts, logs } = mk([{ ok: true }], state)
    expect(await runPass(opts)).toHaveLength(1)
    expect(logs[0]).toMatch(/^ok: 1s -> \[\[x\]\]/)
    expect(await runPass(opts)).toHaveLength(0) // not due again
  })
  it('retries then gives up until next occurrence', async () => {
    const state: Record<string, JobState> = { j1: { firstSeen: '2026-10-01T09:00:00', failures: 0 } }
    const { opts, logs } = mk([{ ok: false, message: 'a' }, { ok: false, message: 'b' }, { ok: false, message: 'c' }], state)
    await runPass(opts)
    await runPass(opts)
    await runPass(opts)
    expect(logs).toEqual(['failed: attempt 1/3: a', 'failed: attempt 2/3: b', 'gave-up: c'])
    expect(await runPass(opts)).toHaveLength(0)
  })
  it('advances lastSuccess only on success and hands the previous value to run', async () => {
    const prior = '2026-10-18T06:00:00.000Z'
    const state: Record<string, JobState> = { j1: { firstSeen: '2026-10-01T09:00:00', lastSuccess: prior, failures: 0 } }
    const seen: Array<string | undefined> = []
    const { opts } = mk([{ ok: false, message: 'a' }, { ok: false, message: 'b' }, { ok: false, message: 'c' }, { ok: true }], state, {
      run: async (_j: JobConfig, _n: Date, since?: string) => {
        seen.push(since)
        return { ok: seen.length === 4, message: 'x', seconds: 1, outputPath: 'Weekly Summaries/x.md' }
      },
    })
    await runPass(opts)
    await runPass(opts)
    await runPass(opts) // third failure gives up: lastRun advances, lastSuccess must not
    expect(state.j1.lastRun).toBe(now.toISOString())
    expect(state.j1.lastSuccess).toBe(prior)
    const forced = { ...opts, force: true, onlyId: 'j1' }
    await runPass(forced)
    expect(seen).toEqual([prior, prior, prior, prior])
    expect(state.j1.lastSuccess).toBe(now.toISOString())
  })
  it('skips disabled jobs unless forced, and force ignores schedule', async () => {
    const state: Record<string, JobState> = { j1: { firstSeen: new Date().toISOString(), failures: 0 } }
    const disabled = { ...job, enabled: false }
    const a = mk([], state, { jobs: [disabled] })
    expect(await runPass(a.opts)).toHaveLength(0)
    const b = mk([{ ok: true }], state, { jobs: [disabled], force: true, onlyId: 'j1' })
    expect(await runPass(b.opts)).toHaveLength(1)
  })
})

describe('source reference', () => {
  it('wikilinks user jobs but not built-ins', async () => {
    const { sourceRef } = await import('../src/core/runner')
    expect(sourceRef({ name: 'Mine', builtin: undefined })).toBe('[[Mine]]')
    expect(sourceRef({ name: 'Tag Review', builtin: 'default/tag-review' })).toBe('Tag Review')
  })
})
