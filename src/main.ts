import * as fs from 'fs'
import * as nodePath from 'path'
import * as os from 'os'
import { apiVersion, FileSystemAdapter, FuzzySuggestModal, Notice, normalizePath, Plugin, TFile } from 'obsidian'
import { formatLogRow, LogStatus, runPass, RUN_LOG_HEADER } from './core/pass'
import { LOG_TAG } from './brand'
import { buildDiagnostics } from './core/diagnostics'
import { BUILTINS, ensureBuiltins } from './core/builtinJobs'
import { readDailyNotesConfig } from './core/dailyNotes'
import { runJob, RunSettings } from './core/runner'
import { JobConfig } from './core/types'
import { FsVaultIO } from './core/vaultIO'
import { rebasePath } from './core/vaultPath'
import { getDescriptor } from './executors/registry'
import { AgentSettings, normalizeSettings } from './settings'
import { registerTagReview, undoLastBatch } from './tagreview/panel'
import { bootstrapText, isEmptyVocabulary, missingVocabularyText, starterVocabulary } from './tagreview/scaffold'
import { AgentSettingTab } from './ui/SettingTab'

export default class AgentPlugin extends Plugin {
  settings!: AgentSettings
  private busy = false
  private timer: number | null = null
  private statusEl: HTMLElement | null = null

  async onload() {
    this.settings = normalizeSettings(await this.loadData())

    if (ensureBuiltins(this.settings)) await this.saveSettings()

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
      id: 'run-due',
      name: 'Run all due jobs now',
      callback: () => void this.tick(true),
    })
    this.addCommand({
      id: 'open-run-log',
      name: 'Open run log',
      callback: () => void this.openRunLog(),
    })

    registerTagReview(this)
    this.addCommand({
      id: 'undo-tag-review',
      name: 'Undo last tag-review batch',
      callback: () => void undoLastBatch(this),
    })

    this.restartTimer()
    this.app.workspace.onLayoutReady(() => {
      // catch-up pass shortly after startup, once the vault index has settled
      void this.ensureRunLog()
      void this.ensureGlossary()
      window.setTimeout(() => void this.tick(), 10_000)
    })
  }

  onunload() {
    this.stopTimer()
  }

  /**
   * Rename the plugin folder with Obsidian's own rename (so links update), then re-point everything that
   * referred to it: job outputs, allowed and protected folders, and the vocabulary path if it lived inside.
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
    this.settings.tagVocabularyPath = move(this.settings.tagVocabularyPath)
    this.settings.pluginFolder = next
    await this.saveSettings()
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
    if (!(a instanceof FileSystemAdapter)) throw new Error(`${this.manifest.name} needs a local (desktop) vault`)
    return a.getBasePath()
  }

  /** Tag Review prompt text for an empty or missing vocabulary; '' when the vocabulary has tags. */
  private vocabularyBootstrap(): string {
    const path = this.settings.tagVocabularyPath
    try {
      const text = fs.readFileSync(nodePath.join(this.vaultPath, path), 'utf8')
      return isEmptyVocabulary(text) ? bootstrapText(path) : ''
    } catch {
      return missingVocabularyText(path)
    }
  }

  /** Create the starter glossary when the vocabulary lives in the plugin folder and does not exist yet. */
  async ensureGlossary(): Promise<void> {
    const vault = this.app.vault
    const path = normalizePath(this.settings.tagVocabularyPath)
    if (vault.getAbstractFileByPath(path)) return
    if (!path.toLowerCase().startsWith(this.settings.pluginFolder.toLowerCase() + '/')) return
    try {
      const dir = path.split('/').slice(0, -1).join('/')
      const parts = dir.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const d = parts.slice(0, i).join('/')
        if (!vault.getAbstractFileByPath(d)) await vault.createFolder(d)
      }
      await vault.create(path, starterVocabulary())
    } catch (e) {
      console.error(`[${LOG_TAG}] could not create the starter glossary`, e)
    }
  }

  /** Run log page, always inside the plugin folder. */
  get runLogPath(): string {
    return `${this.settings.pluginFolder}/Run Log.md`
  }

  /** Folders jobs must not read for suggestions or edit: plugin folder, glossary, .obsidian, plus the user's list. */
  skipFolders(): string[] {
    const glossary = this.settings.tagVocabularyPath.split('/').slice(0, -1).join('/')
    const all = ['.obsidian', glossary, this.settings.pluginFolder, ...this.settings.protectedFolders]
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
        vocabularyPath: this.settings.tagVocabularyPath,
        bootstrap: this.vocabularyBootstrap(),
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
    const harnessVersion = desc ? await desc.getVersion(s.harnesses[id]) : 'unknown harness'
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
      new Notice(`${this.manifest.name}: no built-in job found`)
      return
    }
    for (const job of jobs) await this.runNow(job)
  }

  /** Run one job immediately, ignoring schedule and enabled flag. */
  async runNow(job: JobConfig): Promise<void> {
    await this.pass({ force: true, onlyId: job.id })
  }

  private async pass(opts: { force?: boolean; onlyId?: string }) {
    if (this.busy) {
      new Notice(`${this.manifest.name}: a job is already running`)
      return
    }
    this.busy = true
    try {
      const io = new FsVaultIO(this.vaultPath)
      const ran = await runPass({
        jobs: this.settings.jobs,
        state: this.settings.state,
        now: new Date(),
        maxRetries: this.settings.maxRetries,
        force: opts.force,
        onlyId: opts.onlyId,
        run: (job, now, since) => {
          const id = this.harnessIdFor(job)
          const desc = getDescriptor(id)
          if (!desc) return Promise.resolve({ ok: false, message: `Unknown harness '${id}'`, seconds: 0 })
          this.setStatus(`running ${job.name}…`)
          const executor = desc.create(() => this.settings.harnesses[id])
          return runJob(job, now, { settings: this.runSettings(id), io, executor }, since)
        },
        log: (job, status, detail) => this.writeLog(job, status, detail),
        save: () => this.saveSettings(),
      })
      if (opts.force) {
        for (const { job, result } of ran) {
          new Notice(
            result.ok
              ? `${this.manifest.name}: ${job.name} done (${result.seconds}s) → ${result.outputPath}`
              : `${this.manifest.name}: ${job.name} failed: ${result.message}`,
            8000,
          )
        }
      }
    } catch (e) {
      console.error(`[${LOG_TAG}] pass failed`, e)
      await this.writeLog({ name: 'runner' }, 'error', (e as Error).message)
      new Notice(`${this.manifest.name} error: ${(e as Error).message}`)
    } finally {
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
    else new Notice(`${this.manifest.name}: could not create the run log page`)
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
