export type FmValue = string | number | boolean | string[]

export interface ParsedNote {
  meta: Record<string, FmValue>
  body: string
}

function removeQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

function toScalar(v: string): string | number | boolean {
  const unq = removeQuotes(v)
  if (unq !== v) return unq // quoted values stay strings
  if (/^(true|yes)$/.test(v)) return true
  if (/^(false|no)$/.test(v)) return false
  if (/^\d+$/.test(v)) return parseInt(v, 10)
  return v
}

/** Minimal front-matter parser: `key: value` lines and `- item` lists (port of FrontMatter.ps1). */
export function parseFrontMatter(text: string): ParsedNote {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2 || lines[0].trim() !== '---') return { meta: {}, body: text }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return { meta: {}, body: text }

  const meta: Record<string, FmValue> = {}
  let currentList: string | null = null
  for (const line of lines.slice(1, end)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const item = /^\s+-\s*(.*)$/.exec(line)
    if (currentList && item) {
      const list = meta[currentList] as string[]
      list.push(removeQuotes(item[1]))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) {
      const value = kv[2].replace(/\s+#.*$/, '').trim()
      if (value === '') {
        meta[kv[1]] = []
        currentList = kv[1]
      } else {
        currentList = null
        meta[kv[1]] = toScalar(value)
      }
    }
  }
  return { meta, body: lines.slice(end + 1).join('\n').trim() }
}
