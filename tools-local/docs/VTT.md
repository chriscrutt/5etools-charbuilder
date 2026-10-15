# Tabletop (VTT)

A free, self-hosted virtual tabletop built into the fork, a lightweight alternative to
Foundry/Roll20 for running games over a local network. Page: `vtt.html` (nav: Dungeon Master →
Tabletop (VTT)). All fork code.

## Files

| File | What it is |
| --- | --- |
| `vtt.html` | The page; loads the stock 5etools scripts (incl. `utils-dataloader.js` and `utils-brew.js`, which the loaders need) plus `js/fork-compat.js`, `js/vtt-net.js`, `js/vtt.js`. Renders into `#vtt-root`. |
| `js/vtt.js` | `class VttBoard`, one classic (non-module) script, plain DOM. Uses 5etools globals (`Renderer`, `DataLoader`, `DataUtil`, `StorageUtil`, `JqueryUtil`). Exposes `globalThis.dbg_vtt`. |
| `js/vtt-net.js` | `globalThis.VttNet`: the multiplayer client (`host()`, `join(code)`, `pushScene()`, `ping()`, `sendHandout()`). |
| `css/vtt.css` | Board, tokens, panels, stat-block window. |
| `tools-local/vtt-server.mjs` | **Zero-dependency** WebSocket relay (raw RFC 6455 over `node:http`/`crypto`). `npm run vtt`, port 5055 (`VTT_PORT` to change). |

## Scene model

`board._scene` is a single JSON object, auto-saved to `localStorage["vtt_scene_v1"]` and
exportable/importable as a file:

```
{ map: {src, w, h},
  grid: {cell, feet, show, snap, color, offsetX, offsetY},
  view: {x, y, scale},
  tokens: [{id, x, y, ft, name, color, img, hp, maxHp, temp, ac, init, conditions[], locked,
            square, monUid?, isPc?, charId?}],
  turn: {order, ix, round},
  aoes: [...], drawings: [...], fog: {on, base, cells} }
```

- **Tokens are sized in real feet** (`ft`: Tiny 2.5 … Gargantuan 20) and converted to pixels
  using the grid's feet-per-square, so a Medium creature covers one 5-ft square, or a quarter of
  a square on a 20-ft travel map.
- **Rendering**: a CSS-transformed `.vtt-world` (pan/zoom) holding the map image, a `<canvas>`
  grid, an SVG layer for templates/ruler/pings, DOM tokens, and a fog canvas.
- **Undo**: JSON snapshots (`_pushUndo`/`_doUndo`, Ctrl+Z, 50 deep).

## Features

- **Board**: maps from a URL, a site image path or a local file; fit map; grid with snap and
  offsets; a "📐 Align grid to map" tool (drag across N×M printed squares and it computes cell
  size, offset and feet). Ruler (5e diagonal = Chebyshev), freehand drawing, double-click pings,
  fog of war (brush reveal/hide; the DM sees through dimly and players see it opaque), and AoE
  templates (circle, cone, line, cube) with real-foot geometry.
- **Site maps**: "🗺 Site Maps" browses `data/generated/gendata-maps.json` (about 1,800 maps from
  about 100 books, 2014-only) and loads the images from local `img/`. Maps with a printed square
  grid auto-match the VTT grid to it.
- **Combat**: initiative tracker (roll all, prev/next, rounds), quick damage/heal (temp HP first),
  bloodied and dead states, 18 conditions as token markers, duplicate/lock/z-order, and a
  right-click context menu.
- **Monsters**: "Add Monster" lazy-loads the bestiary (`DataLoader.pCacheAndGetAllSite`, so the
  2014-only filter applies). A token gets art (`Renderer.monster.getTokenUrl`), HP (average or
  rolled), size and initiative, and `monUid = "name|source"`.
- **Stat blocks**: right-click a token → "📖 Stat block" opens a draggable window rendered with
  `Renderer.monster.getCompactRenderedString`; its dice are clickable.
- **Encounter Builder**: party levels plus monsters, live XP / multiplier / difficulty (2014 DMG
  thresholds, `_XP_THRESH`, `_ENC_MULTS`). It includes a random generator (difficulty and
  environment; excludes named creatures) and published encounter tables from `data/tables.json`,
  which can be rolled.
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
Players: http://<dm-lan-ip>:5050/vtt.html   → Join with the 4-letter room code
         (or open the invite link: vtt.html#room=CODE)
```

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
