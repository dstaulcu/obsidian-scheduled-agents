import { definedTags } from './vocab'

/**
 * Starter vocabulary for installs that have no glossary of their own: the structure Tag Review expects
 * (facet sections, system tags, legacy/drop lists) with no tags yet. Bootstrap mode fills it from the
 * tags actually in use, via edits the user approves.
 */
export function starterVocabulary(): string {
  return `---
tags: [glossary]
---
# Allowed tags

Controlled vocabulary checked by Tag Review. A tag not listed here is a hygiene finding. Tags are in backticks so this page creates no real tags. This page is the single source: each tag is one bullet, \`\` - \`tools/git\` — one-line definition \`\`, so there are no per-tag notes to keep in sync.

## areas/

## projects/

## tools/

## techniques/

## System tags (no facet)

## Legacy → canonical
Map an old tag with a line like \`\` - \`old\` → \`tools/example\` \`\`, and list tags to remove on a \`- Drop:\` line.

## Conventions
- Facets: \`areas/\` are ongoing responsibilities, \`projects/\` are finite efforts, \`tools/\` are apps and services, \`techniques/\` are repeatable methods you use (for example scheduled jobs or human-in-the-loop review).
- Tags are lowercase kebab-case with a facet prefix. A tag with no prefix is a system tag.
- Status: a tag line may end with \`(status: dormant)\` or \`(status: done)\`. No marker means active. Tag Review keeps this up to date for projects.
- Nesting (delete or change this if you tag differently): a tag on a parent bullet applies to every bullet nested under it. A parent holding only tags (for example \`- #areas/work\`) is a group header. Children may add more specific tags of their own.
- Front matter: none required. Tag Review only reports front matter that is broken. To have it check or fill a key, say so on a line like this one that names the key in backticks.
`
}

export const isEmptyVocabulary = (text: string): boolean => definedTags(text).size === 0

/** Prompt text injected as {{bootstrap}} while the vocabulary has no tags. */
export function bootstrapText(vocabularyPath: string): string {
  return [
    `## BOOTSTRAP MODE`,
    `The vocabulary note \`${vocabularyPath}\` has no tags yet, so there is nothing to check tags against. This run builds a starting vocabulary from the tags the user already uses. Follow the sections below, with these changes:`,
    `- Skip section 1. In section 2, replace the "Unknown tags" table with "Proposed vocabulary": a table of Current tag(s) | Proposed canonical tag | One-line definition. Cover the tags used on at least two notes or lines, and any clearly central tag, at most 25. Put each proposed tag under one of the facet headings in the vocabulary note, with lowercase kebab-case names.`,
    `- In section 6, emit \`vocab_add\` edits for the proposed tags first, then \`vocab_map\` edits for current tags whose name differs from the canonical one. Do NOT emit \`retag\`, \`append_tags\` or \`fm_set\` edits in this run: they depend on a vocabulary that does not exist until the user approves these edits. The next run proposes those.`,
    `- In the Summary, say that this run proposes a first vocabulary.`,
  ].join('\n')
}

/** Prompt text injected as {{bootstrap}} when the vocabulary note does not exist. */
export function missingVocabularyText(vocabularyPath: string): string {
  return [
    `## VOCABULARY NOTE MISSING`,
    `The vocabulary note \`${vocabularyPath}\` does not exist. Do not scan notes. Return only a Summary saying the vocabulary note is missing and that the user can create it or set its path in the plugin settings (Tag vocabulary note), and end with an empty \`brain-edits\` block containing \`[]\`.`,
  ].join('\n')
}
