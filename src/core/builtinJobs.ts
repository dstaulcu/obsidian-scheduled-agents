import { JobConfig } from './types'
import { newJob, AgentSettings } from '../settings'


export const WEEKLY_DIGEST_NAME = 'Weekly Digest'

interface DigestPeriod {
  /** Shown in the page headings: "Day", "Week", "Month". */
  noun: string
  /** How many days back to read, counting today. Written into the prompt, so users change it by editing the prompt. */
  days: number
  /** Closing section title and how many items it may hold. */
  carry: string
  carryMax: string
}

/** One prompt for every digest period, so a wording fix reaches all of them. */
export function digestPrompt(p: DigestPeriod): string {
  return `You are summarising the user's ${p.noun.toLowerCase()} from their Obsidian daily notes. You are read-only: never claim to have changed anything.

## Inputs
1. Use the daily notes from the last ${p.days} day${p.days === 1 ? '' : 's'} (today counts as day 1). Find them with Glob \`{{dailyNotesPath}}**/*.md\` (daily note names follow the Moment format \`{{dailyNotesFormat}}\`; they may sit in subfolders; select ONLY by the date the filename encodes). Read them.
2. Skip {{skipPaths}}.
3. A tag on a parent bullet applies to every bullet nested under it. Use tags (they are grouped by facet, such as \`areas/\` or \`projects/\`) to group the work when they are present.

## Output
Return ONLY this markdown. Link source notes with [[wikilinks]]. Wrap any tag in backticks so this page creates no real tags. Do NOT use \`- [ ]\` checkboxes.

### ${p.noun} at a glance
Three or four sentences: what the ${p.noun.toLowerCase()} was about and how many daily notes there were.

### By area or project
One short subsection per area or project that had real activity, with the key outcomes as bullets and a link to the notes they came from.

### Decisions and open threads
Decisions made, and tasks or questions that were started but not finished.

### ${p.carry}
${p.carryMax}

Be concise and specific. If there are no daily notes in the range, say so in one sentence.
`
}

const WEEKLY_DIGEST_PROMPT = digestPrompt({
  noun: 'Week',
  days: 7,
  carry: 'Worth carrying into next week',
  carryMax: 'At most five items.',
})
/** Built-in ids are namespaced and stable; the display name is just a label and can change freely. */
export const BUILTIN_NAMESPACE = 'default'
/** The id predates the rename to Weekly Digest and stays so saved jobs keep their schedule and state. */
export const WEEKLY_DIGEST_ID = `${BUILTIN_NAMESPACE}/daily-notes-digest`

export interface BuiltinJob {
  id: string
  name: string
  make(): JobConfig
}

const base = (id: string, name: string, over: Partial<JobConfig>): JobConfig => ({
  ...newJob(),
  name,
  builtin: id,
  enabled: false,
  model: 'sonnet',
  timeoutMinutes: 10,
  ...over,
})

/** Catalog of shipped jobs. Seeded once, disabled; each can be reset to this definition. */
export const BUILTINS: BuiltinJob[] = [
  {
    id: WEEKLY_DIGEST_ID,
    name: WEEKLY_DIGEST_NAME,
    make: () =>
      base(WEEKLY_DIGEST_ID, WEEKLY_DIGEST_NAME, {
        schedule: 'weekly',
        at: '06:00',
        day: 'monday',
        output: '{{pluginFolder}}/{{week}} Digest',
        mode: 'new',
        prompt: WEEKLY_DIGEST_PROMPT,
      }),
  },
]

/**
 * Earlier builds used the display name as the id, and the weekly digest used to be called Daily Notes Digest.
 * Map those to the stable id and the new label. A name the user chose is kept.
 */
const LEGACY_IDS: Record<string, { id: string; rename?: [string, string] }> = {
  'Daily Notes Digest': { id: WEEKLY_DIGEST_ID, rename: ['Daily Notes Digest', WEEKLY_DIGEST_NAME] },
  [WEEKLY_DIGEST_ID]: { id: WEEKLY_DIGEST_ID, rename: ['Daily Notes Digest', WEEKLY_DIGEST_NAME] },
  'Weekly Digest': { id: WEEKLY_DIGEST_ID },
}

/** Built-ins that no longer ship. Installs that still carry them lose the job and its run state. */
const RETIRED_BUILTINS = ['default/tag-review', 'Tag Review']

function removeRetiredBuiltins(settings: AgentSettings): boolean {
  const gone = settings.jobs.filter((j) => j.builtin && RETIRED_BUILTINS.includes(j.builtin))
  if (!gone.length) return false
  for (const j of gone) delete settings.state[j.id]
  settings.jobs = settings.jobs.filter((j) => !gone.includes(j))
  return true
}

function migrateLegacyBuiltinIds(settings: AgentSettings): boolean {
  let changed = false
  for (const [from, { id: to, rename }] of Object.entries(LEGACY_IDS)) {
    for (const j of settings.jobs) {
      if (j.builtin !== from) continue
      if (j.builtin !== to) {
        j.builtin = to
        changed = true
      }
      if (rename && j.name === rename[0]) {
        j.name = rename[1]
        changed = true
      }
    }
  }
  return changed
}

/**
 * Make sure every built-in exists. Built-ins cannot be deleted (only disabled), so any that are missing are
 * added disabled (or enabled, once, when the reset-test dev hook asks for it), which also delivers built-ins introduced by later versions. A same-named user job is adopted
 * as the built-in without touching its contents. Returns true if settings changed.
 */
export function ensureBuiltins(settings: AgentSettings): boolean {
  let changed = removeRetiredBuiltins(settings)
  changed = migrateLegacyBuiltinIds(settings) || changed
  const enabled = settings.seedBuiltinsEnabled === true
  for (const b of BUILTINS) {
    if (settings.jobs.some((j) => j.builtin === b.id)) continue
    const same = settings.jobs.find((j) => j.name === b.name && !j.builtin)
    if (same) same.builtin = b.id
    else settings.jobs.push({ ...b.make(), enabled })
    changed = true
  }
  if ('seedBuiltinsEnabled' in settings) {
    delete settings.seedBuiltinsEnabled
    changed = true
  }
  return changed
}

/** Restore a built-in job's definition in place, keeping its id, enabled flag and run state. */
export function resetBuiltin(job: JobConfig): boolean {
  const def = BUILTINS.find((b) => b.id === job.builtin)
  if (!def) return false
  Object.assign(job, { ...def.make(), id: job.id, enabled: job.enabled })
  return true
}

/**
 * A one-off digest over the last `days` days, for the on-demand command. It is never saved to settings: it runs
 * once and logs to the run log, so it leaves no job or run state behind.
 */
export function rangeDigestJob(days: number): JobConfig {
  const label = `Digest (last ${days} day${days === 1 ? '' : 's'})`
  return {
    ...newJob(),
    id: 'adhoc-digest',
    name: label,
    enabled: true,
    schedule: 'daily',
    at: '06:00',
    day: '',
    model: 'sonnet',
    timeoutMinutes: 10,
    output: `{{pluginFolder}}/{{date}} ${label}`,
    mode: 'new',
    prompt: digestPrompt({ noun: 'Period', days, carry: 'Worth carrying forward', carryMax: 'At most five items.' }),
  }
}
