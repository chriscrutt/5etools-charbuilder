# 5etools + Character Builder + Tabletop

A self-hosted fork of [5etools](https://github.com/5etools-mirror-3/5etools-src) that stays in
sync with upstream and adds:

- **Character Builder** (`charbuilder.html`): step-by-step 5e character creation with leveling
  1-20, multiclassing, feats, spells from every source, gear, and magic items with attunement.
  It has a **play mode** for running the character at the table (HP, slots, rests, conditions,
  buffs, one-click rolls), **Tasha's sidekicks**, and a **My Characters** roster.
- **Tabletop (VTT)** (`vtt.html`): maps (including the 2014-era books' own maps), grid, tokens with
  monster art and stat blocks, initiative, fog of war, AoE templates, an encounter builder and
  generator, handouts, and LAN multiplayer through a zero-dependency relay. Characters from the
  builder import as tokens.
- **2014-only mode**: Classic style by default, which hides everything released from the 2024 PHB
  onward, site-wide. Switch Settings → Preferences → Style to Modern to bring it back. A
  **Forgotten Realms Canon Only** toggle in the Settings menu narrows it further to official
  WotC books that are setting-neutral or set in the Realms.
- **Upkeep tooling**: `npm run local:sync` pulls new 5etools releases (site and images), and
  `npm run local:test` runs a browser test suite over the builder, VTT and edition mode.

## Quick start

```bash
git clone <this repo or your fork> 5etools && cd 5etools
git remote add upstream https://github.com/5etools-mirror-3/5etools-src.git
git clone --depth 1 https://github.com/5etools-mirror-3/5etools-img.git img   # images, ~13 GB on disk
npm install
npm run serve:fast          # http://localhost:5050/charbuilder.html
npm run local:test          # check everything works
```

Needs Node 24+, and Chrome, Edge or Chromium for the tests. Details: [SETUP](/tools-local/docs/SETUP.md).

## Keeping it updated

```bash
npm run local:sync          # merge the latest 5etools release + update images
npm run local:test
```

How it works and what to do when something breaks: [UPKEEP](/tools-local/docs/UPKEEP.md).

## Docs

Using Claude Code? [`CLAUDE.md`](/CLAUDE.md) loads automatically and points at all of these.

| | |
| --- | --- |
| [SETUP](/tools-local/docs/SETUP.md) | Install, run, troubleshoot |
| [UPKEEP](/tools-local/docs/UPKEEP.md) | Syncing with upstream: routine, conflicts, the compatibility shim, history |
| [CHARACTER-BUILDER](/tools-local/docs/CHARACTER-BUILDER.md) | Architecture, rules engine, save format, play mode, sidekicks |
| [VTT](/tools-local/docs/VTT.md) | Tabletop architecture, scene model, multiplayer |
| [EDITION-2014](/tools-local/docs/EDITION-2014.md) | How 2014-only mode works and how to change it |
| [TESTING](/tools-local/docs/TESTING.md) | Running and writing tests |
| [INTEGRATION-OPTIONS](/tools-local/docs/INTEGRATION-OPTIONS.md) | Using the builder in another site: re-theme, consume exports, or extract the engine |
| [LOCAL-HOSTING](/tools-local/LOCAL-HOSTING.md) | Serving and caching notes, benchmarks |

## Credits and licensing

Built on 5etools by TheGiddyLimit and contributors. Upstream's own README is
[README.md](/README.md). The code is MIT-licensed ([LICENSE.md](/LICENSE.md)). The game
content in `data/` and the images are Wizards of the Coast material. This fork is for personal
use, so think before hosting it publicly
([INTEGRATION-OPTIONS](/tools-local/docs/INTEGRATION-OPTIONS.md#questions-that-decide-it)).
