# Tabletop (VTT)

A free, self-hosted virtual tabletop built into the fork, a lightweight alternative to
Foundry/Roll20 for running games over a local network. Page: `vtt.html` (nav: Dungeon Master →
Tabletop (VTT)). All fork code.

## Files

| File | What it is |
| --- | --- |
| `vtt.html` | The page; loads the stock 5etools scripts (incl. `utils-dataloader.js` and `utils-brew.js`, which the loaders need) plus `js/fork-compat.js`, `js/vtt-net.js`, `js/vtt.js`. Renders into `#vtt-root`. |
| `js/vtt.js` | `class VttBoard`, one classic (non-module) script, plain DOM. Uses 5etools globals (`Renderer`, `DataLoader`, `DataUtil`, `StorageUtil`, `JqueryUtil`). Exposes `globalThis.dbg_vtt`. |
| `js/vtt-net.js` | `globalThis.VttNet`: the multiplayer client (`host(board, cb)`, `join(board, code, cb)`, `leave()`, `pushScene(scene)`, `ping(x, y)`, `sendHandout(h)`). |
| `css/vtt.css` | Board, tokens, panels, stat-block window. |
| `tools-local/vtt-server.mjs` | **Zero-dependency** WebSocket relay (raw RFC 6455 over `node:http`/`crypto`). `npm run vtt`, port 5055 (`VTT_PORT` to change). |

## Scene model

`board._scene` is a single JSON object, auto-saved to `localStorage["vtt_scene_v1"]` and
exportable/importable as a file. Auto-save is **best effort**: `_save` swallows errors, and
localStorage holds only about 5 million characters per origin. A map loaded from a local file is
embedded as a base64 data URL, so an image over roughly 3.5 MB makes every later save fail
silently, and a reload restores the last scene that fit. Library → Save copies the whole scene,
fails the same way and still says "Saved". Prefer site maps or image URLs, and Export scenes you
care about.

```
{ map: {src, w, h},
  grid: {cell, feet, show, snap, color, offsetX, offsetY},
  view: {x, y, scale},
  tokens: [{id, x, y, ft, name, color, img, hp, maxHp, temp, init, conditions[], locked,
            square, ac?, monUid?, isPc?, charId?}],
  turn: {order, ix, round},
  aoes: [...], drawings: [...], fog: {on, base, cells} }
```

- **Tokens are sized in real feet** (`ft`: Tiny 2.5 … Gargantuan 20) and converted to pixels
  using the grid's feet-per-square, so a Medium creature covers one 5-ft square, but is only a
  quarter of a square wide (1/16 of its area) on a 20-ft travel map.
- **Rendering**: a CSS-transformed `.vtt-world` (pan/zoom) holding, bottom to top: the map image,
  a `<canvas>` grid, an SVG layer for AoE templates (`.vtt-aoe`), a `<canvas>` for freehand
  drawing (`.vtt-draw`), DOM tokens (in `.vtt-tokens`), a fog `<canvas>`, and an SVG overlay
  (`.vtt-overlay`) for the ruler, pings and align box. Each token has an inline `z-index` (10+,
  for bring-to-front), so **`.vtt-tokens` must keep `z-index: 0`** (`css/vtt.css`). That gives it
  its own stacking context; without it tokens paint above the fog (it once let players see
  every token through fog; test: `vtt-fog`). The overlay is cleared on every ruler move, so
  don't put persistent shapes there.
- `ac` is set only on PC tokens made by Import Character. Monster tokens get none, and the
  Selected Token panel has no AC field.
- **Undo**: JSON snapshots (`_pushUndo`/`_doUndo`, Ctrl+Z, 50 deep).

## Features

- **Board**: maps from a URL, a site image path or a local file; fit map; grid with snap and
  offsets; a "📐 Align grid to map" tool (drag a box across a whole number of the map's printed
  squares, type the count such as `4x3`, and it computes cell size and offset, then asks for
  feet per square). Ruler (5e diagonal = Chebyshev), freehand drawing, double-click pings,
  fog of war (brush reveal/hide; the DM sees through dimly and players see it opaque), and AoE
  templates (circle, cone, line, cube) with real-foot geometry.
- **Site maps**: "🗺 Site Maps" browses `data/generated/gendata-maps.json` and loads the images
  from local `img/`. It's **always** 2014-only, because `_flattenMaps` filters with
  `SourceUtil.isClassicSource` directly, even in Modern style (it also honors the Forgotten Realms
  Canon Only toggle). Maps with a printed square grid
  auto-match the VTT grid to it.
- **Combat**: initiative tracker (roll all, prev/next, rounds), quick damage/heal (temp HP first),
  bloodied and dead states, 18 conditions as token markers, duplicate/lock/z-order, and a
  right-click context menu.
