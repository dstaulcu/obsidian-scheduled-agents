// Fill a throwaway test vault with six harmless daily notes (yesterday back to six days ago) for recording demos.
//   node scripts/seed-demo.mjs [vault] [--dry-run]
// Vault is resolved like reset-test.mjs: the argument, $OBSIDIAN_TEST_VAULT, then .deploy.json ({ "testVault": "<path>" }).
// Safety: refuses unless the vault carries the marker created by `node scripts/reset-test.mjs --mark`.
// Notes go where Obsidian's Daily notes settings put them (vault root when never configured) and only when the format is YYYY-MM-DD.
// Existing notes with the same name are overwritten; run it on a vault you are fine changing.
// The tags are deliberately messy (legacy names, mixed case, untagged action items) so Tag Review has something to propose.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
if (args.some((a) => a.startsWith('--') && a !== '--dry-run') || positional.length > 1) {
  console.error('Usage: seed-demo.mjs [vault] [--dry-run]')
  process.exit(2)
}

function configuredVault() {
  if (positional[0]) return positional[0]
  if (process.env.OBSIDIAN_TEST_VAULT) return process.env.OBSIDIAN_TEST_VAULT
  const cfg = join(root, '.deploy.json')
  if (existsSync(cfg)) return JSON.parse(readFileSync(cfg, 'utf8')).testVault
  return undefined
}

const vault = configuredVault()
if (!vault) {
  console.error('No test vault set. Pass a path, set OBSIDIAN_TEST_VAULT, or add "testVault" to .deploy.json.')
  process.exit(2)
}
const vaultPath = resolve(vault)
if (!existsSync(join(vaultPath, '.obsidian'))) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vaultPath}`)
  process.exit(1)
}
if (!existsSync(join(vaultPath, '.obsidian', '.scheduled-agents-test-vault'))) {
  console.error(`Refusing: ${vaultPath} is not marked as a test vault.\nRun \`node scripts/reset-test.mjs --mark\` once if it really is a throwaway vault.`)
  process.exit(1)
}

let folder = ''
let format = 'YYYY-MM-DD'
try {
  const cfg = JSON.parse(readFileSync(join(vaultPath, '.obsidian', 'daily-notes.json'), 'utf8'))
  folder = (cfg.folder ?? '').replace(/^\/+|\/+$/g, '')
  format = cfg.format || format
} catch {
  // never configured: vault root, YYYY-MM-DD
}
if (format !== 'YYYY-MM-DD') {
  console.error(`Daily note format "${format}" is not YYYY-MM-DD; set it back to the default for the demo.`)
  process.exit(1)
}
const dir = resolve(vaultPath, folder)
if (dir !== vaultPath && !dir.startsWith(vaultPath + sep)) {
  console.error(`Daily notes folder is outside the vault: ${dir}`)
  process.exit(1)
}

// index 0 is yesterday, 5 is six days ago
const notes = [
  [
    '---',
    'tags: [Tools]',
    '---',
    '- Wired up the weekly review job in #tools/obsidian and checked the run log',
    '- Read a paper on retrieval for notes #learning',
    '- TODO call the dentist and book a cleaning',
    '- Sketched the garden bed layout #home/garden',
  ],
  [
    '- Standup notes for #project/brainagent: cost cap works, timeout still needs a test',
    '- Reviewed two pull requests #work',
    '- Pick up groceries: eggs, rice, basil',
    '- Evening run, 5k, felt good #health',
  ],
  [
    '- Planned the quarterly goals #planning #Work',
    '- Pairing session on #project/brain-agent: renamed the plugin folder setting',
    '- Follow up with the plumber about the leak',
    '- Finished chapter 4 of the book #reading',
  ],
  [
    '- Cleaned up the dotfiles repo #tools/git',
    '- Drafted the README intro for the plugin #project/scheduled-agents',
    '- Meal prep: soup and roasted vegetables #home #cooking',
    '- Need to renew the passport',
  ],
  [
    '---',
    'tags: [health, Reading]',
    '---',
    '- Long walk, listened to a podcast about sleep #health',
    '- Tried a new pour-over ratio #coffee',
    '- Idea: a weekly digest of what I actually finished #ideas',
    '- Water the tomatoes',
  ],
  [
    '- Fixed a flaky test in #project/brainagent after the retry loop change',
    '- Read about prompt injection defences #security #learning',
    '- Called mom, planning the visit #family',
    '- Order new running shoes',
  ],
]

const pad = (n) => String(n).padStart(2, '0')
const name = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`
const today = new Date()

if (!dry) mkdirSync(dir, { recursive: true })
notes.forEach((lines, i) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i + 1))
  const target = join(dir, name(d))
  if (!dry) writeFileSync(target, lines.join('\n') + '\n')
  console.log(`${dry ? 'would write' : 'wrote'} ${target}`)
})
