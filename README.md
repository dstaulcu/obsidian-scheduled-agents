# Brain Agent (Obsidian plugin)

Schedule read-only Claude Code prompts from Obsidian's settings panel. Each run's result is written back into the vault by the plugin, never by Claude. TypeScript port of the PowerShell `brain-agent`.

- Desktop only (spawns the `claude` CLI). Jobs run **while Obsidian is open**; a job missed while it was closed runs once at the next launch.
- Claude gets `Read,Glob,Grep` only: no MCP, no shell, `dontAsk` permissions, user settings only, per-run budget cap and timeout (same flags as the PowerShell version).
- Jobs are stored in the plugin's `data.json`. Output may only be written under **Allowed output folders** (default `BrainAgent`, `Weekly Summaries`), never into hidden folders or the legacy Prompts folder.

## Install (from source)

```powershell
npm ci
npm run build
$dst = "<vault>\.obsidian\plugins\brain-agent"
New-Item -ItemType Directory -Force $dst
Copy-Item main.js, manifest.json, styles.css $dst
```

Enable **Brain Agent** under Settings → Community plugins. Try it in a test vault first.

## Migrating from the PowerShell version

Settings → Brain Agent → **Import prompt notes** converts `BrainAgent/Prompts/*.md` into jobs and carries over `FirstSeen`/`LastRun` from `%LOCALAPPDATA%\BrainAgent\state.json`, so nothing re-fires. Then stop the old runner: `pwsh C:\code\brain-agent\Install-BrainAgent.ps1 -Uninstall`. Imported jobs may need their output folder added to the allow-list.

## Development

```bash
npm test          # jest: schedule, front matter, paths, args, runner, pass loop
npm run build     # tsc --noEmit + production bundle -> main.js
npm run dev       # esbuild watch
```

Layout: `src/core` is pure logic (no Obsidian imports, unit-tested), `src/executors` holds the `JobExecutor` interface and the Claude CLI executor, `src/ui` the settings tab and job editor, `src/main.ts` the plugin wiring.

Not yet ported: Tag Review / Apply-TagReview.
