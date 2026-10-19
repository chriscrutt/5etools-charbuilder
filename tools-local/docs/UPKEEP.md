# Keeping the fork up to date

5etools publishes a new release every week or two. This fork follows it without losing its own
features. There are **two upstream repos**:

| What | Upstream | Here | How it updates |
| --- | --- | --- | --- |
| Site (code + data) | `github.com/5etools-mirror-3/5etools-src` | this repo, branch `local-customizations` | **merged** into the fork branch |
| Images | `github.com/5etools-mirror-3/5etools-img` | `img/` (its own git clone, gitignored here) | **fast-forwarded**; never edited |

Remote layout in a fork: `origin` = your GitHub fork, `upstream` = the official 5etools source
([SETUP.md](SETUP.md) shows how to add it).

## The routine

```bash
npm run local:sync -- --check   # optional: what's new, and is anything risky?
npm run local:sync              # merge upstream site + fast-forward images (+ npm install if needed)
npm run local:test              # ~2 min: Character Builder, VTT, 2014-only mode, media
git push                        # publish the merge to your fork (never push tags; see below)
```

Then restart the server and **hard-refresh** the browser (Ctrl+Shift+R). `serve:fast` sends
1-year cache headers, so the browser may otherwise keep old JS/data.

`tools-local/sync.mjs` does, in order:

1. Finds the upstream remote: one named `upstream`, else any remote pointing at
   `5etools-mirror-N/5etools-src` (or `--remote <name>`). It refuses to run with uncommitted
   changes to tracked files.
