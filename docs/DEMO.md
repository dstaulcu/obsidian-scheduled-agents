# Recording the demo GIFs

Two GIFs for the README, recorded with [ScreenToGif](https://www.screentogif.com/):

| File | Length | Shows |
|---|---|---|
| `docs/hero.gif` | 15–20 s | Run a job, read the page it wrote, see the run log row |
| `docs/tag-review.gif` | 30–40 s | Approve some tag edits, apply them, undo the batch |

A real run takes a minute or more, so record one short clip per step and cut the waiting in ScreenToGif's editor. Don't record one continuous take.

## Prep (off camera)

1. Close the test vault in Obsidian, then `npm run reset:test`. This gives you enabled built-in jobs and a fresh plugin folder. (First time only: see CONTRIBUTING.md to mark the test vault.)
2. `npm run seed:demo` writes six harmless daily notes with a deliberately messy tag mix (legacy names such as `#project/brainagent`, mixed case, untagged action items). It only touches a marked test vault. Never demo on your real vault: the agent reads the notes and the recording shows their text.
3. Open the vault and enable the plugin. **Pre-generate the slow outputs** so the recording only has to show them:
   - Run **Daily Notes Digest** once and keep the page.
   - Run **Tag Review** (bootstrap mode), apply the vocabulary rows, run it again. The second report has the `retag` and `append_tags` rows you want on screen.
   - Keep a copy of the vault (or the notes) from before you apply the second report, so the on-camera Apply is real and you can repeat the take.
4. Window: Obsidian about 1280×720, dark theme, other sidebars closed, zoom 110–125% so text is readable at GIF size.
5. ScreenToGif: Recorder with a fixed region (not full screen), **15 fps**, cursor captured. Rehearse each clip twice first.

## GIF 1: `hero.gif` (about 18 s)

| Time | On screen | Caption |
|---|---|---|
| 0–3 s | Settings → Scheduled Agents → Jobs list: **Tag Review** and **Daily Notes Digest** | Scheduled, read-only agent jobs |
| 3–6 s | Toggle Daily Notes Digest on and show its schedule (weekly Monday 06:00) | Runs while Obsidian is open |
| 6–9 s | Click ▶ run now; the status bar shows "running…" (cut the wait here) | |
| 9–15 s | The digest page opens in the plugin folder; scroll slowly, hold 2 s | |
| 15–18 s | Open `Run Log.md` and show the `ok` row | Results land in your vault |

## GIF 2: `tag-review.gif` (about 35 s)

| Time | On screen | Caption |
|---|---|---|
| 0–4 s | Open the Tag Review page and scroll to the panel | The agent only suggests |
| 4–10 s | Rows with before/after diffs; hover one so a diff is readable | |
| 10–16 s | Tick 3–4 rows, leave one unticked, click **Apply selected** | You approve every change |
| 16–22 s | Open one edited note and show the new tag (about 3 s per note) | |
| 22–30 s | Command palette → **Undo last tag-review batch**, then show the note back as it was | …and undo it |
| 30–35 s | End on the plugin folder with the review page | |

Optional 10 s clip for contributors: Settings → **Report an issue** → Preview → Copy, then **Report a bug**. Make a job fail first (wrong harness path) so the preview shows a last error with `<vault>/…` and `~` in place of real paths.

## Editing in ScreenToGif

- **Cut waits.** Select the frames during a run, delete most of them, and set the rest to about 100 ms, so the viewer sees "click, then result".
- **Slow cursor.** Move in straight lines and pause about 0.5 s before each click.
- **Captions.** Editor → Caption/Title frame. Keep each to 6 words or fewer and show it for at least 1.5 s.
- **Loop feel.** Hold the first frame about 1.5 s and the last about 2 s.
- **Size.** Aim for under 5 MB each. If larger, drop to 12 fps, record a smaller region, or save with Gifski encoding at quality about 80.

## Adding them to the README

Save the files as `docs/hero.gif` and `docs/tag-review.gif`, then uncomment the two image lines in `README.md` (they are commented out so the page doesn't show broken images until the files exist). Don't attach the GIFs to releases: the release assets stay `main.js`, `manifest.json` and `styles.css`.

The repo is private, so the images only render for people with access until it goes public.
