import { JobConfig } from './types'
import { newJob, AgentSettings } from '../settings'

export const TAG_REVIEW_NAME = 'Tag Review'
export const DAILY_DIGEST_NAME = 'Daily Notes Digest'

const TAG_REVIEW_PROMPT = `You are the tag steward for this Obsidian vault. Produce a review page of tag SUGGESTIONS. You are read-only: never claim to have changed anything.

{{bootstrap}}

## Inputs
1. Read \`{{vocabularyPath}}\`. It is the controlled vocabulary: allowed tags grouped under facet headings (\`## <facet>/\`), system tags, a legacy-to-canonical mapping, and tags to drop. Each tag's one-line definition is on its bullet; use it to judge borderline cases. A tag line may end with \`(status: dormant)\` or \`(status: done)\`; no marker means active.
2. Scan notes for tags with Grep, not by reading everything. Look at front-matter \`tags:\` (inline list or \`- item\` list) and inline \`#tags\` in note bodies.
3. SKIP these paths entirely: {{skipPaths}}.
4. **Conventions:** read the Conventions section of the vocabulary note and follow what it says. Enforce no convention it does not state. If it says a tag on a parent bullet applies to the bullets nested under it, then children of a tagged parent are NOT untagged: never suggest re-adding a tag a child already inherits, only suggest an \`append_tags\` on a child when it adds a more specific tag the parent does not give and the line is clearly about it, and never emit \`append_tags\` for a tags-only header line.
5. For untagged-line suggestions, look only at daily notes from the last 14 days, found with Glob \`{{dailyNotesPath}}**/*.md\` (daily note names follow the Moment format \`{{dailyNotesFormat}}\`; they may sit in subfolders such as \`2026/01/\` or \`Week of 2026-01-04/\`, and folder names can be wrong, so select ONLY by the date the filename encodes, and use the note's real path in every \`file\` field below) (selected by filename; some notes have no front matter).

## Output
Return ONLY this markdown, with these sections in order. Wrap every tag in backticks (for example \`tools/git\`) so this page creates no real tags. Link notes with [[wikilinks]]. Use tables or plain bullets; do NOT use \`- [ ]\` checkboxes (they would pollute task queries).

### Summary
Two or three sentences: how many notes were scanned, how many distinct tags in use, how many are in the vocabulary vs not. Say "No issues found" if the vault is clean.

### 1. Legacy tags to remap
Table: Note | Current tag | Suggested canonical tag. Use the legacy mapping in the vocabulary note. For tags marked "drop", suggest removal.

### 2. Unknown tags
Tags in use that are neither in the vocabulary, the system tags, nor the legacy mapping. Table: Tag | Notes using it | Suggestion (map to an existing tag, add to vocabulary with a proposed definition, or drop). Flag near-duplicates and spelling variants of an existing tag.

### 3. Front matter problems
Notes whose front matter is broken: it does not parse, a template placeholder is used as a key, or \`tags:\` holds something other than a list or text. Also report front matter that a line in the Conventions section of the vocabulary note requires and a note lacks. If the vocabulary states no front matter conventions, report only broken front matter, and do not treat missing keys or an empty \`tags:\` as problems. Table: Note | Problem | Suggested fix.

### 4. Untagged lines worth tagging
At most 15 of the clearest cases from the last 14 days of daily notes: a log line or task that clearly concerns something in the vocabulary but carries no tag. Table: Note | Line (quoted, shortened) | Suggested tags (0-3). Skip anything ambiguous.

### 5. Vocabulary gaps and cleanup
- Recurring topics (three or more lines or notes) with no matching tag: propose a new tag, its facet, and a one-line definition.
- Vocabulary tags that have never been used.
- Projects that look finished or dormant (propose a status change).

### 6. Machine-readable edits
End the page with exactly ONE fenced code block whose language tag is \`brain-edits\` (write \`\`\`brain-edits to open it) containing a JSON array of edit objects, and nothing after it. {{pluginName}} renders it as an approve/reject panel and applies approved edits itself. Include only edits from sections 1 to 5 that you are highly confident about, at most 60, listing vocabulary edits (\`vocab_*\`) first. Use \`[]\` if there are none. Allowed shapes:
- \`{"op":"retag","file":"Projects/Alpha.md","old_tag":"git","new_tag":"tools/git"}\` renames a tag (front matter and inline). Use \`"new_tag":null\` to remove a tag. \`old_tag\` has no leading \`#\`.
- \`{"op":"fm_set","file":"Notes/Example.md","key":"tags","value":["tools/git"]}\` sets a front-matter key. \`key\` is \`tags\` (value is an array of vocabulary tags), or \`date\` (YYYY-MM-DD) or \`week\` (value like \`"[[2026-W42]]"\`) only when a front matter line in the vocabulary note's Conventions names that key in backticks.
- \`{"op":"append_tags","file":"Daily Notes/2026-01-16.md","match":"Shipped v1 of the export script","tags":["projects/export-tool"]}\` appends inline tags to the one \`- \` line containing \`match\`. Copy \`match\` EXACTLY from the note (at least 8 characters, unique within that file, no \`#\` characters). 1-4 tags per line.
- \`{"op":"vocab_add","tag":"tools/example-app","definition":"Example app used for this purpose"}\` adds a tag and its one-line definition to the vocabulary note. The tag is lowercase kebab-case and its facet (the part before the \`/\`) must be an existing facet section; a tag with no \`/\` is a system tag. The definition is one line, at most 200 characters. These have no \`file\`.
- \`{"op":"vocab_map","legacy":"vcs","canonical":"tools/git"}\` records a legacy-to-canonical mapping (the canonical tag must already be in the vocabulary).
- \`{"op":"vocab_drop","tag":"misc"}\` adds a tag to the drop list.
- \`{"op":"vocab_status","tag":"projects/example-project","status":"done"}\` sets a vocabulary tag's status to \`active\`, \`dormant\` or \`done\`, written as a \`(status: …)\` marker on its line (\`active\` clears the marker). Use it for projects.
How to resolve section 2 and 5 findings: to map an unknown tag, emit one \`retag\` per note that uses it plus one \`vocab_map\`; to drop one, emit one \`retag\` with \`"new_tag":null\` per note plus one \`vocab_drop\`; to adopt one, emit \`vocab_add\`. A \`retag\`, \`append_tags\` or \`fm_set\` may use a tag introduced by a \`vocab_add\` earlier in the same list; the user applies vocabulary edits first. Never delete vocabulary tags.
Rules: every tag a note edit uses must appear in \`{{vocabularyPath}}\` exactly (or be added by an earlier \`vocab_add\`). \`file\` is vault-relative. Never propose \`retag\`, \`fm_set\` or \`append_tags\` edits to files under {{skipPaths}}; the \`vocab_*\` edits are the only way the vocabulary changes. Omit ambiguous cases and anything needing the user's own words. Do not repeat edits whose result is already present.

Be concise and specific. If a section has nothing to report, write "None."
`