2. `git fetch upstream`, then reports the versions, the new commits, which files *both* sides
   changed (that's where conflicts can happen), and whether upstream touched the **DOM
   element-helper API** in `js/utils.js` (the source of past runtime breakages, below).
3. `git merge --no-edit upstream/main`. On conflicts it stops, lists the files and points here.
   `git merge --abort` backs out.
4. Runs `npm install` if `package-lock.json` changed (otherwise `node_modules` drifts from the lockfile).
5. Fast-forwards a local `main` branch to `upstream/main` if you keep one (optional mirror).
6. `img/`: `git fetch` + `git merge --ff-only` (or prints the clone command if `img/` is missing).
7. Warns if precompressed `.br`/`.gz` files exist. They'd now be stale, and `serve:fast` serves
   them instead of the real files, so re-run `npm run local:precompress`.

## Why merges are usually clean

Almost all fork code lives in **files upstream doesn't have**, so upstream changes can't
conflict with it: `charbuilder.html`, `js/charbuilder.js`, `js/charbuilder/`,
`css/charbuilder.css`, `vtt.html`, `js/vtt.js`, `js/vtt-net.js`, `css/vtt.css`,
`js/fork-compat.js`, `tools-local/`, `CLAUDE.md`, `.github/README.md`.

The fork's edits to **upstream-owned files** are deliberately small. These are the only places a
textual conflict can occur. Each is marked with a `fork:` comment where the format allows:

| File | Fork edit | If it conflicts |
| --- | --- | --- |
| `js/utils.js` | `ExcludeUtil._isEditionHidden()` + caches (2014-only and FR-canon), and the first line of `ExcludeUtil.isExcluded()`; `SourceUtil.isLegacySourceWotc()` body + `SourceUtil._isStyleClassic()`; `SourceUtil.isFrCanonSource()` | Take upstream's version of the surrounding code, then re-add the hook lines ([EDITION-2014.md](EDITION-2014.md)). |
| `js/parser.js` | `Parser.SOURCES_LEGACY_SUPERSEDED_BY_ODND = new Set([PHB, DMG, MM])` and `Parser.SOURCES_NON_FR_FORK` (extra non-FR sources) after `SOURCES_LEGACY_WOTC` | Keep both. |
| `js/utils-config/utils-config-registry.js` | style switcher `default: SITE_STYLE__CLASSIC`; the `isFrCanonOnly` boolean setting right after it | Take upstream's, re-apply the default and re-add the setting. |
| `js/omnisearch/omnisearch-backing.js` | one-line results filter (`!ExcludeUtil._isEditionHidden(res.doc.s)`) in `pGetFilteredResults` | Take upstream's, re-add it next to the `isShowUa`/`isShowLegacy` filters. |
| `js/navigation.js` | two `_addElement_li` lines: Character Builder (Player menu), Tabletop (VTT) (DM menu); the "Forgotten Realms Canon Only" Settings-menu button + `NavBar._fork_isFrCanonOnly()` | Keep both. |
| `package.json` | scripts `serve:fast`, `vtt`, `local:precompress`, `local:precompress:clean`, `local:sync`, `local:test` | Take upstream's version bump/deps, keep the fork scripts. Never hand-merge `package-lock.json`: take upstream's (`git checkout --theirs package-lock.json`) and run `npm install`. |
| `.gitignore` | `.claude/` | Keep both. |

So far (six syncs, v2.30 → v2.38) none of these has actually conflicted.

## The real risk: a clean merge that breaks at runtime

Upstream sometimes renames or reshapes globals that the fork's pages call. The merge is clean
(the fork code is in separate files), but the Character Builder or VTT fails when it loads. That
has happened twice:

- **v2.33 (Aug 2026)**: the DOM helper globals were renamed (`ee`→`veT`, `es`→`veEs`,
  `e_`→`veE`, plus a new `veEm`). The fluent element methods also moved from the element itself
  (`ele.empty()`, `ele.onn()`, `ele.appendTo()`, `ele.val()`, `ele.find()`) into a namespace
  (`ele.vee.empty()`, …). The fork's UI calls the old flat form hundreds of times.
- **v2.36 (Sept 2026; reached this fork in the Oct 2026 sync to v2.37.0)**: `ele.vee` became a
  lazily created class instance (`ElementUtil._ElementUtilVee`) whose methods are non-enumerable
  prototype getters, so the shim's way of discovering method names found nothing.

**Fix pattern: adapt in `js/fork-compat.js`, never at the call sites.** That file is loaded right
after `js/utils.js` on `charbuilder.html` and `vtt.html`. It aliases the old global names and
patches `ElementUtil._getOrModify_bindMethods` so every element also gets the flat methods (only
where the name isn't already a native DOM member, and with `ele.vee` left intact for upstream
code). Fixing it in one place keeps the fork's files untouched, so they never conflict.

**Symptoms**: the test runner reports page errors like `X is not defined` or
`root.empty is not a function`, or `builder-regression` times out waiting for the builder to boot.

**Diagnose**: `node tools-local/tests/tools/diag.mjs charbuilder.html` (or `vtt.html`) prints the
page errors, failed requests, and which element-API globals exist. Then read upstream's diff of
`js/utils.js` around `ElementUtil` and `TemplateUtil`
(`git log -p ORIG_HEAD..HEAD -- js/utils.js` right after a sync), and teach `fork-compat.js` the
new shape.

## Images

`img/` is a plain clone of `5etools-img`. Never commit to it; the sync only fast-forwards it. A
shallow clone (`--depth 1`) is fine and skips the history, but it still takes **about 13 GB**:
~6.5 GB of image files plus ~6.5 GB of git objects in `img/.git` (images don't compress), because
5etools ships every book's art, tokens and maps. Without `img/` the site still works, but images
404 (`site-media` fails and says so).

## When the official repo moves

The official source is published under numbered GitHub orgs and has moved before (it's on
`5etools-mirror-3` now). If fetches start failing, find the current mirror (the 5etools site
or its community links), then:

```bash
git remote set-url upstream https://github.com/5etools-mirror-N/5etools-src.git
git -C img remote set-url origin https://github.com/5etools-mirror-N/5etools-img.git
```

History is shared, so syncing continues normally.

## Things not to do

- **Don't push tags** (`git push --tags`, `--follow-tags`). Upstream's tags (`v2.38.0`, …) come
  along on fetch, and upstream's GitHub workflows run on `v*` tag pushes:
  `.github/workflows/main.yml` publishes a GitHub release (a zip of the whole site) and a Docker
  image to `ghcr.io` under your account. `pages.yml` builds a Pages site, though its deploy steps
  are currently commented out upstream. Keep **Actions disabled** in your repo settings unless
  you mean to use them. GitHub doesn't run workflows on forks until you enable them.
- **Don't use upstream's `npm test` as your gate.** Its lint step flags the fork's files (about
  2,400 errors, never cleaned up: ~1,600 in `tools-local/`, mostly style, and ~850 in `js/`,
  mostly `no-undef` for the old `ee`/`es` globals that `js/fork-compat.js` defines at runtime),
  and its data tests are upstream's concern.
  `npm run local:test` is the fork's gate.
- **Don't edit files in `img/`, or rewrite upstream history** (no rebasing the fork onto
  upstream). Merges keep future syncs simple.

## Doing it by hand (if the script can't)

```bash
git fetch upstream
git log --oneline HEAD..upstream/main
git diff HEAD...upstream/main -- js/utils.js | grep -E '^[-+].*(_getOrModify_bindMethods|_ElementUtilVee|defineProperty\(ele, "vee"|(window|globalThis)\.(ee|es|e_|veT|veEs|veE|veEm)\b)'
git merge --no-edit upstream/main
npm install                       # if package-lock.json changed
git -C img pull --ff-only
npm run local:test
```

## Sync history

| Date | Versions | Notes |
| --- | --- | --- |
| 2026-06-19 | v2.30.1 → v2.31.0 | Clean. |
| 2026-07-22 | v2.31.0 → v2.32.1 | Clean, 139 files. |
| 2026-08-03 | v2.32.1 → v2.33.3 | Textually clean; **broke the builder at runtime** (element-API rename). `js/fork-compat.js` created. |
| 2026-09-17 | v2.33.3 → v2.35.1 | Clean; big content release (416 files, new books/adventures). |
| 2026-10-08 | v2.35.1 → v2.37.0 | Clean; `vee` became a lazy class, so fork-compat updated. |
| 2026-10-14 | v2.37.0 → v2.38.0 | Clean; new adventure "Project Lamordia" (hidden by 2014 mode); lockfile change, so `npm install`. |

Add a row when you sync, especially if something needed fixing.
