// One-command release: bump, open a PR, wait for CI, merge, tag. The tag triggers .github/workflows/release.yml.
//   node scripts/ship.mjs [patch|minor|major] [--no-merge] [--finish] [--yes] [--dry-run]
// Run from a clean, up-to-date `main`. Merging uses your admin bypass on the main ruleset (gh pr merge --admin).
// --no-merge  stop after opening the PR (for a colleague's review); after it is merged, run with --finish
// --finish    pull main and tag the manifest version (the last step, when the PR was merged elsewhere)
// --yes       skip the "merge and tag?" prompt
// --dry-run   check preconditions and print the plan; change nothing
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const levels = args.filter((a) => !a.startsWith('--'))
const level = levels[0] ?? 'patch'

const known = ['--no-merge', '--finish', '--yes', '--dry-run']
const unknown = [...flags].filter((f) => !known.includes(f))
if (!['patch', 'minor', 'major'].includes(level) || levels.length > 1 || unknown.length) {
  console.error(`Usage: ship.mjs [patch|minor|major] ${known.join(' ')}`)
  process.exit(2)
}
if (flags.has('--finish') && (levels.length || flags.has('--no-merge'))) {
  console.error('--finish takes no bump level and cannot be combined with --no-merge')
  process.exit(2)
}

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

function sh(cmd, a, { capture = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, a, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (r.status !== 0 && !allowFail) {
    if (capture) console.error(r.stderr || r.stdout)
    fail(`${cmd} ${a.join(' ')} failed`)
  }
  return capture ? r.stdout.trim() : r
}
const git = (...a) => sh('git', a, { capture: true })
const script = (name, a = []) => sh(process.execPath, [join(root, 'scripts', name), ...a])
const manifestVersion = () => JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version

async function confirm(question) {
  if (flags.has('--yes')) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve))
  rl.close()
  return /^y/i.test(answer.trim())
}

function tagAndReport() {
  const version = manifestVersion()
  script('tag-release.mjs')
  const url = sh('gh', ['repo', 'view', '--json', 'url', '-q', '.url'], { capture: true })
  console.log(`\nTagged ${version}. Release workflow: ${url}/actions\nRelease page (after it finishes): ${url}/releases/tag/${version}`)
}

if (flags.has('--finish')) {
  if (git('branch', '--show-current') !== 'main') sh('git', ['switch', 'main'])
  sh('git', ['pull', '--ff-only'])
  tagAndReport()
  process.exit(0)
}

if (git('branch', '--show-current') !== 'main') fail('Not on main.')
if (git('status', '--porcelain')) fail('Working tree is not clean.')
git('fetch', '--tags', 'origin')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main; pull or push first.')
sh('gh', ['auth', 'status'], { capture: true })

const merge = !flags.has('--no-merge')
if (flags.has('--dry-run')) {
  console.log(`Would: test, bump (${level}), build, branch release/<version>, commit, push, open PR${merge ? ', wait for CI, merge with admin bypass, tag' : ''}.`)
  process.exit(0)
}

script('release.mjs', [level]) // tests, bump everywhere, build; commits nothing
const version = manifestVersion()
if (git('tag', '--list', version)) fail(`Tag ${version} already exists. Undo the bump with: git restore .`)

const branch = `release/${version}`
sh('git', ['switch', '-c', branch])
sh('git', ['add', 'manifest.json', 'package.json', 'package-lock.json', 'versions.json'])
sh('git', ['commit', '-m', `Release ${version}`])
sh('git', ['push', '-u', 'origin', branch])
const body = `Version bump to ${version}. Once this is merged, tagging ${version} triggers the Release workflow.`
const prUrl = sh('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Release ${version}`, '--body', body], { capture: true }).split('\n').pop()
console.log(`\nPR: ${prUrl}`)

if (!merge) {
  console.log(`Stopped before merging. After it is merged, run: npm run ship -- --finish`)
  process.exit(0)
}

console.log('Waiting for CI...')
for (let i = 0; i < 12; i++) {
  // checks take a few seconds to register after the PR opens
  const r = spawnSync('gh', ['pr', 'checks', prUrl, '--json', 'name'], { cwd: root, encoding: 'utf8' })
  if (r.status === 0 && r.stdout.trim() !== '[]') break
  await new Promise((resolve) => setTimeout(resolve, 5000))
}
sh('gh', ['pr', 'checks', prUrl, '--watch', '--fail-fast'])

if (!(await confirm(`CI passed. Merge ${prUrl} with admin bypass and tag ${version}?`))) {
  console.log('Stopped. Merge it when ready, then run: npm run ship -- --finish')
  process.exit(0)
}
sh('gh', ['pr', 'merge', prUrl, '--squash', '--admin', '--delete-branch'])
sh('git', ['switch', 'main'], { allowFail: true }) // gh may already have switched
sh('git', ['pull', '--ff-only'])
tagAndReport()
