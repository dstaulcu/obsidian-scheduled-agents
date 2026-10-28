import { App, Modal, Setting } from 'obsidian'
import { ConflictChoice, Decision } from '../glossary/apply'
import { ImportPlan, PlanItem } from '../glossary/plan'

export interface Rename {
  from: string
  to: string
}

export interface PreviewResult {
  decisions: Decision[]
  renames: Rename[]
}

const LABEL: Record<string, string> = { new: 'New', updated: 'Updated', conflict: 'Conflicts (edited locally)' }

/** Lists what an import would do. Nothing is written until Apply; conflicts default to "keep mine". */
export class GlossaryPreviewModal extends Modal {
  private selected = new Set<string>()
  private choices = new Map<string, ConflictChoice>()
  private renames = new Set<string>()

  constructor(
    app: App,
    private plan: ImportPlan,
    /** Notes outside the glossary that mention `#tag`; shown beside the opt-in rename. */
    private countUsages: (tag: string) => Promise<number>,
    private onApply: (r: PreviewResult) => Promise<void>,
  ) {
    super(app)
    for (const i of plan.items) {
      if (i.category === 'new' || i.category === 'updated') this.selected.add(i.entry.path)
      if (i.category === 'conflict') this.choices.set(i.entry.path, 'keep')
    }
  }

  onOpen() {
    const { contentEl } = this
    this.titleEl.setText('Import tag glossary')
    contentEl.empty()
    for (const cat of ['new', 'updated', 'conflict'] as const) {
      const items = this.plan.items.filter((i) => i.category === cat)
      if (!items.length) continue
      new Setting(contentEl).setName(`${LABEL[cat]} (${items.length})`).setHeading()
      for (const item of items) cat === 'conflict' ? this.conflictRow(contentEl, item) : this.checkRow(contentEl, item)
    }
    const deprecated = this.plan.items.filter((i) => i.entry.status === 'deprecated' && i.entry.replaced_by)
    if (deprecated.length) {
      new Setting(contentEl).setName(`Deprecated (${deprecated.length})`).setHeading()
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Renaming rewrites tags in your other notes. It is off unless you tick it.',
      })
      for (const item of deprecated) this.renameRow(contentEl, item)
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText('Apply').setCta().onClick(async () => {
          b.setDisabled(true)
          const decisions: Decision[] = this.plan.items
            .filter((i) => (i.category === 'conflict' ? true : this.selected.has(i.entry.path)))
            .map((item) => ({ item, choice: this.choices.get(item.entry.path) }))
          const renames = [...this.renames].map((tag) => {
            const e = this.plan.items.find((i) => i.entry.tag === tag)!.entry
            return { from: e.tag, to: e.replaced_by! }
          })
          this.close()
          await this.onApply({ decisions, renames })
        }),
      )
  }

  private checkRow(el: HTMLElement, item: PlanItem) {
    new Setting(el).setName(item.entry.tag).setDesc(item.vaultPath).addToggle((t) =>
      t.setValue(true).onChange((v) => (v ? this.selected.add(item.entry.path) : this.selected.delete(item.entry.path))),
    )
  }

  private conflictRow(el: HTMLElement, item: PlanItem) {
    new Setting(el)
      .setName(item.entry.tag)
      .setDesc('You changed this note. Choose what to do with the upstream version.')
      .addDropdown((d) =>
        d
          .addOptions({ keep: 'Keep mine', theirs: 'Take theirs', copy: 'Save theirs as a copy' })
          .setValue('keep')
          .onChange((v) => this.choices.set(item.entry.path, v as ConflictChoice)),
      )
  }

  private renameRow(el: HTMLElement, item: PlanItem) {
    const row = new Setting(el).setName(`#${item.entry.tag} → #${item.entry.replaced_by}`).setDesc('Counting notes…')
    row.addToggle((t) =>
      t.setValue(false).onChange((v) => (v ? this.renames.add(item.entry.tag) : this.renames.delete(item.entry.tag))),
    )
    void this.countUsages(item.entry.tag).then((n) => row.setDesc(`Rename in ${n} note${n === 1 ? '' : 's'}`))
  }

  onClose() {
    this.contentEl.empty()
  }
}
