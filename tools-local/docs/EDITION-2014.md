# 2014-only mode

This fork behaves like `2014.5e.tools`: by default only 5e (2014-era) content is shown, and the
2014 core books aren't marked "legacy". 2024 (5.5e / One D&D) content is still in `data/`.
It's hidden at runtime, so **switching Settings → Preferences → Style (Appearance group) to "Modern" brings it back**. The one
exception is two VTT pickers, the 🗺 Site Maps browser (`_flattenMaps`) and 📋 Encounter Tables
(`_openEncounterTables`) in `js/vtt.js`. They call `SourceUtil.isClassicSource` directly, so
they stay 2014-only in Modern style too.

## How it works

Upstream's Style setting (`SITE_STYLE__CLASSIC` = `"classic"`, `SITE_STYLE__ONE` = `"one"`) is
display-only by design; `2014.5e.tools` is a separate deployment, and this repo doesn't build
it. This fork instead couples content filtering to the Classic style with four small edits to
upstream files (each marked with a `fork:` comment):

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
   those three aren't "legacy", because their 2024 successors are hidden. VGM, MTF and EEPC stay
   legacy (superseded by MPMM/XGE, which are present). The 2014 DM Screen (`Screen`) also still
   shows as legacy even though its 2024 successor is hidden; add `Parser.SRC_SCREEN` to the set
   if that matters. This one function drives the `[ʟ]` marker, the legacy styling on book covers,
   the "Legacy" list filter, and omnisearch's hide-legacy toggle, which is on by default. Without
   this edit, PHB/DMG/MM results would vanish from search in Classic style. (Upstream's legacy
   *ranking* penalty only applies in Modern style, where this edit is inactive.)

**What counts as classic**: `SourceUtil.isClassicSource` is **date-based**, meaning published
before the 2024 PHB (`Parser.SRC_XPHB`, dated 2024-09-17). So XGE (2017), TCE (2020), FTD and all
2014-era books stay, as do early-2024 releases dated before the 2024 PHB (e.g. Vecna: Eve of
Ruin, Quests from the Infinite Staircase). Every source dated on or after 2024-09-17 is hidden,
including new adventures (for example v2.38.0's "Project Lamordia", dated 2026-10-13). Never
hardcode a source list; new upstream sources classify themselves by date.

## Changing it

- **Per browser**: Settings → Preferences → Style (Appearance group) → Modern, then reload (shows 2024 content, with 2014 marked legacy).
- **Make Modern the default again**: revert edit 1. With edit 2 in place, Modern style simply
  doesn't filter.
- **Remove the feature**: revert all four edits (search for `fork:` in those files), and change
  the two VTT filters mentioned at the top (`_flattenMaps`, `_openEncounterTables`) if those
  should show 2024 content too.

## Verifying

`npm run local:test -- site-edition` checks that a fresh visitor gets Classic, and that Classic
hides every non-classic source while six spot-checked 2014-era books (PHB, DMG, MM, XGE, TCE,
MPMM) stay visible. It also checks that the PHB isn't legacy, VGM still is, and Modern un-hides
the 2024 sources and makes the PHB legacy again.
