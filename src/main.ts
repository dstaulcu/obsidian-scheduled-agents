import * as os from 'os'
import { apiVersion, FileSystemAdapter, FuzzySuggestModal, Notice, normalizePath, Plugin, TFile } from 'obsidian'
import { formatLogRow, LogStatus, runPass, RUN_LOG_HEADER } from './core/pass'
import { LOG_TAG } from './brand'
import type { DebugLog } from './executors/types'
import { errorText, looksBroken } from './core/errorText'
import { buildDiagnostics } from './core/diagnostics'
import { BUILTINS, ensureBuiltins, rangeDigestJob } from './core/builtinJobs'
import { readDailyNotesConfig } from './core/dailyNotes'
import { runJob, RunSettings } from './core/runner'
import { JobConfig } from './core/types'
import { FsVaultIO } from './core/vaultIO'
import { rebasePath } from './core/vaultPath'
import { getDescriptor } from './executors/registry'
import { AgentSettings, normalizeSettings } from './settings'
import { DaysModal } from './ui/DaysModal'
import { AgentSettingTab } from './ui/SettingTab'

export default class AgentPlugin extends Plugin {
  settings!: AgentSettings
  private busy = false
  private timer: number | null = null
  private statusEl: HTMLElement | null = null
  private loadedAt = Date.now()

  async onload() {
    // Before settings load the toggle is unknown, so a crash here is always reported (with its stack) to the console.
    try {
      await this.initialize()
    } catch (e) {
      console.error(`[${LOG_TAG}] failed to load`, e)
      throw e
    }
  }

