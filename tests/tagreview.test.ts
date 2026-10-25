import { appendTagsBody, parseEdits, retagBody, retagFmValue, validateEdit, editId } from '../src/tagreview/edits'

const vocab = '`tools/git` `projects/data-lake-cli` `areas/work`'

describe('parseEdits', () => {
  it('accepts valid and reports bad entries', () => {
    const r = parseEdits('[{"op":"retag","file":"a.md","old_tag":"x","new_tag":null},{"op":"nope","file":"a.md"}]')
    expect(r.edits).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
  })
  it('rejects non-json', () => expect(parseEdits('x').errors).toHaveLength(1))
})

describe('validateEdit', () => {
  it('blocks protected paths and unknown tags', () => {
    expect(validateEdit({ op: 'retag', file: 'Glossary/x.md', old_tag: 'a', new_tag: 'tools/git' }, vocab)).toMatch(/protected/)
    expect(validateEdit({ op: 'retag', file: 'a.md', old_tag: 'a', new_tag: 'tools/nope' }, vocab)).toMatch(/vocabulary/)
    expect(validateEdit({ op: 'retag', file: 'a.md', old_tag: 'a', new_tag: 'tools/git' }, vocab)).toBeNull()
    expect(validateEdit({ op: 'retag', file: '../a.md', old_tag: 'a', new_tag: null }, vocab)).toMatch(/vault-relative/)
  })
  it('does not accept a vocab prefix as a match', () => {
    expect(validateEdit({ op: 'retag', file: 'a.md', old_tag: 'a', new_tag: 'tools' }, vocab)).toMatch(/vocabulary/)
  })
  it('checks fm_set formats and append_tags limits', () => {
    const declared = vocab + '\n- Front matter: daily notes carry `date` and `week`\n'
    expect(validateEdit({ op: 'fm_set', file: 'a.md', key: 'date', value: '2026-10-14' }, declared)).toBeNull()
    expect(validateEdit({ op: 'fm_set', file: 'a.md', key: 'week', value: '2026-W42' }, declared)).toMatch(/week/)
    expect(validateEdit({ op: 'fm_set', file: 'a.md', key: 'tags', value: ['tools/git'] }, vocab)).toBeNull()
    expect(validateEdit({ op: 'append_tags', file: 'a.md', match: 'short', tags: ['tools/git'] }, vocab)).toMatch(/short/)
  })
})

describe('retagBody', () => {
  it('renames inline tags only on whole-tag matches and leaves front matter alone', () => {
    const src = '---\ntags: [old]\n---\n- did #old thing #older\n- #old/sub stays\n'
    const r = retagBody(src, 'old', 'tools/git')
    expect(r.content).toBe('---\ntags: [old]\n---\n- did #tools/git thing #older\n- #old/sub stays\n')
    expect(r.changes).toHaveLength(1)
  })
  it('removes with null', () => {
    expect(retagBody('- a #old b\n', 'old', null).content).toBe('- a b\n')
  })
})

describe('retagFmValue', () => {
  it('renames, dedupes and removes', () => {
    expect(retagFmValue(['old', 'tools/git'], 'old', 'tools/git')).toEqual({ value: ['tools/git'], changed: true })
    expect(retagFmValue('#old, keep', 'old', null)).toEqual({ value: ['keep'], changed: true })
    expect(retagFmValue(['keep'], 'old', null).changed).toBe(false)
  })
})

describe('appendTagsBody', () => {
  const note = '---\ndate: 2026-10-16\n---\n- Built v1 of skill for data lake\n- other line here\n'
  it('appends to the unique bullet', () => {
    const r = appendTagsBody(note, 'Built v1 of skill', ['projects/data-lake-cli'])
    expect(r.content).toContain('- Built v1 of skill for data lake #projects/data-lake-cli\n')
  })
  it('refuses ambiguous, missing, and already-tagged lines', () => {
    expect(() => appendTagsBody('- same line one\n- same line two\n', 'same line', ['tools/git'])).toThrow(/unique/)
    expect(() => appendTagsBody(note, 'not present anywhere', ['tools/git'])).toThrow(/no longer/)
    expect(() => appendTagsBody('- do thing #tools/git\n', 'do thing', ['tools/git'])).toThrow(/already/)
  })
  it('only matches in the body, not front matter', () => {
    expect(() => appendTagsBody('---\ntitle: Built v1 of skill\n---\n- x\n', 'Built v1 of skill', ['tools/git'])).toThrow(/no longer/)
  })
})

