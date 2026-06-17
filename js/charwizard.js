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
		this.classes = [{uid: null, level: 1, subclassUid: null}]; // [0] is the primary class
		this.backgroundUid = null;
		this.abilityMethod = "pointbuy";
		this.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		this.raceAbilOption = 0; // which ability option (a/b/…) for multi-option races
		this.raceAbilChoices = []; // simple "choose N" ability picks
		this.raceAbilWeighted = []; // weighted assignment: ability per weight slot (e.g. ["str","dex"] for +2/+1)
		this.raceResistChoice = null; // chosen damage type when the race offers a resistance choice (e.g. Dragonborn)
		this.classSkillChoices = [];
		this.expertiseChoices = []; // skills with expertise (double proficiency)
		this.profChoices = {}; // choice-group key -> [chosen values] (languages, tools, race/bg skill choices)
		this.equipmentChoices = {}; // line index -> chosen option index
		this.spellChoices = {}; // classUid -> {cantrips:[], leveled:[]} (arrays of "name|source")
		this.raceSpellChoices = {}; // racial spell choice-group key -> [spell names]
		this.raceSpellAbility = null; // chosen ability for racial spells (when the race offers a choice)
		this.asiChoices = {}; // slotKey "classUid@classLevel" -> {type:"asi", plan, inc:{abv:n}} | {type:"feat", featUid, featAbilChoose:[abv]}
		this.armorUid = null; // worn body-armor item "name|source" (drives AC)
		this.shieldUid = null; // equipped shield item "name|source" (may be magic)
		this.attunedUids = []; // items the character is attuned to (max 3)
		this.inventory = []; // [{uid:string|null, name, qty, equipped}]
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
			.filter(sc => sc.className === cls.name && sc.classSource === cls.source && !sc.isReprinted);
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

	// Total ability bonuses from ASIs + chosen feats (only for valid, in-range ASI slots)
	asiBonuses () {
		const out = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
		const valid = new Set(this.asiSlots().map(s => s.key));
		Object.entries(this.asiChoices || {}).forEach(([key, ch]) => {
			if (!ch || !valid.has(key)) return;
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
		const slots = this.asiSlots();
		const byKey = new Map(slots.map(s => [s.key, s]));
		return Object.entries(this.asiChoices || {})
			.filter(([key, c]) => byKey.has(key) && c?.type === "feat" && c.featUid)
			.map(([key, c]) => { const s = byKey.get(key); return {key, level: s.classLevel, className: s.className, featUid: c.featUid}; });
	}

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
		const computed = (this.abilitiesBase[abv] || 0) + this.racialBonuses()[abv] + this.asiBonuses()[abv] + this.classFeatureAbilityBonuses()[abv];
		const set = this._itemAbilitySet(abv); // e.g. Amulet of Health sets Con to 19
		return set != null ? Math.max(computed, set) : computed;
	}
	// highest "static" ability value set by an equipped (attuned) item, or null
	_itemAbilitySet (abv) {
		let best = null;
		this.equippedItems().forEach(it => { if (!this._magicActive(it)) return; const v = it.ability?.static?.[abv]; if (typeof v === "number") best = best == null ? v : Math.max(best, v); });
		return best;
	}
	abilityMod (abv) { return CW.mod(this.finalAbility(abv)); }

	pointBuySpent () {
		return CW.ABILITIES.reduce((acc, abv) => acc + (CW.POINT_BUY_COST[this.abilitiesBase[abv]] ?? 99), 0);
	}

	/* ----- derived ----- */
	get profBonus () { return CW.profBonus(this.level); }

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
		const c = this.classEnt;
		return new Set(c?.proficiency || []); // e.g. ["str","con"]
	}

	// Skill proficiencies granted *outside* the class choice (background + race + fixed class skills)
	fixedSkillProfs () {
		const out = new Set();
		const addGrps = (grps) => (grps || []).forEach(grp => { if (grp && typeof grp === "object" && !grp.choose) Object.entries(grp).forEach(([k, v]) => { if (v === true && CW.skillAbil(k) != null) out.add(k); }); });
		addGrps(this.backgroundEnt?.skillProficiencies);
		addGrps(this.raceEnt?.skillProficiencies);
		addGrps(this.classEnt?.startingProficiencies?.skills);
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
				return ok && !it.magic && (!it.rarity || it.rarity === "none");
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
			let n = 0; let opts = null;
			if (grp.anyStandard) { n = grp.anyStandard; opts = STD_PLUS_EXOTIC; } else if (grp.anyExotic) { n = grp.anyExotic; opts = LEXO; } else if (grp.any) { n = grp.any; opts = LALL; }
			if (n) groups.push({key: `language:${srcKey}:${ix}`, type: "language", label: `${srcLabel}: choose ${n} language${n > 1 ? "s" : ""}`, options: opts, count: n});
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
	chosenLanguages () { const out = this.fixedLanguages(); this.chosenForType("language").forEach(l => out.add(l)); return [...out].sort(); }

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
	chosenTools () { const out = this.fixedTools(); this.chosenForType("tool").forEach(t => out.add(`${t}`.toTitleCase())); return [...out].sort(); }

	clearProfChoicesForSource (srcKey) { Object.keys(this.profChoices).forEach(k => { if (k.includes(`:${srcKey}:`)) delete this.profChoices[k]; }); }

	classSkillChoiceMeta () {
		const cls = this.classEnt;
		const grp = (cls?.startingProficiencies?.skills || []).find(g => g?.choose);
		if (!grp) return null;
		return {from: grp.choose.from || CW.skills(), count: grp.choose.count || 1};
	}

	saveMod (abv) { return this.abilityMod(abv) + (this.saveProfs().has(abv) ? this.profBonus : 0) + this.equippedItemEffects().saveBonus + this._attunementSaveBonus(); }

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

	// number of expertise picks granted (Rogue/Bard Expertise: 2 skills each)
	expertiseSlots () {
		let n = 0;
		this.classList().forEach(({cls, level, subclassEnt}) => {
			const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if (f?.name === "Expertise" && (f.level || (ix + 1)) <= level) n += 2; }));
			scan(cls.classFeatures); scan(subclassEnt?.subclassFeatures);
		});
		return n;
	}

	skillProfType (skill) {
		const isProf = this.skillProfs().has(skill);
		if (isProf && this.expertiseChoices.includes(skill)) return "expertise";
		if (isProf) return "full";
		const hp = this.halfProfMeta();
		if (hp && (hp.abilities === null || hp.abilities.has(CW.skillAbil(skill)))) return "half";
		return "none";
	}

	skillMod (skill) {
		const base = this.abilityMod(CW.skillAbil(skill));
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
			if (it.reqAttune) (this.isAttuned(CW.uid(it)) ? attuned : needAttune).push(it.name);
			if (!this._magicActive(it)) return; // unattuned item gives only its nonmagical benefits
			(it.resist || []).forEach(x => typeof x === "string" && resist.add(x));
			(it.immune || []).forEach(x => typeof x === "string" && immune.add(x));
			(it.vulnerable || []).forEach(x => typeof x === "string" && vulnerable.add(x));
			(it.conditionImmune || []).forEach(x => typeof x === "string" && conditionImmune.add(x));
			if (it.bonusSavingThrow) saveBonus += num(it.bonusSavingThrow);
			if (it.bonusSpellAttack) spellAtk += num(it.bonusSpellAttack);
			if (it.bonusSpellSaveDc) spellDc += num(it.bonusSpellSaveDc);
			if (it.ability?.static) Object.entries(it.ability.static).forEach(([k, v]) => { if (CW.ABILITIES.includes(k)) abilitySet.push({abil: k, value: v, item: it.name}); });
			if (it.focus) focus.push(it.name);
			if (it.modifySpeed) speed.push(it.name);
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
		const toHit = abilMod + (prof ? this.profBonus : 0) + magicAtk;
		return {
			name: it.name, source: it.source, ability, prof, toHit,
			dmg1: it.dmg1, dmg2: (props.includes("V") ? it.dmg2 : null), dmgType: it.dmgType,
			dmgBonus: abilMod + magicDmg,
			ranged: `${it.type || ""}`.split("|")[0] === "R", range: it.range,
			magic: magicAtk || magicDmg,
			properties: props.map(p => CW.WEAPON_PROP[p]).filter(Boolean),
		};
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
		return base + (hp && (hp.abilities === null || hp.abilities.has("dex")) ? hp.amount : 0);
	}
	// passive score = 10 + skill modifier (+5 advantage / -5 disadvantage)
	passiveScore (skill) {
		let s = 10 + this.skillMod(skill);
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
		return bonus;
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
		return null;
	}

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
			if (cls.casterProgression || cls.spellcastingAbility) out.push({kind: "class", uid, ent: cls, classEnt: cls, level, name: cls.name, prog: cls.casterProgression, ability: cls.spellcastingAbility, listClassName: cls.name, preparedSpells: cls.preparedSpells});
			if (subclassEnt && (subclassEnt.casterProgression || subclassEnt.spellcastingAbility)) out.push({kind: "subclass", uid: CW.uid(subclassEnt), ent: subclassEnt, classEnt: cls, level, name: `${cls.name} (${subclassEnt.name})`, prog: subclassEnt.casterProgression, ability: subclassEnt.spellcastingAbility, listClassName: this._subclassSpellListClass(cls, subclassEnt), preparedSpells: subclassEnt.preparedSpells});
		});
		return out;
	}
	_subclassSpellListClass (cls, sc) { return /eldritch knight|arcane trickster/i.test(sc.name) ? "Wizard" : cls.name; }
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
	// highest spell level a single source can know/prepare, from its own table
	maxSpellLevelForSource (src) { const s = this._ownSpellSlots(src.ent, src.level); return s ? Math.max(0, ...Object.keys(s).map(Number)) : 0; }

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
	spellListForSource (src) { return this._data.spells.filter(sp => (sp.classes?.fromClassList || []).some(c => c.name === src.listClassName)); }

	// per-source spell choices bucket {cantrips:[], leveled:[]}
	spellChoicesFor (uid) { return this.spellChoices[uid] || (this.spellChoices[uid] = {cantrips: [], leveled: []}); }

	/* ----- racial spellcasting (additionalSpells) ----- */
	_spellByName (name) { return this._data.spellIndexByName?.get(`${name}`.split("#")[0].trim().toLowerCase()) || null; }

	hasRacialSpells () { return !!this.raceEnt?.additionalSpells?.length; }

	racialSpellAbility () {
		const as = this.raceEnt?.additionalSpells?.[0]; if (!as?.ability) return null;
		if (typeof as.ability === "string") return as.ability;
		if (Array.isArray(as.ability.choose)) return this.raceSpellAbility && as.ability.choose.includes(this.raceSpellAbility) ? this.raceSpellAbility : as.ability.choose.slice().sort((a, b) => this.abilityMod(b) - this.abilityMod(a))[0];
		return null;
	}
	racialSpellAbilityChoices () { const ab = this.raceEnt?.additionalSpells?.[0]?.ability; return Array.isArray(ab?.choose) ? ab.choose : null; }
	racialSpellSaveDc () { const a = this.racialSpellAbility(); return a ? 8 + this.profBonus + this.abilityMod(a) : null; }

	// parse a 5etools spell-choose filter like "level=0|class=Wizard"
	racialSpellOptions (filter) {
		const params = {}; `${filter}`.split("|").forEach(p => { const [k, v] = p.split("="); if (k) params[k.trim()] = (v || "").trim(); });
		const lvl = params.level != null && params.level !== "" ? +params.level : null;
		const cls = params.class ? params.class.toLowerCase() : null;
		const school = params.school ? params.school.toLowerCase() : null;
		return this._data.spells.filter(sp => (lvl == null || sp.level === lvl) && (!cls || (sp.classes?.fromClassList || []).some(c => `${c.name}`.toLowerCase() === cls)) && (!school || `${sp.school}`.toLowerCase() === school));
	}

	// { ability, abilityChoices, knownFixed:[{sp}], knownChoose:[{key,filter,count}], innate:[{sp,freq,level}] } up to current level
	racialSpellsInfo () {
		const as = this.raceEnt?.additionalSpells?.[0]; if (!as) return null;
		const knownFixed = []; const knownChoose = []; const innate = [];
		const lvlOk = (l) => +l <= this.level;
		Object.entries(as.known || {}).forEach(([charLvl, val]) => {
			if (!lvlOk(charLvl)) return;
			const arr = Array.isArray(val) ? val : (val._ || []);
			arr.forEach((it, ix) => {
				if (typeof it === "string") { const sp = this._spellByName(it); if (sp) knownFixed.push(sp); } else if (it.choose) knownChoose.push({key: `rk:${charLvl}:${ix}`, filter: it.choose, count: it.count || 1});
			});
		});
		Object.entries(as.innate || {}).forEach(([charLvl, val]) => {
			if (!lvlOk(charLvl)) return;
			const push = (raw, freq) => { const sp = this._spellByName(raw); if (sp) innate.push({sp, freq, level: +charLvl}); };
			if (Array.isArray(val)) val.forEach(s => push(s, "at will"));
			else { if (val.daily) Object.entries(val.daily).forEach(([per, a]) => a.forEach(s => push(s, `${per}/day`))); if (val.rest) Object.entries(val.rest).forEach(([per, a]) => a.forEach(s => push(s, `${per}/rest`))); if (val.will) val.will.forEach(s => push(s, "at will")); }
		});
		return {ability: this.racialSpellAbility(), abilityChoices: this.racialSpellAbilityChoices(), knownFixed, knownChoose, innate};
	}

	/* ----- serialization ----- */
	toJson () {
		return {
			_v: 2,
			name: this.name,
			raceUid: this.raceUid,
			classes: this.classes,
			backgroundUid: this.backgroundUid,
			abilityMethod: this.abilityMethod,
			abilitiesBase: this.abilitiesBase,
			raceAbilOption: this.raceAbilOption,
			raceAbilChoices: this.raceAbilChoices,
			raceAbilWeighted: this.raceAbilWeighted,
			raceResistChoice: this.raceResistChoice,
			classSkillChoices: this.classSkillChoices,
			expertiseChoices: this.expertiseChoices,
			profChoices: this.profChoices,
			equipmentChoices: this.equipmentChoices,
			spellChoices: this.spellChoices,
			raceSpellChoices: this.raceSpellChoices,
			raceSpellAbility: this.raceSpellAbility,
			asiChoices: this.asiChoices,
			armorUid: this.armorUid,
			shieldUid: this.shieldUid,
			attunedUids: this.attunedUids,
			inventory: this.inventory,
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
			raceUid: j.raceUid ?? null,
			classes,
			backgroundUid: j.backgroundUid ?? null,
			abilityMethod: j.abilityMethod ?? "pointbuy",
			abilitiesBase: j.abilitiesBase ?? {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8},
			raceAbilOption: j.raceAbilOption ?? 0,
			raceAbilChoices: j.raceAbilChoices ?? [],
			raceAbilWeighted: j.raceAbilWeighted ?? [],
			raceResistChoice: j.raceResistChoice ?? null,
			classSkillChoices: j.classSkillChoices ?? [],
			expertiseChoices: j.expertiseChoices ?? [],
			profChoices: j.profChoices ?? {},
			equipmentChoices: j.equipmentChoices ?? {},
			spellChoices,
			raceSpellChoices: j.raceSpellChoices ?? {},
			raceSpellAbility: j.raceSpellAbility ?? null,
			asiChoices,
			armorUid: j.armorUid ?? null,
			shieldUid: j.shieldUid ?? null,
			attunedUids: j.attunedUids ?? [],
			inventory: j.inventory ?? [],
		});
		// migrate v1 boolean shield -> the first shield in inventory
		if (this.shieldUid == null && j.isShield) { const sh = this.inventory.find(r => { const a = this._armorById(r.uid); return a && `${a.type || ""}`.split("|")[0] === "S"; }); this.shieldUid = sh?.uid || null; }
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

		const data = {races, backgrounds, feats, classData, spells, items, armors, itemIndex, itemIndexByName, spellIndexByName, styleHint};
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
