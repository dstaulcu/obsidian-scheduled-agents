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
4. Push the branch and open a pull request into `main`, from the browser or with the GitHub CLI:
   `git push -u origin <branch> && gh pr create --base main --fill`
   Say what changed and why, and how you tested it (a test vault run counts; see below).
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
2. `npm run reset:test` returns the vault to a fresh-install state, then builds and installs the current code. `node scripts/reset-test.mjs` resets without deploying. Add `--dry-run` to preview (`npm run reset:test -- --dry-run`).
3. Open the vault, enable **Scheduled Agents** under Community plugins, and run a job from the plugin's settings. Jobs only run while Obsidian is open.
4. Check the review page the job wrote. For Tag Review, also try approving and undoing an edit in the panel.

**What reset does**

- Removes the plugin's `data.json`, its plugin folder, and the old default output folder (`Weekly Summaries`). Notes elsewhere are never deleted, and hidden folders are skipped.
- Re-enables the built-in jobs, which a real install ships disabled. Pass `--keep-disabled` to match a real first install.
- Sets today's daily note to "Hello world!" (only when the daily-note format is `YYYY-MM-DD`). Pass `--keep-daily` to leave it alone.
- `--keep-output` keeps the `Weekly Summaries` folder.

## Releases

CI (`.github/workflows/ci.yml`) runs tests and a build on every PR. Releases are published by `.github/workflows/release.yml` when a version tag is pushed.

From a clean, up-to-date `main`, run one command:

```bash
npm run ship          # patch; or ship:minor / ship:major
```

It runs the tests, bumps the version in every file that carries it, builds, opens a `release/<version>` PR, waits for CI, asks for confirmation, merges with your admin bypass, and tags the version. The tag (no `v` prefix, as Obsidian requires) triggers the workflow, which attaches `main.js`, `manifest.json` and `styles.css` to a GitHub release. Don't edit versions by hand.

- `npm run ship -- --no-merge` stops after opening the PR so someone else can review it. Once it is merged, run `npm run ship -- --finish` to pull `main` and tag.
- `npm run ship -- --dry-run` checks preconditions and prints the plan.
- The individual steps still exist: `npm run release[:minor|:major]` (bump and build only) and `npm run tag`.

## Claude-assisted fixes

A maintainer can have Claude Code draft a fix for an issue they have approved:

1. Apply the `claude-fix` label to the issue. Only people with triage access or above can, which is the approval step.
2. `.github/workflows/claude-issue-fix.yml` runs Claude Code, which pushes a branch and opens a PR referencing the issue.
3. Review it like any other PR. CI must pass, and a human merges. The workflow cannot edit `.github/`, bump versions or cut releases.

Issue text is untrusted input. Read the issue before labeling it, and treat a Claude PR that widens agent tools or write locations as needing the same scrutiny as any hand-written one. The repo needs an `ANTHROPIC_API_KEY` Actions secret.

Changes under `.github/` (workflows can use repository secrets) require approval from the code owner listed in `.github/CODEOWNERS`.
