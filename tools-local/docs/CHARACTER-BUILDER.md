# Character Builder

The fork's main addition: a step-by-step D&D 5e (2014) character creator with leveling 1-20,
multiclassing, a play mode for running the character at the table, Tasha's sidekicks, and a
saved roster shared with the Tabletop (VTT). Page: `charbuilder.html` (nav: Player → Character
Builder). It is entirely fork code; upstream 5etools has nothing like it.

It was originally called "Character Wizard". Files, classes and CSS were renamed to
`charbuilder` / `CharBuilder*` / `cb__`. Old saves and exports still load (see
[Storage](#storage-and-save-format)). The D&D *class* "Wizard" is unrelated.

## Files

| File | What it is |
| --- | --- |
| `charbuilder.html` | The page. Modeled on upstream `statgen.html`; loads the stock 5etools scripts plus `js/fork-compat.js` and `js/charbuilder.js`. Renders into `#charbuilder-main`. |
| `js/charbuilder.js` | ES module. Exports `CW` (constants + small helpers), `SIDEKICK_META`, `EFFECT_DEFS`, and `CharState` (the rules engine). Also contains `CharBuilderPage` (data loading + boot), which runs on import. |
| `js/charbuilder/cb-ui.js` | ES module. `CharBuilderUi`: every step, the review sheet, play mode, sidekick screens, the Sources panel and the My Characters roster. Imports `CW`, `SIDEKICK_META`, `EFFECT_DEFS` from `../charbuilder.js`. |
| `css/charbuilder.css` | ~100 lines of `cb__*` component styles. Most styling comes from upstream's `css/main.css` (`ve-*` utility classes). |
| `js/fork-compat.js` | Shim that keeps the old 5etools element-helper API working for this page and the VTT (see [UPKEEP.md](UPKEEP.md)). |

## Architecture: three layers

```
CharBuilderPage.pInit()          loads every dataset → one `data` object (globalThis.dbg_cb)
        │
        ▼
CharState(data)                  rules engine: plain state fields + derived-stat methods.
        │                        No DOM, no storage, no rendering. Pure logic over `data`.
        ▼
CharBuilderUi({data, state, eleRoot, fnSave})
                                 renders everything; on any change: mutate state → render() → _save()
```

- **Boot** (`CharBuilderPage.pInit`, bottom of `js/charbuilder.js`): initialises prerelease/
  homebrew and the blocklist, loads all data in parallel, builds indexes, restores the autosave,
  constructs the UI, then dispatches the `toolsLoaded` event.
- **Rendering** is immediate-mode: `CharBuilderUi.render()` empties the root and rebuilds the
  current view (the step, review sheet, play mode, sidekick builder, or Sources panel). There's no
  virtual DOM and no partial updates. Event handlers mutate `this._state`, then call `render()`
  and `_save()`.
- **Persistence**: `_save()` calls `fnSave` (page-scoped autosave) and debounces a shared
  snapshot for the VTT (`_pUpdateCurrentSnapshot`).

### The `data` object

Built once in `pInit`. Everything is already filtered through `ExcludeUtil.isExcluded`, so the
site blocklist **and the 2014-only mode** ([EDITION-2014.md](EDITION-2014.md)) apply before the
builder sees anything.

| Key | Contents / how it's loaded |
| --- | --- |
| `races`, `backgrounds`, `feats` | `DataLoader.pCacheAndGetAllSite/Prerelease/Brew`. Races and backgrounds are migrated for the current style via `UtilsEntityRace/UtilsEntityBackground.mutMigrateForVersion`. |
| `classData` | `DataUtil.class.loadJSON()` → `{classes, sidekickClasses, subclasses, classFeature, subclassFeature}`. Class/subclass features arrive **already dereferenced and grouped by level** (`cls.classFeatures[level-1]`). Spell slots are in `classTableGroups[*].rowsSpellProgression`. The three `isSidekick` TCE classes are split out into `sidekickClasses`. |
| `spells` | **Must** come from `DataUtil.spell.loadJSON()`. Only that path merges class membership from `data/generated/gendata-spell-source-lookup.json`, and supplement spells (e.g. XGE's Chaos Bolt for Sorcerer) live there as *variant* entries on `spell.classes.fromClassListVariant`, not `fromClassList`. If this regresses, a Wild Magic Sorcerer's list drops from about 383 spells to about 157 PHB-only ones (test: `builder-spell-lists`). |
| `items`, `armors`, `itemIndex`, `itemIndexByName` | `DataUtil.item.loadJSON()`. `armors` = all armor and shields, including magic ones, with no name de-duplication so worn gear resolves by exact uid. |
| `spellIndexByName` | First spell per lower-cased name. |
| `optionalFeatures`, `fightingStyles` | `data/optionalfeatures.json`; fighting styles are the `FS:*` feature types. |
| `bestiary` | Creatures eligible to be sidekicks: CR ≤ ½ **or unknown CR** (unknown shows as "CR ?"). |
| `styleHint` | The site style at load (`"classic"` or `"one"`). |

**UIDs**: every entity reference in state is `"<name>|<source>"` (`CW.uid(ent)`), for example
`"Wizard|PHB"` or `"Elf (High)|PHB"`.

## CharState: the rules engine

`export class CharState` (about 2,250 lines). Construct it with the `data` object. State is plain
fields (listed in `toJson()`), and everything else is derived on demand. About 300 public methods,
grouped roughly as follows:

- **Build identity**: `raceEnt`, `backgroundEnt`, `classList()`, `primaryClass`, `classEnt`, `subclassEnt`, `totalLevel`, `isMulticlassed()`, `subclassesForClass()`, `canMulticlassInto()`, `multiclassRequirement()`.
- **Abilities**: `finalAbility(abv)`, `abilityMod(abv)`, `pointBuySpent()`, `racialBonuses()`, `backgroundBonuses()`, `asiBonuses()`, `asiSlots()`; item set/bonus effects such as the Amulet of Health are folded in.
- **Proficiencies**: `saveProfs()`, `skillProfs()`, `skillProfType()` (none/half/prof/expertise), `skillMod()`, `saveMod()`, `armorProficiencies()`, `weaponProficiencies()`, `fixedTools()`/`chosenTools()`, `languages()`, `proficiencyChoiceGroups()` (drives every "choose N" picker).
- **Combat**: `maxHp()`, `hitDiceString()`, `ac()` / `acBreakdown()`, `initiative()`, `speedString()`, `numAttacks()`, `weaponAttack(item)` (to-hit, damage, magic and fighting-style breakdown), `weaponExtraDamage()` (riders such as Flame Tongue, parsed from `{@damage}` tags in item text), `defenses()`, `senses()`, `passivePerception()`.
- **Items**: `addToInventory()`, `equippedItems()`, `equippedItemEffects()`, attunement (`attuneMax()`, `setAttuned()`). All magic effects are gated by attunement, so an unattuned item gives only its nonmagical benefits.
- **Feats**: `featsTaken()` (ASI, racial and background feats together), `meetsFeatPrereq()`, and per-grant aggregators (`featArmorProfs`, `featSkillProfs`, `featResist`, …).
- **Spells**: `spellSources()` (each caster class, or caster subclass such as Eldritch Knight), `spellSlots()` (single class uses its own table; 2+ casters use the multiclass table `_MC_SLOTS`), `pactSlots()`, `spellListForSource()`, `spellSaveDcFor()`, `spellAtkBonusFor()`, plus every granted-spell source. The shared parser `_parseAdditionalSpellGroup` handles `additionalSpells` from race, subclass, background, feat and item.
- **Validation**: `validationIssues()` → `[{step, severity, title, message}]`. It re-checks feat prerequisites, multiclass requirements and the level cap after edits that don't auto-clear choices.
- **Play mode** (runtime state in `this.play`): `playMaxHp()`, `applyDamage()` (temp HP first), `applyHealing()`, `setTempHp()`, slot and pact expend/restore, `shortRest()`, `longRest()`, `spendHitDie()`, `addCondition()`, `castSpell()`, `playSpellbook()`, `spellRollInfo()`, `turnOptions()`, and the effects engine (`activeEffects()`, `playAc()`, `playWalkSpeed()`, `playDamageRiders()`, `effectAdv()`, … driven by `EFFECT_DEFS`).
- **Sidekick mode** (`this.mode === "sidekick"`, state in `this.sidekick`): parallel `sidekick*` derivations and `sk*` play methods.

Its only outside dependencies are `CW` and a handful of read-only 5etools helpers:
`SortUtil.ascSortLower`, `Parser.sourceJsonToFull`, `Parser.sizeAbvToFull`, `Parser.LANGUAGES_*`,
`Parser.SKILL_TO_ATB_ABV` (via `CW`), `SourceUtil.isClassicSource`, `SourceUtil.getFilterGroup`, and
`String.prototype.toTitleCase` (a 5etools extension). This matters if you want to reuse the engine
elsewhere ([INTEGRATION-OPTIONS.md](INTEGRATION-OPTIONS.md)).

### Rules worth knowing (implemented, tested)

- **HP**: max hit die at the 1st *character* level only, average (rounded up) after that, plus Con
  mod per level and feature/feat bonuses (Tough, Dwarven Toughness, Draconic Resilience).
- **Multiclassing**: saves and class skill choices come from the first class only. Each later
  class adds `multiclassing.proficienciesGained` (skills, tools, armor). ASI slots are keyed
  `"<classUid>@<classLevel>"`. Spells are chosen per class in `spellChoices[classUid]`. Warlock
  Pact Magic is separate (`pactSlots()`, parsed from the class table columns).
- **AC**: armor-aware, covering unarmored defense (Barbarian/Monk/Draconic), shields, natural
  armor, magic `bonusAc`, Bracers only when unarmored, Defense fighting style, and proficiency
  warnings. Prepared-spell counts evaluate the class formula (`_evalPreparedFormula`).
- **Feature text parsing**: several bonuses only exist as prose in the data (Fast Movement,
  Aura of Protection, "attune to up to N items", Extra Attack counts, advantage notes). The
  engine parses them heuristically. Subclass sub-features are often **nested inside a wrapper
  feature** (for example "Knowledge Domain" wraps "Blessings of Knowledge"), so match them by
  scanning `JSON.stringify(feature.entries)`, not `feature.name`.
- **`additionalSpells` keys**: `"_"` means "always, no level gate"; numeric keys gate by
  character level. Multiple groups in a race's `additionalSpells` are *alternatives* (pick one,
  `raceSpellGroup`), not cumulative.
- **Sidekicks (TCE)**: built from a creature stat block. HP = stat-block average + (hit-die
  average + Con) per level after 1st, with the die taken from the stat block's formula. Proficiency
  bonus rises with level, so every `{@hit}`/`{@dc}` in the stat block is bumped by
  `sidekickPbDelta()` via `sidekickAdjustEntries()`. Warrior/Expert/Spellcaster class features
  (Martial Role, Improved Critical, Extra Attack, Second Wind, Indomitable, spell roles) are
  modeled. The full rules text is in `data/variantrules.json` (`Sidekicks|TCE`).

### Known simplifications

- Optional-feature pickers that don't change sheet numbers are not modeled (Eldritch
  Invocations, Metamagic, Artificer Infusions, Pact Boon).
- Most conditional subclass resistances aren't applied. The text-based advantage parser misses
  combined sentences (e.g. Sentinel's Perception advantage).
- Sidekick buffs/debuffs are tracked by name only; the effects engine applies to the PC.
- "On Your Turn" action-economy is a heuristic scan of feature text (bonus action / reaction
  wording), and the UI says to double-check it.
- Weapon riders know the extra dice but not *when* they apply (e.g. "vs undead"), so they get
  their own roll button with a note.

## CharBuilderUi: the interface

- **PC steps** (`_steps()`): Race (or Species, depending on edition) → Class → Background →
  Abilities (with ASI/feats merged in) → Skills & Gear → Spells (casters, or races that grant
  spells) → Review. Steps with `validationIssues()` show an amber ⚠ and an issues banner. The step
  index is `ui._ixStep`.
- **Toolbar**: Character/Sidekick toggle, Sources panel, Play/Edit Build, autosave status,
  Export, Import, Print, My Characters (roster).
- **Play mode** (`_renderPlayMode`): HP bar with damage/heal/temp, death saves, hit dice, short and
  long rests, spell-slot pips, a spellbook with cast/attack/damage buttons (cantrips scale by
  caster level, and Chaos Bolt gets a damage-type roll), concentration with a Con-save prompt,
  conditions, exhaustion (2014 cumulative rules), buff/debuff chips (Bless, Rage, Haste, … with
  real mechanical effects from `EFFECT_DEFS`), click-to-roll abilities/saves/skills/initiative,
  attacks with riders, and an "On Your Turn" reference.
- **Rolls** go through the site's own dice roller, `Renderer.dice.pRollEntry({toRoll}, {name, label})`,
  so results appear in 5etools' roll box. Advantage uses `2d20kh1`.
- **Links**: spells, items and features render as 5etools hover links via `Renderer`. Clicks open
  in a new tab so the builder isn't navigated away.
- **Markup**: built with 5etools' tagged-template helper (`ee\`...\`` / `veT`) and the fluent element
  API (`.onn()`, `.appendTo()`, `.empty()`, `.val()`; see fork-compat). Styling is about 1,100
  `ve-*` utility-class uses, 46 `cb__*` component classes and about 180 inline `style=` attributes.
  There are no CSS custom properties yet, which matters for theming
  ([INTEGRATION-OPTIONS.md](INTEGRATION-OPTIONS.md)).
- **Toasts** (`JqueryUtil.doToast`) render string content as a text node, so keep them plain text.
- **Review tables** must be built in one `ee` pass. A `<tr>` built separately has its `<td>`s stripped.

## Storage and save format

All storage goes through 5etools' `StorageUtil`, which uses localforage (IndexedDB, database
`localforage`, store `keyvaluepairs`) on the site's origin.

| Key | Scope | Contents |
| --- | --- | --- |
| `charbuilder_state_charbuilder.html` | page (`pSetForPage("charbuilder_state")`) | The live autosave: `state.toJson()`. Falls back to the old `charwizard_state_charwizard.html`. |
| `charbuilder_roster` | shared | My Characters: `[{id, savedAt, json, summary}]`. |
| `charbuilder_current` | shared | Snapshot of the current build for the VTT: `{summary, rosterId, savedAt}`. Removed when the build is empty. |

`summary` (from `_rosterSummary()`) is a denormalized `{name, level, race, classLabel, maxHp, ac, sizeAbv}`,
so other pages can show a character without loading the rules engine.

**`toJson()` (version `_v: 2`)** is the complete character: `name, classes[{uid, level, subclassUid}],
raceUid, backgroundUid, abilityMethod, abilitiesBase, race/background ability choices,
classSkillChoices, expertiseChoices, profChoices, equipmentChoices, spellChoices{classUid:{cantrips,leveled}},
race/subclass/background spell choices, asiChoices{"classUid@level": …}, raceFeat, bgFeat,
fightingStyles, armorUid, shieldUid, attunedUids, inventory[{uid,name,qty,equipped}], play{…},
mode ("pc"|"sidekick"), sidekick{…}, hiddenSources, hideLegacy`. `fromJson()` migrates v1 saves
(single class, numeric ASI keys, flat spell choices, boolean shield, old sidekick spell ability).
**It stores choices, not results.** Derived numbers (AC, HP, modifiers) are recomputed from the
data on load. That keeps saves small, but anything reading a save needs the rules engine and the
same data to get numbers (or it can use `summary`).

**Export file**: `DataUtil.userDownload(name, state.toJson(), {fileType: "charbuilder"})` writes
`{"fileType": "charbuilder", "siteVersion": "2.38.0", ...toJson()}`. Import accepts
`charbuilder` and the legacy `charwizard` file types.

## Content Sources filter

A builder-level filter (toolbar → Sources), separate from the site-wide blocklist:
`hiddenSources[]` and `hideLegacy` in state, applied to every chooser via `isVisible()` /
`filterVisible()`. There are presets for Show all, Official only, and "Forgotten Realms +
neutral", which hides other settings (`_NON_FR_SOURCES`). "Hide legacy" is edition-aware: it hides
things reprinted into another 2014-era book (VGM → MPMM) and the wholly superseded VGM/MTF/EEPC,
but keeps PHB content. `allSources()` must include `data.bestiary` or monster-only sources never
reach the sidekick picker's filter.

## Debug hooks (used by every test)

- `globalThis.dbg_charBuilderPage`: the page controller; `._ui` is the `CharBuilderUi` and
  `._ui._state` is the `CharState`.
- `globalThis.dbg_cb`: the `data` object.

A test typically sets Classic style, reloads, waits for `dbg_charBuilderPage?._ui?._state`,
then drives state directly and checks derived values or rendered text:

```js
const st = dbg_charBuilderPage._ui._state;
st.reset(); st.abilityMethod = "manual";
st.abilitiesBase = {str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10};
st.raceUid = "Elf (High)|PHB";
st.classes = [{uid: "Wizard|PHB", level: 5, subclassUid: null}];
st.spellSlots();                  // {1: 4, 2: 3, 3: 2}
dbg_charBuilderPage._ui.render(); // then inspect #charbuilder-main
```

See [TESTING.md](TESTING.md) for which test covers which feature.
