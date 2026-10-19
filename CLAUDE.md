# CLAUDE.md

This repo is a **personal fork of 5etools** (the client-side D&D 5e reference site,
`github.com/5etools-mirror-3/5etools-src`). It stays in sync with upstream and adds:

- **Character Builder** (`charbuilder.html`): creation, leveling 1-20, multiclassing, play mode, sidekicks, saved roster.
- **Tabletop / VTT** (`vtt.html`): maps, tokens, initiative, fog, encounters, LAN multiplayer via a tiny relay.
- **2014-only mode**: Classic style is the default and hides everything released from the 2024 PHB onward, site-wide.
  Plus a **Forgotten Realms Canon Only** toggle (navbar Settings menu) for official WotC 2014 FR/setting-neutral books only.
- **Upkeep tooling**: one-command upstream sync and a browser test suite.

Everything else is stock 5etools. Upstream owns `data/`, most of `js/`, `css/`, `node/` and
`test/`; don't restructure them.

## Read the right doc first

| Task | Read |
| --- | --- |
| First-time setup, running the site | `tools-local/docs/SETUP.md` |
| Syncing with upstream, merge conflicts, "builder broke after sync" | `tools-local/docs/UPKEEP.md` |
| Anything in the Character Builder | `tools-local/docs/CHARACTER-BUILDER.md` |
| Anything in the VTT | `tools-local/docs/VTT.md` |
| 2014-only mode | `tools-local/docs/EDITION-2014.md` |
| Running or writing tests | `tools-local/docs/TESTING.md` |
| Using the builder in another site / re-theming / reusing the rules engine | `tools-local/docs/INTEGRATION-OPTIONS.md` |
| Serving speed, caching, benchmarks | `tools-local/LOCAL-HOSTING.md` |

## Commands

```bash
npm install                  # once, and after syncs that change package-lock.json (local:sync does it)
npm run serve:fast           # site on http://localhost:5050 (1-year cache headers: hard-refresh after changes)
npm run serve:dev            # same, no caching (better while editing)
npm run vtt                  # VTT multiplayer relay on :5055
npm run local:sync           # merge upstream 5etools + fast-forward img/  (--check = dry run)
npm run local:test           # fork test suite, ~2 min, starts servers itself (-- --all, -- <name filter>)
node tools-local/tests/tools/diag.mjs charbuilder.html   # page errors / failed requests for one page
```

## Ground rules

1. **Put fork code in fork-owned files** (list below). Edit upstream files only when there's no
   other way. Keep the edit tiny, mark it with a `// fork:` comment, and add it to the
   "fork's edits to upstream-owned files" table in `tools-local/docs/UPKEEP.md`. Every upstream
   edit is a future merge conflict.
2. **When an upstream change breaks a global or element method the fork uses, adapt it in
   `js/fork-compat.js`**, not at the call sites. (The builder UI calls the old flat element API,
   `ele.onn()`/`appendTo()`/`empty()`/`val()`, hundreds of times.)
3. **Run `npm run local:test` after every change and every sync.** Add or extend a test in
   `tools-local/tests/suite/` for new behavior. A clean merge can still break at runtime.
4. **Never commit inside `img/`** (separate clone of 5etools-img). **Never push tags** (upstream's
   tag-triggered workflows publish releases and Docker images). **Never hand-merge
   `package-lock.json`**: take upstream's, then `npm install`.
5. Upstream's `npm test` / lint is not the fork's gate; it flags fork files for style.
   Match the surrounding code style (tabs, double quotes, trailing commas) anyway.

## Fork-owned files

`CLAUDE.md`, `.github/README.md`, `charbuilder.html`, `js/charbuilder.js`, `js/charbuilder/`,
`css/charbuilder.css`, `vtt.html`, `js/vtt.js`, `js/vtt-net.js`, `css/vtt.css`,
`js/fork-compat.js`, `tools-local/` (sync script, VTT relay, precompress, tests, docs).
Small edits in upstream files, each marked `fork:` where the format allows: `js/utils.js`,
`js/parser.js`, `js/utils-config/utils-config-registry.js`, `js/omnisearch/omnisearch-backing.js`,
`js/navigation.js`, `.gitignore`, and `package.json` (scripts `serve:fast`, `vtt`, `local:*`; JSON
can't hold the marker).

## Gotchas that have bitten before

- Builder spell lists **must** check both `spell.classes.fromClassList` and `fromClassListVariant`
  (use `CharState._spellClassNames`/`_spellInClass`), or supplement spells such as XGE's Chaos Bolt
  silently vanish from class lists. The loader merges both lists in from
  `gendata-spell-source-lookup.json`; the raw spell files carry none.
- Entity references are mostly `"name|source"` uids (`CW.uid`), but granted-spell picks store bare
  spell names and `profChoices` stores plain option names. Saves store choices, not computed stats.
- Subclass sub-features are often nested in a wrapper feature: match on
  `JSON.stringify(f.entries)`, not `f.name`. And in raw 5etools class data, every subclass feature after
  the first is wrapped in an unnamed `{type:"entries", level, entries:[feature]}`; the builder unwraps
  these at load (`_pLoadClasses`). Don't filter on `f.name` over raw `DataUtil.class` output.
- In tests, always `page.setCacheEnabled(false)`, set the style with
  `VetoolsConfig.set("styleSwitcher","style","classic")` and **reload** (style is read at load).
- `JqueryUtil.doToast` renders string content as text, so no HTML in toasts.
- Debug hooks: `dbg_charBuilderPage._ui._state` (CharState), `dbg_cb` (data), `dbg_vtt`, `VttNet`.
- A 404 for `sw-injector.js` in dev is normal (build-time file).
