# Using the Character Builder in your own site

This is background for deciding how to use the Character Builder in a separate, custom-themed
character-sheet site. It lays out the options and the facts behind them. It doesn't decide.
Architecture details are in [CHARACTER-BUILDER.md](CHARACTER-BUILDER.md).

## What you're working with

The builder is three layers that are coupled to 5etools to very different degrees. All numbers
were measured on v2.38.0.

| Layer | Size | Coupling to 5etools |
| --- | --- | --- |
| **Data loading** (`CharBuilderPage` in `js/charbuilder.js`) | ~150 lines | **Heavy.** Uses 5etools loaders that do real work: class/subclass features dereferenced and grouped by level, spell↔class lists merged from a generated lookup, races/backgrounds migrated per edition, homebrew/prerelease merged, blocklist and 2014 filtering. Produces one `data` object, about **20 MB of JSON** in 2014 mode (items 13.6 MB, classes 2 MB, monsters 1.5 MB, spells 1.4 MB). |
| **Rules engine** (`CharState` in `js/charbuilder.js`) | ~2,250 lines, ~300 public methods | **Light.** No DOM, storage, network or rendering; pure logic over `data`. Needs `CW` (same file) and a few read-only helpers: `SortUtil.ascSortLower`, `Parser.sourceJsonToFull`, `Parser.sizeAbvToFull`, `Parser.LANGUAGES_*`, `Parser.SKILL_TO_ATB_ABV`, `SourceUtil.isClassicSource`, `SourceUtil.getFilterGroup`, `String#toTitleCase`. Covered by the test suite. |
| **UI** (`CharBuilderUi` in `js/charbuilder/cb-ui.js`, `css/charbuilder.css`) | ~2,800 lines JS + ~100 lines CSS | **Heavy.** Built on the 5etools UI kit: tagged-template element builder, ~1,100 uses of `ve-*` utility classes, 46 `cb__*` classes, ~180 inline `style=` attributes, **no CSS custom properties**, plus 5etools modals, toasts, hover links (`Renderer`), the dice roller and `StorageUtil`. It looks like 5etools because it *is* 5etools UI. |

Two more facts that matter:

- **Saves store choices, not results.** `toJson()` records picks (race, classes and levels,
  ability method, skills, spells, items, …). AC, HP, modifiers and features are recomputed from
  the data every load. Only the small `summary` (`name, level, race, classLabel, maxHp, ac,
  sizeAbv`) is precomputed. So anything that displays a saved character in full needs the engine
  and the data, or a new export that includes computed values (see Option B).
- **Rule coverage**: 2014 rules in depth (multiclassing, every granted-spell source, magic items
  with attunement, feats, sidekicks, play-mode resources and effects), with known gaps listed in
  CHARACTER-BUILDER.md. Switching the site to Modern style exposes 2024 content to the builder,
  but the builder was built and tested against 2014 rules.

## Option A: re-theme it in place

Keep the builder inside this 5etools fork and restyle it to match your site. Link to it, or
embed it.

- **Work**: CSS first: scope overrides under `#charbuilder-main` for the `ve-*` classes it uses,
  restyle the `cb__*` classes, and move the ~180 inline styles into classes (or override them
  with attribute selectors). Introducing CSS custom properties would make later re-theming cheap.
  Deeper visual changes (layout, components) mean editing the markup in `cb-ui.js`.
- **You keep**: everything working today, including data loading, rules, rolls, hover links, VTT
  import, upstream content updates through `local:sync`, and the test suite.
- **Costs**: it stays a 5etools page (site navbar, `main.css`, 5etools look underneath unless you
  override it). Your sheet site and this one are separate apps unless you serve them together.
  You stay on the 5etools UI kit, so you inherit its occasional API changes (handled in
  `js/fork-compat.js`, [UPKEEP.md](UPKEEP.md)).
- **Fits if** the builder itself is the product and a skin is enough.

## Option B: separate app that consumes the builder's characters

Your sheet is its own app (any stack). People build characters here, then your app reads them.

- **Transport**: the export file (`{"fileType": "charbuilder", "siteVersion": …, ...toJson()}`).
  Or, if both apps are served from the **same origin**, shared IndexedDB: localforage database
  `localforage`, store `keyvaluepairs`, keys `charbuilder_roster` and `charbuilder_current`.
  Different origins can't share storage; you'd need files, `postMessage`, or a small backend.
