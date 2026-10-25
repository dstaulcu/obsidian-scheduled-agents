import { MarkdownPostProcessorContext, Notice, TFile } from 'obsidian'
import type AgentPlugin from '../main'
import { applyEdit, editTarget, FileChange, planEdit, Plan, VocabLocation } from './apply'
import { AnyEdit, editId, isVocabEdit, parseEdits } from './edits'

export const EDIT_FENCE = 'brain-edits'

export interface Batch {
  time: string
  ids: string[]
  /** `before` is null for a file the batch created. */
  files: { path: string; before: string | null; after: string }[]
}

export interface TagReviewState {
  decisions: Record<string, 'applied' | 'rejected'>
  lastBatch?: Batch
}

async function readVocab(plugin: AgentPlugin): Promise<VocabLocation | null> {
  const path = plugin.settings.tagVocabularyPath
  const f = plugin.app.vault.getAbstractFileByPath(path)
  return f instanceof TFile ? { path, text: await plugin.app.vault.read(f), protected: plugin.protectedPrefixes() } : null
}

function describe(e: AnyEdit): string {
  switch (e.op) {
    case 'vocab_add':
      return `Add ${e.tag} to vocabulary`
    case 'vocab_map':
      return `Map ${e.legacy} → ${e.canonical} (legacy)`
    case 'vocab_drop':
      return `Add ${e.tag} to drop list`
    case 'vocab_status':
      return `Mark ${e.tag} ${e.status}`
    case 'retag':
      return e.new_tag === null ? `Remove tag ${e.old_tag}` : `Retag ${e.old_tag} → ${e.new_tag}`
    case 'fm_set':
      return `Set ${e.key}`
    case 'append_tags':
      return `Add ${e.tags.join(', ')}`
  }
}

