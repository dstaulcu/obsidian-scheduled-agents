const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Replace `#old` with `#new` where `old` is a whole tag (so `#tools/gitlab` is untouched when renaming `tools/git`);
 * `#old/child` becomes `#new/child`. Bare entries in front-matter `tags:` lists are renamed too.
 * Fenced code and inline code are left alone.
 */
export function renameTagInText(text: string, oldTag: string, newTag: string): string {
  const o = oldTag.replace(/^#/, '')
  const n = newTag.replace(/^#/, '')
  const inline = new RegExp(`(^|[^\\w/#&])#${esc(o)}(?![\\w-])`, 'g')
  const bare = new RegExp(`^(\\s*(?:-\\s+|tags:\\s*)?["']?)${esc(o)}(?![\\w-])`)
  const lines = text.split('\n')
  let fence = false
  let fm = lines[0] === '---'
  return lines
    .map((line, i) => {
      if (fm) {
        if (i > 0 && line === '---') fm = false
        else if (/^\s*(-\s|tags:)/.test(line)) line = line.replace(bare, `$1${n}`)
        return line.replace(inline, `$1#${n}`)
      }
      if (/^\s*(`{3}|~{3})/.test(line)) fence = !fence
      if (fence) return line
      return line
        .split(/(`[^`]*`)/)
        .map((seg) => (seg.startsWith('`') ? seg : seg.replace(inline, `$1#${n}`)))
        .join('')
    })
    .join('\n')
}