  private async initialize() {
    this.loadedAt = Date.now()
    const raw = await this.loadData()
    this.settings = normalizeSettings(raw)
    this.debug(
      `loading v${this.manifest.version} on Obsidian ${apiVersion}, ${process.platform} ${process.arch}; saved data ${raw ? 'found' : 'absent'}, ` +
        `${this.settings.jobs.length} job(s), scheduler ${this.settings.schedulerEnabled ? 'on' : 'off'}, poll ${this.settings.pollSeconds}s`,
    )
    this.watchGlobalErrors()

    if (ensureBuiltins(this.settings)) {
      this.debug('built-in jobs added or migrated; saving settings')
      await this.saveSettings()
    }

    this.statusEl = this.addStatusBarItem()
    this.addSettingTab(new AgentSettingTab(this.app, this))

    this.addCommand({
      id: 'run-job',
      name: 'Run job now…',
      callback: () => new JobPicker(this).open(),
    })
    this.addCommand({
      id: 'run-builtins',
      name: 'Run all built-in jobs now',
      callback: () => void this.runBuiltinsNow(),
    })
    for (const b of BUILTINS) {
      this.addCommand({
        id: `run-builtin-${b.id.replace(/^[^/]*\//, '')}`,
        name: `Run ${b.name} now`,
        callback: () => void this.runBuiltinsNow(b.id),
      })
    }
    this.addCommand({
      id: 'run-digest-days',
      name: 'Run digest for the last N days…',
      callback: () => new DaysModal(this.app, (days) => void this.runRangeDigest(days)).open(),
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
    this.debug('commands, settings tab and timer registered')
    this.app.workspace.onLayoutReady(() => {
      this.debug('layout ready; run log check now, catch-up pass in 10s')
      void this.showIntroOnce()
      // catch-up pass shortly after startup, once the vault index has settled
      void this.ensureRunLog()
      window.setTimeout(() => void this.tick(), 10_000)
    })
  }

  /** First install only: point at the on-demand digest, the quickest way to see the plugin work. */
  private async showIntroOnce(): Promise<void> {
    if (this.settings.introShown) return
    this.settings.introShown = true
    await this.saveSettings()
    try {
      const notice = new Notice(createFragment((f) => {
        f.createDiv({ text: `${this.manifest.name}: try a digest of your recent daily notes.` })
        f.createEl('button', { text: 'Digest the last N days…', cls: 'mod-cta' }).addEventListener('click', () => {
          notice.hide()
          new DaysModal(this.app, (days) => void this.runRangeDigest(days)).open()
        })
        f.createDiv({ text: 'Or run it later from the command palette.', cls: 'setting-item-description' })
      }), 20000)
      this.debug('first-install tip shown')
    } catch (e) {
      console.error(`[${LOG_TAG}] could not show the first-install tip`, e)
    }
  }

  /**
   * Debug only: log uncaught errors and unhandled rejections while the plugin is loaded. These are app-wide, so a
   * line here is not necessarily from this plugin; the stack says. Helps trace popups that appear on enable.
   */
  private watchGlobalErrors() {
    this.registerDomEvent(window, 'error', (ev: ErrorEvent) =>
      this.debug(`window error (any plugin): ${ev.message} at ${ev.filename}:${ev.lineno}`, ev.error),
    )
    this.registerDomEvent(window, 'unhandledrejection', (ev: PromiseRejectionEvent) =>
      this.debug('unhandled rejection (any plugin):', ev.reason),
    )
  }

  onunload() {
    this.debug('unloading')
    this.stopTimer()
  }

  /**
   * Rename the plugin folder with Obsidian's own rename (so links update), then re-point everything that
   * referred to it: job outputs and the allowed and protected folders.
   */
  async renamePluginFolder(raw: string): Promise<void> {
    const next = normalizePath(raw.trim()).replace(/^\/+|\/+$/g, '')
    const old = this.settings.pluginFolder
    if (!next || next === old) return
    if (next.split('/').some((seg) => !seg || seg.startsWith('.'))) throw new Error('Choose a normal vault folder name')
    const vault = this.app.vault
    if (vault.getAbstractFileByPath(next)) throw new Error(`"${next}" already exists; choose another name`)
    const folder = vault.getAbstractFileByPath(old)
    if (folder) {
      const parent = next.split('/').slice(0, -1).join('/')
      if (parent && !vault.getAbstractFileByPath(parent)) await vault.createFolder(parent)
      await this.app.fileManager.renameFile(folder, next)
    }
    const move = (p: string) => rebasePath(p, old, next)
    for (const j of this.settings.jobs) j.output = move(j.output)
    this.settings.allowedOutputFolders = this.settings.allowedOutputFolders.map(move)
    this.settings.protectedFolders = this.settings.protectedFolders.map(move)
    this.settings.pluginFolder = next
    await this.saveSettings()
  }

  /** Console output for troubleshooting; off unless the Debug logging setting is on. Never pass prompts or note text. */
  private debug = (msg: string, ...extra: unknown[]): void => {
    if (this.settings?.debugLogging) console.debug(`[${LOG_TAG}] +${Date.now() - this.loadedAt}ms ${msg}`, ...extra)
  }

  /**
   * Every popup goes through here so it is logged with where it came from, even with debug logging off if its text
   * looks built from a missing value (undefined, null, NaN, [object ...]). Never throws.
   */
  notify(source: string, message: unknown, timeout?: number): void {
    const text = typeof message === 'string' && message.trim() ? message : `${this.manifest?.name ?? 'Scheduled Agents'}: unexpected notice (${source})`
    if (text !== message || looksBroken(text)) console.warn(`[${LOG_TAG}] notice from ${source} has a bad or suspicious message`, { message })
    this.debug(`notice (${source}, ${timeout ?? 'default'}ms): ${text}`)
    try {
      new Notice(text, timeout)
    } catch (e) {
      console.error(`[${LOG_TAG}] could not show notice from ${source}`, e)
    }
  }

  /** Sink handed to core and executors: a no-op unless debug logging is on, checked at call time. */
  private readonly debugSink: DebugLog = (msg) => this.debug(msg)

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
    if (!(a instanceof FileSystemAdapter)) throw new Error(`${this.manifest.name} needs a local (desktop) vault`)
    return a.getBasePath()
  }

  /** Run log page, always inside the plugin folder. */
  get runLogPath(): string {
    return `${this.settings.pluginFolder}/Run Log.md`
  }

  /** Folders jobs are told to skip: .obsidian, the plugin folder, plus the user's list. */
  skipFolders(): string[] {
    const all = ['.obsidian', this.settings.pluginFolder, ...this.settings.protectedFolders]
    return [...new Set(all.map((f) => f.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))]
  }

  protectedPrefixes(): string[] {
    return this.skipFolders().map((f) => f + '/')
  }

  harnessIdFor(job: Pick<JobConfig, 'harness'>): string {
    return job.harness || this.settings.executor
  }

  runSettings(harnessId: string = this.settings.executor): RunSettings {
    return {
      vaultPath: this.vaultPath,
      defaultModel: this.settings.harnesses[harnessId]?.defaultModel ?? 'sonnet',
      defaultTimeoutMinutes: this.settings.defaultTimeoutMinutes,
      maxBudgetUsd: this.settings.maxBudgetUsd,
      dailyNotes: readDailyNotesConfig(this.vaultPath),
      brand: {
        pluginFolder: this.settings.pluginFolder,
        pluginName: this.manifest.name,
        skipPaths: this.skipFolders().map((f) => `\`${f}/\``).join(', '),
      },
      rules: {
        allowedFolders: [...new Set([this.settings.pluginFolder, ...this.settings.allowedOutputFolders])],
      },
    }
  }

  /** Markdown diagnostics for a bug report; see core/diagnostics.ts for what is (and is not) included. */
  async diagnostics(): Promise<string> {
    const s = this.settings
    const id = s.executor
    const desc = getDescriptor(id)
    const harnessPath = s.harnesses[id]?.path ?? ''
    const harnessVersion = desc ? await desc.getVersion(s.harnesses[id], this.debugSink) : 'unknown harness'
    const inPluginFolder = (out: string) => out.startsWith('{{pluginFolder}}') || out.startsWith(s.pluginFolder + '/')
    return buildDiagnostics({
      pluginVersion: this.manifest.version,
      obsidianVersion: apiVersion,
      platform: process.platform,
      arch: process.arch,
      harnessId: id,
      harnessPath,
      harnessVersion,
      capabilities: desc?.capabilities ?? { enforcesReadOnly: false, supportsBudget: false, supportsSkills: false, reportsCost: false },
      schedulerEnabled: s.schedulerEnabled,
      pollSeconds: s.pollSeconds,
      defaultTimeoutMinutes: s.defaultTimeoutMinutes,
      maxBudgetUsd: s.maxBudgetUsd,
      maxRetries: s.maxRetries,
      pluginFolder: s.pluginFolder,
      jobs: s.jobs.map((j) => ({
        builtin: j.builtin,
        enabled: j.enabled,
        schedule: j.schedule,
        day: j.day,
        at: j.at,
        mode: j.mode,
        harness: j.harness,
        hasCustomModel: !!j.model,
        skillCount: j.skills.length,
        outputInPluginFolder: inPluginFolder(j.output),
        lastRun: s.state[j.id]?.lastRun,
        failures: s.state[j.id]?.failures ?? 0,
        lastError: s.state[j.id]?.lastError,
      })),
      vaultPath: this.vaultPath,
      homeDir: os.homedir(),
    })
  }

  private async writeLog(job: Pick<JobConfig, 'name'> | { name: string }, status: LogStatus, detail: string) {
    try {
      const io = new FsVaultIO(this.vaultPath)
      const page = this.runLogPath
      if (!(await io.exists(page))) await io.writeAtomic(page, RUN_LOG_HEADER)
      await io.append(page, formatLogRow(new Date(), job.name, status, detail) + '\n')
    } catch (e) {
      console.error(`[${LOG_TAG}] could not write run log`, e)
    }
  }

  /** One scheduler pass. Timer and startup ticks respect the on/off switch; the command passes manual. */
  async tick(manual = false) {
    if (!manual && !this.settings.schedulerEnabled) return
    await this.pass({})
  }

  /** Run built-in jobs one after another (all of them, or one by built-in id), ignoring schedule and enabled flag. */
  async runBuiltinsNow(onlyBuiltin?: string): Promise<void> {
    const jobs = this.settings.jobs.filter((j) => j.builtin && (!onlyBuiltin || j.builtin === onlyBuiltin))
    if (!jobs.length) {
      this.notify('runBuiltinsNow', `${this.manifest.name}: no built-in job found`)
      return
    }
    for (const job of jobs) await this.runNow(job)
  }

  /** One-off digest over the last `days` days. Not saved as a job; its result and any failure go to the notice and run log. */
  async runRangeDigest(days: number): Promise<void> {
    await this.pass({ force: true, adhoc: rangeDigestJob(days) })
  }

  /** Run one job immediately, ignoring schedule and enabled flag. */
  async runNow(job: JobConfig): Promise<void> {
    await this.pass({ force: true, onlyId: job.id })
  }

  private async pass(opts: { force?: boolean; onlyId?: string; adhoc?: JobConfig }) {
    if (this.busy) {
      this.notify('pass', `${this.manifest.name}: a job is already running`)
      return
    }
    this.busy = true
    this.debug(`pass start (force=${!!opts.force}, onlyId=${opts.onlyId ?? 'all'})`)
    try {
      const io = new FsVaultIO(this.vaultPath)
      const ran = await runPass({
        jobs: opts.adhoc ? [opts.adhoc] : this.settings.jobs,
        state: opts.adhoc ? {} : this.settings.state,
        now: new Date(),
        maxRetries: this.settings.maxRetries,
        force: opts.force,
        onlyId: opts.onlyId,
        run: (job, now, since) => {
          const id = this.harnessIdFor(job)
          const desc = getDescriptor(id)
          if (!desc) {
            this.debug(`job ${job.id}: unknown harness '${id}'`)
            return Promise.resolve({ ok: false, message: `Unknown harness '${id}'`, seconds: 0 })
          }
          this.setStatus(`running ${job.name}…`)
          const executor = desc.create(() => this.settings.harnesses[id], this.debugSink)
          const rs = this.runSettings(id)
          this.debug(`job ${job.id}${job.builtin ? ` (${job.builtin})` : ''}: start, harness ${id}, model ${job.model.trim() || rs.defaultModel}, mode ${job.mode}, since ${since ?? 'n/a'}`)
          return runJob(job, now, { settings: rs, io, executor }, since).then((r) => {
            this.debug(`job ${job.id}: ${r.ok ? 'ok' : 'failed'} in ${r.seconds}s${r.ok ? ` → ${r.outputPath}` : `: ${r.message}`}${r.cost != null ? `, cost $${r.cost}` : ''}`)
            return r
          })
        },
        log: (job, status, detail) => this.writeLog(job, status, detail),
        debug: this.debugSink,
        save: () => (opts.adhoc ? Promise.resolve() : this.saveSettings()),
      })
      if (opts.force) {
        for (const { job, result } of ran) {
          this.notify(
            `job ${job.id} result`,
            result.ok
              ? `${this.manifest.name}: ${job.name} done (${result.seconds}s) → ${result.outputPath}`
              : `${this.manifest.name}: ${job.name} failed: ${result.message}`,
            8000,
          )
        }
      }
    } catch (e) {
      console.error(`[${LOG_TAG}] pass failed`, e)
      this.debug(`pass failed: ${e instanceof Error ? (e.stack ?? e.message) : errorText(e)}`)
      await this.writeLog({ name: 'runner' }, 'error', errorText(e))
      this.notify('pass failure', `${this.manifest.name} error: ${errorText(e)}`)
    } finally {
      this.debug('pass end')
      this.busy = false
      this.setStatus('')
    }
  }

  private setStatus(text: string) {
    this.statusEl?.setText(text ? `${this.manifest.name}: ${text}` : '')
  }

  /** Create the run log page (and its folder) with just the header if it does not exist yet. */
  async ensureRunLog(): Promise<TFile | null> {
    const vault = this.app.vault
    const page = normalizePath(this.runLogPath)
    const existing = vault.getAbstractFileByPath(page)
    if (existing instanceof TFile) return existing
    try {
      const dir = page.split('/').slice(0, -1).join('/')
      if (dir && !vault.getAbstractFileByPath(dir)) await vault.createFolder(dir)
      return await vault.create(page, RUN_LOG_HEADER)
    } catch (e) {
      console.error(`[${LOG_TAG}] could not create run log`, e)
      return null
    }
  }

  async openRunLog() {
    const f = await this.ensureRunLog()
    if (f) await this.app.workspace.getLeaf(false).openFile(f)
    else this.notify('openRunLog', `${this.manifest.name}: could not create the run log page`)
  }
}

class JobPicker extends FuzzySuggestModal<JobConfig> {
  constructor(private plugin: AgentPlugin) {
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
