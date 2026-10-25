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

Test against a throwaway vault, never your real one. The reset script deletes the plugin's settings and folders.

**One-time setup**

1. Create a new, empty vault in Obsidian and open it once, so it has a `.obsidian` folder. Close it afterwards.
2. Create `.deploy.json` (gitignored) in the repo root:
   ```json
   { "vault": "/path/to/your/real/vault", "testVault": "/path/to/the/throwaway/vault" }
   ```
   `vault` is only used by `npm run deploy`. The `OBSIDIAN_VAULT` and `OBSIDIAN_TEST_VAULT` environment variables work instead of the file, and a path argument overrides both.
3. Mark the throwaway vault once: `node scripts/reset-test.mjs --mark`. The reset script refuses to touch a vault without this marker, which guards against pointing it at the wrong vault.
4. Install and log in to the Claude Code CLI. It is the harness the jobs spawn, and a run fails without it.

**Test loop**

1. Close the vault in Obsidian. A running plugin rewrites its settings, which would undo the reset.
2. `npm run reset:test` returns the vault to a fresh-install state and `npm run reset:test -- --deploy` also builds and installs the current code. Add `--dry-run` to preview.
3. Open the vault, enable **Scheduled Agents** under Community plugins, and run a job from the plugin's settings. Jobs only run while Obsidian is open.
4. Check the review page the job wrote. For Tag Review, also try approving and undoing an edit in the panel.

**What reset does**

- Removes the plugin's `data.json`, its plugin folder, and the old default output folder (`Weekly Summaries`). Notes elsewhere are never deleted, and hidden folders are skipped.
- Re-enables the built-in jobs, which a real install ships disabled. Pass `--keep-disabled` to match a real first install.
- Sets today's daily note to "Hello world!" (only when the daily-note format is `YYYY-MM-DD`). Pass `--keep-daily` to leave it alone.
- `--keep-output` keeps the `Weekly Summaries` folder.

## Releases

`npm run release` (or `release:minor` / `release:major`) runs tests, bumps the version in every file that carries it, and builds. Don't edit versions by hand.
