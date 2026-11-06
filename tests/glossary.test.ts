import { applyImport, GlossaryVault } from '../src/glossary/apply'
import { filterTeams, mergeManifests, Manifest, parseManifest } from '../src/glossary/manifest'
import { normalizeSettings } from '../src/settings'
import { planImport, summarize } from '../src/glossary/plan'
import { renameTagInText } from '../src/glossary/rename'
import { createSource, parseRepoUrl, rawUrl, SourceDeps } from '../src/glossary/sources'
import { readStamp, sha256, stamp, stripStamp } from '../src/glossary/stamp'

const note = (tag: string, extra = '') => `---\ntag: ${tag}\nstatus: active\n---\n\n# ${tag}\n${extra}\n`
const entry = (path: string, text: string) => {
  const parts = path.split('/')
  return {
    tag: parts.slice(-2).join('/').replace(/.md$/, ''),
    facet: parts[parts.length - 2],
    source: parts[0] === 'core' ? 'core' : parts[1],
    status: 'active' as const,
    replaced_by: null,
    aliases: [],
    definition: '',
    path,
    hash: sha256(text),
  }
}
const mf = (tags: ReturnType<typeof entry>[]): Manifest => ({ version: 2, facets: ['project', 'community', 'tactic', 'tool'], teams: [], tags })

class FakeVault implements GlossaryVault {
  files = new Map<string, string>()
  writes = 0
  async read(p: string) {
    return this.files.get(p) ?? null
  }
  async create(p: string, c: string) {
    this.writes++
    this.files.set(p, c)
  }
  async modify(p: string, c: string) {
    this.writes++
    this.files.set(p, c)
  }
}

describe('stamp', () => {
  it('round-trips: stripping a stamp restores the original text', () => {
    const t = note('tool/git')
    const h = sha256(t)
    expect(stripStamp(stamp(t, h))).toBe(t)
    expect(readStamp(stamp(t, h))).toBe(h)
  })
  it('adds front matter to a note that has none', () => {
    expect(stripStamp(stamp('# plain\n', 'a'.repeat(64)))).toBe('---\n---\n# plain\n')
  })
})

describe('parseManifest', () => {
  const tag = { tag: 'tool/git', facet: 'tool', source: 'core', status: 'active', replaced_by: null, aliases: ['#tool/git'], definition: 'd', path: 'core/tool/git.md', hash: 'a'.repeat(64) }
  const ok = { version: 2, facets: ['tool', 'project'], teams: [{ id: 'dave', name: 'Dave', description: 'x' }], tags: [tag] }
  it('accepts a valid manifest and keeps teams', () => {
    const m = parseManifest(JSON.stringify(ok))
    expect(m.tags).toHaveLength(1)
    expect(m.teams[0].id).toBe('dave')
  })
  it('derives source and facet from the path, not the file', () => {
    const m = parseManifest(JSON.stringify({ ...ok, tags: [{ ...tag, path: 'teams/dave/project/x.md', source: 'core', facet: 'tool' }] }))
    expect(m.tags[0]).toMatchObject({ source: 'dave', facet: 'project' })
  })
  it('rejects version 1', () => expect(() => parseManifest(JSON.stringify({ ...ok, version: 1 }))).toThrow(/version 2/))
  it.each(['../x.md', '/abs.md', 'core/../x.md', '.hidden/x.md', 'other/tool/x.md', 'core/tool/x.txt', 'core/tool/a/b.md', 'core\\tool\\x.md', 'teams/dave/x.md', 'teams/.d/tool/x.md', 'core/Tool/x.md'])('rejects path %s', (path) => {
    expect(() => parseManifest(JSON.stringify({ ...ok, tags: [{ ...tag, path }] }))).toThrow()
  })
  it('rejects a facet the manifest does not declare', () => {
    expect(() => parseManifest(JSON.stringify({ ...ok, tags: [{ ...tag, path: 'core/bogus/x.md' }] }))).toThrow(/unknown facet/)
  })
  it('rejects bad hashes and bad JSON', () => {
    expect(() => parseManifest(JSON.stringify({ ...ok, tags: [{ ...tag, hash: 'zz' }] }))).toThrow()
    expect(() => parseManifest('{')).toThrow()
  })
})

