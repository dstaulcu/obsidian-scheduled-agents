import { Manifest, ManifestTag } from './manifest'
import { readStamp, sha256, stripStamp } from './stamp'

export type Category = 'new' | 'updated' | 'unchanged' | 'conflict'

export interface PlanItem {
  entry: ManifestTag
  category: Category
  /** Vault path the note lives at. */
  vaultPath: string
}

export interface ImportPlan {
  items: PlanItem[]
  counts: Record<Category, number> & { deprecated: number }
}

export function vaultPathFor(destFolder: string, repoPath: string): string {
  const d = destFolder.replace(/^\/+|\/+$/g, '')
  return d ? `${d}/${repoPath}` : repoPath
}

/**
 * Compare the manifest to local copies. `readLocal` returns the note text or null when absent.
 * An edit is any difference between the local text (stamp removed) and the version last imported.
 */
export async function planImport(
  manifest: Manifest,
  destFolder: string,
  readLocal: (vaultPath: string) => Promise<string | null>,
): Promise<ImportPlan> {
  const items: PlanItem[] = []
  const counts = { new: 0, updated: 0, unchanged: 0, conflict: 0, deprecated: 0 }
  for (const entry of manifest.tags) {
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
    items.push({ entry, category, vaultPath })
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
