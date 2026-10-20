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
                                 renders everything; most changes: mutate state → render() → _save()
```

- **Boot** (`CharBuilderPage.pInit`, bottom of `js/charbuilder.js`): initialises prerelease/
  homebrew and the blocklist, loads all data in parallel, builds indexes, restores the autosave,
  constructs the UI, then dispatches the `toolsLoaded` event.
- **Rendering** is mostly immediate-mode: `CharBuilderUi.render()` empties the root and rebuilds
  the current view (the step, review sheet, play mode, sidekick builder, or Sources panel), with no
  virtual DOM. Most handlers mutate `this._state`, then call `render()` and `_save()`. The
  exceptions update their own bit of DOM in place and call only `_save()`:
  - the chip pickers (`_renderChipPicker`): skill, expertise, tool, language and weapon picks,
    racial ability "choose N", feat choices, granted-spell picks and fighting styles;
  - the list choosers without an `onAfterSelect` (race, background, sidekick creature);
  - the class spell picker (`_renderSpellPicker`) and the inventory list (`_renderInvList`);
  - the starting-equipment radios and the name field.

  Anything else that depends on those choices refreshes only on the next full `render()`. For
  example, the Expertise picker doesn't update after a class-skill pick.
- **Persistence**: `_save()` calls `fnSave` (page-scoped autosave) and debounces a shared
  snapshot for the VTT (`_pUpdateCurrentSnapshot`).

### The `data` object

Built once in `pInit`. Races, backgrounds, feats, classes, subclasses, spells, items, optional
features and the bestiary are all filtered through `ExcludeUtil.isExcluded`, so the site
blocklist, **the 2014-only mode and the "Forgotten Realms Canon Only" toggle**
([EDITION-2014.md](EDITION-2014.md)) apply before the builder sees them.

| Key | Contents / how it's loaded |
| --- | --- |
| `races`, `backgrounds`, `feats` | `DataLoader.pCacheAndGetAllSite/Prerelease/Brew`. Races and backgrounds are migrated for the current style via `UtilsEntityRace/UtilsEntityBackground.mutMigrateForVersion`. |
| `classData` | `DataUtil.class.loadJSON()` (returns `{class, subclass}`), reshaped by `_pLoadClasses()` into `{classes, sidekickClasses, subclasses}`. Its `classFeature`/`subclassFeature` keys are always empty arrays; features live inside each class and subclass, **already dereferenced and grouped by level**. `cls.classFeatures[level-1]` is the level-N group, but `sc.subclassFeatures` is compact (one group per level that has features), so use each feature's `.level` there. In raw 5etools data every subclass feature after the first is wrapped in an unnamed `{type: "entries", level, entries: [feature]}`; `_pLoadClasses` unwraps these so every item is a named feature. Before that fix (Oct 2026) the builder silently dropped all of them. Spell slots are in `classTableGroups[*].rowsSpellProgression`. The three `isSidekick` TCE classes are split out into `sidekickClasses`. |
| `spells` | `DataUtil.spell.loadJSON()` (plus prerelease/homebrew via `DataLoader`). The spell files carry no class lists; the loader merges them in from `data/generated/gendata-spell-source-lookup.json` (`DataLoader`'s site path uses the same loader). Supplement spells (e.g. XGE's Chaos Bolt for Sorcerer) arrive as *variant* entries on `spell.classes.fromClassListVariant`, not `fromClassList`, so **every class-list check must read both** (`CharState._spellClassNames` / `_spellInClass`). If that regresses, a Wild Magic Sorcerer's list (Classic mode) drops from about 224 spells to about 142 and loses Chaos Bolt (test: `builder-spell-lists`). |
| `items`, `armors`, `itemIndex`, `itemIndexByName` | `DataUtil.item.loadJSON()`. `armors` = all armor and shields, including magic ones, with no name de-duplication so worn gear resolves by exact uid. |
| `spellIndexByName` | First spell per lower-cased name. |
| `optionalFeatures`, `fightingStyles` | `data/optionalfeatures.json`; fighting styles are the `FS:*` feature types. |
| `bestiary` | Creatures eligible to be sidekicks: CR ≤ ½ **or unknown CR** (unknown shows as "CR ?"). |
| `styleHint` | The site style at load (`"classic"` or `"one"`). |

**UIDs**: most entity references in state are `"<name>|<source>"` (`CW.uid(ent)`), for example
`"Wizard|PHB"` or `"Elf (High)|PHB"`. That covers race, background, classes and subclasses, feats,
class spell picks (`spellChoices`), `mysticArcanum`, fighting styles, armor, shield, attuned and
inventory items, and the sidekick's creature, class and spells. **Exceptions**: `raceSpellChoices`,
`subclassSpellChoices`, `bgSpellChoices` and a feat choice's `featSpellChoose` store bare spell
names, resolved with `_spellByName()` (the first spell of that name). `profChoices` and the feat
proficiency picks (`featToolChoose`, `featLangChoose`, `featWeaponChoose`) store plain option names.

## CharState: the rules engine

`export class CharState` (about 2,250 lines). Construct it with the `data` object. State is plain
fields (listed in `toJson()`), and everything else is derived on demand. About 300 public methods,
grouped roughly as follows:

- **Build identity**: `raceEnt`, `backgroundEnt`, `classList()`, `primaryClass`, `classEnt`, `subclassEnt`, `totalLevel`, `isMulticlassed()`, `subclassesForClass()`, `canMulticlassInto()`, `multiclassRequirement()`.
- **Abilities**: `finalAbility(abv)`, `abilityMod(abv)`, `pointBuySpent()`, `racialBonuses()`, `backgroundBonuses()`, `asiBonuses()`, `asiSlots()`; item set/bonus effects such as the Amulet of Health are folded in.
- **Proficiencies**: `saveProfs()`, `skillProfs()`, `skillProfType()` (`"none"`/`"half"`/`"full"`/`"expertise"`), `skillMod()`, `saveMod()`, `armorProficiencies()`, `weaponProficiencies()`, `fixedTools()`/`chosenTools()`, `languages()`, `proficiencyChoiceGroups()` (race/background language, skill and weapon "choose N" groups, tool choices and a secondary class's `proficienciesGained`, stored in `profChoices`; class skill picks use `classSkillChoiceMeta()` → `classSkillChoices`, and feat proficiency picks live on the feat's choice object as `featSkillChoose`/`featToolChoose`/…).
- **Combat**: `maxHp()`, `hitDiceString()`, `ac()` / `acBreakdown()`, `initiative()`, `speedString()`, `numAttacks()`, `weaponAttack(item)` (to-hit, damage, magic and fighting-style breakdown), `weaponExtraDamage()` (riders such as Flame Tongue, parsed from `{@damage}` tags in item text), `defenses()`, `senses()`, `passivePerception()`.
- **Items**: `addToInventory()`, `equippedItems()`, `equippedItemEffects()`, attunement (`attuneMax()`, `setAttuned()`). All magic effects are gated by attunement, so an unattuned item gives only its nonmagical benefits.
- **Feats**: `featsTaken()` (ASI, racial and background feats together). A background's `feats` array lists *alternatives*: one entry means its feats are granted (`backgroundFixedFeats()`), 2+ entries means pick one (`backgroundFeatAlternatives()` → stored in `bgFeat`, like an "any feat" pick, so the chosen feat keeps its own pickers). Skilled's pooled "any 3 skills or tools" (`skillToolLanguageProficiencies`) is stored as `featSkillToolChoose` (`skill:x`/`tool:x`/`lang:x`). Also `meetsFeatPrereq()`, and per-grant aggregators (`featArmorProfs`, `featSkillProfs`, `featResist`, …).
- **Spells**: `spellSources()` (each caster class, or caster subclass such as Eldritch Knight), `spellSlots()` (single class uses its own table; 2+ casters use the multiclass table `_MC_SLOTS`), `pactSlots()`, `spellListForSource()`, `spellSaveDcFor()`, `spellAtkBonusFor()`, plus every granted-spell source. The shared parser `_parseAdditionalSpellGroup` handles `additionalSpells` from race, subclass, background and feat. Item-granted spells come from the item's `attachedSpells` (`_flattenAttachedSpells()`, surfaced via `equippedItemEffects()`).
- **Validation**: `validationIssues()` → `[{step, severity, title, message}]`. It re-checks feat prerequisites, multiclass requirements and the level cap after edits that don't auto-clear choices.
- **Play mode** (runtime state in `this.play`): `playMaxHp()`, `applyDamage()` (temp HP first), `applyHealing()`, `setTempHp()`, slot and pact expend/restore, `shortRest()`, `longRest()`, `spendHitDie()`, `addCondition()`, `castSpell()`, `playSpellbook()`, `spellRollInfo()`, `turnOptions()`, and the effects engine (`activeEffects()`, `playAc()`, `playWalkSpeed()`, `playDamageRiders()`, `effectAdv()`, … driven by `EFFECT_DEFS`).
- **Sidekick mode** (`this.mode === "sidekick"`, state in `this.sidekick`): parallel `sidekick*` derivations and `sk*` play methods.

Its only outside dependencies are `CW`, the module constants `EFFECT_DEFS`, `SIDEKICK_META` and the
non-exported `SIDEKICK_SIZE_DIE` (all in `js/charbuilder.js`), and a handful of read-only 5etools helpers:
`SortUtil.ascSortLower`, `Parser.sourceJsonToFull`, `Parser.sizeAbvToFull`, `Parser.LANGUAGES_*`,
`Parser.SKILL_TO_ATB_ABV` (via `CW`), `SourceUtil.isClassicSource`, `SourceUtil.getFilterGroup`, and
`String.prototype.toTitleCase` (a 5etools extension). `SourceUtil.getFilterGroup` also expects the
`FilterItem` class (from `js/filter.js`) to exist. This matters if you want to reuse the engine
elsewhere ([INTEGRATION-OPTIONS.md](INTEGRATION-OPTIONS.md)).

### Rules worth knowing (implemented, tested)

- **HP**: max hit die at the 1st *character* level only, average (rounded up) after that, plus Con
  mod per level and feature/feat bonuses (Tough, Dwarven Toughness, Draconic Resilience).
- **Multiclassing**: saves and class skill choices come from the first class only. Each later
  class adds `multiclassing.proficienciesGained` (skills, tools, armor). ASI slots are keyed
  `"<classUid>@<classLevel>"`. Spells are chosen per spell source in `spellChoices[sourceUid]`: the class uid, or the subclass
  uid for a subclass caster (an Eldritch Knight's picks are under `"Eldritch Knight|PHB"`). Warlock
  Pact Magic is separate (`pactSlots()`, parsed from the class table columns).
- **AC**: armor-aware, covering unarmored defense (Barbarian/Monk/Draconic), shields, natural
  armor, magic `bonusAc`, Bracers only when unarmored, Defense fighting style, and proficiency
  warnings. Prepared-spell counts evaluate the class formula (`_evalPreparedFormula`).
- **Feature text parsing**: several bonuses only exist as prose in the data (Fast Movement,
  Aura of Protection, "attune to up to N items", Extra Attack counts, advantage notes). The
  engine parses them heuristically. Subclass sub-features are often **nested inside a wrapper
  feature** (for example "Knowledge Domain" wraps "Blessings of Knowledge"), so match them by
  scanning `JSON.stringify(feature.entries)`, not `feature.name`.
- **`additionalSpells` keys**: `"_"` means "always, no level gate"; numeric keys gate by level:
  character level for race, background and feat grants, and that class's level for subclass grants
  (e.g. domain spells by Cleric level). Multiple groups in a race's `additionalSpells` are *alternatives* (pick one,
  `raceSpellGroup`), not cumulative.
- **Sidekicks (TCE)**: built from a creature stat block. HP = stat-block average + (hit-die
  average + Con) per level after 1st, with the die taken from the stat block's formula. Proficiency
  bonus rises with level, so `sidekickAdjustEntries()` bumps every `{@dc}` in the stat block by
  `sidekickPbDelta()` and every `{@hit}` by `sidekickAttackBonus()` (the PB increase, plus +2 for the
  Warrior's Attacker role). Warrior/Expert/Spellcaster class features
  (Martial Role, Improved Critical, Extra Attack, Second Wind, Indomitable, spell roles) are
  modeled. The full rules text is in `data/variantrules.json` (`Sidekicks|TCE`).

### Known simplifications

- Optional-feature pickers that don't change sheet numbers are not modeled (Eldritch
  Invocations, Metamagic, Artificer Infusions, Pact Boon).
- Most conditional subclass resistances aren't applied. The text-based advantage parser skips any
  sentence that mentions advantage on initiative, so it misses other advantages in the same sentence
  (e.g. the Sentinel Shield's Perception advantage).
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
- **Race list** (`_renderStepRace` → `_renderChooser` with a `group` config): the ~300 race entries collapse into
  base-race groups. Subraces sit under a header, and 5etools' generated *versions* (a choice baked in:
  Dragonborn colors, half-elf variant features, Aasimar revelations; `_versionBase_*`) fold behind a
  "▸ N" toggle on their parent. Standalone reprints join their family by following `reprintedAs`
  back to the original ("Elf (Eladrin)|MTF" → "Eladrin|MPMM" goes under Elf; "Gnome (Deep)" → "Deep
  Gnome" under Gnome), or by name when there's no predecessor ("Astral Elf" → Elf). Search auto-expands matches, the selection's group opens by itself,
  and a "Hide older printings" checkbox there flips `st.hideLegacy`.
- **Background list** uses the same grouping. Backgrounds have no base/variant fields, so
  `_renderStepBackground` groups by naming convention: "Variant Criminal (Spy)" and "Baldur's Gate
  Criminal" go under Criminal, and "X (Sailor)" goes under Sailor when Sailor exists. The sidekick
  creature list stays flat.
- **Toolbar**: Character/Sidekick toggle, Sources panel, Play/Edit Build, autosave status,
  Export, Import, Print, My Characters (roster).
- **Play mode** (`_renderPlayMode`): HP bar with damage/heal/temp, death saves, hit dice, short and
  long rests, spell-slot pips, a spellbook with cast/attack/damage buttons (cantrips scale by
  character level, `totalLevel`, or a sidekick's level; Chaos Bolt gets a damage-type roll), concentration with a Con-save prompt,
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
raceResistChoice, sizeChoice, classSkillChoices, expertiseChoices, profChoices, equipmentChoices,
spellChoices{sourceUid:{cantrips,leveled}}, race/subclass/background spell choices,
raceSpellAbility, raceSpellGroup, mysticArcanum{spellLevel:"name|source"},
asiChoices{"classUid@level": …}, raceFeat, bgFeat, fightingStyles, armorUid, shieldUid,
attunedUids, inventory[{uid,name,qty,equipped,choiceCategory?}], play{…}, mode ("pc"|"sidekick"),
sidekick{…}, hiddenSources, hideLegacy`. `fromJson()` migrates v1 saves
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
neutral", which hides other settings (`_NON_FR_SOURCES`). "Hide legacy" (also the "Hide older printings" checkbox on the race step) is edition-aware. It reads each reprint's source with `CharState._reprintSource()`, which knows subclass uids are `shortName|className|classSource|source`, not `name|source`: it hides
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
