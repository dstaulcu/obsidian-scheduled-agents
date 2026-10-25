import * as os from 'os'
import * as path from 'path'
import { apiVersion, App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian'
import { REPO_URL } from '../brand'
import type AgentPlugin from '../main'
import { getLatestOccurrence, parseStamp } from '../core/schedule'
import { JobConfig } from '../core/types'
import { fmtDate, fmtTime } from '../core/templates'
import { resetBuiltin } from '../core/builtinJobs'
import { EXECUTORS } from '../executors/registry'
import { newJob } from '../settings'
import { JobEditorModal } from './JobEditorModal'

function describeSchedule(j: JobConfig): string {
  const when = [j.schedule, j.schedule === 'hourly' ? '' : j.day, j.schedule === 'hourly' ? '' : j.at]
  return when.filter(Boolean).join(' ')
}

export class AgentSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AgentPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    this.renderJobs(containerEl)
    this.renderGeneral(containerEl)
    this.renderReport(containerEl)
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
      .addButton((b) => b.setButtonText('Open run log').onClick(() => void p.openRunLog()))

    if (!p.settings.jobs.length) {
      el.createEl('p', { text: 'No jobs yet. Create one.', cls: 'setting-item-description' })
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
      if (job.builtin) {
        s.addExtraButton((b) =>
          b.setIcon('rotate-ccw').setTooltip('Reset to built-in default (keeps on/off)').onClick(() =>
            new ConfirmModal(this.app, `Reset "${job.name}" to its built-in default? Your edits to its prompt, schedule and output will be lost.`, async () => {
              resetBuiltin(job)
              await p.saveSettings()
              this.display()
            }).open(),
          ),
        )
      }
      s.addExtraButton((b) =>
        b.setIcon('copy').setTooltip('Duplicate').onClick(async () => {
          p.settings.jobs.push({ ...job, id: newJob().id, name: `${job.name} copy`, enabled: false, skills: [...job.skills], builtin: undefined })
          await p.saveSettings()
          this.display()
        }),
      )
      // built-ins cannot be deleted (disable them instead); they are re-added on load
      if (!job.builtin) {
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
  }

  private edit(job: JobConfig, isNew: boolean) {
    const p = this.plugin
    new JobEditorModal(
      this.app,
      job,
      () => p.runSettings(),
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

    new Setting(el)
      .setName('Default harness')
      .setDesc('Agent harness that runs prompts; each keeps its own provider login. Jobs can pick another.')
      .addDropdown((d) => {
        EXECUTORS.forEach((e) => d.addOption(e.id, e.label))
        d.setValue(s.executor).onChange(async (v) => {
          s.executor = v
          await p.saveSettings()
        })
      })
    for (const e of EXECUTORS) {
      const h = s.harnesses[e.id]
      const c = e.capabilities
      const yn = (b: boolean) => (b ? 'yes' : 'no')
      new Setting(el)
        .setName(`${e.label}: path`)
        .setDesc(
          `Executable (already logged in). Harness-enforced read-only: ${c.enforcesReadOnly ? 'yes' : 'NO'} · ` +
            `budget cap: ${yn(c.supportsBudget)} · skills: ${yn(c.supportsSkills)} · cost reporting: ${yn(c.reportsCost)}`,
        )
        .addText((t) => t.setValue(h.path).onChange(async (v) => { h.path = v.trim() || e.defaultConfig().path; await p.saveSettings() }))
      new Setting(el)
        .setName(`${e.label}: default model`)
        .setDesc('Harness-specific model name, used unless a job sets its own.')
        .addText((t) => t.setValue(h.defaultModel).onChange(async (v) => { h.defaultModel = v.trim() || e.defaultConfig().defaultModel; await p.saveSettings() }))
    }
    num('Default timeout (minutes)', 'Per run; the process tree is killed on timeout.', () => s.defaultTimeoutMinutes, (n) => (s.defaultTimeoutMinutes = Math.max(1, n)))
    num('Max budget per run (USD)', 'Passed as --max-budget-usd.', () => s.maxBudgetUsd, (n) => (s.maxBudgetUsd = n))
    num('Max attempts', 'Failed attempts before giving up until the next occurrence.', () => s.maxRetries, (n) => (s.maxRetries = Math.max(1, Math.floor(n))))
    num('Poll interval (seconds)', 'How often the scheduler checks for due jobs (min 30).', () => s.pollSeconds, (n) => (s.pollSeconds = Math.max(30, Math.floor(n))), () => p.restartTimer())
    new Setting(el)
      .setName('Plugin folder')
      .setDesc(`${s.pluginFolder} — vault folder for the plugin's own pages (run log, default job output). Renaming moves the folder, updates links, and re-points job outputs.`)
      .addButton((b) =>
        b.setButtonText('Rename…').onClick(() =>
          new PromptModal(this.app, 'Rename plugin folder', s.pluginFolder, async (v) => {
            try {
              await p.renamePluginFolder(v)
              new Notice(`Plugin folder is now "${s.pluginFolder}"`)
            } catch (e) {
              new Notice(`Could not rename: ${(e as Error).message}`, 10000)
            }
            this.display()
          }).open(),
        ),
      )
    new Setting(el)
      .setName('Protected folders')
      .setDesc('One per line. Jobs are told to skip these and Tag Review will not edit notes in them. The plugin folder, glossary and .obsidian are always protected.')
      .addTextArea((t) =>
        t.setValue(s.protectedFolders.join('\n')).onChange(async (v) => {
          s.protectedFolders = v.split('\n').map((x) => x.trim()).filter(Boolean)
          await p.saveSettings()
        }),
      )
    new Setting(el)
      .setName('Claude Code logs')
      .setDesc(
        'Each run is a Claude Code session; transcripts are under ~/.claude/projects/ (one folder per working directory). ' +
          'Failed runs also appear in the run log page.',
      )
      .addButton((b) =>
        b.setButtonText('Open folder').onClick(() => {
          const dir = path.join(os.homedir(), '.claude', 'projects')
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { shell } = require('electron')
            void shell.openPath(dir)
          } catch {
            new Notice(dir, 10000)
          }
        }),
      )
    text('Tag vocabulary note', 'Tag Review edits are validated against tags listed in this note.', () => s.tagVocabularyPath, (v) => (s.tagVocabularyPath = v.trim()))
    new Setting(el)
      .setName('Allowed output folders')
      .setDesc('One per line, vault-relative. Jobs may write under these folders and always under the plugin folder. Add the folders you want job output to go to, then point the job output at one.')
      .addTextArea((t) =>
        t.setValue(s.allowedOutputFolders.join('\n')).onChange(async (v) => {
          s.allowedOutputFolders = v.split('\n').map((x) => x.trim()).filter(Boolean)
          await p.saveSettings()
        }),
      )
  }

  private renderReport(el: HTMLElement) {
    const p = this.plugin
    new Setting(el).setName('Report an issue').setHeading()
    new Setting(el)
      .setName('Diagnostics')
      .setDesc(
        'Versions, harness details and job status to paste into a bug report. It never includes prompts, job names, note content or your vault name, ' +
          'and vault and home paths are replaced. Review it before sharing.',
      )
      .addButton((b) => b.setButtonText('Preview').onClick(() => void this.withDiagnostics((text) => new DiagnosticsModal(this.app, text).open())))
      .addButton((b) =>
        b.setButtonText('Copy').onClick(() =>
          void this.withDiagnostics(async (text) => {
            await navigator.clipboard.writeText(text)
            new Notice('Diagnostics copied. Paste them into the issue.')
          }),
        ),
      )
    new Setting(el)
      .setName('Open a GitHub issue')
      .setDesc('Opens the bug report form with your versions filled in. Copy the diagnostics first and paste them into the form.')
      .addButton((b) =>
        b.setButtonText('Report a bug').setCta().onClick(() => {
          const q = new URLSearchParams({
            template: 'bug_report.yml',
            plugin_version: p.manifest.version,
            environment: `${process.platform} ${process.arch}, Obsidian ${apiVersion}`,
          })
          window.open(`${REPO_URL}/issues/new?${q}`)
        }),
      )
  }

  private async withDiagnostics(use: (text: string) => void | Promise<void>) {
    try {
      await use(await this.plugin.diagnostics())
    } catch (e) {
      new Notice(`Could not build diagnostics: ${(e as Error).message}`, 10000)
    }
  }
}

class DiagnosticsModal extends Modal {
  constructor(app: App, private text: string) {
    super(app)
  }
  onOpen() {
    this.titleEl.setText('Diagnostics')
    const area = this.contentEl.createEl('textarea', { text: this.text })
    area.readOnly = true
    area.rows = 18
    area.style.width = '100%'
    area.style.fontFamily = 'var(--font-monospace)'
    new Setting(this.contentEl).addButton((b) => b.setButtonText('Close').onClick(() => this.close()))
  }
  onClose() {
    this.contentEl.empty()
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onConfirm: () => void | Promise<void>) {
    super(app)
  }
  onOpen() {
    this.contentEl.createEl('p', { text: this.message })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText('Reset').setWarning().onClick(async () => {
          this.close()
          await this.onConfirm()
        }),
      )
  }
  onClose() {
    this.contentEl.empty()
  }
}

class PromptModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private value: string,
    private onSubmit: (value: string) => void | Promise<void>,
  ) {
    super(app)
  }
  onOpen() {
    this.titleEl.setText(this.title)
    let value = this.value
    new Setting(this.contentEl).addText((t) => {
      t.setValue(value).onChange((v) => (value = v))
      t.inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          this.close()
          void this.onSubmit(value)
        }
      })
      t.inputEl.focus()
    })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText('Rename').setCta().onClick(() => {
          this.close()
          void this.onSubmit(value)
        }),
      )
  }
  onClose() {
    this.contentEl.empty()
  }
}