export function registerTagReview(plugin: AgentPlugin) {
  plugin.registerMarkdownCodeBlockProcessor(EDIT_FENCE, async (source, el, _ctx: MarkdownPostProcessorContext) => {
    const box = el.createDiv({ cls: 'ba-review' })
    const render = async () => {
      box.empty()
      const parsed = parseEdits(source)
      const errors = parsed.errors
      // vocabulary edits first, so tags they introduce are available to the edits after them
      const edits = [...parsed.edits].sort((a, b) => Number(isVocabEdit(b)) - Number(isVocabEdit(a)))
      errors.forEach((m) => box.createDiv({ cls: 'ba-review-error', text: m }))
      if (!edits.length) {
        if (!errors.length) box.createDiv({ cls: 'ba-review-empty', text: 'No edits suggested.' })
        return
      }
      const vocab = await readVocab(plugin)
      if (vocab === null) {
        box.createDiv({ cls: 'ba-review-error', text: `Vocabulary note not found: ${plugin.settings.tagVocabularyPath}` })
        return
      }
      const st = plugin.settings.tagReview
      const rows: { id: string; edit: AnyEdit; plan: Plan; cb?: HTMLInputElement }[] = []
      for (const edit of edits) {
        const id = editId(edit)
        rows.push({ id, edit, plan: await planEdit(plugin.app, edit, vocab) })
      }

      const bar = box.createDiv({ cls: 'ba-review-bar' })
      const list = box.createDiv({ cls: 'ba-review-list' })
      for (const row of rows) {
        const decision = st.decisions[row.id]
        const item = list.createDiv({ cls: 'ba-review-item' })
        const head = item.createDiv({ cls: 'ba-review-head' })
        const pending = !decision && row.plan.ok
        if (pending) {
          row.cb = head.createEl('input', { type: 'checkbox' })
          row.cb.checked = true
        }
        head.createSpan({ cls: 'ba-review-title', text: describe(row.edit) })
        const target = editTarget(row.edit, vocab.path)
        const link = head.createEl('a', { cls: 'internal-link', text: target, href: target })
        link.addEventListener('click', (ev) => {
          ev.preventDefault()
          void plugin.app.workspace.openLinkText(target, '', false)
        })
        const badge = decision ?? (row.plan.ok ? '' : `skipped: ${row.plan.reason}`)
        if (badge) head.createSpan({ cls: `ba-review-badge ba-${decision ?? 'stale'}`, text: badge })
        if (decision === 'rejected') {
          head.createEl('button', { text: 'Restore' }).addEventListener('click', async () => {
            delete st.decisions[row.id]
            await plugin.saveSettings()
            void render()
          })
        }
        if (row.plan.ok) {
          for (const c of row.plan.changes) {
            const d = item.createDiv({ cls: 'ba-review-diff' })
            if (c.before) d.createDiv({ cls: 'ba-del', text: c.before })
            d.createDiv({ cls: 'ba-ins', text: c.after })
          }
          if (row.plan.note) item.createDiv({ cls: 'ba-review-fm', text: row.plan.note })
        }
      }

      const selected = () => rows.filter((r) => r.cb?.checked)
      const pendingRows = rows.filter((r) => r.cb)
      bar.createSpan({ text: `${pendingRows.length} pending of ${rows.length}` })
      if (pendingRows.length) {
        bar.createEl('button', { text: 'Select all / none' }).addEventListener('click', () => {
          const all = pendingRows.every((r) => r.cb!.checked)
          pendingRows.forEach((r) => (r.cb!.checked = !all))
        })
        bar.createEl('button', { text: 'Reject selected' }).addEventListener('click', async () => {
          for (const r of selected()) st.decisions[r.id] = 'rejected'
          await plugin.saveSettings()
          void render()
        })
        bar.createEl('button', { text: 'Apply selected', cls: 'mod-cta' }).addEventListener('click', async () => {
          const chosen = selected()
          if (!chosen.length) return new Notice('Nothing selected')
          const files = new Map<string, { before: string | null; after: string }>()
          const ids: string[] = []
          let applied = 0
          const skipped: string[] = []
          for (const r of chosen) {
            const out = await applyEdit(plugin.app, r.edit, vocab)
            if (!out.ok) {
              skipped.push(`${editTarget(r.edit, vocab.path)}: ${out.reason}`)
              continue
            }
            applied++
            ids.push(r.id)
            st.decisions[r.id] = 'applied'
            for (const f of out.files as FileChange[]) {
              const prev = files.get(f.path)
              files.set(f.path, { before: prev ? prev.before : f.before, after: f.after })
            }
            // later edits in this batch must see vocabulary changes made by earlier ones
            if (isVocabEdit(r.edit)) vocab.text = (await readVocab(plugin))?.text ?? vocab.text
          }
          if (applied) {
            st.lastBatch = {
              time: new Date().toISOString(),
              ids,
              files: [...files].map(([path, v]) => ({ path, ...v })),
            }
          }
          await plugin.saveSettings()
          new Notice(
            `Applied ${applied} edit(s)` + (skipped.length ? `, skipped ${skipped.length}: ${skipped.join('; ')}` : '') +
              (applied ? '. Command "Undo last tag-review batch" reverts them.' : ''),
            10000,
          )
          void render()
        })
      }
    }
    await render()
  })
}

/** Restore files from the last applied batch, but only those untouched since. */
export async function undoLastBatch(plugin: AgentPlugin) {
  const st = plugin.settings.tagReview
  const batch = st.lastBatch
  if (!batch) return new Notice('No tag-review batch to undo')
  let restored = 0
  const changed: string[] = []
  for (const f of batch.files) {
    const file = plugin.app.vault.getAbstractFileByPath(f.path)
    if (!(file instanceof TFile)) {
      changed.push(f.path)
      continue
    }
    const cur = await plugin.app.vault.read(file)
    if (cur !== f.after) {
      changed.push(f.path)
      continue
    }
    if (f.before === null) await plugin.app.vault.delete(file)
    else await plugin.app.vault.modify(file, f.before)
    restored++
  }
  for (const id of batch.ids) delete st.decisions[id]
  delete st.lastBatch
  await plugin.saveSettings()
  new Notice(
    `Restored ${restored} file(s)` + (changed.length ? `. Left alone (edited since): ${changed.join(', ')}` : ''),
    10000,
  )
}
