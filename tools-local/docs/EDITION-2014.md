# 2014-only mode

This fork behaves like `2014.5e.tools`: by default only 5e (2014-era) content is shown, and the
2014 core books aren't marked "legacy". 2024 (5.5e / One D&D) content is still in `data/`.
It's hidden at runtime, so **switching Settings → Style to "Modern" brings it all back**.

## How it works

Upstream's Style setting (`SITE_STYLE__CLASSIC` = `"classic"`, `SITE_STYLE__ONE` = `"one"`) is
display-only by design. `2014.5e.tools` is a separate deployment that also strips 2024 data. This
fork instead couples content filtering to the Classic style with four small edits to upstream
files (each marked with a `fork:` comment):

1. **Default style** (`js/utils-config/utils-config-registry.js`): the style switcher's
   `default` is `SITE_STYLE__CLASSIC` instead of `SITE_STYLE__ONE`.
2. **Hide non-classic sources everywhere** (`js/utils.js`, `ExcludeUtil`): `isExcluded()` starts
   with `if (ExcludeUtil._isEditionHidden(source)) return true;`. `_isEditionHidden` returns
   true when the style is Classic and `SourceUtil.isClassicSource(source)` is false. Every list
   page, the Character Builder's loaders and the VTT's bestiary go through `isExcluded`, so this
   one hook covers them. Results are cached (`_cache_isClassicOnly`, `_cache_classicBySource`);
   a style change needs a reload anyway.
3. **Search** (`js/omnisearch/omnisearch-backing.js`): omnisearch only runs the blocklist when
   it's non-empty, so it gets its own filter for non-classic sources in Classic style.
4. **No legacy badge on the 2014 core books** (`js/utils.js` `SourceUtil.isLegacySourceWotc`,
   `js/parser.js` `Parser.SOURCES_LEGACY_SUPERSEDED_BY_ODND = {PHB, DMG, MM}`): in Classic style
   those three aren't "legacy", because their 2024 successors are hidden. VGM, MTF and the like
   stay legacy (superseded by MPMM/XGE, which are present). This one function drives the `[ʟ]`
   marker, book covers, filters and search ranking.

**What counts as classic**: `SourceUtil.isClassicSource` is **date-based**, meaning published
before the 2024 PHB (`Parser.SRC_XPHB`). So XGE (2017), TCE (2020), FTD and all 2014-era books
stay, and every 2024-or-later source is hidden, including new adventures (for example
v2.38.0's "Project Lamordia", dated 2026-10-13). Never hardcode a source list; new upstream
sources classify themselves by date.

## Changing it

- **Per browser**: Settings → Style → Modern (shows 2024 content, with 2014 marked legacy).
- **Make Modern the default again**: revert edit 1. With edit 2 in place, Modern style simply
  doesn't filter.
- **Remove the feature**: revert all four edits (search for `fork:` in those files).

## Verifying

`npm run local:test -- site-edition` checks that a fresh visitor gets Classic, Classic hides
every non-classic source but no 2014-era book, the PHB isn't legacy, VGM still is, and Modern
reverses all of it.