- **Monsters**: "Add Monster" lazy-loads the bestiary with `DataLoader.pCacheAndGetAllSite`
  (which returns *everything*), then `_loadBestiary` drops each creature that
  `ExcludeUtil.isExcluded` rejects. That explicit filter is what applies the 2014-only mode and the
  user's blocklist, so copy it if you load data elsewhere. A token gets art
  (`Renderer.monster.getTokenUrl`), HP (average or rolled), size and initiative, and
  `monUid = "name|source"`.
- **Stat blocks**: right-click a token → "📖 Stat block" opens a draggable window rendered with
  `Renderer.monster.getCompactRenderedString`; its dice are clickable.
- **Encounter Builder**: party levels plus monsters, live XP / multiplier / difficulty per the
  2014 DMG (`_XP_THRESH`, `_ENC_MULTS`, `_encMultiplier`; parties under 3 use the next multiplier
  up and parties of 6+ the next one down, so the range is ×0.5 to ×5). One cell differs from
  upstream's own encounter-builder table: level 18 Medium is 4,200 here (matching the DMG) and
  4,100 in upstream's `encounterbuilder-consts-classic.js`. It includes a random generator
  (difficulty and environment; excludes named creatures).
- **Encounter tables**: a separate "📋 Encounter Tables" picker rolls on published
  random-encounter tables (about 100 tables from about 15 books). They come from
  `data/generated/gendata-tables.json`; `data/tables.json` is also loaded but contributes
  essentially nothing. The picker is always 2014-only (`SourceUtil.isClassicSource` directly; it also honors the Forgotten
  Realms Canon Only toggle), and
  a rolled row's creatures can be sent to the Encounter Builder.
- **Import Character**: reads the Character Builder's shared storage (`charbuilder_current` first,
  then the `charbuilder_roster` entries) and makes a PC token from the entry's `summary` (name,
  max HP, AC, size). The VTT never loads the rules engine. Running a PC's attacks and spells
  stays in the builder's play mode.
- **Library and handouts**: saved encounters (`vtt_encounters_v1`), token presets
  (`vtt_tokenlib_v1`), encounter-builder state (`vtt_encbuilder_v1`), and handouts
  (`vtt_handouts_v1`, title/text/image) that the DM can push to players.
- **Dice tray**: d4–d100 and freeform rolls through `Renderer.dice`.

## Multiplayer

```
DM:      npm run serve:fast   (site, port 5050, listens on all interfaces)
         npm run vtt          (relay, port 5055; prints the LAN URL)
Players: http://<dm-lan-ip>:5050/vtt.html   → Join with the 4-character room code
         (letters and digits 2-9; I, O, 0 and 1 are never used)
         or open the invite link: vtt.html#room=CODE
```

"Copy invite link" uses the DM page's own address, so the **DM should also open the VTT at
`http://<dm-lan-ip>:5050/vtt.html`**, not `localhost`, before hosting. Otherwise the shared link
points at each player's own machine. But browser storage is per origin: a scene, Library,
handouts or Character Builder characters saved at `http://localhost:5050` aren't visible at the
LAN address. Prep at the LAN address from the start, or carry things over before hosting
(Scene → Export/Import for the scene, which doesn't push to the room by itself; the builder's
Export/Import for characters). Alternatively, stay on `localhost` and send players the LAN URL
that `npm run vtt` prints, plus the room code.

- `VttNet` connects to `ws://<page hostname>:5055` (override the port with `?vttport=`).
- Model: **trust-based, last-write-wins full-scene sync** among friends on a LAN. The relay keeps
  the latest scene per room and forwards scene updates, pings and handouts. There are no accounts
  and no authority checks. Images loaded from local files travel as data URLs, so they're heavy;
  prefer site maps.
- Roles: the host is `"dm"` and sees through fog; joiners are `"player"`. Remote updates are
  deferred while you're mid-drag so tokens aren't pulled out from under the cursor.
- Hooks in `vtt.js`: `_netPush()` / `_netPushThrottled()` after edits; `applyRemoteScene(scene)` to
  apply incoming state.

## Debug hooks

`globalThis.dbg_vtt` is the `VttBoard`. Tests call `_addToken`, `_addMonsterToken`, `_loadBestiary`,
`_openStatblock`, `_openEncounterBuilder`, `_generateEncounter`, `_openCharacterImport`, `_roll`,
`_netPush`, and so on. `VttNet.host(board, cb)` starts a room. See [TESTING.md](TESTING.md):
`vtt-*` tests; the multiplayer ones need the relay, which the runner starts for you.
