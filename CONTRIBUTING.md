# Contributing

## Flow

1. Branch from an up-to-date `main`: `git switch main && git pull && git switch -c <type>/<short-name>` (for example `feat/tag-review-undo`, `fix/missed-job-launch`, `docs/readme`).
2. Make small, focused commits with imperative messages ("Add undo to tag edits").
3. Before pushing, run the checks locally:
   ```bash
   npm run type:check
   npm test
   npm run build
   ```
4. Push the branch and open a pull request into `main`. Say what changed and why, and how you tested it (a test vault run counts; see below).
5. Another contributor reviews. Address comments with new commits, then merge. Prefer squash merge to keep `main` history readable.
6. Don't push directly to `main`, except for trivial doc fixes.

## Code guidelines

- Keep `src/core` free of Obsidian imports and unit-tested. Put Obsidian access behind the `VaultIO` interface.
- The agent is read-only and only the plugin writes to the vault. Changes that widen what an agent can do or where the plugin writes need explicit discussion in the PR.
- New executors must declare their `ExecutorCapabilities` accurately; see `src/executors/types.ts`.
- Add or update tests in `tests/` for behavior changes.
- Update `README.md` and `CLAUDE.md` in the same PR when commands, architecture or user-visible behavior change.

## Trying changes in Obsidian

Use a throwaway vault, never your real one.

1. Put the vault path in `.deploy.json` (gitignored): `{"vault": "<path>"}`.
2. `npm run deploy` builds and copies the plugin into the vault. Reload Obsidian or toggle the plugin.
3. `npm run reset:test` returns a marked test vault to fresh-install state (read the header of `scripts/reset-test.mjs` first, and close the vault in Obsidian before running it).

## Releases

`npm run release` (or `release:minor` / `release:major`) runs tests, bumps the version in every file that carries it, and builds. Don't edit versions by hand.