- **The catch**: because saves hold choices, not results, your app can't show AC, spell DCs,
  attacks or feature text from an export without the engine. The practical fix is a **computed
  export**. For example, add a `CharState.toSheetJson()` that writes out what the review sheet and
  play mode show (abilities and modifiers, saves, skills, AC breakdown, HP, speeds, attacks,
  spell lists with DC and attack bonus, features with their text, inventory with effects). The
  engine already computes all of it; this mostly gathers existing method results into one
  object. Then your app only reads JSON.
- **You keep**: a 5etools-free frontend, a clear contract between the two apps, and the builder
  syncing with upstream as-is.
- **Costs**: two apps; changes made in your sheet don't flow back unless you also write `toJson()`
  fields; feature text contains 5etools `{@tag ...}` markup (render it yourself or strip it).
- **Fits if** you want the builder as a back office and the sheet as the product.

## Option C: take the rules engine into your app

Use `CharState` as the brains of your app with your own UI.

- **Engine**: move `CharState`, `CW`, `SIDEKICK_META` and `EFFECT_DEFS` into their own module.
  Today `js/charbuilder.js` also runs the page boot code when imported, so it needs to be split.
  Then provide the helpers listed above, either with a small shim or by loading 5etools'
  `js/parser.js` + `js/utils.js`.
- **Data**, the hard part: the engine expects the loader-produced `data` object, not raw `data/`
  files. The realistic route is a **build-time bundle**: a script like the tests
  (`tools-local/tests/lib/harness.mjs`) loads `charbuilder.html`, then serializes
  `globalThis.dbg_cb` (rebuild the `Map` indexes on load). Re-run it after each upstream sync.
  About 20 MB, mostly items, so it's trimmable. Re-implementing the 5etools loaders yourself is
  far more work.
- **Then** build your UI on the engine's methods, and use `toJson()`/`fromJson()` as your save
  format (it migrates old versions already). Rendering feature/spell text needs a `{@tag}`
  renderer: 5etools' `Renderer`, or your own for the common tags.
- **You keep**: ~2,250 lines of tested rules logic, with full control of the UI. At runtime
  your app needs no 5etools code beyond the helpers.
- **Costs**: the most up-front work. You own engine changes and must re-run the bundle after
  content updates. The tests here exercise the engine through the 5etools page, so they keep
  working only if this fork stays the engine's home (or you port them).
- **Fits if** the sheet *is* your product and you want the builder logic without its UI.

**Hybrids are natural.** Start with A (use it as-is or lightly themed), add B's computed export
when your sheet needs real data, and move to C later if the sheet becomes the main app.

## At a glance

| | A: re-theme | B: consume exports | C: extract engine |
| --- | --- | --- | --- |
| Up-front work | Low to medium (CSS) | Medium (computed export + importer) | High (module split, data bundle, new UI) |
| Visual control | Partial (5etools UI underneath) | Full for the sheet | Full |
| Upstream content updates | Automatic via `local:sync` | Automatic in the builder; re-export | Re-run the data bundle |
| Breaks when 5etools changes its UI kit | Yes (fix in fork-compat) | Builder side only | No (engine has no UI deps) |
| Runs without the 5etools site | No | Sheet: yes | Yes (with bundle) |
| Tests | Existing suite | Existing + your importer | Port or keep engine here |

## Questions that decide it

1. **Public or private?** The code is MIT-licensed, but 5etools data is Wizards of the Coast
   content. Hosting the full data publicly (or shipping it in a bundle) is the same legal
   exposure the 5etools mirrors live with (they've been moved more than once). The **SRD** is
   openly licensed (CC-BY-4.0), and 5etools tags SRD entries with `srd: true` (5.1) or
   `srd52: true` (5.2). In the builder's 2014 data that's 12 classes, 319 spells, ~1,100 items
   and 28 races, but only 1 background and 1 feat. An SRD-only public build is possible but thin
   on backgrounds and feats. A private or friends-only site doesn't have this constraint in the
   same way.
2. **Which rules?** The builder targets 2014. If your sheet must handle 2024 characters too,
   expect engine work (backgrounds granting feats and abilities and species changes are partly
   handled, but untested as a full ruleset).
3. **What stack is your site?** C fits anything (the engine is plain JS). A means living inside
   5etools' page model.
4. **Do you need play mode?** The builder's play mode (HP, slots, rests, effects, rolls) overlaps
   a D&D Beyond-style interactive sheet. With A you get it as-is. With B or C you'd rebuild the
   UI but can reuse the engine's play-state methods (`applyDamage`, `longRest`, `castSpell`, …).
5. **Does the 5etools site stay?** If yes, A and B are cheap starts. If your site replaces it, C.