describe('teams, merging and layout', () => {
  const t1 = note('tool/git')
  const t2 = note('project/x')
  const core = mf([entry('core/tool/git.md', t1)])
  const team = { ...mf([entry('teams/dave/project/x.md', t2), entry('teams/ops/project/y.md', t2)]), teams: [{ id: 'dave', name: 'D', description: '' }, { id: 'ops', name: 'O', description: '' }] }
  it('keeps the core plus selected teams, or all', () => {
    const m = mergeManifests([core, team])
    expect(filterTeams(m, [], false).map((t) => t.source)).toEqual(['core'])
    expect(filterTeams(m, ['dave'], false).map((t) => t.source)).toEqual(['core', 'dave'])
    expect(filterTeams(m, [], true)).toHaveLength(3)
    expect(m.teams.map((x) => x.id)).toEqual(['dave', 'ops'])
  })
  it('first source wins on a duplicate tag and warns', () => {
    const m = mergeManifests([core, mf([entry('core/tool/git.md', t1)])])
    expect(m.tags).toHaveLength(1)
    expect(m.warnings).toHaveLength(1)
  })
  it('mirrors core and team folders in the vault and records the origin', async () => {
    const m = mergeManifests([core, team])
    const plan = await planImport(m, 'Glossary', async () => null)
    expect(plan.items.map((i) => i.vaultPath)).toEqual(['Glossary/core/tool/git.md', 'Glossary/dave/project/x.md', 'Glossary/ops/project/y.md'])
    expect(plan.items.map((i) => i.origin)).toEqual([0, 1, 1])
  })
})

describe('settings migration', () => {
  it('folds the single-repo glossary settings into the first source', () => {
    const s = normalizeSettings({ glossary: { repoUrl: 'https://github.com/o/r', ref: 'v1', authMethod: 'git', destFolder: 'G', checkOnStartup: true, token: 't' } } as never)
    expect(s.glossary.sources).toHaveLength(1)
    expect(s.glossary.sources[0]).toMatchObject({ repoUrl: 'https://github.com/o/r', ref: 'v1', authMethod: 'git', token: 't' })
    expect(s.glossary).toMatchObject({ destFolder: 'G', checkOnStartup: true, teams: [], allTeams: false })
  })
  it('gives a fresh install one empty source', () => {
    expect(normalizeSettings(null).glossary.sources).toHaveLength(1)
  })
})

describe('plan and apply', () => {
  const a = note('tool/git')
  const b = note('tool/github')
  const manifest = (): Manifest => mf([entry('core/tool/git.md', a), entry('core/tool/github.md', b)])
  const fetchNote = async (i: { entry: { path: string } }) => (i.entry.path === 'core/tool/git.md' ? a : b)
  const run = async (v: FakeVault, m = manifest(), choice?: 'keep' | 'theirs' | 'copy', f = fetchNote) => {
    const plan = await planImport(m, 'Glossary', (p) => v.read(p))
    const res = await applyImport(plan.items.map((item) => ({ item, choice })), f, v)
    return { plan, res }
  }

  it('imports everything into a fresh vault', async () => {
    const v = new FakeVault()
    const { plan, res } = await run(v)
    expect(plan.counts.new).toBe(2)
    expect(res.created).toBe(2)
    expect(v.files.get('Glossary/core/tool/git.md')).toBe(stamp(a, sha256(a)))
  })

  it('reports up to date and writes nothing on a re-run', async () => {
    const v = new FakeVault()
    await run(v)
    v.writes = 0
    const { plan } = await run(v)
    expect(summarize(plan.counts)).toBe('Glossary: up to date')
    expect(v.writes).toBe(0)
  })

  it('updates a note the user did not touch', async () => {
    const v = new FakeVault()
    await run(v)
    const a2 = note('tool/git', 'more')
    const m = mf([entry('core/tool/git.md', a2), entry('core/tool/github.md', b)])
    const { res } = await run(v, m, undefined, async (i) => (i.entry.path === 'core/tool/git.md' ? a2 : b))
    expect(res.updated).toBe(1)
    expect(stripStamp(v.files.get('Glossary/core/tool/git.md')!)).toBe(a2)
  })

  it('flags a locally edited note as a conflict and does not overwrite it', async () => {
    const v = new FakeVault()
    await run(v)
    const mine = v.files.get('Glossary/core/tool/git.md')! + 'my edit\n'
    v.files.set('Glossary/core/tool/git.md', mine)
    const a2 = note('tool/git', 'upstream change')
    const m = mf([entry('core/tool/git.md', a2), entry('core/tool/github.md', b)])
    const f = async (i: { entry: { path: string } }) => (i.entry.path === 'core/tool/git.md' ? a2 : b)
    v.writes = 0
    const { plan } = await run(v, m, undefined, f)
    expect(plan.counts.conflict).toBe(1)
    expect(summarize(plan.counts)).toBe('Glossary: 1 conflict')
    expect(v.files.get('Glossary/core/tool/git.md')).toBe(mine)
    expect(v.writes).toBe(0)

    await run(v, m, 'copy', f)
    expect(v.files.get('Glossary/core/tool/git.md')).toBe(mine)
    expect(stripStamp(v.files.get('Glossary/core/tool/git (glossary).md')!)).toBe(a2)

    await run(v, m, 'theirs', f)
    expect(stripStamp(v.files.get('Glossary/core/tool/git.md')!)).toBe(a2)
  })

  it('treats an existing unstamped note that differs as a conflict', async () => {
    const v = new FakeVault()
    v.files.set('Glossary/core/tool/git.md', 'my own page')
    const { plan } = await run(v, undefined, 'keep')
    expect(plan.items[0].category).toBe('conflict')
    expect(v.files.get('Glossary/core/tool/git.md')).toBe('my own page')
  })

  it('writes nothing when any fetch fails', async () => {
    const v = new FakeVault()
    const f = async (i: { entry: { path: string } }) => {
      if (i.entry.path.endsWith('github.md')) throw new Error('401')
      return a
    }
    await expect(run(v, undefined, undefined, f)).rejects.toThrow('401')
    expect(v.writes).toBe(0)
  })

  it('refuses content that does not match the manifest hash', async () => {
    const v = new FakeVault()
    await expect(run(v, undefined, undefined, async () => 'tampered')).rejects.toThrow('manifest hash')
    expect(v.writes).toBe(0)
  })
})

