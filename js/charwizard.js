import {VetoolsConfig} from "./utils-config/utils-config-config.js";
import {UtilsEntityBackground} from "./utils/utils-entity-background.js";
import {UtilsEntityRace} from "./utils/utils-entity-race.js";
import {CharWizardUi} from "./charwizard/cw-ui.js";

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

/* -------------------------------------------------------------------------- */
/* Character state + rules engine                                             */
/* -------------------------------------------------------------------------- */

export class CharState {
	constructor (data) {
		this._data = data;
		this.reset();
	}

	reset () {
		this.name = "";
		this.raceUid = null;
		this.classUid = null;
		this.level = 1;
		this.subclassUid = null;
		this.backgroundUid = null;
		this.abilityMethod = "pointbuy";
		this.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		this.raceAbilOption = 0; // which ability option (a/b/…) for multi-option races
		this.raceAbilChoices = []; // simple "choose N" ability picks
		this.raceAbilWeighted = []; // weighted assignment: ability per weight slot (e.g. ["str","dex"] for +2/+1)
		this.classSkillChoices = [];
		this.equipmentChoices = {}; // line index -> chosen option index
		this.spellChoices = {cantrips: [], leveled: []}; // arrays of "name|source"
		this.asiChoices = {}; // level -> {type:"asi", plan, inc:{abv:n}} | {type:"feat", featUid, featAbilChoose:[abv]}
		this.armorUid = null; // worn armor item "name|source" (drives AC)
		this.isShield = false;
		this.inventory = []; // [{uid:string|null, name, qty, equipped}]
	}

	/* ----- entity lookups ----- */
	_byUid (arr, uid) { if (!uid) return null; return arr.find(e => CW.uid(e) === uid) || null; }
	get raceEnt () { return this._byUid(this._data.races, this.raceUid); }
	get classEnt () { return this._byUid(this._data.classData.classes, this.classUid); }
	get backgroundEnt () { return this._byUid(this._data.backgrounds, this.backgroundUid); }
	get subclassEnt () {
		const cls = this.classEnt;
		if (!cls || !this.subclassUid) return null;
		return this._data.classData.subclasses
			.filter(sc => sc.className === cls.name && sc.classSource === cls.source)
			.find(sc => CW.uid(sc) === this.subclassUid) || null;
	}

	subclassesForClass () {
		const cls = this.classEnt;
		if (!cls) return [];
		return this._data.classData.subclasses
			.filter(sc => sc.className === cls.name && sc.classSource === cls.source && !sc.isReprinted);
	}

	subclassGainLevel () {
		const cls = this.classEnt;
		if (!cls) return null;
		// the level at which the first subclass feature is gained
		const subs = this.subclassesForClass();
		for (const sc of subs) {
			const feats = sc.subclassFeatures || [];
			for (let i = 0; i < feats.length; ++i) if ((feats[i] || []).length) return (feats[i][0]?.level) || (i + 1);
		}
		return 3;
	}

	/* ----- abilities ----- */
	raceAbilityOptions () { return this.raceEnt?.ability || []; }
	activeRaceAbilityOption () {
		const opts = this.raceAbilityOptions();
		if (!opts.length) return null;
		return opts[Math.min(this.raceAbilOption || 0, opts.length - 1)] || null;
	}

	racialBonuses () {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const ab = this.activeRaceAbilityOption();
		if (!ab) return out;
		// fixed bonuses
		Object.entries(ab).forEach(([k, v]) => { if (k !== "choose" && typeof v === "number" && out[k] != null) out[k] += v; });
		const ch = ab.choose;
		if (ch?.weighted) {
			const weights = ch.weighted.weights || [];
			(this.raceAbilWeighted || []).forEach((abv, i) => { if (abv && out[abv] != null && weights[i] != null) out[abv] += weights[i]; });
		} else if (ch) {
			const amount = ch.amount || 1;
			(this.raceAbilChoices || []).forEach(k => { if (out[k] != null) out[k] += amount; });
		}
		return out;
	}

