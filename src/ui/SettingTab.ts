import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type BrainAgentPlugin from '../main'
import { getLatestOccurrence, parseStamp } from '../core/schedule'
import { JobConfig } from '../core/types'
import { fmtDate, fmtTime } from '../core/templates'
import { importPromptNotes } from '../importPrompts'
import { newJob } from '../settings'
import { JobEditorModal } from './JobEditorModal'

function describeSchedule(j: JobConfig): string {
  const when = [j.schedule, j.schedule === 'hourly' ? '' : j.day, j.schedule === 'hourly' ? '' : j.at]
  return when.filter(Boolean).join(' ')
}

export class BrainAgentSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrainAgentPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    this.renderJobs(containerEl)
    this.renderGeneral(containerEl)
  }

  private renderJobs(el: HTMLElement) {
    const p = this.plugin
    new Setting(el).setName('Jobs').setHeading()

    new Setting(el)
      .setName('Scheduler')
      .setDesc('Run due jobs in the background while Obsidian is open. Missed runs catch up once at startup.')
      .addToggle((t) =>
        t.setValue(p.settings.schedulerEnabled).onChange(async (v) => {
          p.settings.schedulerEnabled = v
          await p.saveSettings()
        }),
      )

    new Setting(el)
      .addButton((b) =>
        b.setButtonText('New job').setCta().onClick(() => this.edit(newJob(), true)),
      )
      .addButton((b) =>
        b.setButtonText('Import prompt notes').onClick(async () => {
          const r = await importPromptNotes(this.app, p.settings)
          await p.saveSettings()
          new Notice(
            `Imported ${r.imported.length} job(s), migrated state for ${r.stateMigrated}.` +
              (r.skipped.length ? ` Skipped: ${r.skipped.join('; ')}` : '') +
              ' Disable the old BrainAgent scheduled task to avoid double runs.',
            12000,
          )
          this.display()
        }),
      )
      .addButton((b) => b.setButtonText('Open run log').onClick(() => void p.openRunLog()))

    if (!p.settings.jobs.length) {
      el.createEl('p', { text: 'No jobs yet. Create one or import your existing prompt notes.', cls: 'setting-item-description' })
    }

    for (const job of p.settings.jobs) {
      const st = p.settings.state[job.id]
      const last = parseStamp(st?.lastRun)
      const lastText = last ? `${fmtDate(last)} ${fmtTime(last)}` : 'never'
      let next = ''
      try {
        if (job.enabled) next = ` · latest slot ${fmtDate(getLatestOccurrence(job, new Date()))}`
      } catch {
        next = ' · invalid schedule'
      }
      const s = new Setting(el)
        .setName(job.name || '(unnamed)')
        .setDesc(`${describeSchedule(job)} → ${job.output} · last run ${lastText}${next}`)
      s.addToggle((t) =>
        t.setValue(job.enabled).onChange(async (v) => {
          job.enabled = v
          await p.saveSettings()
          this.display()
        }),
      )
      s.addExtraButton((b) =>
        b.setIcon('play').setTooltip('Run now').onClick(() => void p.runNow(job)),
      )
      s.addExtraButton((b) => b.setIcon('pencil').setTooltip('Edit').onClick(() => this.edit(job, false)))
      s.addExtraButton((b) =>
        b.setIcon('copy').setTooltip('Duplicate').onClick(async () => {
          p.settings.jobs.push({ ...job, id: newJob().id, name: `${job.name} copy`, enabled: false, skills: [...job.skills] })
          await p.saveSettings()
          this.display()
        }),
      )
      s.addExtraButton((b) =>
        b.setIcon('trash').setTooltip('Delete').onClick(async () => {
          p.settings.jobs = p.settings.jobs.filter((j) => j.id !== job.id)
          delete p.settings.state[job.id]
          await p.saveSettings()
          this.display()
        }),
      )
    }
  }

  private edit(job: JobConfig, isNew: boolean) {
    const p = this.plugin
    new JobEditorModal(
      this.app,
      job,
      () => ({
        vaultPath: p.vaultPath,
        defaultModel: p.settings.defaultModel,
        defaultTimeoutMinutes: p.settings.defaultTimeoutMinutes,
        maxBudgetUsd: p.settings.maxBudgetUsd,
        rules: { promptsFolder: p.settings.promptsFolder, allowedFolders: p.settings.allowedOutputFolders },
      }),
      async (saved) => {
        if (isNew) p.settings.jobs.push(saved)
        else p.settings.jobs = p.settings.jobs.map((j) => (j.id === saved.id ? saved : j))
        await p.saveSettings()
        this.display()
      },
    ).open()
  }

  private renderGeneral(el: HTMLElement) {
    const p = this.plugin
    const s = p.settings
    new Setting(el).setName('General').setHeading()

    const text = (name: string, desc: string, get: () => string, set: (v: string) => void, after?: () => void) =>
      new Setting(el).setName(name).setDesc(desc).addText((t) =>
        t.setValue(get()).onChange(async (v) => {
          set(v)
          await p.saveSettings()
          after?.()
        }),
      )
    const num = (name: string, desc: string, get: () => number, set: (n: number) => void, after?: () => void) =>
      text(name, desc, () => String(get()), (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) set(n) }, after)

    new Setting(el).setName('Executor').setDesc('Backend that runs prompts. Claude Code CLI is the only one for now.').addDropdown((d) =>
      d.addOption('claude-cli', 'Claude Code CLI').setValue(s.executor).setDisabled(true),
    )
    text('Claude path', 'Path to the claude executable (already logged in).', () => s.claudePath, (v) => (s.claudePath = v.trim()))
    text('Default model', 'Used unless a job sets its own.', () => s.defaultModel, (v) => (s.defaultModel = v.trim() || 'sonnet'))
    num('Default timeout (minutes)', 'Per run; the process tree is killed on timeout.', () => s.defaultTimeoutMinutes, (n) => (s.defaultTimeoutMinutes = Math.max(1, n)))
    num('Max budget per run (USD)', 'Passed as --max-budget-usd.', () => s.maxBudgetUsd, (n) => (s.maxBudgetUsd = n))
    num('Max attempts', 'Failed attempts before giving up until the next occurrence.', () => s.maxRetries, (n) => (s.maxRetries = Math.max(1, Math.floor(n))))
    num('Poll interval (seconds)', 'How often the scheduler checks for due jobs (min 30).', () => s.pollSeconds, (n) => (s.pollSeconds = Math.max(30, Math.floor(n))), () => p.restartTimer())
    text('Run log page', 'Vault-relative page that gets a row per run.', () => s.runLogPage, (v) => (s.runLogPage = v.trim()))
    text('Prompt notes folder', 'Legacy prompt notes (import source). Never a valid output target.', () => s.promptsFolder, (v) => (s.promptsFolder = v.trim()))
    new Setting(el)
      .setName('Allowed output folders')
      .setDesc('One per line, vault-relative. Jobs can only write under these. Empty = anywhere (not recommended).')
      .addTextArea((t) =>
        t.setValue(s.allowedOutputFolders.join('\n')).onChange(async (v) => {
          s.allowedOutputFolders = v.split('\n').map((x) => x.trim()).filter(Boolean)
          await p.saveSettings()
        }),
      )
  }
}
