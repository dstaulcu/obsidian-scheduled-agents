export const FACETS = ['projects', 'techniques', 'tools'] as const

export interface ManifestTag {
  tag: string
  facet: string
  status: 'active' | 'proposed' | 'deprecated'
  replaced_by: string | null
  /** Repo-relative note path, e.g. `tools/git.md`. */
  path: string
  /** sha256 hex of the note exactly as stored upstream. */
  hash: string
}

export interface Manifest {
  version: number
  tags: ManifestTag[]
}

/** A repo path is safe to turn into a vault path: relative, no `..`, no hidden segments, a note under a known facet. */
export function isSafeNotePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.endsWith('.md') || p.includes('\\') || p.startsWith('/')) return false
  const parts = p.split('/')
  if (parts.length !== 2) return false
  if (parts.some((s) => !s || s.startsWith('.') || s === '..')) return false
  return (FACETS as readonly string[]).includes(parts[0])
}

export function parseManifest(text: string): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('glossary.json is not valid JSON')
  }
  const m = raw as { version?: unknown; tags?: unknown }
  if (!m || m.version !== 1 || !Array.isArray(m.tags)) throw new Error('glossary.json has an unsupported format')
  const tags: ManifestTag[] = []
  for (const t of m.tags as Partial<ManifestTag>[]) {
    if (!t || !isSafeNotePath(t.path)) throw new Error(`glossary.json has an unsafe note path: ${String(t?.path)}`)
    if (typeof t.hash !== 'string' || !/^[0-9a-f]{64}$/.test(t.hash)) throw new Error(`glossary.json has a bad hash for ${t.path}`)
    const status = t.status === 'deprecated' || t.status === 'proposed' ? t.status : 'active'
    tags.push({
      tag: String(t.tag ?? ''),
      facet: String(t.facet ?? ''),
      status,
      replaced_by: t.replaced_by ? String(t.replaced_by) : null,
      path: t.path,
      hash: t.hash,
    })
  }
  return { version: 1, tags }
}
