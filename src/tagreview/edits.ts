/** Pure parsing, validation and text transforms for tag-review edits. No Obsidian imports, so it is unit-testable. */

import { declaredFmKeys, Status, STATUSES, TAG_RE } from './vocab'

export interface RetagEdit {
  op: 'retag'
  file: string
  old_tag: string
  new_tag: string | null
}
export interface FmSetEdit {
  op: 'fm_set'
  file: string
  key: 'date' | 'week' | 'tags'
  value: string | string[]
}
export interface AppendTagsEdit {
  op: 'append_tags'
  file: string
  match: string
  tags: string[]
}
export type TagEdit = RetagEdit | FmSetEdit | AppendTagsEdit

/** Edits to the vocabulary note itself (the single source for tags, definitions and status); they carry no `file`. */
export interface VocabAddEdit {
  op: 'vocab_add'
  tag: string
  definition: string
}
export interface VocabMapEdit {
  op: 'vocab_map'
  legacy: string
  canonical: string
}
export interface VocabDropEdit {
  op: 'vocab_drop'
  tag: string
}
export interface VocabStatusEdit {
  op: 'vocab_status'
  tag: string
  status: Status
}
export type VocabEdit = VocabAddEdit | VocabMapEdit | VocabDropEdit | VocabStatusEdit
export type AnyEdit = TagEdit | VocabEdit

export const isVocabEdit = (e: AnyEdit): e is VocabEdit => e.op.startsWith('vocab_')

export interface LineChange {
  before: string
  after: string
}

/** Folders a tag-review edit may never touch. */
/** Folders (with trailing slash) edits may not touch when the caller does not supply its own list. */
export const DEFAULT_PROTECTED = ['Glossary/', 'Templates/', '.obsidian/']
export const MAX_EDITS = 60

export function parseEdits(source: string): { edits: AnyEdit[]; errors: string[] } {
  const errors: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (e) {
    return { edits: [], errors: [`Edit list is not valid JSON: ${(e as Error).message}`] }
  }
  if (!Array.isArray(raw)) return { edits: [], errors: ['Edit list must be a JSON array'] }
  const edits: AnyEdit[] = []
  raw.slice(0, MAX_EDITS).forEach((item, i) => {
    const bad = structuralError(item)
    if (bad) errors.push(`Edit ${i + 1}: ${bad}`)
    else edits.push(item as AnyEdit)
  })
  if (raw.length > MAX_EDITS) errors.push(`Only the first ${MAX_EDITS} edits are shown`)
  return { edits, errors }
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function structuralError(e: unknown): string | null {
  if (!e || typeof e !== 'object') return 'not an object'
  const o = e as Record<string, unknown>
  switch (o.op) {
    case 'vocab_add':
      return isStr(o.tag) && isStr(o.definition) ? null : 'vocab_add needs tag and definition'
    case 'vocab_map':
      return isStr(o.legacy) && isStr(o.canonical) ? null : 'vocab_map needs legacy and canonical'
    case 'vocab_drop':
      return isStr(o.tag) ? null : 'vocab_drop needs tag'
    case 'vocab_status':
      return isStr(o.tag) && (STATUSES as readonly unknown[]).includes(o.status)
        ? null
        : 'vocab_status needs tag and a status of active, dormant or done'
  }
  if (!isStr(o.file)) return 'missing file'
  switch (o.op) {
    case 'retag':
      if (!isStr(o.old_tag)) return 'retag needs old_tag'
      if (!(o.new_tag === null || isStr(o.new_tag))) return 'retag new_tag must be a string or null'
      return null
    case 'fm_set':
      if (o.key !== 'date' && o.key !== 'week' && o.key !== 'tags') return 'fm_set key must be date, week or tags'
      if (!(isStr(o.value) || (Array.isArray(o.value) && o.value.every(isStr)))) return 'fm_set needs a value'
      return null
    case 'append_tags':
      if (!isStr(o.match)) return 'append_tags needs match'
      if (!Array.isArray(o.tags) || !o.tags.every(isStr)) return 'append_tags needs tags'
      return null
    default:
      return `unknown op '${String(o.op)}'`
  }
}

/** Stable identity for an edit, so decisions survive the report being regenerated. */
export function editId(e: AnyEdit): string {
  const s = JSON.stringify(e)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function tagInVocabulary(vocab: string, tag: string): boolean {
  return new RegExp(`(^|[^\\w/-])#?${esc(tag)}(?![\\w/-])`, 'm').test(vocab)
}

/** Returns an error string, or null when the edit is allowed. */
function validateVocabEdit(e: VocabEdit): string | null {
  const bad = (t: string) => (TAG_RE.test(t) ? null : `'${t}' must be lowercase kebab-case, with / between facet and name`)
  switch (e.op) {
    case 'vocab_add':
      if (e.definition.length < 3 || e.definition.length > 200 || /[\r\n]/.test(e.definition)) {
        return 'definition must be one line, 3-200 characters'
      }
      return bad(e.tag)
    case 'vocab_map':
      return bad(e.legacy) ?? bad(e.canonical)
    case 'vocab_drop':
    case 'vocab_status':
      return bad(e.tag)
  }
}

export function validateEdit(e: AnyEdit, vocab: string, protectedPrefixes: string[] = DEFAULT_PROTECTED): string | null {
  if (isVocabEdit(e)) return validateVocabEdit(e)
  const file = e.file.replace(/\\/g, '/')
  if (!file.endsWith('.md')) return 'only .md files can be edited'
  if (file.startsWith('/') || file.split('/').includes('..')) return 'path must be vault-relative'
  if (protectedPrefixes.some((p) => file.toLowerCase().startsWith(p.toLowerCase()))) return 'protected folder'
  const needTag = (t: string) => (tagInVocabulary(vocab, t) ? null : `tag '${t}' is not in the vocabulary`)
  switch (e.op) {
    case 'retag':
      if (e.old_tag.startsWith('#') || (e.new_tag ?? '').startsWith('#')) return "tags must not start with '#'"
      return e.new_tag === null ? null : needTag(e.new_tag)
    case 'fm_set':
      if (e.key !== 'tags' && !declaredFmKeys(vocab).has(e.key)) {
        return `front matter key '${e.key}' is not declared in the vocabulary's Conventions`
      }
      if (e.key === 'date') return typeof e.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.value) ? null : 'date must be YYYY-MM-DD'
      if (e.key === 'week') return typeof e.value === 'string' && /^\[\[\d{4}-W\d{2}\]\]$/.test(e.value) ? null : 'week must look like [[2026-W42]]'
      if (!Array.isArray(e.value)) return 'tags value must be an array'
      return e.value.map(needTag).find((x) => x) ?? null
    case 'append_tags':
      if (e.match.length < 8) return 'match is too short'
      if (e.match.includes('#')) return "match must not contain '#'"
      if (e.tags.length < 1 || e.tags.length > 4) return 'append_tags takes 1-4 tags'
      return e.tags.map(needTag).find((x) => x) ?? null
  }
}

/** Split into front matter (including its closing fence line) and body. */
export function splitFrontMatter(content: string): { head: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(content)
  if (!m) return { head: '', body: content }
  return { head: m[0], body: content.slice(m[0].length) }
}

/** Rename (or remove, with next=null) an inline #tag in the body only. */
export function retagBody(
  content: string,
  old: string,
  next: string | null,
): { content: string; changes: LineChange[] } {
  const { head, body } = splitFrontMatter(content)
  const re = new RegExp(`(^|[\\s(])#${esc(old)}(?![\\w/-])`, 'g')
  const changes: LineChange[] = []
  const lines = body.split('\n').map((line) => {
    if (!re.test(line)) return line
    re.lastIndex = 0
    let out = line.replace(re, (_m, pre: string) => (next === null ? pre : `${pre}#${next}`))
    if (next === null) out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(\r?)$/, '$1')
    changes.push({ before: line.trim(), after: out.trim() })
    return out
  })
  return { content: head + lines.join('\n'), changes }
}

