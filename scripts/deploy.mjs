// Copy built plugin files into an Obsidian vault for testing.
//   node scripts/deploy.mjs [vault] [--build] [--hot-reload]
// Vault is resolved from: the argument, $OBSIDIAN_VAULT, then .deploy.json ({ "vault": "C:/path/to/vault" }).
// --build        run the production build first
// --hot-reload   create a .hotreload marker (used by the Hot Reload community plugin)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const unknown = [...flags].filter((f) => !['--build', '--hot-reload'].includes(f))
if (unknown.length || positional.length > 1) {
  console.error('Usage: deploy.mjs [vault] [--build] [--hot-reload]')
  process.exit(2)
}

function configuredVault() {
  if (positional[0]) return positional[0]
  if (process.env.OBSIDIAN_VAULT) return process.env.OBSIDIAN_VAULT
  const cfg = join(root, '.deploy.json')
  if (existsSync(cfg)) return JSON.parse(readFileSync(cfg, 'utf8')).vault
  return undefined
}

const vault = configuredVault()
if (!vault) {
  console.error('No vault set. Pass a path, set OBSIDIAN_VAULT, or create .deploy.json with {"vault": "<path>"}.')
  process.exit(2)
}
const vaultPath = resolve(vault)
if (!existsSync(join(vaultPath, '.obsidian'))) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vaultPath}`)
  process.exit(1)
}

if (flags.has('--build')) {
  const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const dest = join(vaultPath, '.obsidian', 'plugins', manifest.id)
const files = ['main.js', 'manifest.json', 'styles.css']
const missing = files.filter((f) => !existsSync(join(root, f)))
if (missing.length) {
  console.error(`Missing build output: ${missing.join(', ')}. Run with --build.`)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
for (const f of files) copyFileSync(join(root, f), join(dest, f))
if (flags.has('--hot-reload')) writeFileSync(join(dest, '.hotreload'), '')
console.log(`Deployed ${manifest.id} ${manifest.version} -> ${dest}`)
console.log('Reload Obsidian (or toggle the plugin) to pick it up. data.json (your settings) was not touched.')
