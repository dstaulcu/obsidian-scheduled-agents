import { createHash } from 'crypto'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Remove the plugin's `glossary_hash` line so the content equals what upstream stored. */
export function stripStamp(text: string): string {
  return text.replace(/^glossary_hash:.*\n?/m, '')
}

/** The upstream hash a local note was imported from, or null if it has no stamp. */
export function readStamp(text: string): string | null {
  const m = /^glossary_hash:\s*"?([0-9a-f]{64})"?\s*$/m.exec(text)
  return m ? m[1] : null
}

/** Add `glossary_hash` as the last front-matter key (quoted, so no parser coerces it). Notes with no front matter get one. */
export function stamp(text: string, hash: string): string {
  const line = `glossary_hash: "${hash}"`
  const m = /^---\n[\s\S]*?\n(---)/.exec(text)
  if (!m) return `---\n${line}\n---\n${text}`
  const at = m.index + m[0].length - m[1].length
  return text.slice(0, at) + line + '\n' + text.slice(at)
}
