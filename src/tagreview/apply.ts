import { App, TFile } from 'obsidian'
import {
  AnyEdit,
  appendTagsBody,
  isVocabEdit,
  LineChange,
  retagBody,
  retagFmValue,
  validateEdit,
  VocabEdit,
} from './edits'
import { addDropTag, addLegacyMapping, addVocabEntry, setTagStatus } from './vocab'

export interface Plan {
  ok: boolean
  reason?: string
  /** Line-level before/after pairs for the preview (empty `before` = a new line). */
  changes: LineChange[]
  /** Human description of a change that is not a line diff. */
  note?: string
}

/** One file touched by an edit. `before` is null when the edit created the file. */
export interface FileChange {
  path: string
  before: string | null
  after: string
}

export interface ApplyOutcome {
  ok: boolean
  reason?: string
  files?: FileChange[]
}

/** The vocabulary note. It is the single source for tags, their definitions and project status. */
export interface VocabLocation {
  text: string
  path: string
  /** Folder prefixes (trailing slash) that note edits may not touch. */
  protected: string[]
}

function getFile(app: App, path: string): TFile | null {
  const f = app.vault.getAbstractFileByPath(path)
  return f instanceof TFile ? f : null
}

function fmTags(app: App, f: TFile): unknown {
  return app.metadataCache.getFileCache(f)?.frontmatter?.tags
}

/** The file a row should link to: vocabulary edits all live in the vocabulary note. */
export function editTarget(e: AnyEdit, vocabPath: string): string {
  return isVocabEdit(e) ? vocabPath : e.file
}

/** What a vocabulary edit does to the vocabulary text, or why it cannot be applied. */
function vocabTransform(e: VocabEdit, text: string): { content: string; before: string; after: string } {
  switch (e.op) {
    case 'vocab_add': {
      const r = addVocabEntry(text, e.tag, e.definition)
      return { content: r.content, before: '', after: r.line }
    }
    case 'vocab_map': {
      const r = addLegacyMapping(text, e.legacy, e.canonical)
      return { content: r.content, before: '', after: r.line }
    }
    case 'vocab_drop': {
      const r = addDropTag(text, e.tag)
      return { content: r.content, before: '', after: r.line }
    }
    case 'vocab_status':
      return setTagStatus(text, e.tag, e.status)
  }
}

function planVocab(e: VocabEdit, v: VocabLocation): Plan {
  try {
    const r = vocabTransform(e, v.text)
    return { ok: true, changes: [{ before: r.before, after: r.after }] }
  } catch (err) {
    return { ok: false, reason: (err as Error).message, changes: [] }
  }
}

/** Dry run against the vault as it is now: is the edit still valid, and what would change? */
export async function planEdit(app: App, e: AnyEdit, v: VocabLocation): Promise<Plan> {
  const bad = validateEdit(e, v.text, v.protected)
  if (bad) return { ok: false, reason: bad, changes: [] }
  if (isVocabEdit(e)) return planVocab(e, v)

  const f = getFile(app, e.file)
  if (!f) return { ok: false, reason: 'file not found', changes: [] }
  const content = await app.vault.read(f)
  try {
    switch (e.op) {
      case 'append_tags':
        return { ok: true, changes: appendTagsBody(content, e.match, e.tags).changes }
      case 'retag': {
        const body = retagBody(content, e.old_tag, e.new_tag)
        const fm = retagFmValue(fmTags(app, f), e.old_tag, e.new_tag)
        if (!body.changes.length && !fm.changed) return { ok: false, reason: 'tag not found (already done?)', changes: [] }
        const note = fm.changed ? `front matter tags: ${e.old_tag} → ${e.new_tag ?? '(removed)'}` : undefined
        return { ok: true, changes: body.changes, note }
      }
      case 'fm_set': {
        const cur = app.metadataCache.getFileCache(f)?.frontmatter?.[e.key]
        if (JSON.stringify(cur) === JSON.stringify(e.value)) return { ok: false, reason: 'already set', changes: [] }
        const shown = (x: unknown) => (x === undefined || x === null || x === '' ? '(empty)' : JSON.stringify(x))
        return { ok: true, changes: [], note: `${e.key}: ${shown(cur)} → ${shown(e.value)}` }
      }
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message, changes: [] }
  }
}

async function applyVocab(app: App, e: VocabEdit, v: VocabLocation): Promise<FileChange[]> {
  const vocabFile = getFile(app, v.path)
  if (!vocabFile) throw new Error('vocabulary note not found')
  const before = await app.vault.read(vocabFile)
  await app.vault.process(vocabFile, (data) => vocabTransform(e, data).content)
  return [{ path: vocabFile.path, before, after: await app.vault.read(vocabFile) }]
}

/** Apply one edit. Re-validates and re-plans first, so stale edits are skipped rather than guessed at. */
export async function applyEdit(app: App, e: AnyEdit, v: VocabLocation): Promise<ApplyOutcome> {
  const plan = await planEdit(app, e, v)
  if (!plan.ok) return { ok: false, reason: plan.reason }
  try {
    if (isVocabEdit(e)) return { ok: true, files: await applyVocab(app, e, v) }

    const f = getFile(app, e.file)!
    const before = await app.vault.read(f)
    if (e.op === 'append_tags') {
      await app.vault.process(f, (data) => appendTagsBody(data, e.match, e.tags).content)
    } else if (e.op === 'retag') {
      if (plan.changes.length) await app.vault.process(f, (data) => retagBody(data, e.old_tag, e.new_tag).content)
      const fm = retagFmValue(fmTags(app, f), e.old_tag, e.new_tag)
      if (fm.changed) {
        await app.fileManager.processFrontMatter(f, (front) => {
          const r = retagFmValue(front.tags, e.old_tag, e.new_tag)
          if (r.value.length) front.tags = r.value
          else delete front.tags
        })
      }
    } else {
      await app.fileManager.processFrontMatter(f, (front) => {
        front[e.key] = e.value
      })
    }
    return { ok: true, files: [{ path: f.path, before, after: await app.vault.read(f) }] }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}
