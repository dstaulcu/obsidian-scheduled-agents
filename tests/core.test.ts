import { parseFrontMatter } from '../src/core/frontmatter'
import { expandTemplate, isoWeek } from '../src/core/templates'
import { resolveVaultPath } from '../src/core/vaultPath'
import { parseSkills, validateJob } from '../src/core/validate'
import { buildClaudeArgs } from '../src/executors/claudeCli'
import { JobConfig } from '../src/core/types'

describe('parseFrontMatter', () => {
  it('parses scalars, lists, quotes and trailing comments', () => {
    const r = parseFrontMatter(
      ['---', 'enabled: true', 'schedule: weekly   # when', 'at: "06:00"', 'n: 10', 'skills:', '  - dataviz', "  - 'a:b'", '---', 'Body here', ''].join('\n'),
    )
    expect(r.meta).toEqual({ enabled: true, schedule: 'weekly', at: '06:00', n: 10, skills: ['dataviz', 'a:b'] })
    expect(r.body).toBe('Body here')
  })
  it('returns whole text when there is no front matter', () => {
    expect(parseFrontMatter('just text').body).toBe('just text')
  })
})

describe('templates', () => {
  it('computes ISO weeks across year edges', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 })
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 })
    expect(isoWeek(new Date(2026, 9, 22))).toEqual({ year: 2026, week: 43 })
  })
  it('expands tokens', () => {
    expect(expandTemplate('W/{{week}} {{date}} {{month}} {{vault}}', new Date(2026, 9, 22), 'V')).toBe(
      'W/2026-W43 2026-10-22 2026-10 V',
    )
  })
})

describe('resolveVaultPath', () => {
  const rules = { allowedFolders: ['BrainAgent', 'Weekly Summaries'] }
  it('adds .md and normalizes', () => {
    expect(resolveVaultPath('Weekly Summaries/2026-W43 Summary', rules)).toBe('Weekly Summaries/2026-W43 Summary.md')
    expect(resolveVaultPath('BrainAgent\\Run Log.md', rules)).toBe('BrainAgent/Run Log.md')
  })
  it.each([
    ['C:\\x.md'],
    ['/abs.md'],
    ['../escape'],
    ['BrainAgent/../../escape'],
    ['.obsidian/plugins/x'],
    ['BrainAgent/.hidden/x'],
    ['Glossary/_tags'],
  ])('rejects %s', (p) => {
    expect(() => resolveVaultPath(p, rules)).toThrow()
  })
  it('allows anything outside prompts when allow-list is empty', () => {
    expect(resolveVaultPath('Glossary/x', { allowedFolders: [] })).toBe('Glossary/x.md')
  })
})

describe('skills and claude args', () => {
  it('parses comma lists and rejects injection', () => {
    expect(parseSkills('dataviz, plugin:x')).toEqual(['dataviz', 'plugin:x'])
    expect(() => parseSkills(['--dangerously-skip-permissions'])).toThrow()
    expect(() => parseSkills(['a b'])).toThrow()
  })
  it('builds read-only args without skills', () => {
    const a = buildClaudeArgs({ model: 'sonnet', maxBudgetUsd: 0.5, skills: [] })
    expect(a).toEqual(expect.arrayContaining(['--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--strict-mcp-config']))
    expect(a).not.toContain('--allowedTools')
    expect(a[a.indexOf('--max-budget-usd') + 1]).toBe('0.5')
  })
  it('adds Skill tool and allow-list only when skills listed', () => {
    const a = buildClaudeArgs({ model: 'sonnet', maxBudgetUsd: 0.5, skills: ['dataviz'] })
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Skill')
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('Read Glob Grep Skill(dataviz)')
  })
})

