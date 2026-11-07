import { App, Modal, Setting } from 'obsidian'
import { MAX_DIGEST_DAYS, parseDays } from '../core/days'

/** Asks how many days a one-off digest should look back, then calls `onSubmit` with that number. */
export class DaysModal extends Modal {
  constructor(
    app: App,
    private onSubmit: (days: number) => void,
    private initial = 14,
  ) {
    super(app)
  }

  onOpen() {
    this.titleEl.setText('Digest of the last N days')
    let value = String(this.initial)
    const error = this.contentEl.createEl('p', { cls: 'mod-warning' })
    const submit = () => {
      const days = parseDays(value)
      if (days === null) {
        error.setText(`Enter a whole number from 1 to ${MAX_DIGEST_DAYS}.`)
        return
      }
      this.close()
      this.onSubmit(days)
    }
    new Setting(this.contentEl)
      .setName('Days to look back')
      .setDesc('Today counts as day 1. The result is a new page in the plugin folder.')
      .addText((t) => {
        t.setValue(value).onChange((v) => (value = v))
        t.inputEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') submit()
        })
        t.inputEl.focus()
        t.inputEl.select()
      })
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Run digest').setCta().onClick(submit))
  }

  onClose() {
    this.contentEl.empty()
  }
}
