import { parseFrontMatter } from '../src/core/frontmatter'
import { expandTemplate, isoWeek } from '../src/core/templates'
import { resolveVaultPath } from '../src/core/vaultPath'
import { parseSkills, validateJob } from '../src/core/validate'
import { buildClaudeArgs } from '../src/executors/claudeCli'
import { JobConfig } from '../src/core/types'
import { dailyNotesVars, resolveDailyNotes } from '../src/core/dailyNotes'
import { buildPrompt, resolveOutput } from '../src/core/runner'
import { parseDays } from '../src/core/days'

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

import { BUILTINS, ensureBuiltins, rangeDigestJob, resetBuiltin } from '../src/core/builtinJobs'

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
  it('relabels the old Daily Notes Digest as Weekly Digest, keeping id, schedule and state', () => {
    const s = defaultSettings()
    const old = { ...BUILTINS[0].make(), name: 'Daily Notes Digest', schedule: 'monthly' as const, day: '3' }
    s.jobs.push(old)
    s.state[old.id] = { failures: 0, lastRun: '2026-10-19T06:00:00' }
    expect(ensureBuiltins(s)).toBe(true)
    expect(old.name).toBe('Weekly Digest')
    expect([old.builtin, old.schedule, old.day]).toEqual(['default/daily-notes-digest', 'monthly', '3'])
    expect(s.state[old.id].lastRun).toBe('2026-10-19T06:00:00')
    expect(s.jobs.filter((j) => j.builtin === 'default/daily-notes-digest')).toHaveLength(1)
    expect(ensureBuiltins(s)).toBe(false)
  })
  it('keeps a name the user chose', () => {
    const s = defaultSettings()
    const mine = { ...BUILTINS[0].make(), name: 'My digest' }
    s.jobs.push(mine)
    expect(ensureBuiltins(s)).toBe(false)
    expect(mine.name).toBe('My digest')
  })
})

describe('daily notes location', () => {
  it('prefers core config, then Periodic Notes, then defaults', () => {
    expect(resolveDailyNotes({ folder: '/Journal/', format: 'YYYY/MM/DD' }, null)).toEqual({ folder: 'Journal', format: 'YYYY/MM/DD' })
    expect(resolveDailyNotes({ folder: '', format: '' }, null)).toEqual({ folder: '', format: 'YYYY-MM-DD' })
    expect(resolveDailyNotes(null, { daily: { enabled: true, folder: 'Logs', format: 'YYYYMMDD' } })).toEqual({ folder: 'Logs', format: 'YYYYMMDD' })
    expect(resolveDailyNotes(null, null)).toEqual({ folder: '', format: 'YYYY-MM-DD' })
  })
  it('expands variables in prompts and output paths; root folder gives an empty path prefix', () => {
    expect(dailyNotesVars({ folder: '', format: 'F' }).dailyNotesPath).toBe('')
    const j = { ...BUILTINS[0].make(), output: '{{dailyNotesPath}}Digests/{{week}}' }
    const s = { vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1, rules: { allowedFolders: ['Journal'] }, dailyNotes: { folder: 'Journal', format: 'YYYY-MM-DD' } }
    expect(resolveOutput(j, new Date(2026, 9, 22), s)).toBe('Journal/Digests/2026-W43.md')
    const p = buildPrompt(j, new Date(2026, 9, 22), 'v', s)
    expect(p).toContain('Journal/**/*.md')
    expect(p).not.toContain('{{')
  })
})

describe('stable built-in ids', () => {
  it('uses namespaced ids and migrates name-as-id installs', () => {
    expect(BUILTINS.map((b) => b.id)).toEqual(['default/daily-notes-digest'])
    const s = defaultSettings()
    const dig = { ...BUILTINS[0].make(), name: 'Weekly Digest', builtin: 'Weekly Digest' }
    const old = { ...BUILTINS[0].make(), id: 'o', name: 'Daily Notes Digest', builtin: 'Daily Notes Digest' }
    s.jobs.push(dig)
    ensureBuiltins(s)
    expect(dig.builtin).toBe('default/daily-notes-digest')
    expect(s.jobs).toHaveLength(1)
    const s2 = defaultSettings()
    s2.jobs.push(old)
    ensureBuiltins(s2)
    expect([old.builtin, old.name]).toEqual(['default/daily-notes-digest', 'Weekly Digest'])
  })
  it('drops the retired Tag Review built-in and its state, but keeps a user job with that name', () => {
    const s = defaultSettings()
    const old = { ...BUILTINS[0].make(), id: 'a', name: 'Tag Review', builtin: 'default/tag-review' }
    const older = { ...BUILTINS[0].make(), id: 'b', name: 'Tag Review', builtin: 'Tag Review' }
    const mine = { ...BUILTINS[0].make(), id: 'c', name: 'Tag Review', builtin: undefined }
    s.jobs.push(old, older, mine)
    s.state = { a: { failures: 0 }, b: { failures: 0 }, c: { failures: 0 } } as never
    expect(ensureBuiltins(s)).toBe(true)
    expect(s.jobs.some((j) => j.id === 'a' || j.id === 'b')).toBe(false)
    expect(s.jobs.some((j) => j.id === 'c')).toBe(true)
    expect(Object.keys(s.state)).toEqual(['c'])
    expect(s.jobs.filter((j) => j.builtin === 'default/daily-notes-digest')).toHaveLength(1)
  })
  it('discards settings of the removed tag features', () => {
    const s = normalizeSettings({ tagVocabularyPath: 'x.md', tagReview: { decisions: {} }, glossary: {} } as never)
    expect(['tagVocabularyPath', 'tagReview', 'glossary'].some((k) => k in s)).toBe(false)
  })
})