describe('validateJob', () => {
  const ok: JobConfig = {
    id: '1', name: 'Weekly', enabled: true, schedule: 'weekly', at: '06:00', day: 'sunday',
    output: 'BrainAgent/x', mode: 'new', model: '', timeoutMinutes: 0, skills: [], prompt: 'hi',
  }
  it('accepts a valid job', () => expect(validateJob(ok)).toBeNull())
  it('flags problems', () => {
    expect(validateJob({ ...ok, name: 'a/b' })).toMatch(/Name/)
    expect(validateJob({ ...ok, day: 'noday' })).toMatch(/weekday/)
    expect(validateJob({ ...ok, prompt: ' ' })).toMatch(/Prompt/)
    expect(validateJob({ ...ok, skills: ['bad name'] })).toMatch(/skill/)
  })
})

import { BUILTINS, ensureBuiltins, resetBuiltin } from '../src/core/builtinJobs'
import { defaultSettings } from '../src/settings'

describe('built-in jobs', () => {
  it('adds every built-in disabled, and re-adds any that are missing', () => {
    const s = defaultSettings()
    expect(ensureBuiltins(s)).toBe(true)
    expect(s.jobs).toHaveLength(BUILTINS.length)
    expect(s.jobs.every((j) => !j.enabled && j.builtin)).toBe(true)
    expect(ensureBuiltins(s)).toBe(false)
    s.jobs = []
    expect(ensureBuiltins(s)).toBe(true)
    expect(s.jobs).toHaveLength(BUILTINS.length)
  })
  it('adopts an existing same-named job without touching it', () => {
    const s = defaultSettings()
    const mine = { ...BUILTINS[0].make(), builtin: undefined, prompt: 'custom', enabled: true }
    s.jobs.push(mine)
    ensureBuiltins(s)
    expect(s.jobs.filter((j) => j.name === mine.name)).toHaveLength(1)
    expect(mine.builtin).toBe(BUILTINS[0].id)
    expect(mine.prompt).toBe('custom')
  })
  it('reset restores definition but keeps id and enabled', () => {
    const j = { ...BUILTINS[0].make(), prompt: 'edited', enabled: true }
    const id = j.id
    expect(resetBuiltin(j)).toBe(true)
    expect(j.prompt).not.toBe('edited')
    expect(j.id).toBe(id)
    expect(j.enabled).toBe(true)
  })
})

describe('renamed built-ins', () => {
  it('carries a seeded Weekly Digest over to Daily Notes Digest without duplicating', () => {
    const s = defaultSettings()
    const old = { ...BUILTINS[1].make(), name: 'Weekly Digest', builtin: 'Weekly Digest' }
    s.jobs.push(old)
    ensureBuiltins(s)
    expect(old.name).toBe('Daily Notes Digest')
    expect(old.builtin).toBe('default/daily-notes-digest')
    expect(s.jobs.filter((j) => j.builtin === 'default/daily-notes-digest')).toHaveLength(1)
  })
})

import { dailyNotesVars, resolveDailyNotes } from '../src/core/dailyNotes'
import { buildPrompt, resolveOutput } from '../src/core/runner'

describe('daily notes location', () => {
  it('prefers core config, then Periodic Notes, then defaults', () => {
    expect(resolveDailyNotes({ folder: '/Journal/', format: 'YYYY/MM/DD' }, null)).toEqual({ folder: 'Journal', format: 'YYYY/MM/DD' })
    expect(resolveDailyNotes({ folder: '', format: '' }, null)).toEqual({ folder: '', format: 'YYYY-MM-DD' })
    expect(resolveDailyNotes(null, { daily: { enabled: true, folder: 'Logs', format: 'YYYYMMDD' } })).toEqual({ folder: 'Logs', format: 'YYYYMMDD' })
    expect(resolveDailyNotes(null, null)).toEqual({ folder: '', format: 'YYYY-MM-DD' })
  })
  it('expands variables in prompts and output paths; root folder gives an empty path prefix', () => {
    expect(dailyNotesVars({ folder: '', format: 'F' }).dailyNotesPath).toBe('')
    const j = { ...BUILTINS[1].make(), output: '{{dailyNotesPath}}Digests/{{week}}' }
    const s = { vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1, rules: { allowedFolders: ['Journal'] }, dailyNotes: { folder: 'Journal', format: 'YYYY-MM-DD' } }
    expect(resolveOutput(j, new Date(2026, 9, 22), s)).toBe('Journal/Digests/2026-W43.md')
    const p = buildPrompt(j, new Date(2026, 9, 22), 'v', s)
    expect(p).toContain('Journal/**/*.md')
    expect(p).not.toContain('{{')
  })
})

