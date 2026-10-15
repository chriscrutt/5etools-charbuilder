# Setup

## Requirements

- **Node.js 24+** (upstream's `package.json` requires it) and **Git**.
- **About 14 GB of disk**: about 13 GB for the images (even a `--depth 1` clone holds ~6.5 GB of
  image files plus a ~6.5 GB packed copy in `img/.git`; images don't compress), and about 1 GB for
  the site, its git history and `node_modules`.
- **Chrome, Edge, Chromium or Brave** for the tests (any OS). Set `CHROME_PATH` if it's
  installed somewhere unusual.

## First-time setup

1. **Fork** this repo on GitHub. Its default branch, `local-customizations`, holds everything;
   GitHub's "copy the default branch only" option is fine.
2. **Clone your fork and add the official 5etools source as `upstream`:**
   ```bash
   git clone https://github.com/<you>/<your-fork>.git 5etools
   cd 5etools
   git remote add upstream https://github.com/5etools-mirror-3/5etools-src.git
   ```
3. **Get the images** (a separate repo, cloned into `img/`, which this repo ignores):
   ```bash
   git clone --depth 1 https://github.com/5etools-mirror-3/5etools-img.git img
   ```
4. **Install and run:**
   ```bash
   npm install
   npm run serve:fast        # http://localhost:5050
   ```
   - Character Builder: <http://localhost:5050/charbuilder.html>
   - Tabletop (VTT): <http://localhost:5050/vtt.html> (multiplayer also needs `npm run vtt`; see [VTT.md](VTT.md))
   - `npm run serve:dev` is the same server without caching, which is handy while editing code.
5. **Check everything works:**
   ```bash
   npm run local:test        # installs the test package on first run; ~2 min
   ```
6. **GitHub settings**: leave Actions disabled on your fork (the default for forks) and don't
   push tags ([UPKEEP.md](UPKEEP.md#things-not-to-do) explains why).

From then on, [UPKEEP.md](UPKEEP.md) is the routine: `npm run local:sync`, `npm run local:test`,
`git push`.

## Working with Claude Code

`CLAUDE.md` at the repo root loads automatically in every Claude Code session here. It describes
the fork, the rules (where changes go, how to test, how to sync) and which doc to read for what.
Useful first prompts:

- "Read tools-local/docs/INTEGRATION-OPTIONS.md and help me decide how to use the Character
  Builder in my own site."
- "Sync with upstream and run the tests."
- "Walk me through how CharState computes AC."

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Port 5050 in use | Another server is running (maybe a previous `serve:fast`). Stop it, or use `npx http-server -p 5051` and `FORK_TEST_BASE=http://localhost:5051` for tests. |
| Tests: "No Chrome/Edge/Chromium/Brave found" | Install one, or `CHROME_PATH=/path/to/chrome npm run local:test`. |
| Tests time out on Linux with snap Chromium | The harness already keeps profiles inside the repo. If it still fails, use a non-snap Chrome via `CHROME_PATH`. |
| Images missing / `site-media` fails | `img/` isn't cloned (step 3). |
| Old content after a sync | `serve:fast` sends 1-year cache headers. Hard-refresh (Ctrl+Shift+R), or use `serve:dev`. |
| Builder/VTT blank after a sync, "X is not defined" | Upstream changed an API the fork uses; see [UPKEEP.md](UPKEEP.md#the-real-risk-a-clean-merge-that-breaks-at-runtime). |
| `npm install` errors about the engine | Node is older than 24. |
