import {VetoolsConfig} from "./utils-config/utils-config-config.js";
import {UtilsEntityBackground} from "./utils/utils-entity-background.js";
import {UtilsEntityRace} from "./utils/utils-entity-race.js";
import {CharBuilderUi} from "./charbuilder/cb-ui.js";

/* -------------------------------------------------------------------------- */
/* Shared constants/helpers                                                   */
/* -------------------------------------------------------------------------- */

export const CW = {
	ABILITIES: ["str", "dex", "con", "int", "wis", "cha"],
	ABIL_FULL: {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"},
	ABIL_NAME_TO_ABV: {strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"},
	STANDARD_ARRAY: [15, 14, 13, 12, 10, 8],
	POINT_BUY_COST: {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9},
	POINT_BUY_BUDGET: 27,
	DMG_TYPE: {S: "slashing", P: "piercing", B: "bludgeoning"},
	WEAPON_PROP: {F: "finesse", V: "versatile", T: "thrown", L: "light", H: "heavy", "2H": "two-handed", A: "ammunition", R: "reach", LD: "loading", S: "special", RLD: "reload", BF: "burst fire", AF: "ammunition (firearm)"},

	mod (score) { return Math.floor((score - 10) / 2); },
	fmtMod (n) { return n >= 0 ? `+${n}` : `${n}`; },
	profBonus (level) { return 2 + Math.floor((level - 1) / 4); },

	// All skills -> governing ability (from Parser)
	skills () { return Object.keys(Parser.SKILL_TO_ATB_ABV); },
	skillAbil (skill) { return Parser.SKILL_TO_ATB_ABV[skill]; },
	skillName (skill) { return skill.toTitleCase(); },

	uid (ent) { return `${ent.name}|${ent.source}`; },

	// split a class starting-equipment line like "(a) X or (b) Y" into ["X", "Y"]
	splitEquipChoice (text) {
		if (!/\([a-d]\)/.test(text)) return [text];
		return text.split(/\s*\([a-d]\)\s*/).map(s => s.replace(/^\s*or\s+/i, "").replace(/,\s*$/, "").trim()).filter(Boolean);
	},
};

// Per-class metadata for Tasha's sidekick classes (the only 3, TCE) — drives the proficiency/expertise/spellcasting choices.
export const SIDEKICK_META = {
	"Expert Sidekick": {
		label: "Expert", die: null, saves: ["dex", "int", "cha"],
		skillCount: 5, skillFrom: null, // any skill
		expertiseAt: [3, 15], // +2 expertise skills at each
		toolsIfQualified: 2,
		armor: ["light"], simpleIfQualified: true, martialIfQualified: false, shieldsIfQualified: false,
	},
	"Warrior Sidekick": {
		label: "Warrior", saves: ["str", "dex", "con"],
		skillCount: 2, skillFrom: ["acrobatics", "animal handling", "athletics", "intimidation", "nature", "perception", "survival"],
		expertiseAt: [], toolsIfQualified: 0,
		armor: ["light", "medium", "heavy"], simpleIfQualified: true, martialIfQualified: true, shieldsIfQualified: true,
	},
	"Spellcaster Sidekick": {
		label: "Spellcaster", saves: ["wis", "int", "cha"],
		skillCount: 2, skillFrom: ["arcana", "history", "insight", "investigation", "medicine", "performance", "persuasion", "religion"],
		expertiseAt: [], toolsIfQualified: 0,
		armor: ["light"], simpleIfQualified: true, martialIfQualified: false, shieldsIfQualified: false,
		spellcaster: true, spellAbilities: ["int", "wis", "cha"],
	},
};
// HP per level above 1st is rolled from a Hit Die set by the creature's SIZE (Tasha's Sidekick Hit Dice table)
const SIDEKICK_SIZE_DIE = {T: 4, S: 6, M: 8, L: 10, H: 12, G: 20};

// Active-effect mechanical definitions (applied live in play mode). Effects not listed are tracked by name only.
// Fields: acBonus, acMin, acUnarmoredSet (Mage Armor), speedMul, speedBonus, maxHpBonus, extraAttacks,
//   resist:[], attackDice/saveDice ("+1d4"/"-1d4"), advAttack, advCheck:[abv], advSave:[abv], disSave:[abv],
//   dmgRider:{dice,type?,note?}, rageDamage (Barbarian, scales), reqClass, note.
export const EFFECT_DEFS = {
	"Rage": {reqClass: "Barbarian", resist: ["bludgeoning", "piercing", "slashing"], advCheck: ["str"], advSave: ["str"], rageDamage: true, note: "Resist bludgeoning/piercing/slashing; advantage on Strength checks & saves; +rage damage on Strength melee attacks; can't cast or concentrate."},
	"Reckless Attack": {reqClass: "Barbarian", advAttack: true, note: "Advantage on Strength-based melee attack rolls this turn (attacks against you also have advantage)."},
	"Mage Armor": {acUnarmoredSet: 13, note: "AC becomes 13 + Dex while you wear no armor."},
	"Shield of Faith": {acBonus: 2, note: "+2 AC (concentration)."},
	"Shield": {acBonus: 5, note: "+5 AC until the start of your next turn (reaction)."},
	"Barkskin": {acMin: 16, note: "Your AC can't be below 16 (concentration)."},
	"Haste": {acBonus: 2, speedMul: 2, extraAttacks: 1, advSave: ["dex"], note: "+2 AC, double speed, one extra action (one weapon attack), advantage on Dex saves (concentration)."},
	"Slow": {acBonus: -2, speedMul: 0.5, disSave: ["dex"], note: "-2 AC, half speed, -2 to Dex saves, one action OR bonus action per turn."},
	"Bless": {attackDice: "+1d4", saveDice: "+1d4", note: "+1d4 to attack rolls and saving throws (concentration)."},
	"Bane": {attackDice: "-1d4", saveDice: "-1d4", note: "-1d4 to attack rolls and saving throws (concentration)."},
	"Hunter's Mark": {dmgRider: {dice: "1d6", note: "vs marked target"}, note: "+1d6 damage to weapon attacks against the marked target (concentration)."},
	"Hex": {dmgRider: {dice: "1d6", type: "necrotic", note: "vs hexed target"}, disCheck: ["__hexAbility"], note: "+1d6 necrotic vs the hexed target; it has disadvantage on the chosen ability's checks (concentration)."},
	"Divine Favor": {dmgRider: {dice: "1d4", type: "radiant"}, note: "+1d4 radiant to weapon attacks (concentration)."},
	"Aid": {maxHpBonus: 5, note: "+5 hit point maximum (and current HP)."},
	"Longstrider": {speedBonus: 10, note: "+10 ft. speed (concentration)."},
	"Stoneskin": {resist: ["bludgeoning", "piercing", "slashing"], note: "Resistance to nonmagical bludgeoning, piercing & slashing (concentration)."},
	"Foresight": {advAttack: true, advCheck: ["str", "dex", "con", "int", "wis", "cha"], advSave: ["str", "dex", "con", "int", "wis", "cha"], note: "Advantage on all attacks, checks & saves; attacks against you have disadvantage (8 hours)."},
	"Enhance Ability": {note: "Advantage on ability checks with the chosen ability (concentration)."},
	"Heroism": {note: "Immune to frightened; temp HP equal to the caster's mod each turn (concentration)."},
	"Guidance": {note: "+1d4 to one ability check of your choice (concentration)."},
	"Resistance": {note: "+1d4 to one saving throw of your choice (concentration)."},
	"Faerie Fire": {note: "Attack rolls against affected creatures have advantage; they can't benefit from invisibility (concentration)."},
	"Enlarge/Reduce": {note: "Enlarged: advantage on Str checks/saves, +1d4 weapon damage. Reduced: the opposite."},
	"Spirit Guardians": {note: "Hostile creatures in the aura have halved speed and take radiant/necrotic on entering (concentration)."},
	"Sanctuary": {note: "Attackers must pass a Wis save or pick a new target (ends if you attack or cast offensively)."},
	"Death Ward": {note: "The first time you'd drop to 0 HP this casting, you drop to 1 instead."},
	"Freedom of Movement": {note: "Ignore difficult terrain; immune to magical grapple/restrain/paralyze of movement; escape nonmagical restraints for 5 ft."},
	"Mirror Image": {note: "Three duplicates may be hit instead of you (AC 10 + your Dex to 'hit' a duplicate)."},
	"Blur": {note: "Attack rolls against you have disadvantage unless the attacker ignores sight (concentration)."},
};

/* -------------------------------------------------------------------------- */
/* Character state + rules engine                                             */
/* -------------------------------------------------------------------------- */

export class CharState {
	constructor (data) {
		this._data = data;
		this.reset();
	}

	reset () {
		const keepHidden = this.hiddenSources; const keepLegacy = this.hideLegacy; // preserve the content filter across a character reset
		this.hiddenSources = keepHidden || []; // source codes the user has hidden from the builder
		this.hideLegacy = keepLegacy ?? false; // hide content superseded by a newer 2014-rules printing (VGM -> MPMM)
		this.name = "";
		this.raceUid = null;
		this.classes = [{uid: null, level: 1, subclassUid: null}]; // [0] is the primary class
		this.backgroundUid = null;
		this.abilityMethod = "pointbuy";
		this.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		this.raceAbilOption = 0; // which ability option (a/b/…) for multi-option races
		this.raceAbilChoices = []; // simple "choose N" ability picks
		this.raceAbilWeighted = []; // weighted assignment: ability per weight slot (e.g. ["str","dex"] for +2/+1)
		this.raceResistChoice = null; // chosen damage type when the race offers a resistance choice (e.g. Dragonborn)
		this.sizeChoice = null; // chosen size abv when the race offers Small or Medium
		this.bgAbilOption = 0; // which background ability option (a/b)
		this.bgAbilChoices = []; // background "choose N" ability picks
		this.bgAbilWeighted = []; // background weighted ability assignment
		this.bgFeat = {featUid: null, featAbilChoose: []}; // feat granted by some backgrounds (2024 origin feat, dragonmark, …)
		this.classSkillChoices = [];
		this.expertiseChoices = []; // skills with expertise (double proficiency)
		this.profChoices = {}; // choice-group key -> [chosen values] (languages, tools, race/bg skill choices)
		this.equipmentChoices = {}; // line index -> chosen option index
		this.spellChoices = {}; // classUid -> {cantrips:[], leveled:[]} (arrays of "name|source")
		this.mysticArcanum = {}; // spellLevel(6-9) -> "name|source" (Warlock Mystic Arcanum)
		this.raceSpellChoices = {}; // racial spell choice-group key -> [spell names]
		this.subclassSpellChoices = {}; // subclass bonus-spell choice-group key -> [spell names] (e.g. Lore Bard Additional Magical Secrets)
		this.bgSpellChoices = {}; // background spell choice-group key -> [spell names]
		this.raceSpellAbility = null; // chosen ability for racial spells (when the race offers a choice)
		this.raceSpellGroup = 0; // chosen additionalSpells variant index (when the race offers alternatives)
		this.asiChoices = {}; // slotKey "classUid@classLevel" -> {type:"asi", plan, inc:{abv:n}} | {type:"feat", featUid, featAbilChoose:[abv]}
		this.raceFeat = {featUid: null, featAbilChoose: []}; // level-1 feat granted by some races (Variant Human, Custom Lineage)
		this.fightingStyles = []; // chosen fighting-style uids "name|source" (Fighter/Paladin/Ranger/Bard)
		this.armorUid = null; // worn body-armor item "name|source" (drives AC)
		this.shieldUid = null; // equipped shield item "name|source" (may be magic)
		this.attunedUids = []; // items the character is attuned to (max 3)
		this.inventory = []; // [{uid:string|null, name, qty, equipped}]
		this.play = this._defaultPlayState(); // runtime "play mode" state (current HP, expended slots, …) — distinct from the build
		this.mode = "pc"; // "pc" = player character builder; "sidekick" = creature-first sidekick builder
		this.sidekick = this._defaultSidekick();
	}

	/* ----- sidekick (creature-first) builder state ----- */
	_defaultSidekick () {
		return {
			creatureUid: null, // bestiary creature "name|source" (CR ≤ 1/2)
			classUid: null, // sidekick class "Expert Sidekick|TCE" / "Warrior Sidekick|TCE" / "Spellcaster Sidekick|TCE"
			level: 1,
			saveProf: null, // chosen save-proficiency ability (from the class's 3 options)
			skillChoices: [], // class-granted skill proficiencies chosen
			expertiseChoices: [], // Expert expertise skills
			toolChoices: [], // Expert tool proficiencies (free text)
			asi: {}, // classLevel -> {inc:{abv:n}} ability-score improvements
			martialRole: null, // Warrior L1 Martial Role: "attacker" | "defender"
			spellRole: "mage", // Spellcaster L1 role: "mage" (Wizard/Int) | "healer" (Cleric+Druid/Wis) | "prodigy" (Bard+Warlock/Cha)
			sharpMindSave: null, // Expert L18 Sharp Mind: chosen int/wis/cha save proficiency
			empoweredSchool: null, // Spellcaster L14 Empowered Spells: chosen school
			spellChoices: {cantrips: [], leveled: []}, // Spellcaster chosen spells "name|source"
			name: "", // optional sidekick name (overrides the creature name)
			play: {...this._defaultPlayState(), featureUses: {}}, // runtime play-mode state for the sidekick (separate from the PC's this.play)
		};
	}
	// Tasha's Spellcaster sidekick roles -> spell list + ability
	static _SK_SPELL_ROLES = {
		mage: {label: "Mage", ability: "int", classes: ["Wizard"]},
		healer: {label: "Healer", ability: "wis", classes: ["Cleric", "Druid"]},
		prodigy: {label: "Prodigy", ability: "cha", classes: ["Bard", "Warlock"]},
	};

	/* ----- play mode: live runtime state, separate from the character build ----- */
	_defaultPlayState () {
		return {
			curHp: null, // null => treat as full (maxHp); a number tracks current HP
			tempHp: 0, // temporary hit points (absorbed first, don't stack — take the higher)
			expended: {}, // "spellLevel" -> # of slots expended
			pactExpended: 0, // warlock pact-magic slots expended (return on a short rest)
			arcanumUsed: {}, // mystic arcanum spell level (6-9) -> used this long rest
			hitDiceUsed: {}, // die faces -> # of Hit Dice spent
			deathSaves: {success: 0, fail: 0},
			exhaustion: 0, // 0-6; 1 disadv on checks, 2 speed halved, 3 disadv on attacks/saves, 4 HP max halved, 5 speed 0, 6 death
			conditions: [], // active condition names
			effects: [], // free-form buffs/debuffs the character currently has (Bless, Bardic Inspiration, …)
			concentration: null, // spell name being concentrated on (or null)
			inspiration: false,
			log: [], // recent roll results [{label, total, detail, ts}]
			notes: "",
		};
	}
	get play () { return this._play || (this._play = this._defaultPlayState()); }
	set play (v) { this._play = v || this._defaultPlayState(); }

	playMaxHp () { let mx = this.maxHp(); this.activeEffects().forEach(({def}) => { if (def.maxHpBonus) mx += def.maxHpBonus; }); if ((this.play.exhaustion || 0) >= 4) mx = Math.floor(mx / 2); return mx; } // + Aid etc., then exhaustion 4 halves
	playCurHp () { const mx = this.playMaxHp(); const c = this.play.curHp; return c == null ? mx : Math.max(0, Math.min(c, mx)); }
	playTempHp () { return Math.max(0, Math.floor(this.play.tempHp || 0)); }
	// damage hits temporary HP first, then current HP (floors at 0)
	applyDamage (n) {
		n = Math.max(0, Math.floor(n || 0)); if (!n) return;
		const temp = this.playTempHp();
		if (temp > 0) { const fromTemp = Math.min(temp, n); this.play.tempHp = temp - fromTemp; n -= fromTemp; }
		if (n > 0) this.play.curHp = Math.max(0, this.playCurHp() - n);
	}
	applyHealing (n) { n = Math.max(0, Math.floor(n || 0)); if (!n) return; const was = this.playCurHp(); this.play.curHp = Math.min(this.playMaxHp(), was + n); if (was === 0 && this.play.curHp > 0) this.play.deathSaves = {success: 0, fail: 0}; } // healing above 0 ends dying
	// temp HP doesn't stack — keep whichever is higher (RAW)
	setTempHp (n) { this.play.tempHp = Math.max(this.playTempHp(), Math.max(0, Math.floor(n || 0))); }
	clearTempHp () { this.play.tempHp = 0; }

	playSlotsTotal (lvl) { return (this.spellSlots() || {})[lvl] || 0; }
	playSlotsRemaining (lvl) { return Math.max(0, this.playSlotsTotal(lvl) - (this.play.expended[lvl] || 0)); }
	expendSlot (lvl) { const used = this.play.expended[lvl] || 0; if (used < this.playSlotsTotal(lvl)) this.play.expended[lvl] = used + 1; }
	restoreSlot (lvl) { const used = this.play.expended[lvl] || 0; if (used > 0) this.play.expended[lvl] = used - 1; }
	playPactTotal () { const p = this.pactSlots() || {}; const lvl = Object.keys(p)[0]; return lvl ? p[lvl] : 0; }
	playPactLevel () { const p = this.pactSlots() || {}; return +(Object.keys(p)[0] || 0); }
	playPactRemaining () { return Math.max(0, this.playPactTotal() - (this.play.pactExpended || 0)); }
	expendPact () { if ((this.play.pactExpended || 0) < this.playPactTotal()) this.play.pactExpended = (this.play.pactExpended || 0) + 1; }
	restorePact () { if ((this.play.pactExpended || 0) > 0) this.play.pactExpended -= 1; }

	pushRollLog (label, total, detail) {
		const log = this.play.log || (this.play.log = []);
		log.unshift({label, total, detail, ts: Date.now()});
		if (log.length > 14) log.length = 14;
	}

	/* ----- Hit Dice (spent to heal on a short rest) ----- */
	hitDicePool () { const out = {}; this.classList().forEach(({cls, level}) => { const f = cls?.hd?.faces; if (f) out[f] = (out[f] || 0) + level; }); return out; }
	hitDiceUsed (faces) { return this.play.hitDiceUsed?.[faces] || 0; }
	hitDiceRemaining (faces) { return Math.max(0, (this.hitDicePool()[faces] || 0) - this.hitDiceUsed(faces)); }
	spendHitDie (faces) { if (this.hitDiceRemaining(faces) <= 0) return; (this.play.hitDiceUsed = this.play.hitDiceUsed || {})[faces] = this.hitDiceUsed(faces) + 1; }
	restoreHitDie (faces) { const u = this.hitDiceUsed(faces); if (u > 0) this.play.hitDiceUsed[faces] = u - 1; }
	hitDiceTotal () { return Object.values(this.hitDicePool()).reduce((a, b) => a + b, 0); }

	/* ----- conditions ----- */
	addCondition (c) { const set = this.play.conditions || (this.play.conditions = []); if (c && !set.includes(c)) set.push(c); }
	removeCondition (c) { this.play.conditions = (this.play.conditions || []).filter(x => x !== c); }

	shortRest () { this.play.pactExpended = 0; } // pact slots return on a short rest (spend Hit Dice manually to heal)
	longRest () {
		this.play.curHp = this.playMaxHp();
		this.play.tempHp = 0;
		this.play.expended = {};
		this.play.pactExpended = 0;
		this.play.arcanumUsed = {};
		this.play.deathSaves = {success: 0, fail: 0};
		this.play.concentration = null;
		this.play.exhaustion = Math.max(0, (this.play.exhaustion || 0) - 1); // a long rest removes 1 level
		// regain spent Hit Dice up to half the total (min 1), greedily from the largest die
		let restore = Math.max(1, Math.floor(this.hitDiceTotal() / 2));
		const used = this.play.hitDiceUsed || {};
		Object.keys(used).map(Number).sort((a, b) => b - a).forEach(f => { const take = Math.min(used[f] || 0, restore); used[f] = (used[f] || 0) - take; restore -= take; });
		this.play.hitDiceUsed = used;
	}

	/* ----- play spellbook: the spells chosen on the build, for casting in play mode ----- */
	playSpellbook () {
		return this.spellSources().map(src => {
			const bucket = this.spellChoices[src.uid] || {cantrips: [], leveled: []};
			const cantrips = (bucket.cantrips || []).map(u => this._byUid(this._data.spells, u)).filter(Boolean);
			const lvlMap = new Map();
			(bucket.leveled || []).map(u => this._byUid(this._data.spells, u)).filter(Boolean).forEach(sp => lvlMap.set(`${sp.name}|${sp.source}`, sp));
			this.subclassPreparedSpells(src).forEach(p => { if (p.sp.level > 0) lvlMap.set(`${p.sp.name}|${p.sp.source}`, p.sp); });
			return {
				src,
				cantrips: cantrips.sort((a, b) => SortUtil.ascSortLower(a.name, b.name)),
				leveled: [...lvlMap.values()].sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)),
			};
		}).filter(s => s.cantrips.length || s.leveled.length);
	}
	// cast a leveled spell: expend the lowest available slot at or above its level. Returns the slot level used, or null.
	castSpell (sp) {
		for (let L = sp.level; L <= 9; ++L) { if (this.playSlotsRemaining(L) > 0) { this.expendSlot(L); return L; } }
		// fall back to a pact slot if it's high enough
		if (this.playPactRemaining() > 0 && this.playPactLevel() >= sp.level) { this.expendPact(); return this.playPactLevel(); }
		return null;
	}

	/* ----- play-mode spell rolls: attack bonus / save DC / damage dice (mirrors weaponAttack for spells) ----- */
	// PC: roll info for a spell cast from a given spell source
	spellRollInfo (sp, src) {
		return {
			atk: (sp.spellAttack && sp.spellAttack.length) ? this.spellAtkBonusFor(src) : null,
			save: (sp.savingThrow && sp.savingThrow.length) ? {abil: sp.savingThrow[0], dc: this.spellSaveDcFor(src)} : null,
			damage: this._spellDamageDice(sp, this.totalLevel),
			scaleNote: this._spellScaleNote(sp),
			typeTable: this.spellDamageTypeTable(sp),
		};
	}
	// Sidekick (Spellcaster): same, using the sidekick's attack/DC and caster level
	sidekickSpellRollInfo (sp) {
		return {
			atk: (sp.spellAttack && sp.spellAttack.length) ? this.sidekickSpellAtk() : null,
			save: (sp.savingThrow && sp.savingThrow.length) ? {abil: sp.savingThrow[0], dc: this.sidekickSpellSaveDc()} : null,
			damage: this._spellDamageDice(sp, this.sidekick?.level || 1),
			scaleNote: this._spellScaleNote(sp),
			typeTable: this.spellDamageTypeTable(sp),
		};
	}
	// a roll-determined damage-type table (Chaos Bolt's d8 → type) parsed from a spell's {@table} entry: {faces, map:{n:typeName}} or null
	spellDamageTypeTable (sp) {
		const tbl = (sp.entries || []).find(e => e && e.type === "table" && /damage type/i.test(JSON.stringify(e.colLabels || e.caption || "")));
		if (!tbl || !tbl.rows || !tbl.rows.length) return null;
		const dieM = JSON.stringify(tbl.colLabels || "").match(/d(\d+)/);
		const map = {};
		tbl.rows.forEach(r => {
			const roll = r[0] && r[0].roll; if (!roll) return;
			const type = `${r[r.length - 1]}`.replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?\}/g, "$1").trim(); // strip any {@tag …}
			if (roll.exact != null) map[roll.exact] = type;
			else if (roll.min != null) for (let i = roll.min; i <= (roll.max != null ? roll.max : roll.min); ++i) map[i] = type;
		});
		const keys = Object.keys(map).map(Number);
		if (!keys.length) return null;
		return {faces: dieM ? +dieM[1] : Math.max(...keys), map};
	}
	// base damage/heal dice for a spell — cantrips scale by caster level (scalingLevelDice); leveled spells use the base {@damage} tag
	_spellDamageDice (sp, casterLevel) {
		const entries = JSON.stringify(sp.entries || "");
		const dmgType = (sp.damageInflict && sp.damageInflict.length === 1) ? sp.damageInflict[0] : null; // a single fixed type (Chaos Bolt etc. have many → undefined)
		if (!sp.level && sp.scalingLevelDice) {
			const slds = Array.isArray(sp.scalingLevelDice) ? sp.scalingLevelDice : [sp.scalingLevelDice];
			return slds.map(s => {
				const ts = Object.keys(s.scaling || {}).map(Number).sort((a, b) => a - b);
				let dice = null; ts.forEach(t => { if (casterLevel >= t) dice = s.scaling[t]; });
				return dice ? {dice, type: dmgType || this._dmgTypeFromLabel(s.label), kind: "damage"} : null;
			}).filter(Boolean);
		}
		let m = entries.match(/\{@damage ([^}|]+)/);
		if (m) return [{dice: m[1].trim(), type: dmgType, kind: "damage"}];
		m = entries.match(/\{@dice ([^}|]+)/);
		if (m && /\bregain|heal|hit point/i.test(entries)) return [{dice: m[1].trim(), kind: "heal"}]; // healing (Cure Wounds etc.)
		return [];
	}
	_dmgTypeFromLabel (label) { const m = `${label || ""}`.match(/acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder/i); return m ? m[0].toLowerCase() : null; }
	// upcast scaling note parsed from "At Higher Levels" (e.g. Fireball "+1d6/slot above Lv 3")
	_spellScaleNote (sp) {
		if (!sp.level) return null;
		const txt = JSON.stringify(sp.entriesHigherLevel || "");
		const m = txt.match(/\{@scale(?:damage|dice) [^}|]+\|[^}|]+\|([^}|]+)/);
		return m ? `+${m[1].trim()}/slot above Lv ${sp.level}` : null;
	}

	/* ----- action economy: what you can do on your turn ----- */
	_spellCastCategory (sp) { const u = sp?.time?.[0]?.unit; return u === "action" ? "action" : u === "bonus" ? "bonus" : u === "reaction" ? "reaction" : "other"; }
	// features that grant a bonus action / reaction (heuristic scan; "action" is omitted as Attack/Cast-a-Spell already cover it)
	_featureActionKinds (name, entries) {
		// skip "choose one of many options" wrapper features — their text aggregates options that mention reaction/bonus action (false positives), and the chosen option isn't tracked here
		if (/^(Fighting Style|Eldritch Invocations?|Metamagic|Maneuvers|Combat Superiority|Pact Boon|Pact Magic|Artificer Infusions?|Infuse Item|Channel Divinity|Mystic Arcanum|Martial Role)$/i.test(`${name || ""}`.trim())) return [];
		const t = JSON.stringify(entries || "").toLowerCase(); const out = [];
		if (/\bbonus action\b/.test(t)) out.push("bonus");
		if (/\breaction\b/.test(t)) out.push("reaction");
		return out;
	}
	// {action, bonus, reaction} lists of {name?|spell?|feature?} for the PC's turn
	turnOptions () {
		const out = {action: [], bonus: [], reaction: []};
		const n = this.playNumAttacks();
		out.action.push({action: "Attack", suffix: n > 1 ? ` (${n} attacks)` : ""});
		if (this.isCaster() || this.hasRacialSpells()) out.action.push({action: "Cast a Spell"});
		if (this.featuresHaveName(/^Action Surge$/)) out.action.push({name: "Action Surge — one extra action (short rest)", emph: true});
		out.reaction.push({action: "Opportunity Attack"});
		// spells by casting time
		const seenSp = new Set();
		(this.playSpellbook() || []).forEach(({cantrips, leveled}) => [...cantrips, ...leveled].forEach(sp => {
			const cat = this._spellCastCategory(sp); if (cat !== "bonus" && cat !== "reaction") return;
			const k = `${cat}|${sp.name}`; if (seenSp.has(k)) return; seenSp.add(k); out[cat].push({spell: sp});
		}));
		// features
		const seenF = {bonus: new Set(), reaction: new Set()};
		this._turnFeatures().forEach(f => this._featureActionKinds(f.name, f.entries).forEach(kind => { if (!seenF[kind].has(f.name)) { seenF[kind].add(f.name); out[kind].push({feature: f}); } }));
		return out;
	}
	featuresHaveName (re) { return this.featureSections().some(s => s.items.some(f => re.test(f.name))); }
	// {@classFeature}/{@subclassFeature} hover-link tags for a feature, or null if it can't be built
	_classFeatureTag (f, lvl) { if (!f?.className || !f.classSource) return null; const src = (f.source && f.source !== f.classSource) ? `|${f.source}` : ""; return `{@classFeature ${f.name}|${f.className}|${f.classSource}|${lvl}${src}}`; }
	_subclassFeatureTag (f, sc, lvl) { const sn = f.subclassShortName || sc?.shortName; const ss = f.subclassSource || sc?.source; if (!f?.className || !f.classSource || !sn || !ss) return null; return `{@subclassFeature ${f.name}|${f.className}|${f.classSource}|${sn}|${ss}|${lvl}}`; }
	_turnFeatures () {
		const out = [];
		this.classList().forEach(({cls, level, subclassEnt: sc}) => {
			(cls.classFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => { if (f?.name && !f.isClassFeatureVariant && (f.level || (ix + 1)) <= level) out.push({name: f.name, entries: f.entries, ref: this._classFeatureTag(f, f.level || (ix + 1))}); }));
			(sc?.subclassFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => { if (f?.name && (f.level || (ix + 1)) <= level) out.push({name: f.name, entries: f.entries, ref: this._subclassFeatureTag(f, sc, f.level || (ix + 1))}); }));
		});
		this.featsTaken().forEach(ft => { const f = this._data.feats.find(x => CW.uid(x) === ft.featUid); if (f) out.push({name: f.name, entries: f.entries, feat: f}); });
		return out;
	}

	/* ----- active effects (Rage, Mage Armor, Bless, Haste, …) applied live in PC play mode ----- */
	effectDef (name) { return EFFECT_DEFS[name] || null; }
	activeEffects () { return (this.play.effects || []).map(name => { const def = EFFECT_DEFS[name]; return def && (!def.reqClass || this.hasClass(def.reqClass)) ? {name, def} : null; }).filter(Boolean); }
	_rageDamage () { const lv = this.classList().find(c => c.cls.name === "Barbarian")?.level || 0; return lv >= 16 ? 4 : lv >= 9 ? 3 : 2; }
	_walkSpeed () { const sp = this.raceEnt?.speed; const base = sp == null ? 30 : (typeof sp === "number" ? sp : (sp.walk ?? 30)); return Math.max(0, base + this.speedBonusFromFeatures() - (this.armorEffects().strReqUnmet ? 10 : 0)); }
	playWalkSpeed () {
		let s = this._walkSpeed();
		this.activeEffects().forEach(({def}) => { if (def.speedMul) s = Math.floor(s * def.speedMul); if (def.speedBonus) s += def.speedBonus; });
		const ex = this.play.exhaustion || 0; if (ex >= 5) return 0; if (ex >= 2) s = Math.floor(s / 2);
		return s;
	}
	playAc () {
		let ac = this.ac(); const eff = this.activeEffects();
		if (!this.armorEnt()) eff.forEach(({def}) => { if (def.acUnarmoredSet && !this.hasClass("Barbarian") && !this.hasClass("Monk")) ac += (def.acUnarmoredSet - 10); });
		eff.forEach(({def}) => { if (def.acMin && ac < def.acMin) ac = def.acMin; });
		eff.forEach(({def}) => { if (def.acBonus) ac += def.acBonus; });
		return ac;
	}
	playNumAttacks () { let n = this.numAttacks(); this.activeEffects().forEach(({def}) => { if (def.extraAttacks) n += def.extraAttacks; }); return n; }
	playResistances () { const set = new Set(this.defenses().resist); this.activeEffects().forEach(({def}) => (def.resist || []).forEach(r => set.add(r))); return [...set]; }
	playDamageRiders () {
		const out = [];
		this.activeEffects().forEach(({name, def}) => {
			if (def.rageDamage) out.push(`+${this._rageDamage()} (Rage, Str melee)`);
			if (def.dmgRider) out.push(`+${def.dmgRider.dice}${def.dmgRider.type ? ` ${def.dmgRider.type}` : ""} (${name}${def.dmgRider.note ? `, ${def.dmgRider.note}` : ""})`);
		});
		return out;
	}
	effectAttackDice () { return this.activeEffects().map(({def}) => def.attackDice).filter(Boolean).join(""); }
	effectSaveDice () { return this.activeEffects().map(({def}) => def.saveDice).filter(Boolean).join(""); }
	// merge active-effect advantage/disadvantage into a base {adv,dis,net} for a roll (category: attack | check | save; abv = ability)
	effectAdv (baseAd, category, abv) {
		const adv = [...(baseAd?.adv || [])]; const dis = [...(baseAd?.dis || [])];
		this.activeEffects().forEach(({name, def}) => {
			if (category === "attack" && def.advAttack) adv.push(name);
			if (category === "check" && def.advCheck?.includes(abv)) adv.push(name);
			if (category === "save" && def.advSave?.includes(abv)) adv.push(name);
			if (category === "save" && def.disSave?.includes(abv)) dis.push(name);
		});
		if (!adv.length && !dis.length) return baseAd || null;
		return {adv, dis, net: adv.length && dis.length ? "both" : adv.length ? "adv" : "dis"};
	}

	/* ----- content source filter ----- */
	// books wholly superseded by a newer 2014-rules book (Volo's + Mordenkainen's -> Monsters of the Multiverse; Elemental Evil -> MPMM/XGE)
	static _LEGACY_CLASSIC_SOURCES = new Set(["VGM", "MTF", "EEPC"]);
	_sourceAllowed (source) { return !(this.hiddenSources || []).includes(source); }
	// superseded within 2014 rules: a wholly-replaced book, or an entity reprinted by a newer "classic" source (e.g. VGM Aasimar -> MPMM).
	// 2014->2024 reprints (PHB -> XPHB) are NOT legacy here, since we're playing 2014 rules.
	_isLegacyEntity (ent) {
		if (!this.hideLegacy || !ent) return false;
		if (CharState._LEGACY_CLASSIC_SOURCES.has(ent.source)) return true;
		if (!ent.reprintedAs) return false;
		const isClassic = (s) => { try { return SourceUtil.isClassicSource(s); } catch (e) { return false; } };
		return ent.reprintedAs.some(rep => { const s = (typeof rep === "string" ? rep : rep.uid || "").split("|")[1] || ""; return s && s !== ent.source && isClassic(s); });
	}
	isVisible (ent) { return !!ent && this._sourceAllowed(ent.source) && !this._isLegacyEntity(ent); }
	filterVisible (arr) { return (arr || []).filter(e => this.isVisible(e)); }
	// every source present across the loaded data, with its filter group (for the Sources panel)
	allSources () {
		const seen = new Map();
		const scan = (arr) => (arr || []).forEach(e => { if (e?.source && !seen.has(e.source)) seen.set(e.source, {source: e.source, group: (typeof SourceUtil !== "undefined" ? SourceUtil.getFilterGroup(e.source) : 0)}); });
		const d = this._data;
		[d.races, d.backgrounds, d.feats, d.classData?.classes, d.classData?.subclasses, d.spells, d.items, d.optionalFeatures, d.bestiary].forEach(scan);
		return [...seen.values()].sort((a, b) => (a.group - b.group) || SortUtil.ascSortLower(Parser.sourceJsonToFull(a.source), Parser.sourceJsonToFull(b.source)));
	}

	/* ----- entity lookups ----- */
	_byUid (arr, uid) { if (!uid) return null; return arr.find(e => CW.uid(e) === uid) || null; }
	get raceEnt () { return this._byUid(this._data.races, this.raceUid); }
	get backgroundEnt () { return this._byUid(this._data.backgrounds, this.backgroundUid); }

	/* ----- multiclassing: this.classes = [{uid, level, subclassUid}]; classes[0] is the primary (first) class ----- */
	// resolved class entries [{ix, uid, cls, level, subclassUid, subclassEnt, isPrimary}], skipping unchosen rows
	classList () {
		return (this.classes || [])
			.map((c, ix) => {
				const cls = this._byUid(this._data.classData.classes, c.uid);
				if (!cls) return null;
				return {ix, uid: c.uid, cls, level: Math.max(1, c.level || 1), subclassUid: c.subclassUid || null, subclassEnt: this._subclassEntFor(cls, c.subclassUid), isPrimary: ix === 0};
			})
			.filter(Boolean);
	}
	get primaryClass () { return this.classList()[0] || null; }
	get classEnt () { return this.primaryClass?.cls || null; } // first class — drives saving throws, skills, starting equipment
	get subclassEnt () { return this.primaryClass?.subclassEnt || null; }
	// total character level (sum of class levels); compat getters for old single-class read sites
	get totalLevel () { return this.classList().reduce((a, c) => a + c.level, 0); }
	get level () { return Math.max(1, this.totalLevel); }
	get classUid () { return this.primaryClass?.uid || (this.classes?.[0]?.uid ?? null); }
	get subclassUid () { return this.primaryClass?.subclassUid || null; }
	isMulticlassed () { return this.classList().length > 1; }
	hasClass (name) { return this.classList().some(c => c.cls.name === name); }

	_subclassEntFor (cls, subclassUid) {
		if (!cls || !subclassUid) return null;
		return this._data.classData.subclasses
			.filter(sc => sc.className === cls.name && sc.classSource === cls.source)
			.find(sc => CW.uid(sc) === subclassUid) || null;
	}

	subclassesForClass (cls = this.classEnt) {
		if (!cls) return [];
		return this._data.classData.subclasses
			.filter(sc => sc.className === cls.name && sc.classSource === cls.source && !sc.isReprinted && this.isVisible(sc));
	}

	subclassGainLevel (cls = this.classEnt) {
		if (!cls) return null;
		// the level at which the first subclass feature is gained
		const subs = this.subclassesForClass(cls);
		for (const sc of subs) {
			const feats = sc.subclassFeatures || [];
			for (let i = 0; i < feats.length; ++i) if ((feats[i] || []).length) return (feats[i][0]?.level) || (i + 1);
		}
		return 3;
	}

	/* ----- multiclass prerequisites (ability score minimums) ----- */
	// {ok, reqText, missing:[...]} for taking a level in `cls` as a multiclass (ignores starting-class case)
	multiclassRequirement (cls) {
		const req = cls?.multiclassing?.requirements;
		if (!req) return {ok: true, reqText: "", missing: []};
		const missing = []; const parts = [];
		Object.entries(req).forEach(([k, v]) => {
			if (k === "or") {
				(v || []).forEach(alt => {
					const opts = Object.entries(alt);
					parts.push(opts.map(([a, sc]) => `${a.toUpperCase()} ${sc}`).join(" or "));
					if (!opts.some(([a, sc]) => this.finalAbility(a) >= sc)) missing.push(opts.map(([a, sc]) => `${a.toUpperCase()} ${sc}`).join(" or "));
				});
			} else if (CW.ABILITIES.includes(k)) {
				parts.push(`${k.toUpperCase()} ${v}`);
				if (this.finalAbility(k) < v) missing.push(`${k.toUpperCase()} ${v}`);
			}
		});
		return {ok: !missing.length, reqText: parts.join(", "), missing};
	}

	// Can the character add a level in `cls` (must meet its reqs AND those of all current classes)
	canMulticlassInto (cls) {
		if (!this.multiclassRequirement(cls).ok) return false;
		return this.classList().every(c => this.multiclassRequirement(c.cls).ok);
	}

	/* ----- abilities ----- */
	// generic ability-bonus computation for an option (fixed + weighted/simple choose), shared by race + background
	_abilOptionBonuses (opt, choices, weighted) {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		if (!opt) return out;
		Object.entries(opt).forEach(([k, v]) => { if (k !== "choose" && typeof v === "number" && out[k] != null) out[k] += v; });
		const ch = opt.choose;
		if (ch?.weighted) { const weights = ch.weighted.weights || []; (weighted || []).forEach((abv, i) => { if (abv && out[abv] != null && weights[i] != null) out[abv] += weights[i]; }); } else if (ch) { const amount = ch.amount || 1; (choices || []).forEach(k => { if (out[k] != null) out[k] += amount; }); }
		return out;
	}
	_chooseMeta (opt) { if (!opt?.choose || opt.choose.weighted) return null; return {from: opt.choose.from || CW.ABILITIES, count: opt.choose.count || 1, amount: opt.choose.amount || 1}; }

	raceAbilityOptions () { return this.raceEnt?.ability || []; }
	activeRaceAbilityOption () { const o = this.raceAbilityOptions(); return o.length ? (o[Math.min(this.raceAbilOption || 0, o.length - 1)] || null) : null; }
	racialBonuses () { return this._abilOptionBonuses(this.activeRaceAbilityOption(), this.raceAbilChoices, this.raceAbilWeighted); }
	racialChooseMeta () { return this._chooseMeta(this.activeRaceAbilityOption()); }

	// background ability bonuses (2024 / Eberron / FRHoF backgrounds, same weighted format as races)
	bgAbilityOptions () { return this.backgroundEnt?.ability || []; }
	activeBgAbilityOption () { const o = this.bgAbilityOptions(); return o.length ? (o[Math.min(this.bgAbilOption || 0, o.length - 1)] || null) : null; }
	backgroundBonuses () { return this._abilOptionBonuses(this.activeBgAbilityOption(), this.bgAbilChoices, this.bgAbilWeighted); }
	bgChooseMeta () { return this._chooseMeta(this.activeBgAbilityOption()); }

	// ASI "slots" across all classes: each class grants ASIs at its own levels.
	// Returns [{classUid, className, classLevel, key}] where key = "classUid@classLevel".
	asiSlots () {
		const out = [];
		this.classList().forEach(({cls, level, uid}) => {
			const cf = cls.classFeatures || [];
			for (let lv = 1; lv <= level; ++lv) {
				const feats = cf[lv - 1] || [];
				if (feats.some(f => f?.name && /^Ability Score Improvement/i.test(f.name))) out.push({classUid: uid, className: cls.name, classLevel: lv, key: `${uid}@${lv}`});
			}
		});
		return out;
	}
	// back-compat: character levels that have an ASI (used only for messaging)
	asiLevels () { return [...new Set(this.asiSlots().map(s => s.classLevel))].sort((a, b) => a - b); }

	// ability bonuses from one feat choice (fixed + chosen "+N to one of …")
	_featAbilityBonus (featUid, featAbilChoose) {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const feat = this._data.feats.find(f => CW.uid(f) === featUid);
		(feat?.ability || []).forEach(ab => {
			Object.entries(ab).forEach(([k, v]) => { if (k !== "choose" && typeof v === "number" && out[k] != null) out[k] += v; });
			if (ab.choose) (featAbilChoose || []).forEach(k => { if (out[k] != null) out[k] += (ab.choose.amount || 1); });
		});
		return out;
	}

	// Total ability bonuses from ASIs + chosen feats (only for valid, in-range ASI slots) + the racial feat
	asiBonuses () {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const valid = new Set(this.asiSlots().map(s => s.key));
		Object.entries(this.asiChoices || {}).forEach(([key, ch]) => {
			if (!ch || !valid.has(key)) return;
			if (ch.type === "asi" && ch.inc) Object.entries(ch.inc).forEach(([k, v]) => { if (out[k] != null) out[k] += v; });
			else if (ch.type === "feat" && ch.featUid) Object.entries(this._featAbilityBonus(ch.featUid, ch.featAbilChoose)).forEach(([k, v]) => out[k] += v);
		});
		if (this.raceFeatCount() && this.raceFeat?.featUid) Object.entries(this._featAbilityBonus(this.raceFeat.featUid, this.raceFeat.featAbilChoose)).forEach(([k, v]) => out[k] += v);
		this.backgroundFixedFeats().forEach(f => Object.entries(this._featAbilityBonus(CW.uid(f), [])).forEach(([k, v]) => out[k] += v));
		if (this.backgroundFeatChoice() && this.bgFeat?.featUid) Object.entries(this._featAbilityBonus(this.bgFeat.featUid, this.bgFeat.featAbilChoose)).forEach(([k, v]) => out[k] += v);
		return out;
	}

	// number of level-1 feats granted by the race (Variant Human / Custom Lineage = 1)
	raceFeatCount () { return (this.raceEnt?.feats || []).reduce((a, g) => a + (g?.any || g?.anyFromCategory?.count || 0), 0); }

	/* ----- background feats (2024 origin feat, dragonmark, faction…) ----- */
	// feats the background grants by a specific name (auto-applied)
	backgroundFixedFeats () {
		const out = [];
		(this.backgroundEnt?.feats || []).forEach(grp => Object.entries(grp).forEach(([k, v]) => { if (v !== true) return; const feat = this._data.feats.find(f => CW.uid(f).toLowerCase() === `${k}`.toLowerCase()); if (feat) out.push(feat); }));
		return out;
	}
	// a "choose any feat" entry on the background, if present -> {count, category}
	backgroundFeatChoice () {
		for (const grp of (this.backgroundEnt?.feats || [])) { if (grp.any) return {count: grp.any}; if (grp.anyFromCategory) return {count: grp.anyFromCategory.count || 1, category: grp.anyFromCategory.category}; }
		return null;
	}

	featsTaken () {
		const slots = this.asiSlots();
		const byKey = new Map(slots.map(s => [s.key, s]));
		const out = Object.entries(this.asiChoices || {})
			.filter(([key, c]) => byKey.has(key) && c?.type === "feat" && c.featUid)
			.map(([key, c]) => { const s = byKey.get(key); return {key, level: s.classLevel, className: s.className, featUid: c.featUid}; });
		if (this.raceFeatCount() && this.raceFeat?.featUid) out.unshift({key: "race", level: 1, className: "Race", featUid: this.raceFeat.featUid});
		this.backgroundFixedFeats().forEach(f => out.unshift({key: `bgfixed:${CW.uid(f)}`, level: 1, className: "Background", featUid: CW.uid(f)}));
		if (this.backgroundFeatChoice() && this.bgFeat?.featUid) out.unshift({key: "bg", level: 1, className: "Background", featUid: this.bgFeat.featUid});
		return out;
	}

	// short human-readable summary of a feat's prerequisite (alternatives joined by "OR")
	_featPrereqText (feat) {
		const pres = feat?.prerequisite; if (!pres?.length) return "";
		return pres.map(pre => Object.entries(pre).map(([k, v]) => {
			if (k === "ability") return v.map(req => Object.entries(req).map(([a, sc]) => `${a.toUpperCase()} ${sc}`).join(", ")).join(" or ");
			if (k === "level") return `level ${typeof v === "number" ? v : (v.level || v)}`;
			if (/^spellcasting/i.test(k)) return "a spellcasting feature";
			if (k === "race") return v.map(r => `${r.name}${r.subrace ? ` (${r.subrace})` : ""}`).join(" or ");
			if (k === "proficiency") return v.map(req => Object.entries(req).map(([t, val]) => `${val} ${t}`).join(", ")).join(" or ");
			if (k === "other") return `${v}`;
			if (k === "otherSummary") return `${v.entrySummary || v}`;
			return `${k}`;
		}).join(", ")).join(" OR ");
	}

	// Consistency check: choices whose prerequisites are no longer satisfied (e.g. after changing class/race/abilities).
	// Returns [{step, severity:"warning"|"error", title, message}]; the UI flags the relevant step + lists them.
	validationIssues () {
		const out = [];
		const cl = this.classList();
		// multiclass ability-score requirements (RAW: every class in a multiclass must meet its minimum)
		if (cl.length > 1) {
			cl.forEach(c => { const req = this.multiclassRequirement(c.cls); if (!req.ok) out.push({step: "class", severity: "warning", title: `${c.cls.name}`, message: `Multiclassing requires ${req.reqText} — not met (need ${req.missing.join("; ")}).`}); });
		}
		if (this.totalLevel > 20) out.push({step: "class", severity: "error", title: "Level cap", message: `Total level ${this.totalLevel} exceeds the maximum of 20.`});
		// feat prerequisites (ASI feats + racial feat + background feat — all chosen on the Abilities step)
		this.featsTaken().forEach(ft => {
			const feat = this._data.feats.find(f => CW.uid(f) === ft.featUid); if (!feat) return;
			if (this.meetsFeatPrereq(feat)) return;
			const src = ft.className === "Race" ? this._raceWord() : ft.className === "Background" ? "Background" : `${ft.className} ${ft.level}`;
			const pr = this._featPrereqText(feat);
			out.push({step: "abilities", severity: "warning", title: feat.name, message: `${feat.name} (${src} feat) no longer meets its prerequisite${pr ? `: ${pr}` : ""}.`});
		});
		return out;
	}
	_raceWord () { return this._data.styleHint === "one" ? "Species" : "Race"; }

	// Does the character satisfy a feat's prerequisites? (checks ability/level/spellcasting/proficiency/race; unknown types pass)
	meetsFeatPrereq (feat) {
		const pres = feat?.prerequisite;
		if (!pres || !pres.length) return true;
		return pres.some(pre => this._meetsOnePrereq(pre)); // alternatives (OR)
	}
	_meetsOnePrereq (pre) {
		for (const [k, v] of Object.entries(pre)) {
			if (k === "ability") { if (!v.some(req => Object.entries(req).every(([a, sc]) => this.finalAbility(a) >= sc))) return false; } else if (k === "level") { const lv = typeof v === "number" ? v : (v.level || 0); if (this.level < lv) return false; } else if (/^spellcasting/i.test(k)) { if (!this.isCaster() && !this.hasRacialSpells()) return false; } else if (k === "proficiency") { if (!v.every(req => Object.entries(req).every(([t, val]) => t === "armor" ? this.armorProficiencies().has(val) : true))) return false; } else if (k === "race") { const rn = `${this.raceEnt?.name || ""}`.toLowerCase(); if (!v.some(r => rn.includes(`${r.name}`.toLowerCase()))) return false; }
			// other prerequisite kinds (background, item, "other", etc.) aren't checkable here -> don't block
		}
		return true;
	}

	/* ----- feat grants (proficiencies / save / expertise / resist / numeric), aggregated across every taken feat ----- */
	// [{feat, choice}] for ASI feats + racial feat + background feat (choices) + background fixed feats (no choices)
	_allFeatInstances () {
		const out = [];
		const valid = new Set(this.asiSlots().map(s => s.key));
		Object.entries(this.asiChoices || {}).forEach(([key, c]) => { if (valid.has(key) && c?.type === "feat" && c.featUid) { const feat = this._data.feats.find(f => CW.uid(f) === c.featUid); if (feat) out.push({feat, choice: c}); } });
		if (this.raceFeatCount() && this.raceFeat?.featUid) { const feat = this._data.feats.find(f => CW.uid(f) === this.raceFeat.featUid); if (feat) out.push({feat, choice: this.raceFeat}); }
		if (this.backgroundFeatChoice() && this.bgFeat?.featUid) { const feat = this._data.feats.find(f => CW.uid(f) === this.bgFeat.featUid); if (feat) out.push({feat, choice: this.bgFeat}); }
		this.backgroundFixedFeats().forEach(feat => out.push({feat, choice: {}}));
		return out;
	}
	// fixed (object {x:true}) proficiencies of one kind across all feats
	_featFixedProfs (field) { const out = new Set(); this._allFeatInstances().forEach(({feat}) => (feat[field] || []).forEach(g => { if (g && typeof g === "object" && !g.choose) Object.entries(g).forEach(([k, v]) => { if (v === true && !k.startsWith("any")) out.add(k.toLowerCase()); }); })); return out; }
	featArmorProfs () { return this._featFixedProfs("armorProficiencies"); }
	featSaveProfs () { const out = new Set(); this._allFeatInstances().forEach(({choice}) => (choice.featSaveChoose || []).forEach(a => out.add(a))); return out; }
	featSkillProfs () { const out = new Set(); this._allFeatInstances().forEach(({feat, choice}) => { (feat.skillProficiencies || []).forEach(g => { if (g && !g.choose) Object.entries(g).forEach(([k, v]) => { if (v === true) out.add(k); }); }); (choice.featSkillChoose || []).forEach(s => out.add(s)); }); return out; }
	featToolProfs () { const out = new Set(); this._allFeatInstances().forEach(({choice}) => (choice.featToolChoose || []).forEach(t => out.add(`${t}`.toTitleCase()))); return out; }
	featLangProfs () { const out = new Set(); this._allFeatInstances().forEach(({choice}) => (choice.featLangChoose || []).forEach(l => out.add(`${l}`.toTitleCase()))); return out; }
	featWeaponProfs () {
		const cats = new Set(); const names = new Set();
		this._allFeatInstances().forEach(({feat, choice}) => {
			(feat.weaponProficiencies || []).forEach(g => { if (g && !g.choose) Object.entries(g).forEach(([k, v]) => { if (v !== true) return; const kl = `${k}`.toLowerCase(); if (/martial/.test(kl)) cats.add("martial"); else if (/simple/.test(kl)) cats.add("simple"); else if (!kl.startsWith("any")) names.add(kl.split("|")[0]); }); });
			(choice.featWeaponChoose || []).forEach(w => names.add(`${w}`.toLowerCase()));
		});
		return {cats, names};
	}
	featExpertiseSkills () { const out = new Set(); this._allFeatInstances().forEach(({choice}) => (choice.featExpertiseChoose || []).forEach(s => out.add(s))); return out; }
	featResist () { const out = new Set(); this._allFeatInstances().forEach(({feat}) => (feat.resist || []).forEach(x => { if (typeof x === "string") out.add(x); })); return out; }
	// numeric bonuses from feats (text-only in the data, so matched by name)
	_hasFeat (re) { return this._allFeatInstances().some(({feat}) => re.test(feat.name)); }
	featSpeedBonus () { return this._hasFeat(/^Mobile$/) ? 10 : 0; }
	featInitiativeBonus () { return this._hasFeat(/^Alert$/) ? 5 : 0; }
	featPassivePerceptionBonus () { return this._hasFeat(/^Observant$/) ? 5 : 0; }

	// Parse a feature's text for "Your X [and Y] score(s) increase(s) by N" (e.g. Primal Champion)
	_featureAbilityIncrease (feature) {
		const out = {};
		const text = JSON.stringify(feature?.entries || "").toLowerCase();
		const re = /your ([a-z ,]+?) scores? (?:increase|raise)s? by (\d+)/g;
		let m;
		while ((m = re.exec(text)) !== null) {
			const amount = parseInt(m[2], 10);
			m[1].split(/\s*,\s*|\s+and\s+/).map(s => s.trim()).forEach(n => {
				const abv = CW.ABIL_NAME_TO_ABV[n];
				if (abv) out[abv] = Math.max(out[abv] || 0, amount);
			});
		}
		return out;
	}

	// Ability increases from class/subclass features gained so far (outside ASIs/feats)
	classFeatureAbilityBonuses () {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const addFrom = (featuresByLevel, maxLv) => {
			(featuresByLevel || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => {
				if (!f?.name) return;
				const lvl = f.level || (ix + 1);
				if (lvl > maxLv) return;
				Object.entries(this._featureAbilityIncrease(f)).forEach(([k, v]) => { if (out[k] != null) out[k] += v; });
			}));
		};
		this.classList().forEach(({cls, level, subclassEnt}) => { addFrom(cls.classFeatures, level); addFrom(subclassEnt?.subclassFeatures, level); });
		return out;
	}

	finalAbility (abv) {
		const computed = (this.abilitiesBase[abv] || 0) + this.racialBonuses()[abv] + this.backgroundBonuses()[abv] + this.asiBonuses()[abv] + this.classFeatureAbilityBonuses()[abv] + this._itemAbilityBonus(abv);
		const set = this._itemAbilitySet(abv); // e.g. Amulet of Health sets Con to 19
		return set != null ? Math.max(computed, set) : computed;
	}
	// highest "static" ability value set by an equipped (attuned) item, or null
	_itemAbilitySet (abv) {
		let best = null;
		this.equippedItems().forEach(it => { if (!this._magicActive(it)) return; const v = it.ability?.static?.[abv]; if (typeof v === "number") best = best == null ? v : Math.max(best, v); });
		return best;
	}
	// flat ability bonus from equipped items (Belt of Dwarvenkind +2 Con, Ioun Stones, Tomes/Manuals)
	_itemAbilityBonus (abv) {
		let n = 0;
		this.equippedItems().forEach(it => { if (!this._magicActive(it)) return; const v = it.ability?.[abv]; if (typeof v === "number") n += v; });
		return n;
	}
	abilityMod (abv) { return CW.mod(this.finalAbility(abv)); }

	pointBuySpent () {
		return CW.ABILITIES.reduce((acc, abv) => acc + (CW.POINT_BUY_COST[this.abilitiesBase[abv]] ?? 99), 0);
	}

	/* ----- derived ----- */
	get profBonus () { return CW.profBonus(this.level) + this._itemBonusNum("bonusProficiencyBonus"); } // Ioun Stone of Mastery (+1)
	// sum a numeric "+N" field across equipped (magic-active) items
	_itemBonusNum (field) { let n = 0; this.equippedItems().forEach(it => { if (this._magicActive(it) && it[field] != null) n += parseInt(`${it[field]}`.replace(/[^-0-9]/g, ""), 10) || 0; }); return n; }

	hitDie () { const c = this.classEnt; return c?.hd ? c.hd.faces : null; }

	// e.g. "3d10, 2d6" — hit dice grouped by die size across all classes
	hitDiceString () {
		const byDie = {};
		this.classList().forEach(({cls, level}) => { const f = cls.hd?.faces; if (f) byDie[f] = (byDie[f] || 0) + level; });
		const keys = Object.keys(byDie).map(Number).sort((a, b) => b - a);
		return keys.length ? keys.map(f => `${byDie[f]}d${f}`).join(", ") : "—";
	}

	maxHp () {
		const list = this.classList(); if (!list.length || !list[0].cls.hd) return null;
		const conMod = this.abilityMod("con");
		let hp = 0; let isFirstLevel = true;
		list.forEach(({cls, level}) => {
			const faces = cls.hd?.faces; if (!faces) return;
			const avg = Math.floor(faces / 2) + 1;
			for (let i = 0; i < level; ++i) {
				if (isFirstLevel) { hp += faces + conMod; isFirstLevel = false; } // 1st character level: max die
				else hp += avg + conMod; // every other level (any class): average
			}
		});
		hp += this.hpBonusPerLevel() * this.totalLevel; // Tough, Dwarven Toughness, etc.
		return Math.max(this.totalLevel, hp);
	}

	// Per-level bonus HP from race traits / feats / features (Tough +2, Dwarven Toughness +1, …)
	hpBonusPerLevel () {
		const parse = (entries) => {
			const text = JSON.stringify(entries || "").toLowerCase();
			if (!/hit point maximum increases/.test(text)) return 0;
			if (/twice your level/.test(text)) return 2; // Tough
			let m = text.match(/increases by (\d+)[^.]*?(?:every time you gain a level|whenever you (?:gain|reach) a (?:new )?level|per (?:\w+ )?level)/);
			if (m) return parseInt(m[1], 10);
			m = text.match(/additional (\d+) hit points?/);
			return m ? parseInt(m[1], 10) : 0;
		};
		let perLevel = parse(this.raceEnt?.entries);
		this.featsTaken().forEach(({featUid}) => { perLevel += parse(this._data.feats.find(x => CW.uid(x) === featUid)?.entries); });
		const addF = (fbl, maxLv) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if ((f?.level || (ix + 1)) <= maxLv) perLevel += parse(f?.entries); }));
		this.classList().forEach(({cls, level, subclassEnt}) => { addF(cls.classFeatures, level); addF(subclassEnt?.subclassFeatures, level); });
		return perLevel;
	}

	saveProfs () {
		if (this._hasAllSaveProficiency()) return new Set(CW.ABILITIES); // Monk Diamond Soul
		const c = this.classEnt;
		const out = new Set(c?.proficiency || []); // e.g. ["str","con"]
		this.featSaveProfs().forEach(a => out.add(a)); // Resilient
		return out;
	}
	_hasAllSaveProficiency () { return this._hasFeature("Diamond Soul") || this._hasFeature("Disciplined Survivor"); }
	// flat bonus to ALL saving throws from features (Paladin Aura of Protection = +Cha mod, min +1)
	_featureSaveBonus () { return this._hasFeature("Aura of Protection") ? Math.max(1, this.abilityMod("cha")) : 0; }

	// Skill proficiencies granted *outside* the class choice (background + race + fixed class skills)
	fixedSkillProfs () {
		const out = new Set();
		const addGrps = (grps) => (grps || []).forEach(grp => { if (grp && typeof grp === "object" && !grp.choose) Object.entries(grp).forEach(([k, v]) => { if (v === true && CW.skillAbil(k) != null) out.add(k); }); });
		addGrps(this.backgroundEnt?.skillProficiencies);
		addGrps(this.raceEnt?.skillProficiencies);
		addGrps(this.classEnt?.startingProficiencies?.skills);
		this.featSkillProfs().forEach(s => out.add(s)); // Skill Expert, Prodigy, Observant, …
		return out;
	}

	skillProfs () {
		const out = this.fixedSkillProfs();
		this.classSkillChoices.forEach(s => out.add(s));
		this.chosenForType("skill").forEach(s => out.add(s));
		return out;
	}

	/* ----- choosable proficiencies: languages / tools / race+bg skill choices ----- */
	_toolOptions (typeAbv) {
		const seen = new Set();
		return (this._data.items || [])
			.filter(it => {
				const t = `${it.type || ""}`.split("|")[0];
				const ok = typeAbv === "ANY" ? ["AT", "INS", "GS", "T"].includes(t) : t === typeAbv;
				return ok && !it.magic && (!it.rarity || it.rarity === "none") && this.isVisible(it);
			})
			.map(it => it.name)
			.filter(n => { if (seen.has(n)) return false; seen.add(n); return true; })
			.sort(SortUtil.ascSortLower);
	}

	// Returns [{key, type, label, options, count}] for every "choose N" proficiency the character has
	proficiencyChoiceGroups () {
		const groups = [];
		const LSTD = Parser.LANGUAGES_STANDARD || []; const LALL = Parser.LANGUAGES_ALL || []; const LEXO = Parser.LANGUAGES_EXOTIC || [];
		const STD_PLUS_EXOTIC = [...new Set([...LSTD, ...LEXO])]; // "standard" choices are loosened to also allow exotic
		const addLang = (arr, srcKey, srcLabel) => (arr || []).forEach((grp, ix) => {
			if (!grp || typeof grp !== "object") return;
			let n = 0; let opts = null;
			if (grp.anyStandard) { n = grp.anyStandard; opts = STD_PLUS_EXOTIC; } else if (grp.anyExotic) { n = grp.anyExotic; opts = LEXO; } else if (grp.any) { n = grp.any; opts = LALL; }
			if (n) groups.push({key: `language:${srcKey}:${ix}`, type: "language", label: `${srcLabel}: choose ${n} language${n > 1 ? "s" : ""}`, options: opts, count: n});
			if (grp.choose?.from) { const cn = grp.choose.count || 1; groups.push({key: `language:${srcKey}:${ix}:c`, type: "language", label: `${srcLabel}: choose ${cn} language${cn > 1 ? "s" : ""}`, options: grp.choose.from.map(l => `${l}`.toTitleCase()), count: cn}); }
		});
		const NUMW = {one: 1, two: 2, three: 3, four: 4, five: 5};
		const CATABV = {"musical instrument": "INS", "artisan's tool": "AT", "artisans tool": "AT", "gaming set": "GS", "tool": "ANY"};
		const addTool = (arr, srcKey, srcLabel) => (arr || []).forEach((grp, ix) => {
			// some class tool profs are free text, e.g. "three {@item musical instrument|phb} of your choice"
			if (typeof grp === "string") {
				const clean = `${grp}`.replace(/\{@\w+ ([^}|]+)(?:\|[^}]*)?\}/g, "$1").toLowerCase();
				const m = clean.match(/(one|two|three|four|five|\d+) [^.]*?(musical instrument|artisan'?s tool|gaming set|tool)s? of your choice/);
				if (m) { const n = NUMW[m[1]] || parseInt(m[1], 10) || 1; const cat = CATABV[m[2].replace("'", "")] || CATABV[m[2]] || "ANY"; groups.push({key: `tool:${srcKey}:${ix}`, type: "tool", label: `${srcLabel}: choose ${n} ${m[2]}${n > 1 ? "s" : ""}`, options: this._toolOptions(cat), count: n}); }
				return;
			}
			if (typeof grp !== "object") return;
			let n = 0; let opts = null; let what = "tool";
			if (grp.choose?.from) { n = grp.choose.count || 1; opts = grp.choose.from.map(s => `${s}`); } else if (grp.anyArtisansTool) { n = grp.anyArtisansTool; opts = this._toolOptions("AT"); what = "artisan's tool"; } else if (grp.anyMusicalInstrument) { n = grp.anyMusicalInstrument; opts = this._toolOptions("INS"); what = "instrument"; } else if (grp.anyGamingSet) { n = grp.anyGamingSet; opts = this._toolOptions("GS"); what = "gaming set"; } else if (grp.anyTool || grp.any) { n = grp.anyTool || grp.any; opts = this._toolOptions("ANY"); }
			if (n) groups.push({key: `tool:${srcKey}:${ix}`, type: "tool", label: `${srcLabel}: choose ${n} ${what}${n > 1 ? "s" : ""}`, options: opts, count: n});
		});
		const addSkill = (arr, srcKey, srcLabel) => (arr || []).forEach((grp, ix) => {
			if (grp?.choose?.from) groups.push({key: `skill:${srcKey}:${ix}`, type: "skill", label: `${srcLabel}: choose ${grp.choose.count || 1} skill${(grp.choose.count || 1) > 1 ? "s" : ""}`, options: grp.choose.from, count: grp.choose.count || 1});
			else if (grp?.any) groups.push({key: `skill:${srcKey}:${ix}`, type: "skill", label: `${srcLabel}: choose ${grp.any} skill${grp.any > 1 ? "s" : ""}`, options: CW.skills(), count: grp.any});
		});
		// weapon choices (e.g. Hobgoblin: choose 2 martial weapons via fromFilter)
		const addWeapon = (arr, srcKey, srcLabel) => (arr || []).forEach((grp, ix) => {
			if (!grp?.choose) return;
			const count = grp.choose.count || 1;
			let opts; let what = "weapon";
			if (grp.choose.fromFilter) { const cat = /martial/.test(grp.choose.fromFilter) ? "martial" : (/simple/.test(grp.choose.fromFilter) ? "simple" : null); opts = this.weaponOptions({category: cat}); what = `${cat ? `${cat} ` : ""}weapon`; } else if (grp.choose.from) opts = grp.choose.from.map(s => `${s}`.split("|")[0]);
			if (opts) groups.push({key: `weapon:${srcKey}:${ix}`, type: "weapon", label: `${srcLabel}: choose ${count} ${what}${count > 1 ? "s" : ""}`, options: opts, count});
		});
		addLang(this.raceEnt?.languageProficiencies, "race", "Race");
		addLang(this.backgroundEnt?.languageProficiencies, "bg", "Background");
		addTool(this.classEnt?.startingProficiencies?.tools, "class", this.classEnt?.name || "Class");
		addTool(this.raceEnt?.toolProficiencies, "race", this.raceEnt?.name || "Race");
		addTool(this.backgroundEnt?.toolProficiencies, "bg", "Background");
		addSkill(this.raceEnt?.skillProficiencies, "race", "Race");
		addSkill(this.backgroundEnt?.skillProficiencies, "bg", "Background");
		addWeapon(this.raceEnt?.weaponProficiencies, "race", this.raceEnt?.name || "Race");
		// multiclassed (secondary) classes grant a limited set of skill + tool proficiencies (keyed by class uid)
		this.classList().forEach(({cls, isPrimary, uid}) => {
			if (isPrimary) return;
			const pg = cls.multiclassing?.proficienciesGained; if (!pg) return;
			addSkill(pg.skills, uid, cls.name);
			addTool(pg.toolProficiencies, uid, cls.name);
		});
		return groups;
	}

	chosenForType (type) {
		const out = new Set();
		this.proficiencyChoiceGroups().filter(g => g.type === type).forEach(g => (this.profChoices[g.key] || []).forEach(v => out.add(v)));
		return out;
	}

	// fixed (non-choose) languages from race + background
	fixedLanguages () {
		const out = new Set();
		const add = (grps) => (grps || []).forEach(grp => Object.entries(grp).forEach(([k, v]) => { if (v === true) out.add(k.toTitleCase()); }));
		add(this.raceEnt?.languageProficiencies); add(this.backgroundEnt?.languageProficiencies);
		return out;
	}
	// special class languages (Druid -> Druidic, Rogue -> Thieves' Cant)
	classLanguages () {
		const out = new Set();
		this.classList().forEach(({cls, level}) => (cls.classFeatures || []).forEach((lv, ix) => (lv || []).forEach(f => {
			if ((f?.level || (ix + 1)) > level) return;
			if (/^druidic$/i.test(f?.name || "")) out.add("Druidic");
			if (/^thieves'? cant$/i.test(f?.name || "")) out.add("Thieves' Cant");
		})));
		return [...out];
	}
	chosenLanguages () { const out = this.fixedLanguages(); this.chosenForType("language").forEach(l => out.add(l)); this.classLanguages().forEach(l => out.add(l)); this.featLangProfs().forEach(l => out.add(l)); return [...out].sort(); }

	// number of attacks per Attack action (Extra Attack; Fighter improves at 11/20)
	numAttacks () {
		let n = this._hasFeature("Extra Attack") ? 2 : 1;
		const fighter = this.classList().find(c => c.cls.name === "Fighter");
		if (fighter) { if (fighter.level >= 20) n = Math.max(n, 4); else if (fighter.level >= 11) n = Math.max(n, 3); }
		return n;
	}

	// fixed (non-choose) tools from class + background
	fixedTools () {
		const out = new Set();
		const add = (arr) => (arr || []).forEach(t => {
			if (typeof t === "string") { if (/of your choice/i.test(t)) return; out.add(t.includes("{@") ? t : t.toTitleCase()); return; }
			if (t && typeof t === "object" && !t.choose && !Object.keys(t).some(k => k.startsWith("any"))) Object.entries(t).forEach(([k, v]) => { if (v === true) out.add(k.toTitleCase()); });
		});
		add(this.classEnt?.startingProficiencies?.tools); add(this.backgroundEnt?.toolProficiencies); add(this.raceEnt?.toolProficiencies);
		this.classList().forEach(({cls, isPrimary}) => { if (!isPrimary) add(cls.multiclassing?.proficienciesGained?.toolProficiencies); });
		return out;
	}
	chosenTools () { const out = this.fixedTools(); this.chosenForType("tool").forEach(t => out.add(`${t}`.toTitleCase())); this.featToolProfs().forEach(t => out.add(t)); return [...out].sort(); }

	clearProfChoicesForSource (srcKey) { Object.keys(this.profChoices).forEach(k => { if (k.includes(`:${srcKey}:`)) delete this.profChoices[k]; }); }

	classSkillChoiceMeta () {
		const cls = this.classEnt;
		const grp = (cls?.startingProficiencies?.skills || []).find(g => g?.choose);
		if (!grp) return null;
		return {from: grp.choose.from || CW.skills(), count: grp.choose.count || 1};
	}

	saveMod (abv) { return this.abilityMod(abv) + (this.saveProfs().has(abv) ? this.profBonus : 0) + this.equippedItemEffects().saveBonus + this._attunementSaveBonus() + this._featureSaveBonus(); }

	_hasFeature (name) {
		return this.classList().some(({cls, level, subclassEnt}) => {
			const scan = (fbl) => (fbl || []).some((lvArr, ix) => (lvArr || []).some(f => f?.name === name && (f.level || (ix + 1)) <= level));
			return scan(cls.classFeatures) || scan(subclassEnt?.subclassFeatures);
		});
	}

	// Half proficiency to ability checks not already proficient (Jack of All Trades / Remarkable Athlete)
	halfProfMeta () {
		if (this._hasFeature("Jack of All Trades")) return {amount: Math.floor(this.profBonus / 2), abilities: null, name: "Jack of All Trades"};
		if (this._hasFeature("Remarkable Athlete")) return {amount: Math.ceil(this.profBonus / 2), abilities: new Set(["str", "dex", "con"]), name: "Remarkable Athlete"};
		return null;
	}

	// number of expertise picks granted (Rogue/Bard Expertise 2 each; plus other expertise-granting features)
	expertiseSlots () {
		let n = 0;
		this.classList().forEach(({cls, level, subclassEnt}) => {
			const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => {
				if (!f || (f.level || (ix + 1)) > level) return;
				if (f.name === "Expertise") n += 2;
				else if (f.name && /^deft explorer$/i.test(f.name)) n += 1; // Ranger (Tasha's)
				else if (/blessings of knowledge/i.test(JSON.stringify(f.entries || ""))) n += 2; // Knowledge Cleric (nested sub-feature)
			}));
			scan(cls.classFeatures); scan(subclassEnt?.subclassFeatures);
		});
		return n;
	}

	skillProfType (skill) {
		const isProf = this.skillProfs().has(skill);
		if (isProf && (this.expertiseChoices.includes(skill) || this.featExpertiseSkills().has(skill))) return "expertise"; // incl. Skill Expert/Prodigy
		if (isProf) return "full";
		const hp = this.halfProfMeta();
		if (hp && (hp.abilities === null || hp.abilities.has(CW.skillAbil(skill)))) return "half";
		return "none";
	}

	skillMod (skill) {
		const base = this.abilityMod(CW.skillAbil(skill)) + this._itemBonusNum("bonusAbilityCheck"); // Stone of Good Luck (+1 to ability checks)
		const type = this.skillProfType(skill);
		if (type === "expertise") return base + this.profBonus * 2;
		if (type === "full") return base + this.profBonus;
		if (type === "half") return base + this.halfProfMeta().amount;
		return base;
	}

	/* ----- armor: only wearable if owned; AC respects type + proficiency ----- */
	_armorById (uid) { return uid ? (this._data.armors || []).find(a => CW.uid(a) === uid) || null : null; }
	_hasInInventory (uid) { return this.inventory.some(r => r.uid === uid); }
	hasShieldInInventory () { return this.inventory.some(r => { const a = this._armorById(r.uid); return a && `${a.type || ""}`.split("|")[0] === "S"; }); }
	inventoryArmors () { return this.inventory.map(r => this._armorById(r.uid)).filter(a => a && ["LA", "MA", "HA"].includes(`${a.type || ""}`.split("|")[0])); }
	inventoryShields () { return this.inventory.map(r => this._armorById(r.uid)).filter(a => a && `${a.type || ""}`.split("|")[0] === "S"); }

	// worn body armor / equipped shield entities, only if actually in the inventory
	armorEnt () { return this.armorUid && this._hasInInventory(this.armorUid) ? this._armorById(this.armorUid) : null; }
	shieldEnt () {
		if (!this.shieldUid || !this._hasInInventory(this.shieldUid)) return null;
		const it = this._armorById(this.shieldUid);
		return it && `${it.type || ""}`.split("|")[0] === "S" ? it : null;
	}
	isShieldEffective () { return !!this.shieldEnt(); }
	// the "+N" magic AC bonus on an item, as a number
	_bonusAcNum (it) { return it?.bonusAc ? (parseInt(`${it.bonusAc}`.replace(/[^-0-9]/g, ""), 10) || 0) : 0; }

	/* ----- attunement (base 3; raised by features e.g. Artificer Magic Item Adept/Savant/Master) ----- */
	static ATTUNE_MAX = 3;
	static _NUMW = {two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8};
	requiresAttunement (it) { return !!it?.reqAttune; }
	attuneCondition (it) { return typeof it?.reqAttune === "string" ? it.reqAttune : null; } // e.g. "by a spellcaster"
	isAttuned (uid) { return this.attunedUids.includes(uid); }
	attunedCount () { return this.attunedUids.length; }
	// max attunements, raised by class features whose text says "attune to up to N magic items"
	attuneMax () {
		let max = CharState.ATTUNE_MAX;
		this.classList().forEach(({cls, level}) => (cls.classFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => {
			if (!f?.entries || (f.level || (ix + 1)) > level) return;
			const m = JSON.stringify(f.entries).match(/attune to up to (\w+) magic items?/i);
			if (m) { const n = CharState._NUMW[m[1].toLowerCase()] || parseInt(m[1], 10); if (n > max) max = n; }
		})));
		return max;
	}
	canAttuneMore () { return this.attunedCount() < this.attuneMax(); }
	// +1 save per attuned item from Artificer's Soul of Artifice ("+1 bonus to all saving throws per magic item")
	_attunementSaveBonus () {
		let per = 0;
		this.classList().forEach(({cls, level}) => (cls.classFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => {
			if (!f?.entries || (f.level || (ix + 1)) > level) return;
			if (/bonus to all saving throws per magic item/i.test(JSON.stringify(f.entries))) per = 1;
		})));
		return per * this.attunedCount();
	}
	setAttuned (uid, on) {
		if (!uid) return;
		if (on) { if (!this.isAttuned(uid) && this.canAttuneMore()) this.attunedUids.push(uid); }
		else this.attunedUids = this.attunedUids.filter(u => u !== uid);
	}
	// an item's magic properties are active only if it needs no attunement, or it is attuned
	_magicActive (it) { return it && (!it.reqAttune || this.isAttuned(CW.uid(it))); }

	// armor categories the character is proficient with (light/medium/heavy/shield).
	// First class grants its full starting proficiencies; multiclassed classes grant only their limited set.
	armorProficiencies () {
		const out = new Set();
		const add = (arr) => (arr || []).forEach(a => { const s = (typeof a === "string" ? a : a.proficiency || a.full || "").toLowerCase(); if (s) out.add(s); });
		this.classList().forEach(({cls, isPrimary}) => add(isPrimary ? cls.startingProficiencies?.armor : cls.multiclassing?.proficienciesGained?.armor));
		// race / background armor proficiencies use {light:true, medium:true} objects (e.g. Mountain Dwarf)
		const addObj = (arr) => (arr || []).forEach(grp => { if (grp && typeof grp === "object") Object.entries(grp).forEach(([k, v]) => { if (v === true) out.add(k.toLowerCase()); }); });
		addObj(this.raceEnt?.armorProficiencies);
		addObj(this.backgroundEnt?.armorProficiencies);
		this.featArmorProfs().forEach(a => out.add(a)); // Heavily/Moderately/Lightly Armored
		return out;
	}
	static _ARMOR_TYPE_TO_CAT = {LA: "light", MA: "medium", HA: "heavy", S: "shield"};
	armorCategory (armorEnt) { return CharState._ARMOR_TYPE_TO_CAT[`${armorEnt?.type || ""}`.split("|")[0]] || null; }
	// proficient with a specific armor/shield item (category proficiency, or the item itself grants it)
	_proficientWithItem (it) { if (!it) return true; if (it.grantsProficiency) return true; const cat = this.armorCategory(it); return !cat || this.armorProficiencies().has(cat); }

	// warnings for wearing armor/shields the character isn't proficient with
	armorProficiencyWarnings () {
		const out = [];
		const armor = this.armorEnt();
		if (armor && !this._proficientWithItem(armor)) { const cat = this.armorCategory(armor); out.push(`Not proficient with ${cat} armor (${armor.name}): disadvantage on ability checks, saves, and attacks using Str or Dex, and you can't cast spells.`); }
		const shield = this.shieldEnt();
		if (shield && !this._proficientWithItem(shield)) out.push(`Not proficient with shields (${shield.name}): similar penalties apply while the shield is equipped.`);
		return out;
	}

	/* ----- advantage / disadvantage (annotations) ----- */
	_ignoresHeavyArmorSpeedPenalty () {
		// e.g. Dwarf: "Your speed is not reduced by wearing heavy armor."
		return /speed is(?:n't| not) reduced by (?:wearing )?heavy armor/.test(JSON.stringify(this.raceEnt?.entries || "").toLowerCase());
	}

	armorEffects () {
		const out = {stealthDis: null, nonProf: false, strReqUnmet: null};
		const armor = this.armorEnt();
		if (armor) {
			if (armor.stealth) out.stealthDis = armor.name;
			if (!this._proficientWithItem(armor)) out.nonProf = true;
			const req = parseInt(armor.strength, 10);
			if (req && this.finalAbility("str") < req && !this._ignoresHeavyArmorSpeedPenalty()) out.strReqUnmet = {armor: armor.name, req};
		}
		const shield = this.shieldEnt();
		if (shield) { if (shield.stealth) out.stealthDis = out.stealthDis || shield.name; if (!this._proficientWithItem(shield)) out.nonProf = true; }
		return out;
	}

	/* ----- equipped magic-item effects (worn armor + shield + wielded weapons + worn rings/wondrous) ----- */
	_isArmorOrShieldItem (it) { return !!(it && (it.armor || ["LA", "MA", "HA", "S"].includes(`${it.type || ""}`.split("|")[0]))); }
	// a worn (not held/wielded) accessory: ring or wondrous item
	isWearable (it) { if (!it) return false; return `${it.type || ""}`.split("|")[0] === "RG" || !!it.wondrous; }
	// a held magic implement: wand, rod, or staff (spell focus / spell-attack bonuses / attached spells)
	isHoldable (it) { if (!it) return false; return ["WD", "RD", "ST"].includes(`${it.type || ""}`.split("|")[0]); }
	_wornWondrousEquipped () { return this.inventory.filter(r => r.equipped && this.isWearable(this._itemByUid(r.uid))).map(r => this._itemByUid(r.uid)).filter(Boolean); }
	// every equipped item that contributes effects: worn armor + shield + all inventory rows flagged equipped (weapons, rings, wondrous)
	equippedItems () {
		const out = [this.armorEnt(), this.shieldEnt()];
		this.inventory.forEach(r => { if (!r.equipped || !r.uid) return; const it = this._itemByUid(r.uid); if (it && !this._isArmorOrShieldItem(it)) out.push(it); });
		return out.filter(Boolean);
	}

	// flatten an item's attachedSpells structure into [{name, note}]
	_flattenAttachedSpells (att) {
		const out = []; const add = (name, note) => out.push({name: `${name}`.split("#")[0].trim(), note});
		if (!att) return out;
		if (Array.isArray(att)) { att.forEach(s => add(s, "")); return out; }
		(att.will || []).forEach(s => add(s, "at will"));
		Object.entries(att.rest || {}).forEach(([k, arr]) => (arr || []).forEach(s => add(s, `${`${k}`.replace(/e$/, "")}/rest`)));
		Object.entries(att.daily || {}).forEach(([k, arr]) => (arr || []).forEach(s => add(s, `${`${k}`.replace(/e$/, "")}/day`)));
		Object.entries(att.charges || {}).forEach(([k, arr]) => (arr || []).forEach(s => add(s, `${k} charge${+k > 1 ? "s" : ""}`)));
		(att.ritual || []).forEach(s => add(s, "ritual"));
		(att.limited || att._ || []).forEach(s => add(s, ""));
		return out;
	}

	// Aggregate mechanical effects from equipped armor + shield + wielded weapons.
	// Items that require attunement contribute their magic effects only while attuned.
	equippedItemEffects () {
		const resist = new Set(); const immune = new Set(); const vulnerable = new Set(); const conditionImmune = new Set();
		const attuned = []; const needAttune = []; const speed = []; const focus = []; const spells = []; const abilitySet = []; let saveBonus = 0; let spellAtk = 0; let spellDc = 0;
		const num = (v) => parseInt(`${v}`.replace(/[^-0-9]/g, ""), 10) || 0;
		this.equippedItems().forEach(it => {
			const ref = {name: it.name, source: it.source};
			if (it.reqAttune) (this.isAttuned(CW.uid(it)) ? attuned : needAttune).push(ref);
			if (!this._magicActive(it)) return; // unattuned item gives only its nonmagical benefits
			(it.resist || []).forEach(x => typeof x === "string" && resist.add(x));
			(it.immune || []).forEach(x => typeof x === "string" && immune.add(x));
			(it.vulnerable || []).forEach(x => typeof x === "string" && vulnerable.add(x));
			(it.conditionImmune || []).forEach(x => typeof x === "string" && conditionImmune.add(x));
			if (it.bonusSavingThrow) saveBonus += num(it.bonusSavingThrow);
			if (it.bonusSpellAttack) spellAtk += num(it.bonusSpellAttack);
			if (it.bonusSpellSaveDc) spellDc += num(it.bonusSpellSaveDc);
			if (it.ability?.static) Object.entries(it.ability.static).forEach(([k, v]) => { if (CW.ABILITIES.includes(k)) abilitySet.push({abil: k, value: v, item: it.name, source: it.source}); });
			if (it.focus) focus.push(ref);
			if (it.modifySpeed) speed.push(ref);
			const att = this._flattenAttachedSpells(it.attachedSpells);
			if (att.length) spells.push({item: it.name, source: it.source, entries: att.map(a => ({...a, sp: this._spellByName(a.name)}))});
		});
		return {resist: [...resist], immune: [...immune], vulnerable: [...vulnerable], conditionImmune: [...conditionImmune], saveBonus, spellAtk, spellDc, abilitySet, attuned, needAttune, speed, focus, spells};
	}

	/* ----- defenses: damage resistance / immunity / vulnerability / condition immunity (race + items) ----- */
	// the damage types a race lets you choose a resistance from (e.g. Dragonborn base), or null
	raceResistOptions () { const ch = (this.raceEnt?.resist || []).find(x => x?.choose?.from); return ch ? ch.choose.from : null; }

	defenses () {
		const resist = new Set(); const immune = new Set(); const vulnerable = new Set(); const conditionImmune = new Set();
		const addArr = (arr, set) => (arr || []).forEach(x => { if (typeof x === "string") set.add(x); });
		const r = this.raceEnt;
		addArr(r?.resist, resist); addArr(r?.immune, immune); addArr(r?.vulnerable, vulnerable); addArr(r?.conditionImmune, conditionImmune);
		if (this.raceResistChoice && (this.raceResistOptions() || []).includes(this.raceResistChoice)) resist.add(this.raceResistChoice);
		this.featResist().forEach(x => resist.add(x)); // feats granting damage resistance
		const fx = this.equippedItemEffects();
		fx.resist.forEach(x => resist.add(x)); fx.immune.forEach(x => immune.add(x)); fx.vulnerable.forEach(x => vulnerable.add(x)); fx.conditionImmune.forEach(x => conditionImmune.add(x));
		return {resist: [...resist], immune: [...immune], vulnerable: [...vulnerable], conditionImmune: [...conditionImmune]};
	}

	// Permanent (non-situational) adv/dis effects from armor + reliably-detectable features.
	// scope.kind: "skill"(+skill) | "abilCheck"(+abil) | "save"(+abil) | "init".
	// Note: most feature adv/dis is situational (e.g. Rage "while raging") and is listed as a note instead.
	_derivedAdvDis () {
		const out = [];
		const eff = this.armorEffects();
		if (eff.stealthDis) out.push({type: "dis", scope: {kind: "skill", skill: "stealth"}, source: `${eff.stealthDis} (stealth)`});
		if (eff.nonProf) {
			["str", "dex"].forEach(a => { out.push({type: "dis", scope: {kind: "abilCheck", abil: a}, source: "non-proficient armor"}); out.push({type: "dis", scope: {kind: "save", abil: a}, source: "non-proficient armor"}); });
			out.push({type: "dis", scope: {kind: "init"}, source: "non-proficient armor"});
		}
		const ia = this._initiativeFeatureAdv(); if (ia) out.push({type: "adv", scope: {kind: "init"}, source: ia});
		return out;
	}

	// Net advantage/disadvantage: collects ALL sources, then a single adv + single dis cancel to none.
	_advDisFor (test) {
		const adv = new Set(); const dis = new Set();
		this._derivedAdvDis().forEach(e => { if (test(e.scope)) (e.type === "adv" ? adv : dis).add(e.source); });
		const a = [...adv]; const d = [...dis];
		return {adv: a, dis: d, net: a.length && d.length ? "both" : a.length ? "adv" : d.length ? "dis" : null};
	}

	skillAdvDis (skill) { const abil = CW.skillAbil(skill); return this._advDisFor(sc => (sc.kind === "skill" && sc.skill === skill) || (sc.kind === "abilCheck" && sc.abil === abil)); }
	saveAdvDis (abv) { return this._advDisFor(sc => (sc.kind === "save" && sc.abil === abv) || sc.kind === "saveAll"); }

	_initiativeFeatureAdv () {
		let found = null;
		this.classList().forEach(({cls, level, subclassEnt}) => {
			const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if (found || (f?.level || (ix + 1)) > level) return; if (/advantage on initiative/i.test(JSON.stringify(f?.entries || ""))) found = f.name; }));
			scan(cls.classFeatures); scan(subclassEnt?.subclassFeatures);
		});
		this.featsTaken().forEach(({featUid}) => { if (found) return; const f = this._data.feats.find(x => CW.uid(x) === featUid); if (/advantage on initiative/i.test(JSON.stringify(f?.entries || ""))) found = f.name; });
		this.equippedItems().forEach(it => { if (found || !this._magicActive(it)) return; if (/advantage on initiative/i.test(JSON.stringify(it.entries || ""))) found = it.name; });
		return found;
	}

	// Initiative is a Dexterity check
	initiativeAdvDis () { return this._advDisFor(sc => sc.kind === "init" || (sc.kind === "abilCheck" && sc.abil === "dex")); }

	// best-effort parse of "advantage/disadvantage on saving throws/checks/rolls ..." from features
	advantageNotes () {
		const out = []; const seen = new Set();
		const parse = (entries, source, sourceTag) => {
			if (!source) return;
			const text = JSON.stringify(entries || "").replace(/\{@\w+ ([^}|]+)(?:\|[^}]*)?\}/g, "$1");
			const re = /([^.>"{}]*\b(?:advantage|disadvantage)\b[^.>"{}]*\bon\b[^.>"{}]*?(?:saving throws?|checks?|rolls?)[^.>"{}]*)\./gi;
			let m;
			while ((m = re.exec(text)) !== null) {
				const s = m[1].trim().replace(/^[,\s]+/, "");
				const key = `${source}|${s.toLowerCase()}`;
				if (/(?:advantage|disadvantage) on initiative/i.test(s)) continue; // shown on the Initiative box instead
				// prefer the advantage/disadvantage that applies to *you* (e.g. Spellguard Shield grants you advantage while imposing disadvantage on attackers)
			let type;
			if (/you (?:have|gain|roll with|can[^.]*?) advantage/i.test(s)) type = "adv";
			else if (/you (?:have|gain|roll with) disadvantage/i.test(s)) type = "dis";
			else type = /disadvantage/i.test(s) ? "dis" : "adv";
			if (s.length > 8 && s.length < 170 && !seen.has(key)) { seen.add(key); out.push({type, text: s, source, sourceTag}); }
			}
		};
		const race = this.raceEnt; const bg = this.backgroundEnt;
		parse(race?.entries, race?.name, race ? `{@race ${race.name}|${race.source}}` : null);
		this.featsTaken().forEach(({featUid}) => { const f = this._data.feats.find(x => CW.uid(x) === featUid); parse(f?.entries, f?.name, f ? `{@feat ${f.name}|${f.source}}` : null); });
		this.classList().forEach(({cls, level, subclassEnt: sc}) => {
			(cls.classFeatures || []).forEach((lv, ix) => (lv || []).forEach(f => { if ((f?.level || (ix + 1)) <= level) parse(f?.entries, f?.name, `{@classFeature ${f.name}|${f.className || cls.name}|${f.classSource || cls.source}|${f.level || ix + 1}}`); }));
			(sc?.subclassFeatures || []).forEach((lv) => (lv || []).forEach(f => { if ((f?.level || 0) <= level) parse(f?.entries, f?.name, `{@subclassFeature ${f.name}|${sc.className}|${sc.classSource}|${sc.shortName}|${sc.source}|${f.level}}`); }));
		});
		parse(bg?.entries, bg?.name, bg ? `{@background ${bg.name}|${bg.source}}` : null);
		this.equippedItems().forEach(it => { if (this._magicActive(it)) parse(it.entries, it.name, `{@item ${it.name}|${it.source}}`); });
		return out;
	}

	/* ----- inventory ----- */
	_resolveItem (name, source) {
		const idx = this._data.itemIndex; const idxName = this._data.itemIndexByName;
		if (source && idx?.has(`${name}|${source}`.toLowerCase())) return idx.get(`${name}|${source}`.toLowerCase());
		return idxName?.get(`${name}`.toLowerCase()) || null;
	}

	addToInventory ({uid, name, qty = 1, choiceCategory = null}) {
		if (uid) { const ex = this.inventory.find(r => r.uid === uid); if (ex) { ex.qty += qty; return; } }
		this.inventory.push({uid: uid || null, name, qty, equipped: false, ...(choiceCategory ? {choiceCategory} : {})});
	}

	removeFromInventory (ix) {
		const [row] = this.inventory.splice(ix, 1);
		if (row && row.uid === this.armorUid) this.armorUid = null; // un-wear armor that's no longer owned
		if (row && row.uid === this.shieldUid) this.shieldUid = null;
		if (row && row.uid) this.attunedUids = this.attunedUids.filter(u => u !== row.uid);
	}

	// Resolve chosen class + background starting equipment into [{uid, name, qty}]
	resolveStartingEquipment () {
		const out = [];
		const pushTag = (rawName, rawSource, displayFallback, qty = 1) => {
			const it = this._resolveItem(`${rawName}`.trim(), `${rawSource || ""}`.trim());
			if (it) out.push({uid: CW.uid(it), name: it.name, qty});
			else out.push({uid: null, name: displayFallback || rawName, qty});
		};
		const addTagsFromString = (str) => {
			const re = /\{@item ([^}]+)\}/g; let m;
			while ((m = re.exec(str)) !== null) {
				const parts = m[1].split("|");
				pushTag(parts[0], parts[1], parts[2] || parts[0]);
			}
			// category weapon choices, e.g. "two {@filter martial weapons|items|...}" -> 2 "choose a weapon" slots
			const reF = /\{@filter ([^}|]+)\|[^}]*\}/g; let fm;
			while ((fm = reF.exec(str)) !== null) {
				const display = `${fm[1]}`.toLowerCase();
				if (!/weapon/.test(display)) continue;
				const pre = str.slice(Math.max(0, fm.index - 14), fm.index).toLowerCase();
				const cm = pre.match(/\b(two|three|four|2|3|4)\b[^a-z0-9]*$/);
				const nW = {two: 2, three: 3, four: 4};
				const count = cm ? (nW[cm[1]] || parseInt(cm[1], 10) || 1) : 1;
				const category = display.includes("martial") ? "martial" : (display.includes("simple") ? "simple" : null);
				const melee = display.includes("melee"); const ranged = display.includes("ranged");
				const label = `${category ? `${category} ` : ""}weapon${melee ? " (melee)" : ranged ? " (ranged)" : ""}`;
				for (let i = 0; i < count; ++i) out.push({uid: null, name: `${label} (choose)`, qty: 1, choiceCategory: {category, melee, ranged}});
			}
		};
		const cls = this.classEnt;
		(cls?.startingEquipment?.default || []).forEach((line, ix) => {
			const opts = CW.splitEquipChoice(line);
			const chosen = opts.length > 1 ? (opts[this.equipmentChoices[ix] ?? 0] || opts[0]) : line;
			addTagsFromString(chosen);
		});
		const bg = this.backgroundEnt;
		(bg?.startingEquipment || []).forEach(grp => {
			const arr = grp._ || grp.a || grp.b || [];
			arr.forEach(it => {
				if (typeof it === "string") { const p = it.split("|"); pushTag(p[0], p[1], p[0]); } else if (it.item) { const p = `${it.item}`.split("|"); pushTag(p[0], p[1], it.displayName || p[0], it.quantity || 1); } else if (it.special) out.push({uid: null, name: it.special, qty: it.quantity || 1});
			});
		});
		return out;
	}

	addStartingEquipmentToInventory () { this.resolveStartingEquipment().forEach(r => this.addToInventory(r)); }

	// mundane fantasy weapons matching a category choice (simple/martial, optional melee/ranged)
	weaponOptions ({category, melee, ranged} = {}) {
		const seen = new Set();
		return (this._data.items || [])
			.filter(it => {
				if (!it.weapon || !it.weaponCategory) return false;
				if (it.magic || (it.rarity && it.rarity !== "none") || it.age) return false; // no magic / firearms / sci-fi
				if (!this.isVisible(it)) return false;
				if (category && it.weaponCategory !== category) return false;
				const t = `${it.type || ""}`.split("|")[0];
				if (melee && t !== "M") return false;
				if (ranged && t !== "R") return false;
				return true;
			})
			.map(it => it.name)
			.filter(n => { if (seen.has(n)) return false; seen.add(n); return true; })
			.sort(SortUtil.ascSortLower);
	}

	/* ----- weapons / attacks ----- */
	_itemByUid (uid) { return uid ? (this._data.itemIndex?.get(`${uid}`.toLowerCase()) || null) : null; }
	isWeapon (it) { return !!(it && it.weapon && it.weaponCategory); }
	// weapons currently wielded (inventory rows flagged equipped)
	wieldedWeapons () { return this.inventory.filter(r => r.equipped && this.isWeapon(this._itemByUid(r.uid))).map(r => this._itemByUid(r.uid)).filter(Boolean); }

	// weapon proficiencies: {cats:Set<"simple"|"martial">, names:Set<weapon name>} from classes + race + background
	weaponProficiencies () {
		const cats = new Set(); const names = new Set();
		const addCatOrName = (raw) => {
			const s = `${raw}`.toLowerCase().trim();
			if (s === "simple" || s === "simple weapons") cats.add("simple");
			else if (s === "martial" || s === "martial weapons") cats.add("martial");
			else { const m = `${raw}`.match(/\{@item ([^}|]+)/); const nm = (m ? m[1] : s).split("|")[0].trim().toLowerCase(); if (nm) names.add(nm); }
		};
		const addClassArr = (arr) => (arr || []).forEach(w => {
			if (typeof w === "string") addCatOrName(w);
			else if (w && typeof w === "object") { const p = `${w.proficiency || w.full || ""}`.toLowerCase(); if (/martial/.test(p)) cats.add("martial"); else if (/simple/.test(p)) cats.add("simple"); }
		});
		this.classList().forEach(({cls, isPrimary}) => addClassArr(isPrimary ? cls.startingProficiencies?.weapons : cls.multiclassing?.proficienciesGained?.weapons));
		const addObjArr = (arr) => (arr || []).forEach(grp => { if (!grp || typeof grp !== "object" || grp.choose) return; Object.entries(grp).forEach(([k, v]) => { if (v !== true) return; const kl = `${k}`.toLowerCase(); if (/martial/.test(kl)) cats.add("martial"); else if (/simple/.test(kl)) cats.add("simple"); else names.add(kl.split("|")[0].trim()); }); });
		addObjArr(this.raceEnt?.weaponProficiencies);
		addObjArr(this.backgroundEnt?.weaponProficiencies);
		this.chosenForType("weapon").forEach(n => names.add(`${n}`.toLowerCase())); // chosen weapon profs (e.g. Hobgoblin)
		const fw = this.featWeaponProfs(); fw.cats.forEach(c => cats.add(c)); fw.names.forEach(n => names.add(n)); // Weapon Master, Gunner, …
		return {cats, names};
	}
	_proficientWithWeapon (it) {
		const {cats, names} = this.weaponProficiencies();
		if (it.weaponCategory && cats.has(it.weaponCategory)) return true;
		const baseName = (it.baseItem ? `${it.baseItem}`.split("|")[0] : it.name).toLowerCase();
		return names.has(baseName) || names.has(`${it.name}`.toLowerCase());
	}

	// the ability used for a weapon's attack/damage (finesse -> better of Str/Dex; ranged -> Dex; else Str)
	_weaponAbility (it) {
		const props = (it.property || []).map(p => `${p}`.split("|")[0].toUpperCase());
		const ranged = `${it.type || ""}`.split("|")[0] === "R";
		if (props.includes("F")) return this.abilityMod("str") >= this.abilityMod("dex") ? "str" : "dex";
		return ranged ? "dex" : "str";
	}
	// magic attack/damage bonus: bonusWeapon applies to both; bonusWeaponAttack/Damage are specific
	_bonusWeaponNum (it, kind) {
		const num = (v) => v ? (parseInt(`${v}`.replace(/[^-0-9]/g, ""), 10) || 0) : 0;
		return num(it.bonusWeapon) + num(it[kind === "attack" ? "bonusWeaponAttack" : "bonusWeaponDamage"]);
	}

	weaponAttack (it) {
		const ability = this._weaponAbility(it);
		const abilMod = this.abilityMod(ability);
		const prof = this._proficientWithWeapon(it);
		const props = (it.property || []).map(p => `${p}`.split("|")[0].toUpperCase());
		const active = this._magicActive(it); // magic +N only applies once attuned (when required)
		const magicAtk = active ? this._bonusWeaponNum(it, "attack") : 0;
		const magicDmg = active ? this._bonusWeaponNum(it, "damage") : 0;
		const ranged = `${it.type || ""}`.split("|")[0] === "R";
		const fsAtk = (ranged && this.hasFightingStyle("Archery")) ? 2 : 0; // Archery: +2 to ranged attacks
		const fsDmg = (!ranged && !props.includes("2H") && this.hasFightingStyle("Dueling")) ? 2 : 0; // Dueling: +2 dmg one-handed melee
		const toHit = abilMod + (prof ? this.profBonus : 0) + magicAtk + fsAtk;
		return {
			name: it.name, source: it.source, ability, prof, toHit, abilMod,
			dmg1: it.dmg1, dmg2: (props.includes("V") ? it.dmg2 : null), dmgType: it.dmgType,
			dmgBonus: abilMod + magicDmg + fsDmg, magicAtk, magicDmg, fsDmg,
			ranged, range: it.range,
			magic: magicAtk || magicDmg,
			critThreshold: (active && it.critThreshold) || null, // crits on N-20
			properties: props.map(p => CW.WEAPON_PROP[p]).filter(Boolean),
		};
	}
	// extra/conditional damage carried in a weapon's description text (e.g. Flame Tongue +2d6 fire; Mace of Disruption +2d6 radiant vs undead)
	// → [{dice, type?}] — these are situational, so the UI shows them as optional rollable riders.
	_DMG_TYPE_WORDS = /^(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|bludgeoning|piercing|slashing)$/i;
	weaponExtraDamage (it) {
		const out = []; const seen = new Set();
		const walk = (e) => {
			if (typeof e === "string") {
				const re = /\{@damage ([^}|]+?)(?:\|[^}]*)?\}\s*(?:\([^)]*\)\s*)?(\w+)?/g; let m;
				while ((m = re.exec(e))) {
					const dice = `${m[1]}`.trim(); if (!/\dd\d/.test(dice)) continue;
					const type = (m[2] && this._DMG_TYPE_WORDS.test(m[2])) ? m[2].toLowerCase() : null;
					const k = `${dice}|${type}`; if (seen.has(k)) continue; seen.add(k); out.push({dice, type});
				}
			} else if (Array.isArray(e)) e.forEach(walk);
			else if (e && typeof e === "object") { if (e.entries) walk(e.entries); if (e.items) walk(e.items); }
		};
		walk(it?.entries);
		return out;
	}
	// formatted damage string, e.g. "1d8 +3 slashing" (versatile shown separately by the UI)
	fmtWeaponDamage (dice, atk) {
		if (!dice) return "—";
		const b = atk.dmgBonus;
		return `${dice}${b ? ` ${CW.fmtMod(b)}` : ""}${atk.dmgType ? ` ${CW.DMG_TYPE[atk.dmgType] || atk.dmgType}` : ""}`;
	}

	acBreakdown () {
		const dex = this.abilityMod("dex");
		const armor = this.armorEnt();
		let base; let how;
		if (armor) {
			const typeAbv = `${armor.type || ""}`.split("|")[0];
			const magic = this._magicActive(armor) ? this._bonusAcNum(armor) : 0;
			const baseAc = (armor.ac || 10) + magic;
			const magicTxt = magic ? ` (+${magic})` : "";
			if (typeAbv === "HA") { base = baseAc; how = `${armor.name}${magicTxt}`; } else if (typeAbv === "MA") { const d = Math.min(dex, armor.dexterityMax ?? 2); base = baseAc + d; how = `${armor.name}${magicTxt} + Dex (max ${armor.dexterityMax ?? 2})`; } else { base = baseAc + dex; how = `${armor.name}${magicTxt} + Dex`; }
		} else {
			// Monk Unarmored Defense requires no shield; Barbarian allows a shield
			if (this.hasClass("Barbarian")) { base = 10 + dex + this.abilityMod("con"); how = "Unarmored Defense (10 + Dex + Con)"; } else if (this.hasClass("Monk") && !this.isShieldEffective()) { base = 10 + dex + this.abilityMod("wis"); how = "Unarmored Defense (10 + Dex + Wis)"; } else { base = 10 + dex; how = "Unarmored (10 + Dex)"; }
			// race natural armor — use if it gives a higher (or equal) AC
			const nat = this.naturalArmor();
			if (nat) {
				const natAc = nat.base + (nat.abil ? this.abilityMod(nat.abil) : 0);
				if (natAc >= base) { base = natAc; how = `Natural Armor (${nat.base}${nat.abil ? ` + ${nat.abil.toUpperCase()}` : ""})`; }
			}
		}
		const shield = this.shieldEnt();
		if (shield) { const sMagic = this._magicActive(shield) ? this._bonusAcNum(shield) : 0; base += (shield.ac || 2) + sMagic; how += ` + Shield${sMagic ? ` (+${sMagic})` : ""}`; }
		const wornAc = this._wornAcBonus();
		if (wornAc) { base += wornAc; how += ` + ${CW.fmtMod(wornAc)} (items)`; }
		if (armor && this.hasFightingStyle("Defense")) { base += 1; how += " + 1 (Defense style)"; } // +1 AC while wearing armor
		return {ac: base, how};
	}

	// AC bonus from worn rings/wondrous items (Ring/Cloak of Protection +1, Bracers of Defense +2…)
	_wornAcBonus () {
		const armored = !!this.armorEnt() || !!this.shieldEnt();
		let bonus = 0;
		this._wornWondrousEquipped().forEach(it => {
			if (!this._magicActive(it)) return;
			const b = this._bonusAcNum(it); if (!b) return;
			if (this._itemAcUnarmoredOnly(it) && armored) return; // e.g. Bracers of Defense — only while unarmored & no shield
			bonus += b;
		});
		return bonus;
	}
	_itemAcUnarmoredOnly (it) { return /(?:wear|wearing|using|use)\s+no\s+armor|aren'?t wearing armor|no armor and (?:using |carrying )?no shield/i.test(JSON.stringify(it.entries || "")); }

	ac () { return this.acBreakdown().ac; }
	initiative () {
		const base = this.abilityMod("dex");
		const hp = this.halfProfMeta();
		return base + (hp && (hp.abilities === null || hp.abilities.has("dex")) ? hp.amount : 0) + this.featInitiativeBonus(); // Alert
	}
	// passive score = 10 + skill modifier (+5 advantage / -5 disadvantage)
	passiveScore (skill) {
		let s = 10 + this.skillMod(skill);
		if ((skill === "perception" || skill === "investigation") && this.featPassivePerceptionBonus()) s += this.featPassivePerceptionBonus(); // Observant
		const ad = this.skillAdvDis(skill);
		if (ad?.net === "adv") s += 5; else if (ad?.net === "dis") s -= 5;
		return s;
	}
	passivePerception () { return this.passiveScore("perception"); }

	// +N ft. speed from features gained (Barbarian Fast Movement, Monk Unarmored Movement, …)
	speedBonusFromFeatures () {
		let bonus = 0; const armored = !!this.armorEnt();
		const addFrom = (fbl, maxLv) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => {
			if (!f?.name || (f.level || (ix + 1)) > maxLv) return;
			const text = JSON.stringify(f.entries || "").toLowerCase();
			const m = text.match(/speed increases by (\d+) ?(?:feet|ft)/);
			if (!m) return;
			const conditional = /(?:not|aren't|are not|no) wearing armor|wearing no armor/.test(text);
			if (!conditional || !armored) bonus += parseInt(m[1], 10);
		}));
		this.classList().forEach(({cls, level, subclassEnt}) => { addFrom(cls.classFeatures, level); addFrom(subclassEnt?.subclassFeatures, level); });
		return bonus + this.featSpeedBonus(); // Mobile +10
	}

	speedString () {
		const sp = this.raceEnt?.speed; if (sp == null) return "—";
		const bonus = this.speedBonusFromFeatures();
		const penalty = this.armorEffects().strReqUnmet ? 10 : 0; // heavy armor STR requirement not met
		const walk = Math.max(0, (typeof sp === "number" ? sp : (sp.walk ?? 30)) + bonus - penalty);
		const parts = [`${walk} ft.`];
		if (typeof sp === "object") {
			[["fly", "fly"], ["swim", "swim"], ["climb", "climb"], ["burrow", "burrow"]].forEach(([k, lbl]) => {
				const v = sp[k]; if (v) parts.push(`${lbl} ${v === true ? walk : v} ft.`);
			});
		}
		const notes = [bonus ? `+${bonus} features` : "", penalty ? `−10 armor Str req` : ""].filter(Boolean);
		return parts.join(", ") + (notes.length ? ` (${notes.join(", ")})` : "");
	}

	// Race natural armor (text-parsed): {base, abil} or null
	naturalArmor () {
		const text = JSON.stringify(this.raceEnt?.entries || "").toLowerCase();
		let m = text.match(/(?:armor class|\bac\b)[^.]{0,40}?(\d{2}) \+ your (\w+) modifier/);
		if (m) { const abv = CW.ABIL_NAME_TO_ABV[m[2]]; if (abv) return {base: parseInt(m[1], 10), abil: abv}; }
		m = text.match(/(?:base ac|armor class)(?: is| of| equals) (\d{2})\b/);
		if (m) return {base: parseInt(m[1], 10), abil: null};
		// "+N bonus to armor class" from natural armor (Lizardfolk/Troglodyte DMG) -> 10 + N + Dex
		if (/natural armor|scales|thick (?:hide|skin)|shell|carapace/.test(text)) { m = text.match(/\+(\d) bonus to (?:your )?(?:armor class|ac)\b/); if (m) return {base: 10 + parseInt(m[1], 10), abil: "dex"}; }
		// class/subclass unarmored AC (e.g. Draconic Resilience "your AC equals 13 + your Dexterity modifier")
		let cna = null;
		this.classList().forEach(({cls, level, subclassEnt}) => {
			const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => {
				if (cna || !f?.entries || (f.level || (ix + 1)) > level) return;
				const t = JSON.stringify(f.entries).toLowerCase();
				if (!/(?:aren't|are not|not) wearing armor|wear no armor/.test(t)) return; // self unarmored AC only
				const mm = t.match(/your (?:armor class|ac) (?:equals|is) (\d{2}) \+ your (\w+) modifier/);
				if (mm) { const abv = CW.ABIL_NAME_TO_ABV[mm[2]]; if (abv) cna = {base: parseInt(mm[1], 10), abil: abv}; }
			}));
			scan(cls.classFeatures); scan(subclassEnt?.subclassFeatures);
		});
		return cna;
	}

	creatureType () { const ct = this.raceEnt?.creatureTypes; return ct?.length ? ct.map(t => `${t}`.toTitleCase()).join(", ") : null; }

	// the size abvs a race lets you choose between (e.g. ["S","M"]), or null
	sizeOptions () { const s = this.raceEnt?.size; return Array.isArray(s) && s.length > 1 ? s : null; }
	sizeAbv () {
		const s = this.raceEnt?.size; if (!Array.isArray(s) || !s.length) return null;
		if (s.length === 1) return s[0];
		return (this.sizeChoice && s.includes(this.sizeChoice)) ? this.sizeChoice : (s.includes("M") ? "M" : s[0]); // default to Medium when offered
	}
	size () { const a = this.sizeAbv(); return a ? Parser.sizeAbvToFull(a) : "—"; }

	senses () {
		const r = this.raceEnt; const out = [];
		if (r?.darkvision) out.push(`darkvision ${r.darkvision} ft.`);
		if (r?.blindsight) out.push(`blindsight ${r.blindsight} ft.`);
		if (r?.tremorsense) out.push(`tremorsense ${r.tremorsense} ft.`);
		if (r?.truesight) out.push(`truesight ${r.truesight} ft.`);
		return out;
	}

	languages () {
		const out = new Set();
		const add = (grps) => (grps || []).forEach(grp => Object.entries(grp).forEach(([k, v]) => {
			if (k.startsWith("any") || k.startsWith("anyStandard")) out.add(`${v} of your choice`);
			else if (v === true) out.add(k.toTitleCase());
		}));
		add(this.raceEnt?.languageProficiencies);
		add(this.backgroundEnt?.languageProficiencies);
		return [...out];
	}

	armorWeaponToolProfs () {
		const fmtList = (a) => (a || []).map(x => typeof x === "string" ? x : (x.proficiency || x.full || x.special || "")).filter(Boolean);
		// title-case plain words, but leave {@tag ...} strings intact for the Renderer
		const tc = (s) => `${s}`.includes("{@") ? `${s}` : `${s}`.toTitleCase();
		const armor = new Set(); const weapons = new Set(); const tools = new Set();
		this.classList().forEach(({cls, isPrimary}) => {
			const src = isPrimary ? (cls.startingProficiencies || {}) : (cls.multiclassing?.proficienciesGained || {});
			fmtList(src.armor).forEach(x => armor.add(tc(x)));
			fmtList(src.weapons).forEach(x => weapons.add(tc(x)));
			if (isPrimary) fmtList(src.tools).forEach(x => tools.add(tc(x)));
		});
		return {armor: [...armor], weapons: [...weapons], tools: [...tools]};
	}

	// Features gained up to current level, grouped per class: [{title, items:[{name,entries,level,kind}]}]
	featureSections () {
		const out = [];
		this.classList().forEach(({cls, level, subclassEnt: sc}) => {
			const items = [];
			(cls.classFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => { if (f?.name && !f.isClassFeatureVariant && (f.level || (ix + 1)) <= level) items.push({name: f.name, entries: f.entries, level: f.level || (ix + 1), kind: "class"}); }));
			(sc?.subclassFeatures || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => { if (f?.name && (f.level || (ix + 1)) <= level) items.push({name: f.name, entries: f.entries, level: f.level || (ix + 1), kind: "subclass"}); }));
			items.sort((a, b) => a.level - b.level);
			if (items.length) out.push({title: `${cls.name}${sc ? ` (${sc.name})` : ""} ${level}`, items});
		});
		return out;
	}

	/* ----- fighting styles (optional features) ----- */
	static _FS_TYPE = {Fighter: "FS:F", Paladin: "FS:P", Ranger: "FS:R", Bard: "FS:B"};
	// {slots, types:Set} — how many fighting styles you can pick and which class lists are available
	fightingStyleInfo () {
		let slots = 0; const types = new Set();
		this.classList().forEach(({cls, level, subclassEnt}) => {
			let n = 0;
			const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if (f?.name && /^(?:additional |bonus )?fighting style$/i.test(f.name) && (f.level || (ix + 1)) <= level) n++; }));
			scan(cls.classFeatures); scan(subclassEnt?.subclassFeatures);
			if (n) { slots += n; types.add(CharState._FS_TYPE[cls.name] || "FS:F"); }
		});
		return {slots, types};
	}
	fightingStyleSlots () { return this.fightingStyleInfo().slots; }
	// styles available to the character (matching the FS lists of its fighting-style classes), deduped by name
	fightingStyleOptions () {
		const {types} = this.fightingStyleInfo(); if (!types.size) return [];
		const seen = new Set();
		return (this._data.fightingStyles || [])
			.filter(o => this.isVisible(o) && (o.featureType || []).some(t => types.has(t)))
			.filter(o => { if (seen.has(o.name)) return false; seen.add(o.name); return true; })
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}
	chosenFightingStyles () { return (this.fightingStyles || []).map(uid => (this._data.fightingStyles || []).find(o => CW.uid(o) === uid)).filter(Boolean); }
	hasFightingStyle (name) { return this.chosenFightingStyles().some(o => o.name === name); }

	/* ----- spellcasting (multiclass-aware) ----- */
	// standard multiclass spellcaster slot table: combined caster level -> [L1..L9]
	static _MC_SLOTS = {
		1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2], 6: [4, 3, 3], 7: [4, 3, 3, 1], 8: [4, 3, 3, 2],
		9: [4, 3, 3, 3, 1], 10: [4, 3, 3, 3, 2], 11: [4, 3, 3, 3, 2, 1], 12: [4, 3, 3, 3, 2, 1],
		13: [4, 3, 3, 3, 2, 1, 1], 14: [4, 3, 3, 3, 2, 1, 1], 15: [4, 3, 3, 3, 2, 1, 1, 1], 16: [4, 3, 3, 3, 2, 1, 1, 1],
		17: [4, 3, 3, 3, 2, 1, 1, 1, 1], 18: [4, 3, 3, 3, 3, 1, 1, 1, 1], 19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
	};

	// A "spell source" is a class or a caster subclass (e.g. Eldritch Knight). Each carries its own progression.
	spellSources () {
		const out = [];
		this.classList().forEach(({cls, level, subclassEnt, uid}) => {
			if (cls.casterProgression || cls.spellcastingAbility) out.push({kind: "class", uid, ent: cls, classEnt: cls, subclassEnt, level, name: cls.name, prog: cls.casterProgression, ability: cls.spellcastingAbility, listClassName: cls.name, preparedSpells: cls.preparedSpells});
			if (subclassEnt && (subclassEnt.casterProgression || subclassEnt.spellcastingAbility)) out.push({kind: "subclass", uid: CW.uid(subclassEnt), ent: subclassEnt, classEnt: cls, subclassEnt, level, name: `${cls.name} (${subclassEnt.name})`, prog: subclassEnt.casterProgression, ability: subclassEnt.spellcastingAbility, listClassName: this._subclassSpellListClass(cls, subclassEnt), preparedSpells: subclassEnt.preparedSpells});
		});
		return out;
	}
	_subclassSpellListClass (cls, sc) { return /eldritch knight|arcane trickster/i.test(sc.name) ? "Wizard" : cls.name; }

	/* ----- subclass spells: prepared (domain/oath/circle) + expanded (warlock/EK) + bonus known (domain cantrips) + innate (totem rituals) ----- */
	// full parse of a source's subclass additionalSpells (gated by the class level), combining all groups
	subclassSpellInfo (src) {
		const sc = src?.subclassEnt; const groups = sc?.additionalSpells; if (!groups?.length) return null;
		const acc = {knownFixed: [], knownChoose: [], innate: [], prepared: [], expanded: []};
		groups.forEach((as, gi) => { const p = this._parseAdditionalSpellGroup(as, src.level, `sc${gi}:`); Object.keys(acc).forEach(k => acc[k].push(...p[k])); });
		return acc;
	}
	// subclass spell info for every class (incl. non-casters like Totem Barbarian) — for the review sheet
	classSubclassSpellInfos () {
		return this.classList().map(c => {
			if (!c.subclassEnt?.additionalSpells?.length) return null;
			const pseudo = {subclassEnt: c.subclassEnt, level: c.level};
			const info = this.subclassSpellInfo(pseudo);
			const has = info && (info.knownFixed.length || info.knownChoose.length || info.innate.length || info.prepared.length || info.expanded.length);
			return has ? {cls: c.cls, subclass: c.subclassEnt, level: c.level, ability: c.cls.spellcastingAbility || null, info} : null;
		}).filter(Boolean);
	}
	// always-prepared spells from a source's subclass (keyed by class level): [{sp, level}]
	subclassPreparedSpells (src) { return this.subclassSpellInfo(src)?.prepared || []; }
	// spell objects added to the pickable list (gated by castable spell level), e.g. Warlock patron / EK
	subclassExpandedSpells (src) { const i = this.subclassSpellInfo(src); if (!i) return []; const maxLvl = this.maxSpellLevelForSource(src); return i.expanded.filter(e => e.spellLevel <= maxLvl).map(e => e.sp); }

	/* ----- background-granted spells (Ravnica guilds, Strixhaven) — mostly "expanded" added to your spell list ----- */
	backgroundSpellsInfo () {
		const groups = this.backgroundEnt?.additionalSpells; if (!groups?.length) return null;
		const acc = {knownFixed: [], knownChoose: [], innate: [], prepared: [], expanded: []};
		groups.forEach((as, gi) => { const p = this._parseAdditionalSpellGroup(as, this.level, `bg${gi}:`); Object.keys(acc).forEach(k => acc[k].push(...p[k])); });
		acc.ability = groups.find(g => typeof g.ability === "string")?.ability || null;
		return acc;
	}

	// expanded spells granted to the whole character (not subclass-specific): background guilds + racial dragonmarks + feats
	_nonSubclassExpandedSpells () {
		const out = [];
		const bg = this.backgroundSpellsInfo(); if (bg) out.push(...bg.expanded);
		const rs = this.racialSpellsInfo(); if (rs) out.push(...rs.expanded);
		this.featSpellSources().forEach(({info}) => { if (info) out.push(...info.expanded); });
		return out;
	}
	isCaster () { return this.spellSources().length > 0; }

	spellAbilityFor (src) { return src?.ability || null; }
	spellSaveDcFor (src) { const a = this.spellAbilityFor(src); return a ? 8 + this.profBonus + this.abilityMod(a) + this.equippedItemEffects().spellDc : null; }
	spellAtkBonusFor (src) { const a = this.spellAbilityFor(src); return a ? this.profBonus + this.abilityMod(a) + this.equippedItemEffects().spellAtk : null; }

	// spell slots from an entity's own progression table (class or subclass table groups)
	_ownSpellSlots (ent, level) {
		const groups = ent?.classTableGroups || ent?.subclassTableGroups; if (!groups) return null;
		const grp = groups.find(g => g.rowsSpellProgression) || groups.find(g => /spell slots/i.test(g.title || ""));
		const rows = grp?.rowsSpellProgression || grp?.rows;
		const row = rows?.[level - 1]; if (!row) return null;
		const out = {};
		row.forEach((cell, ix) => { const n = typeof cell === "number" ? cell : parseInt(`${cell}`.replace(/[^0-9]/g, ""), 10); if (n > 0) out[ix + 1] = n; });
		return Object.keys(out).length ? out : null;
	}

	// combined caster level for the multiclass spell-slot table (excludes Warlock pact magic)
	_combinedCasterLevel () {
		let lvl = 0;
		this.spellSources().forEach(({prog, level}) => {
			if (prog === "full") lvl += level;
			else if (prog === "1/2") lvl += Math.floor(level / 2);
			else if (prog === "artificer") lvl += Math.ceil(level / 2);
			else if (prog === "1/3") lvl += Math.floor(level / 3);
		});
		return lvl;
	}

	// Pact Magic (Warlock) slots — parsed from the "Spell Slots" + "Slot Level" table columns; separate from the regular table
	pactSlots () {
		const src = this.spellSources().find(s => s.prog === "pact");
		if (!src) return null;
		for (const g of (src.ent.classTableGroups || [])) {
			const labels = (g.colLabels || []).map(l => `${l}`);
			const numIx = labels.findIndex(l => /spell slots/i.test(l));
			const lvlIx = labels.findIndex(l => /slot level/i.test(l));
			if (numIx < 0 || lvlIx < 0 || !g.rows) continue;
			const row = g.rows[src.level - 1]; if (!row) return null;
			const num = parseInt(`${row[numIx]}`.replace(/[^0-9]/g, ""), 10);
			const lvlCell = `${row[lvlIx]}`;
			const lvl = parseInt((lvlCell.match(/level=(\d+)/) || lvlCell.match(/(\d+)/) || [])[1], 10);
			return (num > 0 && lvl > 0) ? {[lvl]: num} : null;
		}
		return null;
	}

	// Regular (non-pact) spell slots. One source -> its own table; multiple -> the multiclass table.
	spellSlots () {
		const nonPact = this.spellSources().filter(s => s.prog !== "pact");
		if (!nonPact.length) return null;
		if (nonPact.length === 1) return this._ownSpellSlots(nonPact[0].ent, nonPact[0].level);
		const row = CharState._MC_SLOTS[this._combinedCasterLevel()]; if (!row) return null;
		const out = {};
		row.forEach((n, ix) => { if (n > 0) out[ix + 1] = n; });
		return Object.keys(out).length ? out : null;
	}

	maxSpellLevel () { const s = this.spellSlots(); if (!s) return 0; return Math.max(0, ...Object.keys(s).map(Number)); }
	// highest spell level a single source can know/prepare, from its own table (Warlock uses its Pact Magic slot level)
	maxSpellLevelForSource (src) { let s = this._ownSpellSlots(src.ent, src.level); if (!s && src.prog === "pact") s = this.pactSlots(); return s ? Math.max(0, ...Object.keys(s).map(Number)) : 0; }

	cantripsKnownFor (src) { return src?.ent?.cantripProgression ? (src.ent.cantripProgression[src.level - 1] || 0) : 0; }
	leveledSpellsKnownFor (src) {
		const ent = src.ent;
		if (ent.spellsKnownProgression) return ent.spellsKnownProgression[src.level - 1] || 0;
		if (src.preparedSpells) return this._evalPreparedFormula(src.preparedSpells, src);
		return 0;
	}

	// evaluate a 5etools preparedSpells formula, e.g. "<$level$> / 2 + <$cha_mod$>" (half-caster) -> floor(level/2)+mod, min 1
	_evalPreparedFormula (formula, src) {
		const replaced = `${formula}`
			.replace(/<\$level\$>/g, `${src.level}`)
			.replace(/<\$(\w+?)_mod\$>/g, (m, ab) => `${this.abilityMod(ab)}`);
		let total = 0;
		replaced.split("+").forEach(term => {
			term = term.trim(); if (!term) return;
			const div = term.match(/^(-?\d+)\s*\/\s*(\d+)$/);
			if (div) total += parseInt(div[1], 10) / parseInt(div[2], 10);
			else total += parseInt(term, 10) || 0;
		});
		return Math.max(1, Math.floor(total));
	}
	spellListForSource (src) {
		const base = this._data.spells.filter(sp => this.isVisible(sp) && this._spellInClass(sp, src.listClassName));
		const maxLvl = this.maxSpellLevelForSource(src);
		const expanded = [
			...this.subclassExpandedSpells(src),
			...this._nonSubclassExpandedSpells().filter(e => e.spellLevel <= maxLvl).map(e => e.sp),
		];
		if (!expanded.length) return base;
		const seen = new Set(base.map(s => `${s.name}|${s.source}`));
		return [...base, ...expanded.filter(s => { if (!this.isVisible(s)) return false; const k = `${s.name}|${s.source}`; if (seen.has(k)) return false; seen.add(k); return true; })];
	}

	// per-source spell choices bucket {cantrips:[], leveled:[]}
	spellChoicesFor (uid) { return this.spellChoices[uid] || (this.spellChoices[uid] = {cantrips: [], leveled: []}); }

	/* ----- Warlock Mystic Arcanum (6th-9th level spells, one each at L11/13/15/17) ----- */
	_warlockLevel () { const w = this.classList().find(c => c.cls.name === "Warlock"); return w ? w.level : 0; }
	mysticArcanumLevels () { const wl = this._warlockLevel(); return [[11, 6], [13, 7], [15, 8], [17, 9]].filter(([req]) => wl >= req).map(([, sl]) => sl); }
	mysticArcanumOptions (spLvl) { return this._data.spells.filter(sp => this.isVisible(sp) && sp.level === spLvl && this._spellInClass(sp, "Warlock")).sort((a, b) => SortUtil.ascSortLower(a.name, b.name)); }

	/* ----- racial spellcasting (additionalSpells) ----- */
	_spellByName (name) { return this._data.spellIndexByName?.get(`${name}`.split("#")[0].split("|")[0].trim().toLowerCase()) || null; }
	// class names a spell belongs to — BOTH the core list and the "variant/optional" list (supplement spells like XGE Chaos Bolt are variant)
	_spellClassNames (sp) { const out = new Set(); [...(sp?.classes?.fromClassList || []), ...(sp?.classes?.fromClassListVariant || [])].forEach(c => out.add(c.name)); return out; }
	_spellInClass (sp, className) { return this._spellClassNames(sp).has(className); }
	// exact spell lookup for a buff/effect label (no #/| stripping, so only true spell names resolve)
	effectSpell (name) { return this._data.spellIndexByName?.get(`${name}`.trim().toLowerCase()) || null; }

	hasRacialSpells () { return !!this.raceEnt?.additionalSpells?.length; }

	_racialSpellAbilityEnt () { return (this.raceEnt?.additionalSpells || []).find(a => a.ability)?.ability; }
	racialSpellAbility () {
		const ab = this._racialSpellAbilityEnt(); if (!ab) return null;
		if (typeof ab === "string") return ab;
		if (Array.isArray(ab.choose)) return this.raceSpellAbility && ab.choose.includes(this.raceSpellAbility) ? this.raceSpellAbility : ab.choose.slice().sort((a, b) => this.abilityMod(b) - this.abilityMod(a))[0];
		return null;
	}
	racialSpellAbilityChoices () { const ab = this._racialSpellAbilityEnt(); return Array.isArray(ab?.choose) ? ab.choose : null; }
	racialSpellSaveDc () { const a = this.racialSpellAbility(); return a ? 8 + this.profBonus + this.abilityMod(a) : null; }

	// parse a 5etools spell-choose filter like "level=0|class=Wizard" or "level=1|school=E;D"
	racialSpellOptions (filter) {
		const params = {}; `${filter}`.split("|").forEach(p => { const [k, v] = p.split("="); if (k) params[k.trim()] = (v || "").trim(); });
		const levels = params.level != null && params.level !== "" ? `${params.level}`.split(";").map(s => +s.trim()).filter(s => !Number.isNaN(s)) : null; // "level=0;1;2;3" (Lore Bard secrets)
		const cls = params.class ? params.class.toLowerCase() : null;
		const schools = params.school ? params.school.toLowerCase().split(";").map(s => s.trim()).filter(Boolean) : null;
		return this._data.spells.filter(sp => this.isVisible(sp) && (!levels || levels.includes(sp.level)) && (!cls || [...this._spellClassNames(sp)].some(n => `${n}`.toLowerCase() === cls)) && (!schools || schools.includes(`${sp.school}`.toLowerCase())));
	}

	// multiple additionalSpells groups are alternatives the character picks ONE of (e.g. Astral Elf cantrip, Tiefling legacy)
	racialSpellGroups () { return this.raceEnt?.additionalSpells || []; }
	racialSpellGroupIx () { const g = this.racialSpellGroups(); return g.length ? Math.min(this.raceSpellGroup || 0, g.length - 1) : 0; }
	// auto-label a variant by its spells (the data carries no name)
	racialSpellGroupLabel (as) {
		if (as?.name) return `${as.name}`.toTitleCase(); // explicit group name (e.g. Magic Initiate "Bard Spells")
		const names = []; const collect = (obj) => Object.values(obj || {}).forEach(v => { if (Array.isArray(v)) v.forEach(x => { if (typeof x === "string") names.push(x.split("#")[0].split("|")[0]); }); else if (v && typeof v === "object") collect(v); });
		collect(as?.known); collect(as?.innate);
		// also surface the class/school a {choose} filter targets, so all-choose groups aren't just "Option"
		const collectChoose = (obj) => Object.values(obj || {}).forEach(v => { if (Array.isArray(v)) v.forEach(x => { if (x?.choose && typeof x.choose === "string") { const m = /class=([^|]+)/.exec(x.choose); if (m) names.push(m[1]); } }); else if (v && typeof v === "object") collectChoose(v); });
		if (!names.length) { collectChoose(as?.known); collectChoose(as?.innate); }
		return [...new Set(names)].slice(0, 3).map(n => n.toTitleCase()).join(", ") || "Option";
	}

	// shared parser for one additionalSpells variant group ->
	//   {knownFixed:[sp], knownChoose:[{key,filter,count,freq?,prepared?}], innate:[{sp,freq,level}], prepared:[{sp,level}], expanded:[{sp,spellLevel}]}
	// "known"/"prepared" spells gated by a frequency (rest/daily/will/ritual) are treated as innate; {choose} entries become knownChoose picks.
	// "prepared" = always-prepared (free, cast with your slots, gated by level); "expanded" = added to your spell list (keyed by spell level "sN").
	_parseAdditionalSpellGroup (as, charLevel, keyPrefix) {
		const knownFixed = []; const knownChoose = []; const innate = []; const prepared = []; const expanded = [];
		const lvlOk = (l) => l === "_" || +l <= charLevel; // "_" = always (no level gate); numeric = gained at that character level
		const lvlNum = (l) => (l === "_" ? 0 : +l) || 0;
		const per = (p) => `${p}`.replace(/e$/, "");
		// walk a value that is either a plain array, or a frequency-shaped object {_, will, ritual, rest:{}, daily:{}}.
		// onItem(it, freq|null, subKey) — freq null means "no frequency" (free/always).
		const walk = (val, onItem) => {
			if (Array.isArray(val)) { val.forEach((it, ix) => onItem(it, null, `${ix}`)); return; }
			(val._ || []).forEach((it, ix) => onItem(it, null, `${ix}`));
			(val.will || []).forEach((it, ix) => onItem(it, "at will", `w${ix}`));
			(val.ritual || []).forEach((it, ix) => onItem(it, "ritual", `rit${ix}`));
			Object.entries(val.rest || {}).forEach(([p, a]) => (a || []).forEach((it, ix) => onItem(it, `${per(p)}/rest`, `r${p}.${ix}`)));
			Object.entries(val.daily || {}).forEach(([p, a]) => (a || []).forEach((it, ix) => onItem(it, `${per(p)}/day`, `d${p}.${ix}`)));
		};
		Object.entries(as.known || {}).forEach(([lvlKey, val]) => {
			if (!lvlOk(lvlKey)) return;
			walk(val, (it, freq, subKey) => {
				if (typeof it === "string") { const sp = this._spellByName(it); if (!sp) return; if (freq) innate.push({sp, freq, level: lvlNum(lvlKey)}); else knownFixed.push(sp); }
				else if (it?.choose) knownChoose.push({key: `${keyPrefix}${lvlKey}:${subKey}`, filter: it.choose, count: it.count || 1, freq});
			});
		});
		Object.entries(as.innate || {}).forEach(([lvlKey, val]) => {
			if (!lvlOk(lvlKey)) return;
			walk(val, (it, freq, subKey) => {
				const f = freq || "at will";
				if (typeof it === "string") { const sp = this._spellByName(it); if (sp) innate.push({sp, freq: f, level: lvlNum(lvlKey)}); }
				else if (it?.choose) knownChoose.push({key: `${keyPrefix}i${lvlKey}:${subKey}`, filter: it.choose, count: it.count || 1, freq: f});
			});
		});
		Object.entries(as.prepared || {}).forEach(([lvlKey, val]) => {
			if (!lvlOk(lvlKey)) return;
			walk(val, (it, freq, subKey) => {
				if (typeof it === "string") { const sp = this._spellByName(it); if (!sp) return; if (freq) innate.push({sp, freq, level: lvlNum(lvlKey)}); else prepared.push({sp, level: lvlNum(lvlKey)}); }
				else if (it?.choose) knownChoose.push({key: `${keyPrefix}p${lvlKey}:${subKey}`, filter: it.choose, count: it.count || 1, freq, prepared: !freq});
			});
		});
		// expanded: spells added to your pickable list, keyed by spell level "sN"
		Object.entries(as.expanded || {}).forEach(([key, arr]) => {
			const spellLevel = parseInt(`${key}`.replace(/[^0-9]/g, ""), 10) || 0;
			(arr || []).forEach(it => { if (typeof it === "string") { const sp = this._spellByName(it); if (sp) expanded.push({sp, spellLevel}); } });
		});
		return {knownFixed, knownChoose, innate, prepared, expanded};
	}

	// { ability, abilityChoices, knownFixed, knownChoose, innate, groupCount } from the race's selected variant.
	racialSpellsInfo () {
		const groups = this.racialSpellGroups(); if (!groups.length) return null;
		const as = groups[this.racialSpellGroupIx()] || groups[0];
		return {...this._parseAdditionalSpellGroup(as, this.level, "rk:"), ability: this.racialSpellAbility(), abilityChoices: this.racialSpellAbilityChoices(), groupCount: groups.length};
	}

	/* ----- feat-granted spells (Magic Initiate, Fey Touched, Ritual Caster, dragonmarks…) ----- */
	_featSpellAbility (as, choice) {
		const ab = as?.ability;
		if (ab && typeof ab === "string" && ab !== "inherit") return ab; // Magic Initiate variant: cha/wis/int
		return (choice?.featAbilChoose && choice.featAbilChoose[0]) || null; // Fey/Shadow Touched: "inherit" the feat's chosen ability
	}
	// info for a feat's additionalSpells (selected variant); choice holds featSpellGroup + featSpellChoose
	featSpellsInfo (feat, choice) {
		const groups = feat?.additionalSpells; if (!groups?.length) return null;
		const ix = Math.min(choice?.featSpellGroup || 0, groups.length - 1);
		const as = groups[ix] || groups[0];
		const parsed = this._parseAdditionalSpellGroup(as, this.level, `fs${ix}:`);
		return {...parsed, ability: this._featSpellAbility(as, choice), groups, groupIx: ix};
	}
	// every taken feat that grants spells, with its resolved info — for the review sheet
	featSpellSources () {
		return this._allFeatInstances().map(({feat, choice}) => feat?.additionalSpells?.length ? {feat, choice, info: this.featSpellsInfo(feat, choice)} : null).filter(Boolean);
	}
	featSpellSaveDc (ability) { return ability ? 8 + this.profBonus + this.abilityMod(ability) : null; }

	/* ====================================================================== */
	/* Sidekick (creature-first) derivation                                   */
	/* ====================================================================== */
	sidekickCreature () { return this._byUid(this._data.bestiary, this.sidekick.creatureUid); }
	sidekickClassEnt () { return this._byUid(this._data.sidekickClasses, this.sidekick.classUid); }
	sidekickMeta () { const c = this.sidekickClassEnt(); return c ? SIDEKICK_META[c.name] : null; }
	sidekickLevel () { return Math.max(1, Math.min(20, this.sidekick.level || 1)); }
	sidekickProfBonus () { return CW.profBonus(this.sidekickLevel()); }
	sidekickName () { return this.sidekick.name || this.sidekickCreature()?.name || "Sidekick"; }
	sidekickReady () { return !!this.sidekickCreature(); }

	_creatureSize () { const s = this.sidekickCreature()?.size; return (Array.isArray(s) ? s[0] : s) || "M"; }
	// TCE: HP per level uses "the type of die [that] appears in the sidekick's stat block" — read it from the hp formula, fall back to the size table
	sidekickHitDie () { const m = /\d+\s*d\s*(\d+)/i.exec(`${this.sidekickCreature()?.hp?.formula || ""}`); return m ? +m[1] : (SIDEKICK_SIZE_DIE[this._creatureSize()] || 8); }
	// every eligible creature is CR ≤ 1/2 → base proficiency +2; sidekick PB rises with class level. TCE adds the difference to the stat block's attacks & DCs.
	sidekickPbDelta () { return Math.max(0, this.sidekickProfBonus() - 2); }
	// deep-copy stat-block data with attacks bumped by (PB increase + Attacker bonus) and DCs by the PB increase (TCE) — works on traits/actions AND spellcasting headerEntries
	sidekickAdjustEntries (data) {
		const hitDelta = this.sidekickAttackBonus(); const dcDelta = this.sidekickPbDelta();
		if ((!hitDelta && !dcDelta) || data == null) return data;
		const bump = (s) => `${s}`.replace(/\{@hit (-?\d+)\}/g, (m, n) => `{@hit ${+n + hitDelta}}`).replace(/\{@dc (\d+)([^}]*)\}/g, (m, n, rest) => `{@dc ${+n + dcDelta}${rest}}`);
		const walk = (e) => {
			if (typeof e === "string") return bump(e);
			if (Array.isArray(e)) return e.map(walk);
			if (e && typeof e === "object") { const o = {}; for (const k in e) o[k] = walk(e[k]); return o; }
			return e;
		};
		return walk(data);
	}
	/* ----- sidekick class-feature choices & combat effects ----- */
	sidekickFeatureNames () { return new Set(this.sidekickFeatures().map(f => f.name)); }
	_skHasFeature (name) { return this.sidekickFeatureNames().has(name); }
	sidekickMartialRole () { return this.sidekick.martialRole || null; } // Warrior L1: "attacker"|"defender"
	sidekickInitiativeAdv () { return this._skHasFeature("Battle Readiness"); } // Warrior L7: advantage on initiative
	sidekickCritRange () { return this._skHasFeature("Improved Critical") ? 19 : 20; } // Warrior L3: crits on 19-20
	sidekickExtraAttacks () { const n = this.sidekickFeatureNames(); if (n.has("Extra Attack Improvement")) return 3; if (n.has("Extra Attack")) return 2; return 1; } // Warrior L6/L15
	sidekickAttackBonus () { return this.sidekickPbDelta() + (this.sidekickMartialRole() === "attacker" ? 2 : 0); } // Attacker: +2 to all attack rolls

	sidekickAbilityBase (abv) { return this.sidekickCreature()?.[abv] ?? 10; }
	sidekickAbility (abv) {
		let v = this.sidekickAbilityBase(abv);
		Object.values(this.sidekick.asi || {}).forEach(a => {
			if (a?.type === "feat") { if (a.featUid) v += this._featAbilityBonus(a.featUid, a.featAbilChoose)[abv] || 0; }
			else if (a?.inc?.[abv]) v += a.inc[abv];
		});
		return Math.min(20, v);
	}
	// feats the sidekick took in place of an ASI (TCE allows this at the DM's option): [{level, feat, choice}]
	sidekickFeats () {
		const out = [];
		Object.entries(this.sidekick.asi || {}).forEach(([lv, a]) => { if (a?.type === "feat" && a.featUid) { const f = this._data.feats.find(x => CW.uid(x) === a.featUid); if (f) out.push({level: +lv, feat: f, choice: a}); } });
		return out.sort((a, b) => a.level - b.level);
	}

	// proficiencies granted by the sidekick class (armor always; weapons/tools only if the creature is a humanoid or wields a weapon)
	sidekickArmorProfs () { const meta = this.sidekickMeta(); return meta ? meta.armor.map(a => `${a} armor`) : []; }
	sidekickWeaponProfs () {
		const meta = this.sidekickMeta(); if (!meta) return [];
		const out = []; const q = this.sidekickQualifiesWeapons();
		if (meta.simpleIfQualified && q) out.push("simple weapons");
		if (meta.martialIfQualified && q) out.push("martial weapons");
		if (meta.shieldsIfQualified && q) out.push("shields");
		return out;
	}
	sidekickToolProfCount () { const meta = this.sidekickMeta(); return (meta?.toolsIfQualified && this.sidekickQualifiesWeapons()) ? meta.toolsIfQualified : 0; }
	sidekickToolProfs () { return (this.sidekick.toolChoices || []).filter(Boolean); }
	sidekickAbilityMod (abv) { return CW.mod(this.sidekickAbility(abv)); }

	// HP: creature's base HP + (size hit-die average + Con mod, min 1) per level above 1st (Tasha's)
	// average HP from a creature's hp.formula ("2d8 + 2" → 11) — fallback when hp.average is absent (some unknown-CR/summon stat blocks)
	_avgFromFormula (f) {
		const m = /(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?/i.exec(`${f || ""}`);
		if (!m) return null;
		const mod = m[4] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0;
		return Math.floor(+m[1] * (+m[2] + 1) / 2 + mod);
	}
	sidekickMaxHp () {
		const m = this.sidekickCreature(); if (!m) return null;
		const hp = m.hp || {};
		const base = hp.average ?? this._avgFromFormula(hp.formula) ?? (parseInt(`${hp.special || ""}`, 10) || 0); // special HP (e.g. summons "40 + …") → leading number

		const avg = this.sidekickHitDie() / 2 + 0.5;
		const perLevel = Math.max(1, Math.floor(avg + this.sidekickAbilityMod("con")));
		return base + Math.max(0, this.sidekickLevel() - 1) * perLevel;
	}

	sidekickAc () { const ac = this.sidekickCreature()?.ac?.[0]; let v = typeof ac === "number" ? ac : (ac?.ac ?? null); if (v != null && this._skHasFeature("Improved Defense")) v += 1; return v; } // Warrior L10: +1 AC
	sidekickAcFrom () { const ac = this.sidekickCreature()?.ac?.[0]; return (ac && typeof ac === "object" && ac.from) ? ac.from : null; }
	sidekickSpeed () {
		const sp = this.sidekickCreature()?.speed; if (sp == null) return "—";
		if (typeof sp === "number") return `${sp} ft.`;
		return Object.entries(sp).map(([k, v]) => { const n = typeof v === "number" ? v : v?.number; return n == null ? null : `${k === "walk" ? "" : `${k} `}${n} ft.`; }).filter(Boolean).join(", ");
	}

	sidekickSaveProfs () { const set = new Set(Object.keys(this.sidekickCreature()?.save || {})); if (this.sidekick.saveProf) set.add(this.sidekick.saveProf); if (this.sidekick.sharpMindSave && this._skHasFeature("Sharp Mind")) set.add(this.sidekick.sharpMindSave); return set; } // + Expert L18 Sharp Mind
	sidekickSaveMod (abv) { return this.sidekickAbilityMod(abv) + (this.sidekickSaveProfs().has(abv) ? this.sidekickProfBonus() : 0); }

	sidekickSkillProfs () { const set = new Set(Object.keys(this.sidekickCreature()?.skill || {}).map(s => s.toLowerCase())); (this.sidekick.skillChoices || []).forEach(s => set.add(s)); return set; }
	sidekickExpertise () { return new Set(this.sidekick.expertiseChoices || []); }
	sidekickSkillMod (skill) {
		const mod = this.sidekickAbilityMod(CW.skillAbil(skill)); const pb = this.sidekickProfBonus();
		if (this.sidekickExpertise().has(skill)) return mod + pb * 2;
		if (this.sidekickSkillProfs().has(skill)) return mod + pb;
		return mod;
	}
	sidekickSkillProfType (skill) { return this.sidekickExpertise().has(skill) ? "expertise" : this.sidekickSkillProfs().has(skill) ? "full" : "none"; }
	sidekickExpertiseSlots () { const meta = this.sidekickMeta(); return meta ? (meta.expertiseAt || []).filter(l => this.sidekickLevel() >= l).length * 2 : 0; }

	// creature is a humanoid OR carries a weapon -> qualifies for the class's weapon/tool proficiencies
	sidekickQualifiesWeapons () {
		const m = this.sidekickCreature(); if (!m) return false;
		const typ = typeof m.type === "object" ? m.type.type : m.type;
		if (`${typ}`.toLowerCase() === "humanoid") return true;
		return /\b(weapon|sword|axe|bow|spear|mace|dagger|club|hammer|crossbow|sling|javelin|halberd|glaive|pike|lance|scimitar|rapier|whip|flail|morningstar|trident|dart|longsword|shortsword|greatsword|maul|warhammer|battleaxe|handaxe|greataxe)\b/i.test(JSON.stringify(m.action || []));
	}

	sidekickAsiLevels () {
		const cls = this.sidekickClassEnt(); if (!cls) return [];
		const out = [];
		(cls.classFeatures || []).forEach((feats, ix) => { const lv = ix + 1; if (lv <= this.sidekickLevel() && (feats || []).some(f => f?.name && /^Ability Score Improvement/i.test(f.name))) out.push(lv); });
		return out;
	}
	sidekickFeatures () {
		const cls = this.sidekickClassEnt(); if (!cls) return [];
		const out = [];
		(cls.classFeatures || []).forEach((feats, ix) => { const lv = ix + 1; if (lv > this.sidekickLevel()) return; (feats || []).forEach(f => { if (f?.name) out.push({level: lv, name: f.name, entries: f.entries, ref: this._classFeatureTag(f, f.level || lv)}); }); });
		return out;
	}
	sidekickSenses () { const m = this.sidekickCreature(); if (!m) return ""; return [...(m.senses || []), `passive Perception ${10 + this.sidekickSkillMod("perception")}`].join(", "); }

	/* Spellcaster sidekick */
	sidekickIsCaster () { return !!this.sidekickMeta()?.spellcaster; }
	sidekickSpellRole () { return CharState._SK_SPELL_ROLES[this.sidekick.spellRole] ? this.sidekick.spellRole : "mage"; }
	sidekickSpellRoleMeta () { return CharState._SK_SPELL_ROLES[this.sidekickSpellRole()]; }
	sidekickSpellAbility () { return this.sidekickSpellRoleMeta().ability; }
	sidekickSpellSaveDc () { return 8 + this.sidekickProfBonus() + this.sidekickAbilityMod(this.sidekickSpellAbility()); }
	sidekickSpellAtk () { return this.sidekickProfBonus() + this.sidekickAbilityMod(this.sidekickSpellAbility()); }
	sidekickSpellProgress () {
		const cls = this.sidekickClassEnt(); if (!cls?.classTableGroups) return null;
		const lv = this.sidekickLevel(); let cantrips = 0; let known = 0; const slots = {};
		cls.classTableGroups.forEach(g => {
			const row = (g.rowsSpellProgression || g.rows || [])[lv - 1]; if (!row) return;
			if (/spell slots/i.test(`${g.title || ""}`)) { row.forEach((n, ix) => { if (n > 0) slots[ix + 1] = n; }); }
			else { const lbl = `${(g.colLabels || [])[0] || ""}`; if (/cantrip/i.test(lbl)) cantrips = row[0] || 0; else if (/spell/i.test(lbl)) known = row[0] || 0; }
		});
		return {cantrips, known, slots};
	}
	// Spellcaster role determines the spell list: Mage→Wizard, Healer→Cleric+Druid, Prodigy→Bard+Warlock
	sidekickSpellListClasses () { return this.sidekickSpellRoleMeta().classes; }
	sidekickSpellOptions (level) {
		const classes = this.sidekickSpellListClasses();
		return this._data.spells.filter(sp => this.isVisible(sp) && sp.level === level && [...this._spellClassNames(sp)].some(n => classes.includes(n))).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}
	sidekickMaxSpellLevel () { const p = this.sidekickSpellProgress(); return p ? Math.max(0, ...Object.keys(p.slots).map(Number)) : 0; }

	/* ===================================================================== */
	/* Sidekick play mode (live HP / rests / resources) — separate runtime    */
	/* ===================================================================== */
	skPlay () { const sk = this.sidekick; if (!sk.play) sk.play = {...this._defaultPlayState(), featureUses: {}}; if (!sk.play.featureUses) sk.play.featureUses = {}; return sk.play; }
	skMaxHp () { let mx = this.sidekickMaxHp() || 0; if ((this.skPlay().exhaustion || 0) >= 4) mx = Math.floor(mx / 2); return mx; } // exhaustion 4: HP max halved
	skCurHp () { const c = this.skPlay().curHp; const mx = this.skMaxHp(); return c == null ? mx : Math.max(0, Math.min(c, mx)); }
	skTempHp () { return Math.max(0, Math.floor(this.skPlay().tempHp || 0)); }
	skApplyDamage (n) { n = Math.max(0, Math.floor(n || 0)); if (!n) return; const p = this.skPlay(); const t = this.skTempHp(); if (t > 0) { const f = Math.min(t, n); p.tempHp = t - f; n -= f; } if (n > 0) p.curHp = Math.max(0, this.skCurHp() - n); }
	skApplyHealing (n) { n = Math.max(0, Math.floor(n || 0)); if (!n) return; const p = this.skPlay(); const was = this.skCurHp(); p.curHp = Math.min(this.skMaxHp(), was + n); if (was === 0 && p.curHp > 0) p.deathSaves = {success: 0, fail: 0}; }
	skSetTempHp (n) { this.skPlay().tempHp = Math.max(this.skTempHp(), Math.max(0, Math.floor(n || 0))); }
	skClearTempHp () { this.skPlay().tempHp = 0; }

	// Hit Dice: a sidekick gains one Hit Die per level, all of its size-based type
	skHitDicePool () { const f = this.sidekickHitDie(); return f ? {[f]: this.sidekickLevel()} : {}; }
	skHitDiceUsed (f) { return this.skPlay().hitDiceUsed?.[f] || 0; }
	skHitDiceRemaining (f) { return Math.max(0, (this.skHitDicePool()[f] || 0) - this.skHitDiceUsed(f)); }
	skSpendHitDie (f) { if (this.skHitDiceRemaining(f) <= 0) return; const p = this.skPlay(); (p.hitDiceUsed = p.hitDiceUsed || {})[f] = this.skHitDiceUsed(f) + 1; }
	skRestoreHitDie (f) { const u = this.skHitDiceUsed(f); if (u > 0) this.skPlay().hitDiceUsed[f] = u - 1; }

	// spell slots (Spellcaster sidekick)
	skSlotsTotal (lvl) { return (this.sidekickSpellProgress()?.slots || {})[lvl] || 0; }
	skSlotsRemaining (lvl) { return Math.max(0, this.skSlotsTotal(lvl) - (this.skPlay().expended[lvl] || 0)); }
	skExpendSlot (lvl) { const p = this.skPlay(); const u = p.expended[lvl] || 0; if (u < this.skSlotsTotal(lvl)) p.expended[lvl] = u + 1; }
	skRestoreSlot (lvl) { const p = this.skPlay(); const u = p.expended[lvl] || 0; if (u > 0) p.expended[lvl] = u - 1; }
	skCastSpell (sp) { for (let L = sp.level; L <= 9; ++L) { if (this.skSlotsRemaining(L) > 0) { this.skExpendSlot(L); return L; } } return null; }
	// the sidekick's chosen spells, grouped (Spellcaster) — for casting in play
	skSpellbook () {
		if (!this.sidekickIsCaster()) return null;
		const byUid = (u) => this._byUid(this._data.spells, u);
		const cantrips = (this.sidekick.spellChoices.cantrips || []).map(byUid).filter(Boolean).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const leveled = (this.sidekick.spellChoices.leveled || []).map(byUid).filter(Boolean).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
		return {cantrips, leveled};
	}

	// limited-use class features (Warrior Second Wind / Indomitable)
	sidekickFeatureResources () {
		const names = this.sidekickFeatureNames(); const lv = this.sidekickLevel(); const out = [];
		if (names.has("Second Wind")) out.push({key: "secondWind", name: "Second Wind", max: lv >= 20 ? 2 : 1, recharge: "short rest", roll: `1d10+${lv}`, note: "bonus action — regain HP"});
		if (names.has("Indomitable")) out.push({key: "indomitable", name: "Indomitable", max: lv >= 18 ? 2 : 1, recharge: "long rest", note: "reroll a failed saving throw"});
		return out;
	}
	skFeatureUsed (key) { return this.skPlay().featureUses?.[key] || 0; }
	skFeatureRemaining (res) { return Math.max(0, res.max - this.skFeatureUsed(res.key)); }
	skUseFeature (key) { const p = this.skPlay(); (p.featureUses = p.featureUses || {})[key] = this.skFeatureUsed(key) + 1; }
	skRestoreFeature (key) { const u = this.skFeatureUsed(key); if (u > 0) this.skPlay().featureUses[key] = u - 1; }

	skShortRest () { const p = this.skPlay(); p.featureUses = p.featureUses || {}; this.sidekickFeatureResources().forEach(r => { if (/short/.test(r.recharge)) p.featureUses[r.key] = 0; }); }
	skLongRest () {
		const p = this.skPlay();
		p.curHp = this.skMaxHp(); p.tempHp = 0; p.expended = {}; p.deathSaves = {success: 0, fail: 0}; p.concentration = null; p.featureUses = {};
		p.exhaustion = Math.max(0, (p.exhaustion || 0) - 1); // a long rest removes 1 level
		const f = this.sidekickHitDie(); const restore = Math.max(1, Math.floor(this.sidekickLevel() / 2)); const used = p.hitDiceUsed?.[f] || 0;
		if (p.hitDiceUsed) p.hitDiceUsed[f] = Math.max(0, used - restore);
	}

	// {action, bonus, reaction} for the sidekick's turn
	sidekickTurnOptions () {
		const out = {action: [], bonus: [], reaction: []}; const m = this.sidekickCreature();
		const n = this.sidekickExtraAttacks();
		out.action.push({action: "Attack", suffix: n > 1 ? ` (${n} attacks)` : ""});
		if (this.sidekickIsCaster()) out.action.push({action: "Cast a Spell"});
		out.reaction.push({action: "Opportunity Attack"});
		// Defender martial role is an explicit reaction (impose disadvantage on an attack against a nearby ally); "Martial Role" itself is skipped by the heuristic scan
		if (this.sidekickMartialRole() === "defender") out.reaction.push({name: "Defender — impose disadvantage on an attack vs. an ally within 5 ft.", emph: true});
		const book = this.skSpellbook(); const seenSp = new Set();
		if (book) [...book.cantrips, ...book.leveled].forEach(sp => { const c = this._spellCastCategory(sp); if (c !== "bonus" && c !== "reaction") return; const k = `${c}|${sp.name}`; if (seenSp.has(k)) return; seenSp.add(k); out[c].push({spell: sp}); });
		const seenF = {bonus: new Set(), reaction: new Set()};
		this.sidekickFeatures().forEach(f => this._featureActionKinds(f.name, f.entries).forEach(kind => { if (!seenF[kind].has(f.name)) { seenF[kind].add(f.name); out[kind].push({feature: f}); } }));
		(m?.bonus || []).forEach(a => out.bonus.push({name: a.name}));
		(m?.reaction || []).forEach(a => out.reaction.push({name: a.name}));
		return out;
	}

	/* ----- serialization ----- */
	toJson () {
		return {
			_v: 2,
			name: this.name,
			hiddenSources: this.hiddenSources,
			hideLegacy: this.hideLegacy,
			raceUid: this.raceUid,
			classes: this.classes,
			backgroundUid: this.backgroundUid,
			abilityMethod: this.abilityMethod,
			abilitiesBase: this.abilitiesBase,
			raceAbilOption: this.raceAbilOption,
			raceAbilChoices: this.raceAbilChoices,
			raceAbilWeighted: this.raceAbilWeighted,
			raceResistChoice: this.raceResistChoice,
			sizeChoice: this.sizeChoice,
			bgAbilOption: this.bgAbilOption,
			bgAbilChoices: this.bgAbilChoices,
			bgAbilWeighted: this.bgAbilWeighted,
			bgFeat: this.bgFeat,
			classSkillChoices: this.classSkillChoices,
			expertiseChoices: this.expertiseChoices,
			profChoices: this.profChoices,
			equipmentChoices: this.equipmentChoices,
			spellChoices: this.spellChoices,
			raceSpellChoices: this.raceSpellChoices,
			subclassSpellChoices: this.subclassSpellChoices,
			bgSpellChoices: this.bgSpellChoices,
			raceSpellAbility: this.raceSpellAbility,
			raceSpellGroup: this.raceSpellGroup,
			mysticArcanum: this.mysticArcanum,
			asiChoices: this.asiChoices,
			raceFeat: this.raceFeat,
			fightingStyles: this.fightingStyles,
			armorUid: this.armorUid,
			shieldUid: this.shieldUid,
			attunedUids: this.attunedUids,
			inventory: this.inventory,
			play: this.play,
			mode: this.mode,
			sidekick: this.sidekick,
		};
	}

	fromJson (j) {
		if (!j) return;
		// migrate v1 single-class -> classes[]
		let classes;
		if (Array.isArray(j.classes)) classes = j.classes.map(c => ({uid: c.uid ?? null, level: Math.max(1, c.level || 1), subclassUid: c.subclassUid ?? null}));
		else classes = [{uid: j.classUid ?? null, level: Math.max(1, j.level || 1), subclassUid: j.subclassUid ?? null}];
		if (!classes.length) classes = [{uid: null, level: 1, subclassUid: null}];
		const primaryUid = classes[0]?.uid;

		// migrate asiChoices keyed by numeric level -> "uid@level" for the primary class
		let asiChoices = j.asiChoices ?? {};
		if (primaryUid && Object.keys(asiChoices).some(k => /^\d+$/.test(k))) {
			const migrated = {};
			Object.entries(asiChoices).forEach(([k, v]) => { migrated[/^\d+$/.test(k) ? `${primaryUid}@${k}` : k] = v; });
			asiChoices = migrated;
		}

		// migrate flat spellChoices {cantrips,leveled} -> per-class {uid:{...}}
		let spellChoices = j.spellChoices ?? {};
		if (spellChoices && (Array.isArray(spellChoices.cantrips) || Array.isArray(spellChoices.leveled))) {
			spellChoices = primaryUid ? {[primaryUid]: {cantrips: spellChoices.cantrips || [], leveled: spellChoices.leveled || []}} : {};
		}

		Object.assign(this, {
			name: j.name ?? "",
			hiddenSources: j.hiddenSources ?? [],
			hideLegacy: j.hideLegacy ?? false,
			raceUid: j.raceUid ?? null,
			classes,
			backgroundUid: j.backgroundUid ?? null,
			abilityMethod: j.abilityMethod ?? "pointbuy",
			abilitiesBase: j.abilitiesBase ?? {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8},
			raceAbilOption: j.raceAbilOption ?? 0,
			raceAbilChoices: j.raceAbilChoices ?? [],
			raceAbilWeighted: j.raceAbilWeighted ?? [],
			raceResistChoice: j.raceResistChoice ?? null,
			sizeChoice: j.sizeChoice ?? null,
			bgAbilOption: j.bgAbilOption ?? 0,
			bgAbilChoices: j.bgAbilChoices ?? [],
			bgAbilWeighted: j.bgAbilWeighted ?? [],
			bgFeat: j.bgFeat ?? {featUid: null, featAbilChoose: []},
			classSkillChoices: j.classSkillChoices ?? [],
			expertiseChoices: j.expertiseChoices ?? [],
			profChoices: j.profChoices ?? {},
			equipmentChoices: j.equipmentChoices ?? {},
			spellChoices,
			raceSpellChoices: j.raceSpellChoices ?? {},
			subclassSpellChoices: j.subclassSpellChoices ?? {},
			bgSpellChoices: j.bgSpellChoices ?? {},
			raceSpellAbility: j.raceSpellAbility ?? null,
			raceSpellGroup: j.raceSpellGroup ?? 0,
			mysticArcanum: j.mysticArcanum ?? {},
			asiChoices,
			raceFeat: j.raceFeat ?? {featUid: null, featAbilChoose: []},
			fightingStyles: j.fightingStyles ?? [],
			armorUid: j.armorUid ?? null,
			shieldUid: j.shieldUid ?? null,
			attunedUids: j.attunedUids ?? [],
			inventory: j.inventory ?? [],
			play: {...this._defaultPlayState(), ...(j.play || {})},
			mode: j.mode === "sidekick" ? "sidekick" : "pc",
			sidekick: {...this._defaultSidekick(), ...(j.sidekick || {})},
		});
		// migrate v1 boolean shield -> the first shield in inventory
		if (this.shieldUid == null && j.isShield) { const sh = this.inventory.find(r => { const a = this._armorById(r.uid); return a && `${a.type || ""}`.split("|")[0] === "S"; }); this.shieldUid = sh?.uid || null; }
		// migrate old sidekick spellAbility (int/wis/cha) -> spellRole (mage/healer/prodigy)
		if (!j.sidekick?.spellRole && j.sidekick?.spellAbility) this.sidekick.spellRole = {int: "mage", wis: "healer", cha: "prodigy"}[j.sidekick.spellAbility] || "mage";
		// ensure the sidekick play-state has all fields (old saves predate it)
		this.sidekick.play = {...this._defaultPlayState(), featureUses: {}, ...(this.sidekick.play || {})};
	}
}