describe('stable built-in ids', () => {
  it('uses namespaced ids and migrates name-as-id installs', () => {
    expect(BUILTINS.map((b) => b.id)).toEqual(['default/tag-review', 'default/daily-notes-digest'])
    const s = defaultSettings()
    const tag = { ...BUILTINS[0].make(), builtin: 'Tag Review' }
    const dig = { ...BUILTINS[1].make(), name: 'Weekly Digest', builtin: 'Weekly Digest' }
    s.jobs.push(tag, dig)
    ensureBuiltins(s)
    expect(tag.builtin).toBe('default/tag-review')
    expect(dig.builtin).toBe('default/daily-notes-digest')
    expect(dig.name).toBe('Daily Notes Digest')
    expect(s.jobs).toHaveLength(2)
  })
})

describe('rename resilience', () => {
  it('expands pluginFolder, pluginName and skipPaths in prompts and output paths', () => {
    const j = { ...BUILTINS[0].make() }
    const s = {
      vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1,
      rules: { allowedFolders: ['Hub'] },
      brand: { pluginFolder: 'Hub', pluginName: 'Vault Helper', skipPaths: '`.obsidian/`, `Hub/`', vocabularyPath: 'Hub/Tag Glossary.md', bootstrap: '' },
    }
    expect(resolveOutput(j, new Date(2026, 9, 22), s)).toBe('Hub/Tag Review.md')
    const p = buildPrompt(j, new Date(2026, 9, 22), 'v', s)
    expect(p).toContain('SKIP these paths entirely: `.obsidian/`, `Hub/`.')
    expect(p).toContain('Vault Helper renders it')
    expect(p).not.toContain('{{')
    expect(p).not.toMatch(/BrainAgent|Brain Agent|BRHSBBA/)
  })
})

import { normalizeSettings } from '../src/settings'

describe('plugin folder migration', () => {
  it('keeps the folder an existing install was already using', () => {
    expect(normalizeSettings({ runLogPage: 'BrainAgent/Run Log.md', jobs: [] } as never).pluginFolder).toBe('BrainAgent')
    expect(normalizeSettings({ jobs: [{}] } as never).pluginFolder).toBe('BrainAgent')
    expect(normalizeSettings({ pluginFolder: 'Mine' } as never).pluginFolder).toBe('Mine')
  })
  it('gives a fresh install the default folder', () => {
    expect(normalizeSettings(null).pluginFolder).toBe('Scheduled Agents')
  })
})

import { rebasePath } from '../src/core/vaultPath'

describe('rebasePath', () => {
  it('moves the folder itself and anything under it, case-insensitively, and leaves others alone', () => {
    expect(rebasePath('BrainAgent', 'BrainAgent', 'Scheduled Agents')).toBe('Scheduled Agents')
    expect(rebasePath('BrainAgent/Tag Review', 'BrainAgent', 'Scheduled Agents')).toBe('Scheduled Agents/Tag Review')
    expect(rebasePath('brainagent/Run Log.md', 'BrainAgent', 'X')).toBe('X/Run Log.md')
    expect(rebasePath('BrainAgentOther/x', 'BrainAgent', 'X')).toBe('BrainAgentOther/x')
    expect(rebasePath('Weekly Summaries/{{week}}', 'BrainAgent', 'X')).toBe('Weekly Summaries/{{week}}')
    expect(rebasePath('{{pluginFolder}}/Tag Review', 'BrainAgent', 'X')).toBe('{{pluginFolder}}/Tag Review')
  })
})

