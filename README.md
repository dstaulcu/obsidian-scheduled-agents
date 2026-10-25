# Scheduled Agents (Obsidian plugin)

Scheduled AI reports for your Obsidian vault. Comes with built-in Tag Review and Daily Notes Digest jobs, and you can add your own in Obsidian's settings, each with its own prompt, schedule and output folder. Results land in the plugin's own folder unless you redirect them, and suggested edits wait for your approval.

An agent reads your notes; the plugin writes the results as review pages. Edits an agent suggests (tag fixes, vocabulary changes) appear as an approve/reject panel and are applied by the plugin only after you approve them, with undo.

- **Desktop only.** Jobs spawn an agent harness you already have installed and logged in (Claude Code CLI today). Jobs run **while Obsidian is open**; a job missed while it was closed runs once at the next launch.
- **The agent only reads.** The Claude executor gets `Read,Glob,Grep` only: no MCP, no shell, `dontAsk` permissions, user settings only, per-run budget cap and timeout. Each harness declares what it can enforce; a job is refused on a harness that cannot enforce read-only access.
- **Writes are the plugin's.** By default output goes inside the plugin folder (for example `Scheduled Agents/2026-W43 Digest`), so nothing lands in a place you did not choose. Each job has its own output path. To send output elsewhere, add that folder to **Allowed output folders** and change the job's output path. Output is never written into hidden folders.
- **Settings** live in the plugin's `data.json`.

## Built-in jobs

Shipped disabled, always present (disable rather than delete; reset restores the default):

- **Tag Review** reads a controlled-vocabulary note and your daily notes, then produces a report with an approve/reject panel for tag fixes and vocabulary changes.
  New installs get a starter glossary at `<plugin folder>/Tag Glossary.md` (facets `areas`, `projects`, `tools`, `techniques`; facets are just the headings in that note). While it has no tags, Tag Review runs in bootstrap mode and proposes a first vocabulary from the tags you already use, as edits you approve. Existing glossaries are used as they are: point **Tag vocabulary note** at yours.
- **Daily Notes Digest** summarises the last seven days of daily notes. Daily-notes location and filename format come from Obsidian's Daily notes settings.

## Install (from source)

```bash
npm ci
npm run release:minor   # or: npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/scheduled-agents/`, or put your vault path in `.deploy.json` (`{"vault": "<path>"}`) and run `npm run deploy`. Enable **Scheduled Agents** under Settings → Community plugins. Try it in a test vault first.

## Development

```bash
npm test                          # jest: schedule, paths, runner, tag-review edits
npm run build                     # tsc --noEmit + production bundle -> main.js
npm run dev                       # esbuild watch
npm run release[:minor|:major]    # test, bump version everywhere, build
npm run deploy                    # build and copy into the vault in .deploy.json
```

Layout: `src/core` is pure logic (no Obsidian imports, unit-tested), `src/executors` holds the harness interface, capability profile and registry, `src/tagreview` the edit parser, validator and apply engine, `src/ui` the settings tab and job editor, `src/brand.ts` the product-name defaults, `src/main.ts` the plugin wiring.

## License

MIT. See [LICENSE](LICENSE).