/* -------------------------------------------------------------------------- */
/* Page controller                                                            */
/* -------------------------------------------------------------------------- */

class CharBuilderPage {
	static _STORAGE_KEY = "charbuilder_state";

	async pInit () {
		await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
		await ExcludeUtil.pInitialise();

		const styleHint = VetoolsConfig.get("styleSwitcher", "style");

		const [races, backgrounds, feats, classData, spells, items, optionalFeatures, bestiary] = await Promise.all([
			this._pLoadSimple(UrlUtil.PG_RACES, "race"),
			this._pLoadSimple(UrlUtil.PG_BACKGROUNDS, "background"),
			this._pLoadSimple(UrlUtil.PG_FEATS, "feat"),
			this._pLoadClasses(),
			this._pLoadSpells(),
			this._pLoadItems(),
			this._pLoadOptionalFeatures(),
			this._pLoadBestiary(),
		]);
		const fightingStyles = optionalFeatures.filter(o => (o.featureType || []).some(t => /^FS/.test(t)));

		races.forEach(ent => UtilsEntityRace.mutMigrateForVersion(ent, {styleHint}));
		backgrounds.forEach(ent => UtilsEntityBackground.mutMigrateForVersion(ent, {styleHint}));

		races.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		backgrounds.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		classData.classes.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const typeAbv = (it) => `${it.type || ""}`.split("|")[0];
		// index of all character armor/shields (incl. magic — drives "Wear" + AC); not deduped, so worn items resolve by exact uid
		const armors = items
			.filter(it => (it.armor || ["LA", "MA", "HA", "S"].includes(typeAbv(it))) && !/barding/i.test(it.name))
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const itemIndex = new Map();
		const itemIndexByName = new Map();
		items.forEach(it => {
			itemIndex.set(`${it.name}|${it.source}`.toLowerCase(), it);
			const nk = `${it.name}`.toLowerCase();
			if (!itemIndexByName.has(nk)) itemIndexByName.set(nk, it);
		});
		const spellIndexByName = new Map();
		spells.forEach(sp => { const k = `${sp.name}`.toLowerCase(); if (!spellIndexByName.has(k)) spellIndexByName.set(k, sp); });

		bestiary.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const data = {races, backgrounds, feats, classData, spells, items, armors, itemIndex, itemIndexByName, spellIndexByName, fightingStyles, optionalFeatures, styleHint, bestiary, sidekickClasses: classData.sidekickClasses};
		globalThis.dbg_cb = data;

		const state = new CharState(data);
		let saved = await StorageUtil.pGetForPage(CharBuilderPage._STORAGE_KEY);
		// migrate a save made under the previous "charwizard" name (both the key and the page filename changed)
		if (saved == null) saved = await StorageUtil.pGet("charwizard_state_charwizard.html");
		if (saved) { try { state.fromJson(saved); } catch (e) { /* ignore bad save */ } }

		this._ui = new CharBuilderUi({
			data,
			state,
			eleRoot: es(`#charbuilder-main`),
			fnSave: () => StorageUtil.pSetForPage(CharBuilderPage._STORAGE_KEY, state.toJson()),
		});
		this._ui.render();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	async _pLoadSimple (page, category) {
		const all = [
			...(await DataLoader.pCacheAndGetAllSite(page)),
			...(await DataLoader.pCacheAndGetAllPrerelease(page)),
			...(await DataLoader.pCacheAndGetAllBrew(page)),
		];
		return MiscUtil.copyFast(all.filter(it => {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
			return !ExcludeUtil.isExcluded(hash, category, it.source);
		}));
	}

	async _pLoadItems () {
		try {
			const raw = await DataUtil.item.loadJSON();
			const all = raw.item || [];
			return all.filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS](it);
				return !ExcludeUtil.isExcluded(hash, "item", it.source);
			});
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("charbuilder: item load failed", e);
			return [];
		}
	}

	async _pLoadOptionalFeatures () {
		try {
			const raw = await DataUtil.loadJSON(`${Renderer.get().baseUrl}data/optionalfeatures.json`);
			return (raw.optionalfeature || []).filter(o => !ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_OPT_FEATURES](o), "optionalfeature", o.source));
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("charbuilder: optional feature load failed", e);
			return [];
		}
	}

	// spells must load via DataUtil.spell (not the generic DataLoader) so the class associations from
	// gendata-spell-source-lookup.json are merged — incl. supplement spells (e.g. XGE Chaos Bolt → Sorcerer, as a "variant" class entry)
	async _pLoadSpells () {
		const raw = await DataUtil.spell.loadJSON(); // site spells with class associations merged
		const extra = [...(await DataLoader.pCacheAndGetAllPrerelease(UrlUtil.PG_SPELLS)), ...(await DataLoader.pCacheAndGetAllBrew(UrlUtil.PG_SPELLS))];
		return [...(raw.spell || []), ...extra].filter(sp => !ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_SPELLS](sp), "spell", sp.source));
	}

	async _pLoadClasses () {
		const raw = await DataUtil.class.loadJSON();
		const all = (raw.class || []).filter(cls => {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls);
			return !ExcludeUtil.isExcluded(hash, "class", cls.source);
		});
		const classes = all.filter(cls => !cls.isSidekick); // sidekicks build from a bestiary creature (CR ≤ 1/2) — handled in Sidekick mode
		const sidekickClasses = all.filter(cls => cls.isSidekick);
		return {classes, sidekickClasses, subclasses: raw.subclass || [], classFeature: raw.classFeature || [], subclassFeature: raw.subclassFeature || []};
	}

	// bestiary creatures eligible to become a sidekick (challenge rating 1/2 or lower)
	async _pLoadBestiary () {
		try {
			const all = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY);
			const crMap = {"0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5};
			const crNum = (cr) => { if (cr == null) return null; const v = typeof cr === "object" ? cr.cr : cr; if (v in crMap) return crMap[v]; const n = Number(v); return Number.isNaN(n) ? null : n; };
			return MiscUtil.copyFast(all.filter(m => {
				const n = crNum(m.cr); if (n != null && n > 0.5) return false; // keep CR ≤ ½ AND unknown-CR creatures (shown as "CR ?")
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](m);
				return !ExcludeUtil.isExcluded(hash, "monster", m.source);
			}));
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("charbuilder: bestiary load failed", e);
			return [];
		}
	}
}

const charBuilderPage = new CharBuilderPage();
window.addEventListener("load", () => charBuilderPage.pInit().catch(e => {
	const root = es(`#charbuilder-main`);
	if (root) { root.empty(); ee(root)`<div class="cb__err">Failed to initialise: ${e.message}<br><pre>${e.stack || ""}</pre></div>`; }
	// eslint-disable-next-line no-console
	console.error(e);
}));
globalThis.dbg_charBuilderPage = charBuilderPage;