import { bootstrapText, isEmptyVocabulary, missingVocabularyText, starterVocabulary } from '../src/tagreview/scaffold'
import { addVocabEntry, definedTags } from '../src/tagreview/vocab'

describe('starter glossary', () => {
  it('is an empty vocabulary that accepts vocab_add into each default facet and system tags', () => {
    const v = starterVocabulary()
    expect(isEmptyVocabulary(v)).toBe(true)
    let t = v
    for (const tag of ['areas/home', 'projects/p', 'tools/git', 'techniques/scheduling', 'daily']) t = addVocabEntry(t, tag, 'Definition').content
    expect([...definedTags(t)].sort()).toEqual(['areas/home', 'daily', 'projects/p', 'techniques/scheduling', 'tools/git'])
    expect(isEmptyVocabulary(t)).toBe(false)
  })
  it('uses the vocabulary path in bootstrap and missing-note prompt text, and builds a facet-agnostic prompt', () => {
    expect(bootstrapText('Hub/_tags.md')).toContain('Hub/_tags.md')
    expect(missingVocabularyText('Hub/_tags.md')).toContain('does not exist')
    const j = BUILTINS[0].make()
    expect(j.prompt).toContain('{{bootstrap}}')
    expect(j.prompt).not.toMatch(/tactics|Glossary\/_tags/)
  })
  it('defaults the vocabulary into the plugin folder for fresh installs and keeps legacy installs on Glossary', () => {
    expect(normalizeSettings(null).tagVocabularyPath).toBe('Scheduled Agents/Tag Glossary.md')
    expect(normalizeSettings({ jobs: [{}] } as never).tagVocabularyPath).toBe('Glossary/_tags.md')
    expect(normalizeSettings({ tagVocabularyPath: 'Mine/tags.md' } as never).tagVocabularyPath).toBe('Mine/tags.md')
  })
})

describe('reset-test hook', () => {
  it('adds built-ins enabled once when seedBuiltinsEnabled is set, then clears the flag', () => {
    const s = normalizeSettings({ seedBuiltinsEnabled: true } as never)
    expect(ensureBuiltins(s)).toBe(true)
    expect(s.jobs.length).toBe(BUILTINS.length)
    expect(s.jobs.every((j) => j.enabled)).toBe(true)
    expect('seedBuiltinsEnabled' in s).toBe(false)
  })
  it('does not enable existing built-ins and defaults to disabled without the flag', () => {
    const s = defaultSettings()
    ensureBuiltins(s)
    expect(s.jobs.every((j) => !j.enabled)).toBe(true)
    s.seedBuiltinsEnabled = true
    ensureBuiltins(s)
    expect(s.jobs.every((j) => !j.enabled)).toBe(true)
  })
})

describe('digest default output', () => {
  it('lands at the root of the plugin folder, with no subfolder', () => {
    const j = BUILTINS.find((b) => b.id === 'default/daily-notes-digest')!.make()
    expect(j.output).toBe('{{pluginFolder}}/{{week}} Digest')
    const s = { vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1, rules: { allowedFolders: ['Scheduled Agents'] }, brand: { pluginFolder: 'Scheduled Agents', pluginName: 'P', skipPaths: '', vocabularyPath: '', bootstrap: '' } }
    expect(resolveOutput(j, new Date(2026, 9, 22), s)).toBe('Scheduled Agents/2026-W43 Digest.md')
  })
})

describe('single-source glossary', () => {
  it('has no per-tag note machinery in the prompt or the starter page', () => {
    const p = BUILTINS[0].make().prompt
    expect(p).not.toMatch(/glossaryFolder|glossary note|<facet>\/<name>/)
    expect(p).toContain('(status: dormant)')
    expect(starterVocabulary()).toContain('single source')
    expect(starterVocabulary()).toContain('(status: dormant)')
  })
})