it('editId is stable', () => {
  const e = { op: 'retag', file: 'a.md', old_tag: 'x', new_tag: null } as const
  expect(editId(e)).toBe(editId({ ...e }))
})

import { addDropTag, addLegacyMapping, addVocabEntry, definedTags, setTagStatus, statusOf } from '../src/tagreview/vocab'
import { isVocabEdit } from '../src/tagreview/edits'

const V = [
  '# Allowed tags',
  '',
  '## projects/',
  '- `projects/a` — Alpha',
  '- `projects/b` — Beta',
  '',
  '## tools/',
  '- `tools/git` — Version control',
  '',
  '## System tags (no facet)',
  '- `daily` — marker',
  '',
  '## Legacy → canonical',
  '- `old` → `tools/git`',
  '- Drop: `cron`, `mermaid`',
  '',
  '## Conventions',
  '- Nesting: foo',
  '',
].join('\n')

describe('vocabulary transforms', () => {
  it('reads defined tags without legacy or drop entries', () => {
    expect([...definedTags(V)].sort()).toEqual(['daily', 'projects/a', 'projects/b', 'tools/git'])
  })
  it('adds a tag at the end of its facet section', () => {
    const r = addVocabEntry(V, 'projects/c', 'Gamma')
    const lines = r.content.split('\n')
    expect(lines[lines.indexOf('- `projects/b` — Beta') + 1]).toBe('- `projects/c` — Gamma')
    expect(addVocabEntry(V, 'urgent', 'Needs attention').content).toContain('- `daily` — marker\n- `urgent` — Needs attention')
  })
  it('refuses duplicates and unknown facets', () => {
    expect(() => addVocabEntry(V, 'projects/a', 'x')).toThrow(/already/)
    expect(() => addVocabEntry(V, 'places/home', 'x')).toThrow(/no 'places\/' section/)
  })
  it('adds legacy mappings and drop entries in place', () => {
    expect(addLegacyMapping(V, 'git', 'tools/git').content).toContain('- `old` → `tools/git`\n- `git` → `tools/git`\n- Drop:')
    expect(() => addLegacyMapping(V, 'x', 'tools/nope')).toThrow(/not in the vocabulary/)
    expect(() => addLegacyMapping(V, 'old', 'tools/git')).toThrow(/already mapped/)
    expect(addDropTag(V, 'docs').content).toContain('- Drop: `cron`, `mermaid`, `docs`')
    expect(() => addDropTag(V, 'cron')).toThrow(/already on the drop list/)
    expect(() => addDropTag(V, 'tools/git')).toThrow(/cannot be dropped/)
  })
  it('preserves CRLF files', () => {
    const r = addVocabEntry(V.replace(/\n/g, '\r\n'), 'projects/c', 'Gamma').content
    expect(r.includes('\r\n')).toBe(true)
    expect(r.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })
  it('sets, changes and clears a tag status on its own line, leaving everything else alone', () => {
    const dormant = setTagStatus(V, 'projects/a', 'dormant')
    expect(dormant.before).toBe('- `projects/a` — Alpha')
    expect(dormant.after).toBe('- `projects/a` — Alpha (status: dormant)')
    expect(dormant.content.replace(dormant.after, dormant.before)).toBe(V)
    const done = setTagStatus(dormant.content, 'projects/a', 'done')
    expect(done.after).toBe('- `projects/a` — Alpha (status: done)')
    const cleared = setTagStatus(done.content, 'projects/a', 'active')
    expect(cleared.content).toBe(V)
    expect(statusOf(done.after)).toBe('done')
    expect(statusOf('- `projects/b` — Beta')).toBe('active')
  })
  it('refuses a status change for an unknown tag or one that already has that status', () => {
    expect(() => setTagStatus(V, 'projects/zzz', 'done')).toThrow(/not in the vocabulary/)
    expect(() => setTagStatus(V, 'projects/a', 'active')).toThrow(/already set/)
    expect(() => setTagStatus(setTagStatus(V, 'projects/a', 'done').content, 'projects/a', 'done')).toThrow(/already set/)
  })
  it('does not treat a status marker as part of the tag or break the definition list', () => {
    const marked = setTagStatus(V, 'projects/a', 'dormant').content
    expect([...definedTags(marked)].sort()).toEqual(['daily', 'projects/a', 'projects/b', 'tools/git'])
  })
})

describe('vocabulary edit parsing and validation', () => {
  it('parses vocab ops without a file and validates them', () => {
    const r = parseEdits('[{"op":"vocab_add","tag":"tools/x","definition":"X tool"},{"op":"vocab_status","tag":"projects/a","status":"paused"},{"op":"vocab_drop","tag":"Bad Tag"}]')
    expect(r.edits).toHaveLength(2)
    expect(r.errors).toHaveLength(1)
    expect(r.edits.every(isVocabEdit)).toBe(true)
    expect(validateEdit(r.edits[0], vocab)).toBeNull()
    expect(validateEdit(r.edits[1], vocab)).toMatch(/kebab/)
    expect(validateEdit({ op: 'vocab_add', tag: 'tools/x', definition: 'a\nb' }, vocab)).toMatch(/one line/)
  })
})

describe('protected folders are caller-supplied', () => {
  it('uses the supplied list instead of the defaults', () => {
    const e = { op: 'retag', file: 'Hub/x.md', old_tag: 'a', new_tag: null } as const
    expect(validateEdit(e, vocab)).toBeNull()
    expect(validateEdit(e, vocab, ['Hub/'])).toMatch(/protected/)
    expect(validateEdit({ ...e, file: 'hub/x.md' }, vocab, ['Hub/'])).toMatch(/protected/)
  })
})

import { declaredFmKeys } from '../src/tagreview/vocab'
import { starterVocabulary } from '../src/tagreview/scaffold'

describe('declared front matter keys', () => {
  it('only a front matter convention line that names the key in backticks declares it', () => {
    expect([...declaredFmKeys('- Front matter: notes carry `date` and `week`')].sort()).toEqual(['date', 'week'])
    expect(declaredFmKeys('- Dates: use `date` everywhere').size).toBe(0)
    expect(declaredFmKeys('- Front matter: none required').size).toBe(0)
    expect(declaredFmKeys(starterVocabulary()).size).toBe(0)
  })
  it('rejects undeclared date and week edits, with the reason', () => {
    expect(validateEdit({ op: 'fm_set', file: 'a.md', key: 'date', value: '2026-10-14' }, vocab)).toMatch(/not declared/)
  })
})

describe('starter glossary text and placement', () => {
  it('renders the legacy hint without stray backslashes', () => {
    expect(starterVocabulary().includes('\\' + '`')).toBe(false)
  })
  it('puts the first legacy mapping and drop entry after the intro line, not above it', () => {
    const v = starterVocabulary()
    const mapped = addLegacyMapping(addVocabEntry(v, 'tools/git', 'Version control').content, 'git', 'tools/git').content
    const lines = mapped.split('\n')
    const hint = lines.findIndex((l) => l.startsWith('Map an old tag'))
    expect(lines.findIndex((l) => l.startsWith('- `git` →'))).toBeGreaterThan(hint)
    const dropped = addDropTag(mapped, 'misc').content.split('\n')
    expect(dropped.findIndex((l) => l.startsWith('- Drop:'))).toBeGreaterThan(hint)
  })
})
