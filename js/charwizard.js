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
		this.expertiseChoices = []; // skills with expertise (double proficiency)
		this.profChoices = {}; // choice-group key -> [chosen values] (languages, tools, race/bg skill choices)
		this.equipmentChoices = {}; // line index -> chosen option index
		this.spellChoices = {cantrips: [], leveled: []}; // arrays of "name|source"
		this.raceSpellChoices = {}; // racial spell choice-group key -> [spell names]
		this.raceSpellAbility = null; // chosen ability for racial spells (when the race offers a choice)
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
		hp += this.hpBonusPerLevel() * this.level; // Tough, Dwarven Toughness, etc.
		return Math.max(this.level, hp);
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
		const addF = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if ((f?.level || (ix + 1)) <= this.level) perLevel += parse(f?.entries); }));
		addF(this.classEnt?.classFeatures);
		addF(this.subclassEnt?.subclassFeatures);
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
			if (grp.choose?.from) { n = grp.choose.count || 1; opts = grp.choose.from.map(s => `${s}`); } else if (grp.anyArtisansTool) { n = grp.anyArtisansTool; opts = this._toolOptions("AT"); what = "artisan's tool"; } else if (grp.anyMusicalInstrument) { n = grp.anyMusicalInstrument; opts = this._toolOptions("INS"); what = "instrument"; } else if (grp.anyGamingSet) { n = grp.anyGamingSet; opts = this._toolOptions("GS"); what = "gaming set"; } else if (grp.anyTool) { n = grp.anyTool; opts = this._toolOptions("ANY"); }
			if (n) groups.push({key: `tool:${srcKey}:${ix}`, type: "tool", label: `${srcLabel}: choose ${n} ${what}${n > 1 ? "s" : ""}`, options: opts, count: n});
		});
		const addSkill = (arr, srcKey, srcLabel) => (arr || []).forEach((grp, ix) => {
			if (grp?.choose?.from) groups.push({key: `skill:${srcKey}:${ix}`, type: "skill", label: `${srcLabel}: choose ${grp.choose.count || 1} skill${(grp.choose.count || 1) > 1 ? "s" : ""}`, options: grp.choose.from, count: grp.choose.count || 1});
			else if (grp?.any) groups.push({key: `skill:${srcKey}:${ix}`, type: "skill", label: `${srcLabel}: choose ${grp.any} skill${grp.any > 1 ? "s" : ""}`, options: CW.skills(), count: grp.any});
		});
		addLang(this.raceEnt?.languageProficiencies, "race", "Race");
		addLang(this.backgroundEnt?.languageProficiencies, "bg", "Background");
		addTool(this.classEnt?.startingProficiencies?.tools, "class", this.classEnt?.name || "Class");
		addTool(this.backgroundEnt?.toolProficiencies, "bg", "Background");
		addSkill(this.raceEnt?.skillProficiencies, "race", "Race");
		addSkill(this.backgroundEnt?.skillProficiencies, "bg", "Background");
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
		add(this.classEnt?.startingProficiencies?.tools); add(this.backgroundEnt?.toolProficiencies);
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

	saveMod (abv) { return this.abilityMod(abv) + (this.saveProfs().has(abv) ? this.profBonus : 0); }

	_hasFeature (name) {
		const scan = (fbl) => (fbl || []).some((lvArr, ix) => (lvArr || []).some(f => f?.name === name && (f.level || (ix + 1)) <= this.level));
		return scan(this.classEnt?.classFeatures) || scan(this.subclassEnt?.subclassFeatures);
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
		const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if (f?.name === "Expertise" && (f.level || (ix + 1)) <= this.level) n += 2; }));
		scan(this.classEnt?.classFeatures); scan(this.subclassEnt?.subclassFeatures);
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
	inventoryArmors () { return this.inventory.map(r => this._armorById(r.uid)).filter(a => a && `${a.type || ""}`.split("|")[0] !== "S"); }

	// worn armor entity, only if it is actually in the inventory
	armorEnt () { return this.armorUid && this._hasInInventory(this.armorUid) ? this._armorById(this.armorUid) : null; }
	isShieldEffective () { return this.isShield && this.hasShieldInInventory(); }

	// armor categories the character is proficient with (from class; light/medium/heavy/shield)
	armorProficiencies () {
		const out = new Set();
		(this.classEnt?.startingProficiencies?.armor || []).forEach(a => { const s = (typeof a === "string" ? a : a.proficiency || a.full || "").toLowerCase(); if (s) out.add(s); });
		return out;
	}
	static _ARMOR_TYPE_TO_CAT = {LA: "light", MA: "medium", HA: "heavy", S: "shield"};
	armorCategory (armorEnt) { return CharState._ARMOR_TYPE_TO_CAT[`${armorEnt?.type || ""}`.split("|")[0]] || null; }

	// warnings for wearing armor/shields the character isn't proficient with
	armorProficiencyWarnings () {
		const out = [];
		const profs = this.armorProficiencies();
		const armor = this.armorEnt();
		if (armor) { const cat = this.armorCategory(armor); if (cat && !profs.has(cat)) out.push(`Not proficient with ${cat} armor (${armor.name}): disadvantage on ability checks, saves, and attacks using Str or Dex, and you can't cast spells.`); }
		if (this.isShieldEffective() && !profs.has("shield")) out.push(`Not proficient with shields: similar penalties apply while the shield is equipped.`);
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
			const cat = this.armorCategory(armor);
			if (cat && !this.armorProficiencies().has(cat)) out.nonProf = true;
			const req = parseInt(armor.strength, 10);
			if (req && this.finalAbility("str") < req && !this._ignoresHeavyArmorSpeedPenalty()) out.strReqUnmet = {armor: armor.name, req};
		}
		if (this.isShieldEffective() && !this.armorProficiencies().has("shield")) out.nonProf = true;
		return out;
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
		const scan = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => { if (found || (f?.level || (ix + 1)) > this.level) return; if (/advantage on initiative/i.test(JSON.stringify(f?.entries || ""))) found = f.name; }));
		scan(this.classEnt?.classFeatures); scan(this.subclassEnt?.subclassFeatures);
		this.featsTaken().forEach(({featUid}) => { if (found) return; const f = this._data.feats.find(x => CW.uid(x) === featUid); if (/advantage on initiative/i.test(JSON.stringify(f?.entries || ""))) found = f.name; });
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
				if (s.length > 8 && s.length < 170 && !seen.has(key)) { seen.add(key); out.push({type: /disadvantage/i.test(s) ? "dis" : "adv", text: s, source, sourceTag}); }
			}
		};
		const race = this.raceEnt; const cls = this.classEnt; const sc = this.subclassEnt; const bg = this.backgroundEnt;
		parse(race?.entries, race?.name, race ? `{@race ${race.name}|${race.source}}` : null);
		this.featsTaken().forEach(({featUid}) => { const f = this._data.feats.find(x => CW.uid(x) === featUid); parse(f?.entries, f?.name, f ? `{@feat ${f.name}|${f.source}}` : null); });
		(cls?.classFeatures || []).forEach((lv, ix) => (lv || []).forEach(f => { if ((f?.level || (ix + 1)) <= this.level) parse(f?.entries, f?.name, `{@classFeature ${f.name}|${f.className || cls.name}|${f.classSource || cls.source}|${f.level || ix + 1}}`); }));
		(sc?.subclassFeatures || []).forEach((lv) => (lv || []).forEach(f => { if ((f?.level || 0) <= this.level) parse(f?.entries, f?.name, `{@subclassFeature ${f.name}|${sc.className}|${sc.classSource}|${sc.shortName}|${sc.source}|${f.level}}`); }));
		parse(bg?.entries, bg?.name, bg ? `{@background ${bg.name}|${bg.source}}` : null);
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
			// Monk Unarmored Defense requires no shield; Barbarian allows a shield
			if (clsName === "Barbarian") { base = 10 + dex + this.abilityMod("con"); how = "Unarmored Defense (10 + Dex + Con)"; } else if (clsName === "Monk" && !this.isShieldEffective()) { base = 10 + dex + this.abilityMod("wis"); how = "Unarmored Defense (10 + Dex + Wis)"; } else { base = 10 + dex; how = "Unarmored (10 + Dex)"; }
			// race natural armor — use if it gives a higher (or equal) AC
			const nat = this.naturalArmor();
			if (nat) {
				const natAc = nat.base + (nat.abil ? this.abilityMod(nat.abil) : 0);
				if (natAc >= base) { base = natAc; how = `Natural Armor (${nat.base}${nat.abil ? ` + ${nat.abil.toUpperCase()}` : ""})`; }
			}
		}
		if (this.isShieldEffective()) { base += 2; how += " + Shield"; }
		return {ac: base, how};
	}

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
		const addFrom = (fbl) => (fbl || []).forEach((lv, ix) => (lv || []).forEach(f => {
			if (!f?.name || (f.level || (ix + 1)) > this.level) return;
			const text = JSON.stringify(f.entries || "").toLowerCase();
			const m = text.match(/speed increases by (\d+) ?(?:feet|ft)/);
			if (!m) return;
			const conditional = /(?:not|aren't|are not|no) wearing armor|wearing no armor/.test(text);
			if (!conditional || !armored) bonus += parseInt(m[1], 10);
		}));
		addFrom(this.classEnt?.classFeatures);
		addFrom(this.subclassEnt?.subclassFeatures);
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
			expertiseChoices: this.expertiseChoices,
			profChoices: this.profChoices,
			equipmentChoices: this.equipmentChoices,
			spellChoices: this.spellChoices,
			raceSpellChoices: this.raceSpellChoices,
			raceSpellAbility: this.raceSpellAbility,
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
			expertiseChoices: j.expertiseChoices ?? [],
			profChoices: j.profChoices ?? {},
			equipmentChoices: j.equipmentChoices ?? {},
			spellChoices: j.spellChoices ?? {cantrips: [], leveled: []},
			raceSpellChoices: j.raceSpellChoices ?? {},
			raceSpellAbility: j.raceSpellAbility ?? null,
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
