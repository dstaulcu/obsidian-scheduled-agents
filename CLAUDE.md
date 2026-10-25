# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Desktop-only Obsidian plugin ("Scheduled Agents") that runs read-only agent prompts on a schedule by spawning an installed agent harness (Claude Code CLI today), then writes the result into the vault as a review page. Built-in jobs: Tag Review (with an approve/reject panel for tag edits) and Daily Notes Digest.

## Commands

```bash
npm test                        # jest (ts-jest), tests in tests/**/*.test.ts
npx jest tests/runner.test.ts   # single file
npx jest -t "name pattern"      # single test by name
npm run type:check              # tsc --noEmit
npm run build                   # tsc --noEmit + production esbuild bundle -> main.js
npm run dev                     # esbuild watch
npm run deploy                  # build + copy into the vault in .deploy.json ({"vault": "<path>"})
npm run ship[:minor|:major]     # whole release: bump, PR, wait for CI, admin-merge, tag (see CONTRIBUTING.md)
npm run release[:minor|:major]  # test, bump version everywhere, build
npm run bump[:minor|:major]     # version bump only
npm run reset:test              # reset a marked throwaway test vault to fresh-install state (scripts/reset-test.mjs; read its header first, close the vault in Obsidian before running)
```

## Architecture

- `src/core/` is pure logic with **no Obsidian imports** so it is unit-testable under node. Obsidian access goes through the `VaultIO` interface (`vaultIO.ts`); `runner.ts` orchestrates a job run (expand templates -> check executor capabilities -> resolve output path -> execute -> write). Keep new logic here and inject Obsidian dependencies.
- `src/executors/` defines the `JobExecutor` interface plus declared `ExecutorCapabilities` (`enforcesReadOnly`, `supportsBudget`, `supportsSkills`, `reportsCost`). The runner refuses a job on a harness that cannot enforce read-only access, so new harnesses must declare capabilities honestly. `claudeCli.ts` spawns the CLI with `Read,Glob,Grep` only, `dontAsk` permissions, no MCP/shell; `registry.ts` selects executors.
- `src/tagreview/` is the Tag Review feature: the agent emits proposed edits, `edits.ts` parses them, `vocab.ts`/`apply.ts` validate and apply them (with undo) only after user approval in the panel (`panel.ts`); `scaffold.ts` creates the starter glossary.
- `src/ui/` holds the settings tab and job editor modal; `src/main.ts` wires scheduling, settings and the above together; settings persist in the plugin's `data.json`.
- Prompts and output paths are templates (`core/templates.ts`) with variables such as `{{dailyNotes*}}` and brand vars (`src/brand.ts`, `BrandVars` in `runner.ts`). Built-in job definitions live in `core/builtinJobs.ts`.

## Invariants to preserve

- The agent is read-only; **only the plugin writes** to the vault. Output defaults to inside the plugin folder; other destinations must be in the "Allowed output folders" setting, and hidden folders are never written (`core/vaultPath.ts` enforces this).
- Missed jobs run once at next Obsidian launch; jobs only run while Obsidian is open.
- Built-in jobs always exist (users disable rather than delete; reset restores defaults).
- `main.js` is a gitignored build artifact; deploy copies it with `manifest.json` and `styles.css`. Versions are bumped across files by `scripts/release.mjs`, so don't edit versions by hand.
