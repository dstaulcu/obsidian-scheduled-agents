// Tag the current manifest version and push the tag, which triggers .github/workflows/release.yml.
//   node scripts/tag-release.mjs [--dry-run]
// Run on an up-to-date `main` after the version-bump PR (npm run release[:minor|:major]) is merged.
// Refuses if the tree is dirty, the branch is not main or behind/ahead of origin, or the tag exists.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.some((a) => a !== '--dry-run')) {
  console.error('Usage: tag-release.mjs [--dry-run]')
  process.exit(2)
}
const dry = args.includes('--dry-run')

function git(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`git ${a.join(' ')} failed:\n${r.stderr || r.stdout}`)
    process.exit(1)
  }
  return r.stdout.trim()
}
const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}

const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version
if (git('branch', '--show-current') !== 'main') fail('Not on main.')
if (git('status', '--porcelain')) fail('Working tree is not clean.')
git('fetch', '--tags', 'origin')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main; pull or push first.')
if (git('tag', '--list', version)) fail(`Tag ${version} already exists.`)

console.log(`Tagging ${version} at ${git('rev-parse', '--short', 'HEAD')}`)
if (dry) process.exit(0)
git('tag', '-a', version, '-m', `Release ${version}`)
git('push', 'origin', version)
console.log(`Pushed ${version}. The Release workflow will publish the GitHub release.`)
