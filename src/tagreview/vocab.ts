/** Pure text transforms for the controlled-vocabulary note: one bullet per tag, legacy mappings, a drop list, status markers. */

export const TAG_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/
export const STATUSES = ['active', 'dormant', 'done'] as const
export type Status = (typeof STATUSES)[number]

const eolOf = (s: string) => (s.includes('\r\n') ? '\r\n' : '\n')
const linesOf = (s: string) => s.split(/\r?\n/)
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function section(lines: string[], isHeading: (h: string) => boolean): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.startsWith('## ') && isHeading(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return { start, end }
}

/** Front-matter keys (date, week) a vocabulary declares on a Conventions line that mentions front matter and names the key in backticks. */
export function declaredFmKeys(vocab: string): Set<string> {
  const out = new Set<string>()
  for (const l of linesOf(vocab)) {
    if (!l.startsWith('- ') || !/front[ -]?matter/i.test(l)) continue
    for (const m of l.matchAll(/`(date|week)`/g)) out.add(m[1])
  }
  return out
}

/** Tags defined as "- `tag` — definition" bullets (legacy mappings and the drop list are not definitions). */
export function definedTags(vocab: string): Set<string> {
  const out = new Set<string>()
  for (const l of linesOf(vocab)) {
    const m = /^- `([^`]+)` — /.exec(l)
    if (m) out.add(m[1])
  }
  return out
}

function insertAfterLastBullet(
  lines: string[],
  sec: { start: number; end: number },
  line: string,
  isBullet: (l: string) => boolean,
) {
  // after the last bullet; with none, after the last non-blank line of the section (keeps any intro text above)
  let at = sec.start + 1
  let sawBullet = false
  for (let i = sec.start + 1; i < sec.end; i++) {
    if (isBullet(lines[i])) {
      at = i + 1
      sawBullet = true
    } else if (!sawBullet && lines[i].trim() !== '') at = i + 1
  }
  lines.splice(at, 0, line)
}

export function addVocabEntry(vocab: string, tag: string, definition: string): { content: string; line: string } {
  if (definedTags(vocab).has(tag)) throw new Error(`'${tag}' is already in the vocabulary`)
  const facet = tag.includes('/') ? tag.split('/')[0] : null
  const lines = linesOf(vocab)
  const sec = section(lines, (h) => (facet ? h.trim() === `## ${facet}/` : /^## System tags/.test(h)))
  if (!sec) throw new Error(facet ? `no '${facet}/' section in the vocabulary` : 'no System tags section in the vocabulary')
  const line = `- \`${tag}\` — ${definition}`
  insertAfterLastBullet(lines, sec, line, (l) => l.startsWith('- '))
  return { content: lines.join(eolOf(vocab)), line }
}

export function addLegacyMapping(vocab: string, legacy: string, canonical: string): { content: string; line: string } {
  const defined = definedTags(vocab)
  if (!defined.has(canonical)) throw new Error(`'${canonical}' is not in the vocabulary`)
  if (defined.has(legacy)) throw new Error(`'${legacy}' is already a vocabulary tag`)
  if (new RegExp('^- `' + escRe(legacy) + '` →', 'm').test(vocab)) throw new Error(`'${legacy}' is already mapped`)
  const lines = linesOf(vocab)
  const sec = section(lines, (h) => h.startsWith('## Legacy'))
  if (!sec) throw new Error('no Legacy → canonical section in the vocabulary')
  const line = `- \`${legacy}\` → \`${canonical}\``
  insertAfterLastBullet(lines, sec, line, (l) => l.startsWith('- `') && l.includes(' → '))
  return { content: lines.join(eolOf(vocab)), line }
}

export function addDropTag(vocab: string, tag: string): { content: string; line: string } {
  if (definedTags(vocab).has(tag)) throw new Error(`'${tag}' is a vocabulary tag; it cannot be dropped`)
  const lines = linesOf(vocab)
  const sec = section(lines, (h) => h.startsWith('## Legacy'))
  if (!sec) throw new Error('no Legacy → canonical section in the vocabulary')
  const token = `\`${tag}\``
  const idx = lines.findIndex((l, i) => i > sec.start && i < sec.end && l.startsWith('- Drop:'))
  let line: string
  if (idx >= 0) {
    if (lines[idx].split(/[:,]\s*/).includes(token)) throw new Error(`'${tag}' is already on the drop list`)
    lines[idx] = `${lines[idx].trimEnd()}, ${token}`
    line = lines[idx]
  } else {
    line = `- Drop: ${token}`
    insertAfterLastBullet(lines, sec, line, (l) => l.startsWith('- '))
  }
  return { content: lines.join(eolOf(vocab)), line }
}

/** A trailing "(status: dormant)" marker on a tag's bullet. A tag with no marker is active. */
const STATUS_MARKER = /\s*\(status:\s*(active|dormant|done)\)\s*$/

export function statusOf(line: string): Status {
  return (STATUS_MARKER.exec(line)?.[1] as Status | undefined) ?? 'active'
}

/**
 * Set a tag's status on its bullet in the vocabulary note: `dormant` and `done` append a marker,
 * `active` removes it. Throws if the tag is not defined or already has that status.
 */
export function setTagStatus(
  vocab: string,
  tag: string,
  status: Status,
): { content: string; before: string; after: string } {
  const lines = linesOf(vocab)
  const prefix = `- \`${tag}\` — `
  const idx = lines.findIndex((l) => l.startsWith(prefix))
  if (idx < 0) throw new Error(`'${tag}' is not in the vocabulary`)
  const before = lines[idx]
  if (statusOf(before) === status) throw new Error('already set')
  const base = before.replace(STATUS_MARKER, '')
  const after = status === 'active' ? base : `${base} (status: ${status})`
  lines[idx] = after
  return { content: lines.join(eolOf(vocab)), before, after }
}
