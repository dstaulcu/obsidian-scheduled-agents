import { ManifestTag, vaultRelPath } from './manifest'
import { readStamp, sha256, stripStamp } from './stamp'

export type Category = 'new' | 'updated' | 'unchanged' | 'conflict'

export interface PlanItem {
  entry: ManifestTag
  category: Category
  /** Vault path the note lives at. */
  vaultPath: string
  /** Index of the source the note comes from. */
  origin: number
}

export interface ImportPlan {
  items: PlanItem[]
  counts: Record<Category, number> & { deprecated: number }
}

export function vaultPathFor(destFolder: string, repoPath: string): string {
  const d = destFolder.replace(/^\/+|\/+$/g, '')
  const rel = vaultRelPath(repoPath)
  return d ? `${d}/${rel}` : rel
}

/**
 * Compare the manifest to local copies. `readLocal` returns the note text or null when absent.
 * An edit is any difference between the local text (stamp removed) and the version last imported.
 */
export async function planImport(
  manifest: { tags: ManifestTag[]; origin?: number[] },
  destFolder: string,
  readLocal: (vaultPath: string) => Promise<string | null>,
): Promise<ImportPlan> {
  const items: PlanItem[] = []
  const counts = { new: 0, updated: 0, unchanged: 0, conflict: 0, deprecated: 0 }
  for (const [n, entry] of manifest.tags.entries()) {
    const vaultPath = vaultPathFor(destFolder, entry.path)
    const local = await readLocal(vaultPath)
    let category: Category
    if (local === null) category = 'new'
    else {
      const localHash = sha256(stripStamp(local))
      const imported = readStamp(local)
      if (localHash === entry.hash) category = imported === entry.hash ? 'unchanged' : 'updated' // identical content; stamp it
      else if (imported && localHash === imported) category = 'updated' // untouched since last import
      else category = 'conflict'
    }
    counts[category]++
    if (entry.status === 'deprecated') counts.deprecated++
    items.push({ entry, category, vaultPath, origin: manifest.origin?.[n] ?? 0 })
  }
  return { items, counts }
}

export function summarize(counts: ImportPlan['counts']): string {
  const parts = [
    counts.new && `${counts.new} new`,
    counts.updated && `${counts.updated} updated`,
    counts.conflict && `${counts.conflict} conflict${counts.conflict > 1 ? 's' : ''}`,
  ].filter(Boolean)
  return parts.length ? `Glossary: ${parts.join(', ')}` : 'Glossary: up to date'
}
