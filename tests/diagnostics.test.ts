import { buildDiagnostics, DiagnosticsSnapshot, redact } from '../src/core/diagnostics'

const base: DiagnosticsSnapshot = {
  pluginVersion: '0.2.1',
  obsidianVersion: '1.8.0',
  platform: 'win32',
  arch: 'x64',
  harnessId: 'claude-cli',
  harnessPath: String.raw`C:\Users\alice\.local\bin\claude.exe`,
  harnessVersion: '2.0.1 (Claude Code)',
  capabilities: { enforcesReadOnly: true, supportsBudget: true, supportsSkills: true, reportsCost: true },
  schedulerEnabled: true,
  pollSeconds: 300,
  defaultTimeoutMinutes: 10,
  maxBudgetUsd: 0.5,
  maxRetries: 3,
  pluginFolder: 'Scheduled Agents',
  jobs: [
    { builtin: 'tag-review', enabled: true, schedule: 'weekly', day: 'sunday', at: '06:00', mode: 'new', hasCustomModel: false, skillCount: 0, outputInPluginFolder: true, failures: 0 },
    {
      enabled: false, schedule: 'hourly', day: '', at: '', mode: 'append', hasCustomModel: true, skillCount: 2, outputInPluginFolder: false, failures: 2,
      lastError: String.raw`exit 1: cannot read C:\Users\alice\Vaults\Secret\People\Bob.md about [[Bob Smith]]`,
    },
  ],
  glossaryRepo: 'https://alice:ghp_SECRETTOKEN@github.com/acme/tag-glossary.git?token=ghp_SECRETTOKEN',
  glossaryAuth: 'token',
  vaultPath: String.raw`C:\Users\alice\Vaults\Secret`,
  homeDir: String.raw`C:\Users\alice`,
}

describe('glossary line', () => {
  it('keeps host and path but never credentials or query strings', () => {
    const out = buildDiagnostics(base)
    expect(out).toContain('- Glossary: https://github.com/acme/tag-glossary.git, method token')
    expect(out).not.toContain('SECRETTOKEN')
    expect(out).not.toContain('alice:')
  })
})

describe('redact', () => {
  it('replaces vault before home, in either slash style and any case', () => {
    const t = String.raw`a C:\Users\alice\Vaults\Secret\x.md b c:/users/ALICE/Vaults/Secret/y.md c C:\Users\alice\.claude`
    expect(redact(t, base.vaultPath, base.homeDir)).toBe(String.raw`a <vault>/… b <vault>/… c ~\.claude`)
  })
  it('hides wiki link targets', () => {
    expect(redact('see [[Private Note]] now', '/v', '/h')).toBe('see [[…]] now')
  })
  it('ignores empty paths', () => {
    expect(redact('plain', '', '')).toBe('plain')
  })
})

describe('buildDiagnostics', () => {
  const out = buildDiagnostics(base)
  it('reports environment and job status', () => {
    expect(out).toContain('Plugin: 0.2.1')
    expect(out).toContain('built-in tag-review, enabled, weekly sunday 06:00')
    expect(out).toContain('custom job 2, disabled, hourly')
    expect(out).toContain('2 recent failure(s)')
  })
  it('leaks no paths, user names or note names', () => {
    for (const secret of ['alice', 'Secret', 'Bob']) expect(out).not.toContain(secret)
    expect(out).toContain(String.raw`~\.local\bin\claude.exe`)
  })
  it('truncates long errors', () => {
    const long = buildDiagnostics({ ...base, jobs: [{ ...base.jobs[1], lastError: 'x'.repeat(1000) }] })
    expect(long.length).toBeLessThan(1400)
  })
})