	// meta for a simple (non-weighted) "choose" option, else null
	racialChooseMeta () {
		const ab = this.activeRaceAbilityOption();
		if (!ab?.choose || ab.choose.weighted) return null;
		return {from: ab.choose.from || CW.ABILITIES, count: ab.choose.count || 1, amount: ab.choose.amount || 1};
	}

	// Levels (<= current) at which this class grants an Ability Score Improvement
	asiLevels () {
		const cls = this.classEnt; if (!cls?.classFeatures) return [];
		const out = [];
		for (let lv = 1; lv <= this.level; ++lv) {
			const feats = cls.classFeatures[lv - 1] || [];
			if (feats.some(f => f?.name && /^Ability Score Improvement/i.test(f.name))) out.push(lv);
		}
		return out;
	}

	// Total ability bonuses from ASIs + chosen feats (only for valid, in-range ASI levels)
	asiBonuses () {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const valid = new Set(this.asiLevels());
		Object.entries(this.asiChoices || {}).forEach(([lv, ch]) => {
			if (!ch || !valid.has(+lv)) return;
			if (ch.type === "asi" && ch.inc) Object.entries(ch.inc).forEach(([k, v]) => { if (out[k] != null) out[k] += v; });
			else if (ch.type === "feat" && ch.featUid) {
				const feat = this._data.feats.find(f => CW.uid(f) === ch.featUid);
				(feat?.ability || []).forEach(ab => {
					Object.entries(ab).forEach(([k, v]) => { if (k !== "choose" && typeof v === "number" && out[k] != null) out[k] += v; });
					if (ab.choose) (ch.featAbilChoose || []).forEach(k => { if (out[k] != null) out[k] += (ab.choose.amount || 1); });
				});
			}
		});
		return out;
	}

