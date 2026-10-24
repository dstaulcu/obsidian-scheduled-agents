import esbuild from 'esbuild'
import process from 'process'
import builtins from 'builtin-modules'

const prod = process.argv[2] === 'production'
const nodeBuiltins = [...builtins, ...builtins.map((m) => `node:${m}`)]

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...nodeBuiltins],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  minify: prod,
  outfile: 'main.js',
})

if (prod) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
