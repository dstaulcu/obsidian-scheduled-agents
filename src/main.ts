import { FileSystemAdapter, FuzzySuggestModal, Notice, Plugin, TFile } from 'obsidian'
import { formatLogRow, LogStatus, runPass, RUN_LOG_HEADER } from './core/pass'
import { runJob, RunSettings } from './core/runner'
import { JobConfig } from './core/types'
import { FsVaultIO } from './core/vaultIO'
import { ClaudeCliExecutor } from './executors/claudeCli'
import { JobExecutor } from './executors/types'
import { BrainAgentSettings, normalizeSettings } from './settings'
import { BrainAgentSettingTab } from './ui/SettingTab'

export default class BrainAgentPlugin extends Plugin {
  settings!: BrainAgentSettings
  executor!: JobExecutor
  private busy = false
  private timer: number | null = null
  private statusEl: HTMLElement | null = null

  async onload() {
    this.settings = normalizeSettings(await this.loadData())
    this.executor = new ClaudeCliExecutor(() => this.settings.claudePath)

    this.statusEl = this.addStatusBarItem()
    this.addSettingTab(new BrainAgentSettingTab(this.app, this))

    this.addCommand({
      id: 'run-job',
      name: 'Run job now…',
      callback: () => new JobPicker(this).open(),
    })
    this.addCommand({
      id: 'run-due',
      name: 'Run all due jobs now',
      callback: () => void this.tick(true),
    })
    this.addCommand({
      id: 'open-run-log',
      name: 'Open run log',
      callback: () => void this.openRunLog(),
    })

    this.restartTimer()
    this.app.workspace.onLayoutReady(() => {
      // catch-up pass shortly after startup, once the vault index has settled
      window.setTimeout(() => void this.tick(), 10_000)
    })
  }

  onunload() {
    this.stopTimer()
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  restartTimer() {
    this.stopTimer()
    const ms = Math.max(30, this.settings.pollSeconds) * 1000
    this.timer = window.setInterval(() => void this.tick(), ms)
    this.registerInterval(this.timer)
  }

  private stopTimer() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  get vaultPath(): string {
    const a = this.app.vault.adapter
    if (!(a instanceof FileSystemAdapter)) throw new Error('Brain Agent needs a local (desktop) vault')
    return a.getBasePath()
  }

  private runSettings(): RunSettings {
    return {
      vaultPath: this.vaultPath,
      defaultModel: this.settings.defaultModel,
      defaultTimeoutMinutes: this.settings.defaultTimeoutMinutes,
      maxBudgetUsd: this.settings.maxBudgetUsd,
      rules: {
        promptsFolder: this.settings.promptsFolder,
        allowedFolders: this.settings.allowedOutputFolders,
      },
    }
  }

  private async writeLog(job: Pick<JobConfig, 'name'> | { name: string }, status: LogStatus, detail: string) {
    try {
      const io = new FsVaultIO(this.vaultPath)
      const page = this.settings.runLogPage
      if (!(await io.exists(page))) await io.writeAtomic(page, RUN_LOG_HEADER)
      await io.append(page, formatLogRow(new Date(), job.name, status, detail) + '\n')
    } catch (e) {
      console.error('[brain-agent] could not write run log', e)
    }
  }

  /** One scheduler pass. Timer and startup ticks respect the on/off switch; the command passes manual. */
  async tick(manual = false) {
    if (!manual && !this.settings.schedulerEnabled) return
    await this.pass({})
  }

  /** Run one job immediately, ignoring schedule and enabled flag. */
  async runNow(job: JobConfig): Promise<void> {
    await this.pass({ force: true, onlyId: job.id })
  }

  private async pass(opts: { force?: boolean; onlyId?: string }) {
    if (this.busy) {
      new Notice('Brain Agent: a job is already running')
      return
    }
    this.busy = true
    try {
      const io = new FsVaultIO(this.vaultPath)
      const deps = { settings: this.runSettings(), io, executor: this.executor }
      const ran = await runPass({
        jobs: this.settings.jobs,
        state: this.settings.state,
        now: new Date(),
        maxRetries: this.settings.maxRetries,
        force: opts.force,
        onlyId: opts.onlyId,
        run: (job, now) => {
          this.setStatus(`running ${job.name}…`)
          return runJob(job, now, deps)
        },
        log: (job, status, detail) => this.writeLog(job, status, detail),
        save: () => this.saveSettings(),
      })
      if (opts.force) {
        for (const { job, result } of ran) {
          new Notice(
            result.ok
              ? `Brain Agent: ${job.name} done (${result.seconds}s) → ${result.outputPath}`
              : `Brain Agent: ${job.name} failed: ${result.message}`,
            8000,
          )
        }
      }
    } catch (e) {
      console.error('[brain-agent] pass failed', e)
      await this.writeLog({ name: 'runner' }, 'error', (e as Error).message)
      new Notice(`Brain Agent error: ${(e as Error).message}`)
    } finally {
      this.busy = false
      this.setStatus('')
    }
  }

  private setStatus(text: string) {
    this.statusEl?.setText(text ? `Brain Agent: ${text}` : '')
  }

  async openRunLog() {
    const f = this.app.vault.getAbstractFileByPath(this.settings.runLogPage)
    if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f)
    else new Notice('No run log yet')
  }
}

class JobPicker extends FuzzySuggestModal<JobConfig> {
  constructor(private plugin: BrainAgentPlugin) {
    super(plugin.app)
    this.setPlaceholder('Run which job now?')
  }
  getItems() {
    return this.plugin.settings.jobs
  }
  getItemText(job: JobConfig) {
    return job.name
  }
  onChooseItem(job: JobConfig) {
    void this.plugin.runNow(job)
  }
}