const DAILY_DIGEST_PROMPT = `You are summarising the user's week from their Obsidian daily notes. You are read-only: never claim to have changed anything.

## Inputs
1. Find daily notes from the last 7 days with Glob \`{{dailyNotesPath}}**/*.md\` (daily note names follow the Moment format \`{{dailyNotesFormat}}\`; they may sit in subfolders; select ONLY by the date the filename encodes). Read them.
2. Skip {{skipPaths}}.
3. A tag on a parent bullet applies to every bullet nested under it. Use tags (they are grouped by facet, such as \`areas/\` or \`projects/\`) to group the week's work when they are present.

## Output
Return ONLY this markdown. Link source notes with [[wikilinks]]. Wrap any tag in backticks so this page creates no real tags. Do NOT use \`- [ ]\` checkboxes.

### Week at a glance
Three or four sentences: what the week was about and how many daily notes there were.

### By area or project
One short subsection per area or project that had real activity, with the key outcomes as bullets and a link to the notes they came from.

### Decisions and open threads
Decisions made, and tasks or questions that were started but not finished.

### Worth carrying into next week
At most five items.

Be concise and specific. If there are no daily notes in the range, say so in one sentence.
`

/** Built-in ids are namespaced and stable; the display name is just a label and can change freely. */
export const BUILTIN_NAMESPACE = 'default'
export const TAG_REVIEW_ID = `${BUILTIN_NAMESPACE}/tag-review`
export const DAILY_DIGEST_ID = `${BUILTIN_NAMESPACE}/daily-notes-digest`

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
    id: TAG_REVIEW_ID,
    name: TAG_REVIEW_NAME,
    make: () =>
      base(TAG_REVIEW_ID, TAG_REVIEW_NAME, {
        schedule: 'daily',
        at: '06:00',
        day: '',
        output: '{{pluginFolder}}/Tag Review',
        mode: 'replace',
        prompt: TAG_REVIEW_PROMPT,
      }),
  },
  {
    id: DAILY_DIGEST_ID,
    name: DAILY_DIGEST_NAME,
    make: () =>
      base(DAILY_DIGEST_ID, DAILY_DIGEST_NAME, {
        schedule: 'weekly',
        at: '06:00',
        day: 'monday',
        output: '{{pluginFolder}}/{{week}} Digest',
        mode: 'new',
        prompt: DAILY_DIGEST_PROMPT,
      }),
  },
]

/** Earlier builds used the display name as the id. Map those to the stable ids (and the one old display name). */
const LEGACY_IDS: Record<string, { id: string; rename?: [string, string] }> = {
  'Tag Review': { id: TAG_REVIEW_ID },
  'Daily Notes Digest': { id: DAILY_DIGEST_ID },
  'Weekly Digest': { id: DAILY_DIGEST_ID, rename: ['Weekly Digest', DAILY_DIGEST_NAME] },
}

function migrateLegacyBuiltinIds(settings: AgentSettings): boolean {
  let changed = false
  for (const [from, { id: to, rename }] of Object.entries(LEGACY_IDS)) {
    for (const j of settings.jobs) {
      if (j.builtin !== from) continue
      j.builtin = to
      if (rename && j.name === rename[0]) j.name = rename[1]
      changed = true
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
  let changed = migrateLegacyBuiltinIds(settings)
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
