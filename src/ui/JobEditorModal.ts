import { App, Modal, Setting } from 'obsidian'
import { resolveOutput } from '../core/runner'
import { DAY_NAMES, JobConfig, MODES, SCHEDULES } from '../core/types'
import { parseSkills, validateJob } from '../core/validate'
import { RunSettings } from '../core/runner'

/** Create/edit a job. Works on a copy; calls onSave with the validated result. */
export class JobEditorModal extends Modal {
  private job: JobConfig
  private skillsText: string
  private errorEl!: HTMLElement
  private previewEl!: HTMLElement
  private whenEl!: HTMLElement

  constructor(
    app: App,
    job: JobConfig,
    private getRunSettings: () => RunSettings,
    private onSave: (job: JobConfig) => void | Promise<void>,
  ) {
    super(app)
    this.job = { ...job, skills: [...job.skills] }
    this.skillsText = job.skills.join(', ')
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('brain-agent-editor')
    this.titleEl.setText(this.job.name ? `Edit job: ${this.job.name}` : 'New job')

    new Setting(contentEl).setName('Name').setDesc('Used in wikilinks and the run log.').addText((t) =>
      t.setValue(this.job.name).onChange((v) => (this.job.name = v)),
    )
    new Setting(contentEl).setName('Enabled').addToggle((t) =>
      t.setValue(this.job.enabled).onChange((v) => (this.job.enabled = v)),
    )

    this.whenEl = contentEl.createDiv()
    this.renderWhen()

    new Setting(contentEl)
      .setName('Output page')
      .setDesc('Vault-relative. Templates: {{date}} {{week}} {{month}} {{vault}}')
      .addText((t) =>
        t.setValue(this.job.output).onChange((v) => {
          this.job.output = v
          this.renderPreview()
        }),
      )
    this.previewEl = contentEl.createDiv({ cls: 'setting-item-description brain-agent-preview' })

    new Setting(contentEl)
      .setName('Output mode')
      .setDesc('new: page per run · append: a ## section per run · replace: overwrite')
      .addDropdown((d) => {
        MODES.forEach((m) => d.addOption(m, m))
        d.setValue(this.job.mode).onChange((v) => (this.job.mode = v as JobConfig['mode']))
      })

    new Setting(contentEl).setName('Model').setDesc('Blank = plugin default.').addText((t) =>
      t.setPlaceholder('sonnet').setValue(this.job.model).onChange((v) => (this.job.model = v)),
    )
    new Setting(contentEl).setName('Timeout (minutes)').setDesc('0 = plugin default.').addText((t) =>
      t.setValue(String(this.job.timeoutMinutes)).onChange((v) => (this.job.timeoutMinutes = Math.max(0, Number(v) || 0))),
    )
    new Setting(contentEl)
      .setName('Skills')
      .setDesc('Comma-separated allow-list. None by default; skills stay read-only.')
      .addText((t) => t.setValue(this.skillsText).onChange((v) => (this.skillsText = v)))

    const promptSetting = new Setting(contentEl).setName('Prompt').setDesc('The instruction Claude runs. Templates work here too.')
    promptSetting.settingEl.addClass('brain-agent-prompt-setting')
    const area = contentEl.createEl('textarea', { cls: 'brain-agent-prompt' })
    area.value = this.job.prompt
    area.rows = 10
    area.addEventListener('input', () => (this.job.prompt = area.value))

    this.errorEl = contentEl.createDiv({ cls: 'brain-agent-error mod-warning' })

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText('Save').setCta().onClick(async () => {
          const err = this.check()
          this.errorEl.setText(err ?? '')
          if (err) return
          await this.onSave(this.job)
          this.close()
        }),
      )
    this.renderPreview()
  }

  private renderWhen() {
    this.whenEl.empty()
    new Setting(this.whenEl).setName('Schedule').addDropdown((d) => {
      SCHEDULES.forEach((s) => d.addOption(s, s))
      d.setValue(this.job.schedule).onChange((v) => {
        this.job.schedule = v as JobConfig['schedule']
        if (this.job.schedule === 'weekly' && !DAY_NAMES.includes(this.job.day.toLowerCase())) this.job.day = 'sunday'
        if (this.job.schedule === 'monthly' && !/^\d+$/.test(this.job.day)) this.job.day = '1'
        this.renderWhen()
      })
    })
    if (this.job.schedule !== 'hourly') {
      new Setting(this.whenEl).setName('Time (local)').addText((t) => {
        t.inputEl.type = 'time'
        t.setValue(this.job.at).onChange((v) => (this.job.at = v))
      })
    }
    if (this.job.schedule === 'weekly') {
      new Setting(this.whenEl).setName('Day of week').addDropdown((d) => {
        DAY_NAMES.forEach((n) => d.addOption(n, n))
        d.setValue(this.job.day.toLowerCase()).onChange((v) => (this.job.day = v))
      })
    }
    if (this.job.schedule === 'monthly') {
      new Setting(this.whenEl)
        .setName('Day of month')
        .setDesc('31 clamps to the end of shorter months.')
        .addText((t) => t.setValue(this.job.day).onChange((v) => (this.job.day = v.trim())))
    }
  }

  private renderPreview() {
    try {
      const path = resolveOutput(this.job, new Date(), this.getRunSettings())
      this.previewEl.setText(`→ ${path}`)
      this.previewEl.removeClass('mod-warning')
    } catch (e) {
      this.previewEl.setText((e as Error).message)
      this.previewEl.addClass('mod-warning')
    }
  }

  private check(): string | null {
    try {
      this.job.skills = parseSkills(this.skillsText)
    } catch (e) {
      return (e as Error).message
    }
    const err = validateJob(this.job)
    if (err) return err
    try {
      resolveOutput(this.job, new Date(), this.getRunSettings())
    } catch (e) {
      return (e as Error).message
    }
    return null
  }

  onClose() {
    this.contentEl.empty()
  }
}
