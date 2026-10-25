import * as path from 'path'

export interface PathRules {
  /** Output must live under one of these vault-relative folders. Empty = unrestricted. */
  allowedFolders: string[]
}

const norm = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
const under = (p: string, folder: string) => {
  const f = norm(folder).toLowerCase()
  const q = p.toLowerCase()
  return f === '' ? false : q === f || q.startsWith(f + '/')
}

/** Resolve a vault-relative output page to a normalized posix path ending in .md, or throw. */
export function resolveVaultPath(relative: string, rules: PathRules): string {
  if (/^([a-zA-Z]:|[\\/])/.test(relative)) {
    throw new Error(`Output path must be vault-relative: ${relative}`)
  }
  let rel = norm(relative)
  if (!rel.toLowerCase().endsWith('.md')) rel += '.md'
  rel = path.posix.normalize(rel)
  if (rel === '..' || rel.startsWith('../') || rel.split('/').includes('..')) {
    throw new Error(`Output path escapes the vault: ${relative}`)
  }
  if (rel.split('/').some((seg) => seg.startsWith('.'))) {
    throw new Error(`Output path may not be inside a hidden folder (.obsidian etc): ${relative}`)
  }
  if (rules.allowedFolders.length && !rules.allowedFolders.some((f) => under(rel, f))) {
    throw new Error(
      `Output path '${rel}' is outside the allowed output folders (${rules.allowedFolders.join(', ')})`,
    )
  }
  return rel
}

/** Re-root a vault path from `oldFolder` to `newFolder` (exact match or anything beneath it); other paths pass through. */
export function rebasePath(p: string, oldFolder: string, newFolder: string): string {
  const o = norm(oldFolder).toLowerCase()
  const q = norm(p)
  if (!o) return p
  if (q.toLowerCase() === o) return norm(newFolder)
  if (q.toLowerCase().startsWith(o + '/')) return norm(newFolder) + q.slice(o.length)
  return p
}
