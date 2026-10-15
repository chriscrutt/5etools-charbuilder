# Testing

The fork's tests drive the real site in a headless browser (Chrome, Edge, Chromium or Brave) with
`puppeteer-core`. Nothing is mocked: each test loads the page from the local server, pokes the
app through its debug hooks, and checks numbers and rendered text.

```bash
npm run local:test                    # the pass/fail suite (~2 min). Run after every sync and every change.
npm run local:test -- --all           # + probes and audits
npm run local:test -- vtt- play-      # only tests whose id contains "vtt-" or "play-"
npm run local:test -- --list          # list without running
npm run local:test -- --jobs 3        # parallelism (default 2)
npm run local:test -- --verbose       # stream output (one at a time)
```

The runner (`tools-local/tests/run.mjs`):
- installs `tools-local/tests/node_modules` on first use (a separate package, so upstream's
  lockfile never conflicts with it);
- starts the site server (`http-server`, no caching) if `http://localhost:5050` isn't up, and
  the VTT relay (port 5055) if a selected test needs it; it stops whatever it started;
- writes each test's output to `tools-local/tests/.out/logs/<group>-<name>.log` and prints the
  tail of every failure;
- exits non-zero if anything failed.

**Pass rules.** Suite tests must exit 0, print `FAILURES: none` (or `0`), and report
`page errors: none`. Probes and audits only need to exit 0 without page errors, because their
JSON output is for reading.

**Environment.** `CHROME_PATH` picks the browser (otherwise the first installed one is used),
and `FORK_TEST_BASE` points at another server. On Linux, profiles go under
`tools-local/tests/.out/profiles` (snap Chromium can't see the host's `/tmp`). Any test can run
alone with `node tools-local/tests/suite/<name>.mjs` while the server is running.

## Layout

```
tools-local/tests/
  run.mjs            runner
  lib/harness.mjs    launchBrowser(), BASE, paths; finds the browser, connects over CDP, cleans up
  suite/             pass/fail tests (the gate)
  probes/            feature probes: build a scenario, print the derived values as JSON
  audits/            sweep ALL content of a kind and list what the builder can't parse
  tools/             diag.mjs (why is this page broken?), screens.mjs (screenshot sweep), bench.mjs (load timing)
```

## What the suite covers

| Test | Checks |
| --- | --- |
| `builder-regression` | The big one. Every class at L1/5/11/20, every subclass, race, background and feat, multiclass combos, sidekicks, and serialization round-trips: builds each and renders every step plus play mode, and fails on NaN, `undefined`, `[object Object]`, raw `{@tags}` or exceptions. About 800 builds and 2,300 renders. |
| `builder-rules-values` | Exact derived numbers: proficiency, slots, spell DC/attack, unarmored AC variants, attacks, multiclass caster slots, pact magic. |
| `builder-spell-lists` | Class spell lists include supplement spells (the `DataUtil.spell` loading rule). |
| `builder-weapon-damage` | Magic weapon bonuses and extra-damage riders. |
| `builder-attunement-cleanup` | Attunement follows the inventory; stale ids don't block attuning. |
| `builder-save-button`, `builder-roster` | Saving to My Characters: no duplicates, ids, summaries with numeric AC/HP. |
| `play-flow` | Click-through of play mode: HP, death saves, hit dice, rests, conditions, casting. |
| `play-effects`, `play-exhaustion` | Buff/debuff engine (Rage, Mage Armor, Bless, Haste…) and exhaustion levels. |
| `play-spell-rolls`, `play-turn-options` | Spell attack/save/damage buttons with scaling; the "On Your Turn" reference. |
| `sidekick-*` | Creature pool (CR ≤ ½ + unknown CR), class features, equipment, play mode. |
| `site-edition-2014` | 2014-only mode ([EDITION-2014.md](EDITION-2014.md)). |
| `site-media` | `img/` exists and images are served locally. |
| `vtt-*` | Stat-block window, encounter builder/generator/tables, character import, handouts, multiplayer (relay). |

Probes (21) cover attunement, background bonuses, class change, class features, defenses, feats,
fighting styles, height/weight, magic items, multiclass, play mode, race proficiencies, sidekick
feats, granted spells, the Sources filter, subclass spells, validation, weapon attacks and worn
items. Audits sweep races, backgrounds, feats and gear for data shapes the engine doesn't handle.
Run the audits after a big content release.

## Writing a test

Copy the shape of an existing suite test:

```js
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);   // serve:fast caches for a year
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});   // style applies on load
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(() => {
	const ui = dbg_charBuilderPage._ui; const st = ui._state;
	st.reset(); st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}];
	return {attacks: st.numAttacks()};
});
const F = []; const chk = (label, ok) => { if (!ok) F.push(label); };
chk("Fighter 5 has Extra Attack", r.attacks === 2);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
```

Debug hooks: `dbg_charBuilderPage` (`._ui`, `._ui._state`), `dbg_cb` (data), `dbg_vtt`, `VttNet`
([CHARACTER-BUILDER.md](CHARACTER-BUILDER.md), [VTT.md](VTT.md)). Each `launchBrowser()` gets a
throwaway profile, so `localStorage`/IndexedDB start empty; tests that need saved data create it.

## History: old names

The tests originally lived outside the repo (`../5etools-bench/`), and old commit messages and
notes refer to them by those names:

| Old | New | Old | New |
| --- | --- | --- | --- |
| regression | suite/builder-regression | sbtest | suite/vtt-statblock |
| deepcheck | suite/builder-rules-values | enctest | suite/vtt-encounter-builder |
| spelllist | suite/builder-spell-lists | gentest | suite/vtt-encounter-generator |
| weapons | suite/builder-weapon-damage | tabletest | suite/vtt-encounter-tables |
| invfix | suite/builder-attunement-cleanup | hotest | suite/vtt-handouts |
| donetest | suite/builder-save-button | mptest | suite/vtt-multiplayer |
| rostertest | suite/builder-roster | importfix | suite/vtt-character-import |
| playflow | suite/play-flow | edition, edition2 | suite/site-edition-2014 |
| effects | suite/play-effects | shot | suite/site-media |
| exhaust | suite/play-exhaustion | attunetest | probes/attunement |
| spellroll | suite/play-spell-rolls | magictest | probes/magic-items |
| turnopt | suite/play-turn-options | mctest | probes/multiclass |
| sidekickfeat | suite/sidekick-features | weapontest / worntest | probes/weapon-attacks / worn-items |
| skcr / skequip / skplay | suite/sidekick-creature-pool / -equipment / -play | spellgrant / featspells | probes/granted-spells / feat-spells |
| raceaudit / bgaudit / feataudit / gearaudit | audits/races / backgrounds / feats / gear | playtest | probes/play-mode |

Not carried over: `sidekick.mjs` (tested the first sidekick design, since replaced), and the
one-off perf experiments `swbench.mjs`/`profile.mjs`.
