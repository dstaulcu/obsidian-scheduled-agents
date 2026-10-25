// Put a throwaway test vault back to a "fresh install" state for this plugin.
//   node scripts/reset-test.mjs [vault] [--mark] [--dry-run] [--deploy]
// Vault is resolved from: the argument, $OBSIDIAN_TEST_VAULT, then .deploy.json ({ "testVault": "<path>" }).
// Safety: refuses unless the vault carries a marker file, created once with --mark. Only the plugin's own
// settings, its plugin folder and the old default output folder (Weekly Summaries) are removed; notes anywhere else are never deleted.
// --mark      only mark the vault as a test vault, then stop (nothing is deleted)
// --dry-run   list what would be removed
// --keep-disabled  by default the built-in jobs come back enabled; this leaves them disabled like a real first install
// --keep-output    by default the old default job-output folder (Weekly Summaries) is removed too; this keeps it
// --keep-daily     by default today's daily note is set to "Hello world!"; this leaves it alone
// --deploy    build and deploy the current code into the vault afterwards
// Close the vault in Obsidian (or disable the plugin) first: a running plugin rewrites its settings.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const unknown = [...flags].filter((f) => !['--mark', '--dry-run', '--deploy', '--keep-disabled', '--keep-daily', '--keep-output'].includes(f))
if (unknown.length || positional.length > 1) {
  console.error('Usage: reset-test.mjs [vault] [--mark] [--dry-run] [--deploy] [--keep-disabled] [--keep-daily] [--keep-output]')
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

const marker = join(vaultPath, '.obsidian', '.scheduled-agents-test-vault')
if (flags.has('--mark')) {
  writeFileSync(marker, 'Safe to reset: scripts/reset-test.mjs may delete this vault\'s plugin settings and plugin folder.\n')
  console.log(`Marked as a test vault: ${vaultPath}`)
  process.exit(0) // --mark only marks; run again without it to reset
}
if (!existsSync(marker)) {
  console.error(`Refusing: ${vaultPath} is not marked as a test vault.\nRun once with --mark if it really is a throwaway vault.`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const pluginDir = join(vaultPath, '.obsidian', 'plugins', manifest.id)
const dataFile = join(pluginDir, 'data.json')

// folder names: the one the saved settings use, plus this build's default
const folders = new Set()
const brand = readFileSync(join(root, 'src', 'brand.ts'), 'utf8')
const def = /DEFAULT_PLUGIN_FOLDER\s*=\s*'([^']+)'/.exec(brand)?.[1]
if (def) folders.add(def)
// output folder that earlier builds wrote job output to by default
if (!flags.has('--keep-output')) folders.add('Weekly Summaries')
try {
  const saved = JSON.parse(readFileSync(dataFile, 'utf8')).pluginFolder
  if (typeof saved === 'string' && saved.trim()) folders.add(saved.trim())
} catch {
  /* no saved settings */
}

const targets = []
if (existsSync(dataFile)) targets.push(dataFile)
for (const f of folders) {
  const abs = resolve(vaultPath, f)
  const rel = relative(vaultPath, abs)
  // never delete the vault itself, anything outside it, or hidden folders such as .obsidian
  if (!rel || rel.startsWith('..') || rel.split(sep).some((s) => s.startsWith('.'))) {
    console.error(`Skipping unsafe folder name: ${f}`)
    continue
  }
  if (existsSync(abs)) targets.push(abs)
}

if (!targets.length) console.log('Nothing to reset: already a fresh install.')
for (const t of targets) {
  console.log(`${flags.has('--dry-run') ? 'would remove' : 'removing'}: ${t}`)
  if (!flags.has('--dry-run')) rmSync(t, { recursive: true, force: true })
}

if (!flags.has('--dry-run') && !flags.has('--keep-disabled')) {
  // one-shot hook read by the plugin on its next load: add the built-in jobs enabled
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(dataFile, JSON.stringify({ seedBuiltinsEnabled: true }, null, 2) + '\n')
  console.log('built-in jobs will be enabled on next load')
}

if (!flags.has('--keep-daily')) {
  // today's daily note, where Obsidian's Daily notes settings put it (vault root when never configured)
  let cfg = {}
  try {
    cfg = JSON.parse(readFileSync(join(vaultPath, '.obsidian', 'daily-notes.json'), 'utf8'))
  } catch {
    /* defaults */
  }
  const format = String(cfg.format || 'YYYY-MM-DD')
  if (format !== 'YYYY-MM-DD') {
    console.log(`daily note skipped: format "${format}" is not YYYY-MM-DD`)
  } else {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`
    const folder = String(cfg.folder || '').trim().replace(/^[\\/]+|[\\/]+$/g, '')
    const target = resolve(vaultPath, folder, name)
    if (relative(vaultPath, target).startsWith('..')) {
      console.error(`Skipping daily note outside the vault: ${target}`)
    } else if (flags.has('--dry-run')) {
      console.log(`would write: ${target}`)
    } else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, 'Hello world!\n')
      console.log(`daily note set to "Hello world!": ${target}`)
    }
  }
}

if (flags.has('--deploy') && !flags.has('--dry-run')) {
  const r = spawnSync('node', [join(root, 'scripts', 'deploy.mjs'), vaultPath, '--build'], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
