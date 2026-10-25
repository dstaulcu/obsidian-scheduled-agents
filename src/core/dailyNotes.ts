import * as fs from 'fs'
import * as path from 'path'

export interface DailyNotesConfig {
  /** Vault-relative folder, no leading/trailing slash; '' means the vault root. */
  folder: string
  /** Moment-style filename format; may include subfolders (e.g. YYYY/MM/YYYY-MM-DD). */
  format: string
}

/** Obsidian's own default when the Daily notes settings were never changed: the vault root, YYYY-MM-DD. */
export const DEFAULT_DAILY_NOTES: DailyNotesConfig = { folder: '', format: 'YYYY-MM-DD' }

function clean(folder: unknown): string {
  return String(folder ?? '').trim().replace(/[\\]/g, '/').replace(/^\/+|\/+$/g, '')
}

function fromSection(raw: unknown): DailyNotesConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { folder?: unknown; format?: unknown }
  const format = String(o.format ?? '').trim()
  return { folder: clean(o.folder), format: format || DEFAULT_DAILY_NOTES.format }
}

/**
 * Resolve where daily notes live. Core Daily Notes (`.obsidian/daily-notes.json`) wins,
 * then Periodic Notes' daily section, then the defaults. Unreadable files are ignored.
 */
export function readDailyNotesConfig(vaultPath: string): DailyNotesConfig {
  const read = (rel: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(vaultPath, rel), 'utf8'))
    } catch {
      return null
    }
  }
  return resolveDailyNotes(read('.obsidian/daily-notes.json'), read('.obsidian/plugins/periodic-notes/data.json'))
}

export function resolveDailyNotes(core: unknown, periodic: unknown): DailyNotesConfig {
  const daily = (periodic as { daily?: { enabled?: boolean } } | null)?.daily
  if (core && typeof core === 'object' && Object.keys(core).length) return fromSection(core)!
  if (daily && daily.enabled !== false) return fromSection(daily) ?? DEFAULT_DAILY_NOTES
  return DEFAULT_DAILY_NOTES
}

/** Template variables for prompts and output paths. */
export function dailyNotesVars(c: DailyNotesConfig): Record<string, string> {
  return {
    dailyNotesFolder: c.folder,
    dailyNotesPath: c.folder ? `${c.folder}/` : '',
    dailyNotesFormat: c.format,
  }
}
