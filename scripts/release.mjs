// Version bump + build orchestration.
//   node scripts/release.mjs [patch|minor|major] [--bump-only] [--build-only] [--no-test] [--dry-run]
// Default: run tests, bump the patch version everywhere, then build. Does not commit or tag.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const levels = args.filter((a) => !a.startsWith('--'))
const level = levels[0] ?? 'patch'

const known = ['--bump-only', '--build-only', '--no-test', '--dry-run']
const unknown = [...flags].filter((f) => !known.includes(f))
if (!['patch', 'minor', 'major'].includes(level) || levels.length > 1 || unknown.length) {
  console.error(`Usage: release.mjs [patch|minor|major] ${known.join(' ')}`)
  process.exit(2)
}
if (flags.has('--bump-only') && flags.has('--build-only')) {
  console.error('--bump-only and --build-only are mutually exclusive')
  process.exit(2)
}
const dry = flags.has('--dry-run')

const file = (name) => join(root, name)
const readJson = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
const writeJson = (name, data) => writeFileSync(file(name), JSON.stringify(data, null, 2) + '\n')

function next(version, lvl) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`Cannot parse version '${version}'`)
  let [maj, min, pat] = m.slice(1).map(Number)
  if (lvl === 'major') [maj, min, pat] = [maj + 1, 0, 0]
  else if (lvl === 'minor') [min, pat] = [min + 1, 0]
  else pat += 1
  return `${maj}.${min}.${pat}`
}

function run(label, cmd, cmdArgs) {
  console.log(`\n> ${label}`)
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`\n${label} failed (exit ${r.status}).`)
    process.exit(r.status ?? 1)
  }
}

function bump() {
  const pkg = readJson('package.json')
  const manifest = readJson('manifest.json')
  if (pkg.version !== manifest.version) {
    throw new Error(`package.json (${pkg.version}) and manifest.json (${manifest.version}) disagree; fix before bumping`)
  }
  const from = pkg.version
  const to = next(from, level)
  console.log(`Version: ${from} -> ${to} (${level})`)
  if (dry) return to

  pkg.version = to
  writeJson('package.json', pkg)

  manifest.version = to
  writeJson('manifest.json', manifest)

  if (existsSync(file('package-lock.json'))) {
    const lock = readJson('package-lock.json')
    lock.version = to
    if (lock.packages?.['']) lock.packages[''].version = to
    writeJson('package-lock.json', lock)
  }

  const versions = existsSync(file('versions.json')) ? readJson('versions.json') : {}
  versions[to] = manifest.minAppVersion
  writeJson('versions.json', versions)
  return to
}

if (!flags.has('--build-only')) {
  // test first so a red suite never leaves a bumped version behind
  if (!flags.has('--bump-only') && !flags.has('--no-test') && !dry) run('tests', 'npm', ['test', '--silent'])
  const v = bump()
  if (!flags.has('--bump-only') && !dry) run(`build ${v}`, 'npm', ['run', 'build'])
  if (!dry) console.log(`\nDone: ${v}. Not committed or tagged.`)
} else {
  run('tests', 'npm', ['test', '--silent'])
  run('build', 'npm', ['run', 'build'])
}