describe('sources', () => {
  const deps = (over: Partial<SourceDeps> = {}): SourceDeps => ({
    httpGet: async () => ({ status: 200, text: 'x' }),
    run: async () => ({ stdout: '' }),
    readFile: async () => 'file',
    exists: async () => false,
    platform: 'win32',
    cacheDir: '/cache',
    ...over,
  })
  const cfg = (method: 'https' | 'git' | 'token', extra = {}) => ({ repoUrl: 'https://github.com/o/r', ref: 'main', method, ...extra })

  it('derives raw URLs for GitHub and GitLab', () => {
    expect(rawUrl(parseRepoUrl('https://github.com/o/r.git')!, 'main', 'glossary.json')).toBe('https://raw.githubusercontent.com/o/r/main/glossary.json')
    expect(rawUrl(parseRepoUrl('https://gitlab.corp/g/sub/r')!, 'v1', 'core/tool/git.md')).toBe('https://gitlab.corp/g/sub/r/-/raw/v1/core/tool/git.md')
    expect(parseRepoUrl('git@github.com:o/r.git')).toBeNull()
  })

  it('names the method and status on failure', async () => {
    const s = createSource(cfg('https'), deps({ httpGet: async () => ({ status: 404, text: '' }) }))
    await expect(s.fetchManifest()).rejects.toThrow(/Glossary \(https\).*404/)
    const t = createSource(cfg('token', { token: 't' }), deps({ httpGet: async () => ({ status: 401, text: '' }) }))
    await expect(t.fetchManifest()).rejects.toThrow(/Glossary \(token\).*401/)
  })

  it('sends the token only as a header and never in the URL or error', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const httpGet = async (url: string, headers: Record<string, string>) => {
      seen.push({ url, headers })
      return { status: 500, text: '' }
    }
    const s = createSource(cfg('token', { token: 'SECRET' }), deps({ httpGet }))
    const err = await s.fetchManifest().catch((e: Error) => e)
    expect(seen[0].url).not.toContain('SECRET')
    expect(seen[0].headers.Authorization).toBe('Bearer SECRET')
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('probes git with where on Windows and which elsewhere, and reports it missing', async () => {
    const calls: string[] = []
    const run = async (file: string): Promise<{ stdout: string }> => {
      calls.push(file)
      throw Object.assign(new Error('nope'), { code: 'ENOENT' })
    }
    for (const platform of ['win32', 'linux']) {
      const s = createSource(cfg('git'), deps({ run, platform }))
      await expect(s.fetchManifest()).rejects.toThrow(/Glossary \(git\).*git was not found/)
    }
    expect(calls).toEqual(['where', 'which'])
  })

  it('clones then reads from the cache, and rejects unsafe paths', async () => {
    const runs: string[][] = []
    const run = async (f: string, a: string[]) => {
      runs.push([f, ...a])
      return { stdout: '' }
    }
    const s = createSource({ ...cfg('git'), ref: 'v1' }, deps({ run }))
    expect(await s.fetchManifest()).toBe('file')
    expect(runs[1]).toEqual(['git', 'clone', '--depth', '1', '--branch', 'v1', 'https://github.com/o/r', '/cache'])
    await expect(s.fetchNote('../secret.md')).rejects.toThrow('unsafe')
  })
})

describe('renameTagInText', () => {
  it('renames whole tags and children only', () => {
    const t = 'a #tools/git b #tools/gitlab c #tools/git/sub, #tools/git.\n'
    expect(renameTagInText(t, 'tools/git', 'tools/vcs')).toBe('a #tools/vcs b #tools/gitlab c #tools/vcs/sub, #tools/vcs.\n')
  })
  it('handles front-matter lists and skips code', () => {
    const t = '---\ntags:\n  - tools/git\n  - tools/gitlab\n---\n`#tools/git` #tools/git\n```\n#tools/git\n```\n'
    const want = '---\ntags:\n  - tools/vcs\n  - tools/gitlab\n---\n`#tools/git` #tools/vcs\n```\n#tools/git\n```\n'
    expect(renameTagInText(t, 'tools/git', 'tools/vcs')).toBe(want)
  })
})