/** Rename/remove a tag inside a front-matter `tags` value (array or delimited string). */
export function retagFmValue(value: unknown, old: string, next: string | null): { value: string[]; changed: boolean } {
  const items: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[,\s]+/).filter(Boolean)
      : []
  let changed = false
  const out: string[] = []
  for (const raw of items) {
    if (raw.replace(/^#/, '') === old) {
      changed = true
      if (next !== null && !out.includes(next)) out.push(next)
    } else out.push(raw)
  }
  return { value: changed ? out.filter((t, i) => out.indexOf(t) === i) : out, changed }
}

/** Append inline tags to the single bullet line containing `match`. Throws if not exactly one line matches. */
export function appendTagsBody(
  content: string,
  match: string,
  tags: string[],
): { content: string; changes: LineChange[] } {
  const { head, body } = splitFrontMatter(content)
  const lines = body.split('\n')
  const hits = lines.map((l, i) => (l.includes(match) ? i : -1)).filter((i) => i >= 0)
  if (hits.length === 0) throw new Error('line no longer found')
  if (hits.length > 1) throw new Error('match is not unique in the file')
  const idx = hits[0]
  const line = lines[idx]
  if (!/^\s*[-*]\s/.test(line)) throw new Error('matched line is not a bullet')
  const cr = line.endsWith('\r') ? '\r' : ''
  const base = line.replace(/\r$/, '')
  const present = (t: string) => new RegExp(`(^|\\s)#${esc(t)}(?![\\w/-])`).test(base)
  const add = tags.filter((t) => !present(t))
  if (!add.length) throw new Error('line already has these tags')
  const after = `${base.trimEnd()} ${add.map((t) => `#${t}`).join(' ')}`
  lines[idx] = after + cr
  return { content: head + lines.join('\n'), changes: [{ before: base.trim(), after: after.trim() }] }
}