describe('rename resilience', () => {
  it('expands pluginFolder, pluginName and skipPaths in prompts and output paths', () => {
    const j = { ...BUILTINS[0].make() }
    const s = {
      vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1,
      rules: { allowedFolders: ['Hub'] },
      brand: { pluginFolder: 'Hub', pluginName: 'Vault Helper', skipPaths: '`.obsidian/`, `Hub/`' },
    }
    expect(resolveOutput(j, new Date(2026, 9, 22), s)).toBe('Hub/2026-W43 Digest.md')
    const p = buildPrompt(j, new Date(2026, 9, 22), 'v', s)
    expect(p).toContain('Skip `.obsidian/`, `Hub/`.')
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

describe('digests', () => {
  const s = { vaultPath: 'v', defaultModel: 's', defaultTimeoutMinutes: 1, maxBudgetUsd: 1, rules: { allowedFolders: ['Scheduled Agents'] }, brand: { pluginFolder: 'Scheduled Agents', pluginName: 'P', skipPaths: '' } }
  const now = new Date(2026, 9, 22)
  it('the built-in runs Mondays 06:00, looks back 7 days and writes at the plugin folder root', () => {
    const j = BUILTINS[0].make()
    expect([j.name, j.schedule, j.day, j.at, j.enabled]).toEqual(['Weekly Digest', 'weekly', 'monday', '06:00', false])
    expect(resolveOutput(j, now, s)).toBe('Scheduled Agents/2026-W43 Digest.md')
    const p = buildPrompt(j, now, 'v', s)
    expect(p).toContain('last 7 days')
    expect(p).not.toContain('{{')
  })
  it('the on-demand digest uses the requested number of days and a name that says so', () => {
    const j = rangeDigestJob(14)
    expect(j.prompt).toContain('last 14 days')
    expect(rangeDigestJob(1).prompt).toContain('last 1 day (')
    expect(resolveOutput(j, now, s)).toBe('Scheduled Agents/2026-10-22 Digest (last 14 days).md')
    expect(j.builtin).toBeUndefined()
    expect(validateJob(j)).toBeNull()
  })
  it('shows the first-install tip only for brand-new installs', () => {
    expect(normalizeSettings(null).introShown).toBe(false)
    expect(normalizeSettings({ jobs: [] } as never).introShown).toBe(true)
    expect(normalizeSettings({ introShown: false } as never).introShown).toBe(false)
  })
  it('parseDays accepts whole numbers from 1 to 365 only', () => {
    expect(parseDays(' 14 ')).toBe(14)
    for (const bad of ['', '0', '-3', '2.5', 'abc', '366']) expect(parseDays(bad)).toBeNull()
  })
})

import { errorText, looksBroken } from '../src/core/errorText'

describe('errorText', () => {
  it('never yields "undefined" for odd thrown values', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText('plain')).toBe('plain')
    expect(errorText({ message: 'obj' })).toBe('obj')
    expect(errorText({ code: 1 })).toBe('{"code":1}')
    expect(errorText(undefined)).toMatch(/unknown error/)
    expect(errorText(null)).toMatch(/unknown error/)
    expect(errorText(new Error(''))).toBe('Error')
    for (const v of [undefined, null, 0, '', {}, new Error()]) expect(looksBroken(errorText(v))).toBe(false)
  })
  it('flags text built from missing values', () => {
    expect(looksBroken('Plugin: undefined failed')).toBe(true)
    expect(looksBroken('x [object Object]')).toBe(true)
    expect(looksBroken('all good')).toBe(false)
  })
})