	featsTaken () {
		const valid = new Set(this.asiLevels());
		return Object.entries(this.asiChoices || {})
			.filter(([lv, c]) => valid.has(+lv) && c?.type === "feat" && c.featUid)
			.map(([lv, c]) => ({level: +lv, featUid: c.featUid}));
	}

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
		const addFrom = (featuresByLevel) => {
			(featuresByLevel || []).forEach((lvArr, ix) => (lvArr || []).forEach(f => {
				if (!f?.name) return;
				const lvl = f.level || (ix + 1);
				if (lvl > this.level) return;
				Object.entries(this._featureAbilityIncrease(f)).forEach(([k, v]) => { if (out[k] != null) out[k] += v; });
			}));
		};
		addFrom(this.classEnt?.classFeatures);
		addFrom(this.subclassEnt?.subclassFeatures);
		return out;
	}

	finalAbility (abv) { return (this.abilitiesBase[abv] || 0) + this.racialBonuses()[abv] + this.asiBonuses()[abv] + this.classFeatureAbilityBonuses()[abv]; }
	abilityMod (abv) { return CW.mod(this.finalAbility(abv)); }

	pointBuySpent () {
		return CW.ABILITIES.reduce((acc, abv) => acc + (CW.POINT_BUY_COST[this.abilitiesBase[abv]] ?? 99), 0);
	}

	/* ----- derived ----- */
	get profBonus () { return CW.profBonus(this.level); }

	hitDie () { const c = this.classEnt; return c?.hd ? c.hd.faces : null; }

	maxHp () {
		const c = this.classEnt; if (!c?.hd) return null;
		const faces = c.hd.faces; const conMod = this.abilityMod("con");
		const avg = Math.floor(faces / 2) + 1;
		let hp = faces + conMod; // level 1: max
		for (let lv = 2; lv <= this.level; ++lv) hp += avg + conMod;
		return Math.max(this.level, hp);
	}

	saveProfs () {
		const c = this.classEnt;
		return new Set(c?.proficiency || []); // e.g. ["str","con"]
	}

	// Skill proficiencies: fixed from background + chosen from class (and any fixed class skills)
	skillProfs () {
		const out = new Set();
		const bg = this.backgroundEnt;
		(bg?.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => { if (v === true && CW.skillAbil(k) != null) out.add(k); });
		});
		this.classSkillChoices.forEach(s => out.add(s));
		// fixed (non-choose) class skills
		const cls = this.classEnt;
		(cls?.startingProficiencies?.skills || []).forEach(grp => {
			if (grp && typeof grp === "object" && !grp.choose) {
				Object.entries(grp).forEach(([k, v]) => { if (v === true) out.add(k); });
			}
		});
		return out;
	}

	classSkillChoiceMeta () {
		const cls = this.classEnt;
		const grp = (cls?.startingProficiencies?.skills || []).find(g => g?.choose);
		if (!grp) return null;
		return {from: grp.choose.from || CW.skills(), count: grp.choose.count || 1};
	}

	saveMod (abv) { return this.abilityMod(abv) + (this.saveProfs().has(abv) ? this.profBonus : 0); }
	skillMod (skill) { return this.abilityMod(CW.skillAbil(skill)) + (this.skillProfs().has(skill) ? this.profBonus : 0); }

	armorEnt () { return this.armorUid ? (this._data.armors || []).find(a => CW.uid(a) === this.armorUid) || null : null; }

	/* ----- inventory ----- */
	_resolveItem (name, source) {
		const idx = this._data.itemIndex; const idxName = this._data.itemIndexByName;
		if (source && idx?.has(`${name}|${source}`.toLowerCase())) return idx.get(`${name}|${source}`.toLowerCase());
		return idxName?.get(`${name}`.toLowerCase()) || null;
	}

	addToInventory ({uid, name, qty = 1}) {
		if (uid) { const ex = this.inventory.find(r => r.uid === uid); if (ex) { ex.qty += qty; return; } }
		this.inventory.push({uid: uid || null, name, qty, equipped: false});
	}

	removeFromInventory (ix) { this.inventory.splice(ix, 1); }

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

	acBreakdown () {
		const dex = this.abilityMod("dex");
		const armor = this.armorEnt();
		let base; let how;
		if (armor) {
			const typeAbv = `${armor.type || ""}`.split("|")[0];
			const baseAc = armor.ac || 10;
			if (typeAbv === "HA") { base = baseAc; how = `${armor.name}`; } else if (typeAbv === "MA") { const d = Math.min(dex, armor.dexterityMax ?? 2); base = baseAc + d; how = `${armor.name} + Dex (max ${armor.dexterityMax ?? 2})`; } else { base = baseAc + dex; how = `${armor.name} + Dex`; }
		} else {
			const clsName = this.classEnt?.name;
			if (clsName === "Barbarian") { base = 10 + dex + this.abilityMod("con"); how = "Unarmored Defense (10 + Dex + Con)"; } else if (clsName === "Monk") { base = 10 + dex + this.abilityMod("wis"); how = "Unarmored Defense (10 + Dex + Wis)"; } else { base = 10 + dex; how = "Unarmored (10 + Dex)"; }
		}
		if (this.isShield) { base += 2; how += " + Shield"; }
		return {ac: base, how};
	}

	ac () { return this.acBreakdown().ac; }
	initiative () { return this.abilityMod("dex"); }
	passivePerception () { return 10 + this.skillMod("perception"); }

	speedString () { const r = this.raceEnt; return r?.speed != null ? Parser.getSpeedString(r, {styleHint: this._data.styleHint}) : "—"; }

	size () { const r = this.raceEnt; return r?.size?.length ? Parser.sizeAbvToFull(r.size[0]) : "—"; }

	senses () {
		const r = this.raceEnt; const out = [];
		if (r?.darkvision) out.push(`darkvision ${r.darkvision} ft.`);
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
		const cls = this.classEnt; const sp = cls?.startingProficiencies || {};
		const fmtList = (a) => (a || []).map(x => typeof x === "string" ? x : (x.proficiency || x.full || x.special || ""));
		// title-case plain words, but leave {@tag ...} strings intact for the Renderer
		const tc = (s) => `${s}`.includes("{@") ? `${s}` : `${s}`.toTitleCase();
		return {
			armor: fmtList(sp.armor).map(tc),
			weapons: fmtList(sp.weapons).map(tc),
			tools: fmtList(sp.tools).map(tc),
		};
	}

	// Features gained up to current level (class + chosen subclass)
	featuresByLevel () {
		const cls = this.classEnt; if (!cls) return [];
		const out = [];
		const clsFeats = cls.classFeatures || [];
		const sc = this.subclassEnt;
		const scFeats = sc?.subclassFeatures || [];
		for (let lv = 1; lv <= this.level; ++lv) {
			const items = [];
			(clsFeats[lv - 1] || []).forEach(f => { if (f && !f.isClassFeatureVariant) items.push({name: f.name, entries: f.entries, level: lv, kind: "class"}); });
			(scFeats[lv - 1] || []).forEach(f => { if (f) items.push({name: f.name, entries: f.entries, level: lv, kind: "subclass"}); });
			if (items.length) out.push({level: lv, items});
		}
		return out;
	}

	/* ----- spellcasting ----- */
	isCaster () { const c = this.classEnt; return !!(c?.casterProgression || c?.spellcastingAbility); }

	spellAbility () { return this.classEnt?.spellcastingAbility || null; }

	spellSaveDc () { const a = this.spellAbility(); return a ? 8 + this.profBonus + this.abilityMod(a) : null; }
	spellAtkBonus () { const a = this.spellAbility(); return a ? this.profBonus + this.abilityMod(a) : null; }

	// Spell slots for current level, from the class table groups
	spellSlots () {
		const cls = this.classEnt; if (!cls?.classTableGroups) return null;
		const grp = cls.classTableGroups.find(g => /spell slots/i.test(g.title || "") || g.rowsSpellProgression);
		if (!grp) return null;
		const rows = grp.rowsSpellProgression || grp.rows;
		const row = rows?.[this.level - 1];
		if (!row) return null;
		const out = {};
		row.forEach((cell, ix) => {
			const n = typeof cell === "number" ? cell : parseInt(`${cell}`.replace(/[^0-9]/g, ""), 10);
			if (n > 0) out[ix + 1] = n;
		});
		return out;
	}

	maxSpellLevel () { const s = this.spellSlots(); if (!s) return 0; return Math.max(0, ...Object.keys(s).map(Number)); }

	cantripsKnown () { const c = this.classEnt; return c?.cantripProgression ? (c.cantripProgression[this.level - 1] || 0) : 0; }

	// Number of leveled spells known/prepared
	leveledSpellsKnown () {
		const c = this.classEnt; if (!c) return 0;
		if (c.spellsKnownProgression) return c.spellsKnownProgression[this.level - 1] || 0;
		if (c.preparedSpells) {
			// formula like "<$level$> + <$int_mod$>"
			const a = this.spellAbility();
			let n = this.level + (a ? this.abilityMod(a) : 0);
			return Math.max(1, n);
		}
		return 0;
	}

	spellListForClass () {
		const cls = this.classEnt; if (!cls) return [];
		return this._data.spells.filter(sp => (sp.classes?.fromClassList || []).some(c => c.name === cls.name && (!c.source || c.source === cls.source || true)));
	}

	/* ----- serialization ----- */
	toJson () {
		return {
			_v: 1,
			name: this.name,
			raceUid: this.raceUid,
			classUid: this.classUid,
			level: this.level,
			subclassUid: this.subclassUid,
			backgroundUid: this.backgroundUid,
			abilityMethod: this.abilityMethod,
			abilitiesBase: this.abilitiesBase,
			raceAbilOption: this.raceAbilOption,
			raceAbilChoices: this.raceAbilChoices,
			raceAbilWeighted: this.raceAbilWeighted,
			classSkillChoices: this.classSkillChoices,
			equipmentChoices: this.equipmentChoices,
			spellChoices: this.spellChoices,
			asiChoices: this.asiChoices,
			armorUid: this.armorUid,
			isShield: this.isShield,
			inventory: this.inventory,
		};
	}

	fromJson (j) {
		if (!j) return;
		Object.assign(this, {
			name: j.name ?? "",
			raceUid: j.raceUid ?? null,
			classUid: j.classUid ?? null,
			level: j.level ?? 1,
			subclassUid: j.subclassUid ?? null,
			backgroundUid: j.backgroundUid ?? null,
			abilityMethod: j.abilityMethod ?? "pointbuy",
			abilitiesBase: j.abilitiesBase ?? {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8},
			raceAbilOption: j.raceAbilOption ?? 0,
			raceAbilChoices: j.raceAbilChoices ?? [],
			raceAbilWeighted: j.raceAbilWeighted ?? [],
			classSkillChoices: j.classSkillChoices ?? [],
			equipmentChoices: j.equipmentChoices ?? {},
			spellChoices: j.spellChoices ?? {cantrips: [], leveled: []},
			asiChoices: j.asiChoices ?? {},
			armorUid: j.armorUid ?? null,
			isShield: j.isShield ?? false,
			inventory: j.inventory ?? [],
		});
	}
}

