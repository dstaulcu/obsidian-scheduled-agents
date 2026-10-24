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
  const rules = { promptsFolder: 'BrainAgent/Prompts', allowedFolders: ['BrainAgent', 'Weekly Summaries'] }
  it('adds .md and normalizes', () => {
    expect(resolveVaultPath('Weekly Summaries/2026-W43 Summary', rules)).toBe('Weekly Summaries/2026-W43 Summary.md')
    expect(resolveVaultPath('BrainAgent\\Run Log.md', rules)).toBe('BrainAgent/Run Log.md')
  })
  it.each([
    ['C:\\x.md'],
    ['/abs.md'],
    ['../escape'],
    ['BrainAgent/../../escape'],
    ['BrainAgent/Prompts/evil'],
    ['brainagent/prompts/evil'],
    ['.obsidian/plugins/x'],
    ['BrainAgent/.hidden/x'],
    ['Glossary/_tags'],
  ])('rejects %s', (p) => {
    expect(() => resolveVaultPath(p, rules)).toThrow()
  })
  it('allows anything outside prompts when allow-list is empty', () => {
    expect(resolveVaultPath('Glossary/x', { promptsFolder: 'BrainAgent/Prompts', allowedFolders: [] })).toBe('Glossary/x.md')
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
