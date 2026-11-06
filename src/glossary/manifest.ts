export interface ManifestTag {
  tag: string
  facet: string
  /** `core` or a team id. */
  source: string
  status: 'active' | 'proposed' | 'deprecated'
  replaced_by: string | null
  aliases: string[]
  definition: string
  /** Repo-relative note path, e.g. `core/tool/git.md` or `teams/dave/project/x.md`. */
  path: string
  /** sha256 hex of the note exactly as stored upstream. */
  hash: string
}

export interface ManifestTeam {
  id: string
  name: string
  description: string
}

export interface Manifest {
  version: 2
  facets: string[]
  teams: ManifestTeam[]
  tags: ManifestTag[]
}

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * A repo path is safe to turn into a vault path: relative, no `..`, no hidden segments, and exactly
 * `core/<facet>/<name>.md` or `teams/<team>/<facet>/<name>.md`.
 */
export function isSafeNotePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.endsWith('.md') || p.includes('\\') || p.startsWith('/')) return false
  const parts = p.split('/')
  if (parts.some((s) => !s || s.startsWith('.') || s === '..')) return false
  if (parts[0] === 'core') return parts.length === 3 && SEGMENT.test(parts[1]) && SEGMENT.test(parts[2].slice(0, -3))
  if (parts[0] === 'teams') {
    return parts.length === 4 && SEGMENT.test(parts[1]) && SEGMENT.test(parts[2]) && SEGMENT.test(parts[3].slice(0, -3))
  }
  return false
}

/** Map a repo path to the vault path under `destFolder`: `core/x` -> `<dest>/core/x`, `teams/t/x` -> `<dest>/t/x`. */
export function vaultRelPath(repoPath: string): string {
  return repoPath.startsWith('teams/') ? repoPath.slice('teams/'.length) : repoPath
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parseManifest(text: string): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('glossary.json is not valid JSON')
  }
  const m = raw as { version?: unknown; facets?: unknown; teams?: unknown; tags?: unknown }
  if (!m || m.version !== 2 || !Array.isArray(m.tags)) throw new Error('glossary.json has an unsupported format (expected version 2)')
  const facets = Array.isArray(m.facets) ? m.facets.map(String) : []
  const teams: ManifestTeam[] = []
  for (const t of Array.isArray(m.teams) ? (m.teams as Partial<ManifestTeam>[]) : []) {
    if (t && typeof t.id === 'string' && SEGMENT.test(t.id)) teams.push({ id: t.id, name: str(t.name) || t.id, description: str(t.description) })
  }
  const tags: ManifestTag[] = []
  for (const t of m.tags as Partial<ManifestTag>[]) {
    if (!t || !isSafeNotePath(t.path)) throw new Error(`glossary.json has an unsafe note path: ${String(t?.path)}`)
    if (typeof t.hash !== 'string' || !/^[0-9a-f]{64}$/.test(t.hash)) throw new Error(`glossary.json has a bad hash for ${t.path}`)
    const parts = t.path.split('/')
    const source = parts[0] === 'core' ? 'core' : parts[1]
    const facet = parts[0] === 'core' ? parts[1] : parts[2]
    if (facets.length && !facets.includes(facet)) throw new Error(`glossary.json has an unknown facet "${facet}" in ${t.path}`)
    const status = t.status === 'deprecated' || t.status === 'proposed' ? t.status : 'active'
    tags.push({
      tag: String(t.tag ?? ''),
      facet,
      source, // derived from the path, not trusted from the file
      status,
      replaced_by: t.replaced_by ? String(t.replaced_by) : null,
      aliases: Array.isArray(t.aliases) ? t.aliases.map(String) : [],
      definition: str(t.definition),
      path: t.path,
      hash: t.hash,
    })
  }
  return { version: 2, facets, teams, tags }
}

export interface MergedManifest extends Manifest {
  /** Index into the source list for each tag, parallel to `tags`. */
  origin: number[]
  warnings: string[]
}

/** Union of several registries. On a duplicate tag the earlier source wins and a warning is recorded. */
export function mergeManifests(manifests: Manifest[]): MergedManifest {
  const out: MergedManifest = { version: 2, facets: [], teams: [], tags: [], origin: [], warnings: [] }
  const tagAt = new Map<string, number>()
  const pathAt = new Set<string>()
  manifests.forEach((m, idx) => {
    for (const f of m.facets) if (!out.facets.includes(f)) out.facets.push(f)
    for (const t of m.teams) if (!out.teams.some((x) => x.id === t.id)) out.teams.push(t)
    for (const t of m.tags) {
      if (tagAt.has(t.tag) || pathAt.has(t.path)) {
        out.warnings.push(`${t.tag} is defined by more than one source; using the first`)
        continue
      }
      tagAt.set(t.tag, idx)
      pathAt.add(t.path)
      out.tags.push(t)
      out.origin.push(idx)
    }
  })
  return out
}

/** Keep the core plus the chosen teams (or every team). */
export function filterTeams<T extends { tags: ManifestTag[] }>(m: T, teams: string[], allTeams: boolean): ManifestTag[] {
  return m.tags.filter((t) => t.source === 'core' || allTeams || teams.includes(t.source))
}
