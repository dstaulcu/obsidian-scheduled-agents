import { PlanItem } from './plan'
import { sha256, stamp } from './stamp'

export type ConflictChoice = 'keep' | 'theirs' | 'copy'

export interface GlossaryVault {
  read(path: string): Promise<string | null>
  /** Creates parent folders as needed. */
  create(path: string, content: string): Promise<void>
  modify(path: string, content: string): Promise<void>
}

export interface Decision {
  item: PlanItem
  /** Only consulted for conflicts; defaults to keep. */
  choice?: ConflictChoice
}

export interface ApplyResult {
  created: number
  updated: number
  skipped: number
  copies: string[]
}

/**
 * Fetch every selected note first, so a failure (auth, network) aborts before anything is written, then write.
 * Each download is checked against its manifest hash so a truncated or altered note is never stamped as current.
 */
export async function applyImport(
  decisions: Decision[],
  fetchNote: (repoPath: string) => Promise<string>,
  vault: GlossaryVault,
): Promise<ApplyResult> {
  const work = decisions.filter(
    (d) => d.item.category !== 'unchanged' && !(d.item.category === 'conflict' && (d.choice ?? 'keep') === 'keep'),
  )
  const bodies = new Map<string, string>()
  for (const d of work) {
    const text = await fetchNote(d.item.entry.path)
    if (sha256(text) !== d.item.entry.hash) {
      throw new Error(`${d.item.entry.path} does not match its manifest hash; nothing was written`)
    }
    bodies.set(d.item.entry.path, text)
  }
  const result: ApplyResult = { created: 0, updated: 0, skipped: decisions.length - work.length, copies: [] }
  for (const d of work) {
    const { entry, vaultPath, category } = d.item
    const stamped = stamp(bodies.get(entry.path)!, entry.hash)
    if (category === 'new') {
      await vault.create(vaultPath, stamped)
      result.created++
    } else if (category === 'conflict' && d.choice === 'copy') {
      const base = vaultPath.replace(/\.md$/, '')
      let target = `${base} (glossary).md`
      for (let i = 2; (await vault.read(target)) !== null; i++) target = `${base} (glossary ${i}).md`
      await vault.create(target, stamped)
      result.copies.push(target)
    } else {
      await vault.modify(vaultPath, stamped)
      result.updated++
    }
  }
  return result
}