/* -------------------------------------------------------------------------- */
/* Page controller                                                            */
/* -------------------------------------------------------------------------- */

class CharWizardPage {
	static _STORAGE_KEY = "charwizard_state";

	async pInit () {
		await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
		await ExcludeUtil.pInitialise();

		const styleHint = VetoolsConfig.get("styleSwitcher", "style");

		const [races, backgrounds, feats, classData, spells, items] = await Promise.all([
			this._pLoadSimple(UrlUtil.PG_RACES, "race"),
			this._pLoadSimple(UrlUtil.PG_BACKGROUNDS, "background"),
			this._pLoadSimple(UrlUtil.PG_FEATS, "feat"),
			this._pLoadClasses(),
			this._pLoadSimple(UrlUtil.PG_SPELLS, "spell"),
			this._pLoadItems(),
		]);

		races.forEach(ent => UtilsEntityRace.mutMigrateForVersion(ent, {styleHint}));
		backgrounds.forEach(ent => UtilsEntityBackground.mutMigrateForVersion(ent, {styleHint}));

		races.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		backgrounds.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		classData.classes.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const typeAbv = (it) => `${it.type || ""}`.split("|")[0];
		const seenArmor = new Set();
		const armors = items
			// mundane character armor/shields only (no magic, no animal barding); magic armor handled later with inventory
			.filter(it => (it.armor || ["LA", "MA", "HA", "S"].includes(typeAbv(it))) && !it.magic && (!it.rarity || it.rarity === "none") && !/barding/i.test(it.name))
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name))
			.filter(it => { if (seenArmor.has(it.name)) return false; seenArmor.add(it.name); return true; });

		const itemIndex = new Map();
		const itemIndexByName = new Map();
		items.forEach(it => {
			itemIndex.set(`${it.name}|${it.source}`.toLowerCase(), it);
			const nk = `${it.name}`.toLowerCase();
			if (!itemIndexByName.has(nk)) itemIndexByName.set(nk, it);
		});

		const data = {races, backgrounds, feats, classData, spells, items, armors, itemIndex, itemIndexByName, styleHint};
		globalThis.dbg_cw = data;

		const state = new CharState(data);
		const saved = await StorageUtil.pGetForPage(CharWizardPage._STORAGE_KEY);
		if (saved) { try { state.fromJson(saved); } catch (e) { /* ignore bad save */ } }

		this._ui = new CharWizardUi({
			data,
			state,
			eleRoot: es(`#charwizard-main`),
			fnSave: () => StorageUtil.pSetForPage(CharWizardPage._STORAGE_KEY, state.toJson()),
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
			console.error("charwizard: item load failed", e);
			return [];
		}
	}

	async _pLoadClasses () {
		const raw = await DataUtil.class.loadJSON();
		const classes = (raw.class || []).filter(cls => {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls);
			return !ExcludeUtil.isExcluded(hash, "class", cls.source);
		});
		return {classes, subclasses: raw.subclass || [], classFeature: raw.classFeature || [], subclassFeature: raw.subclassFeature || []};
	}
}

const charWizardPage = new CharWizardPage();
window.addEventListener("load", () => charWizardPage.pInit().catch(e => {
	const root = es(`#charwizard-main`);
	if (root) { root.empty(); ee(root)`<div class="cw__err">Failed to initialise: ${e.message}<br><pre>${e.stack || ""}</pre></div>`; }
	// eslint-disable-next-line no-console
	console.error(e);
}));
globalThis.dbg_charWizardPage = charWizardPage;
