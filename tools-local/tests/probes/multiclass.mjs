import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();

const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = [];
page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage && globalThis.dbg_charBuilderPage._ui && globalThis.dbg_charBuilderPage._ui._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage;
	const st = pg._ui._state;
	const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const byName = (n) => data.classData.classes.find(c => c.name === n && c.source === "PHB") || data.classData.classes.find(c => c.name === n);
	const R = {};

	// ---- Fighter 5 / Wizard 3, decent stats ----
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 15, dex: 12, con: 14, int: 14, wis: 13, cha: 10};
	st.classes = [{uid: uid(byName("Fighter")), level: 5, subclassUid: null}, {uid: uid(byName("Wizard")), level: 3, subclassUid: null}];
	R.fw_totalLevel = st.totalLevel;
	R.fw_profBonus = st.profBonus;
	R.fw_maxHp = st.maxHp(); // expect 10+2 + 4*(6+2) + 3*(4+2) = 12+32+18 = 62
	R.fw_hitDice = st.hitDiceString(); // "5d10, 3d6"
	R.fw_asiSlots = st.asiSlots().map(s => `${s.className}@${s.classLevel}`); // Fighter@4 (Fighter L5), none for Wizard L3
	R.fw_spellSlots = st.spellSlots(); // single caster (Wizard 3) -> own table {1:4,2:2}
	R.fw_sources = st.spellSources().map(s => ({name: s.name, prog: s.prog, ability: s.ability}));

	// ---- Cleric 1 / Wizard 1 -> combined multiclass slots ----
	st.classes = [{uid: uid(byName("Cleric")), level: 1, subclassUid: null}, {uid: uid(byName("Wizard")), level: 1, subclassUid: null}];
	R.cw_combinedLevel = st._combinedCasterLevel(); // 2
	R.cw_spellSlots = st.spellSlots(); // multiclass table[2] = {1:3}
	R.cw_isMulti = st.isMulticlassed();

	// ---- prereq filtering: low physical stats, int 14 ----
	st.abilitiesBase = {str: 8, dex: 8, con: 10, int: 14, wis: 8, cha: 8};
	st.classes = [{uid: uid(byName("Wizard")), level: 1, subclassUid: null}];
	R.low_canAddFighter = st.canMulticlassInto(byName("Fighter")); // needs Str13 or Dex13 -> false
	R.low_canAddBarb = st.canMulticlassInto(byName("Barbarian")); // Str13 -> false
	R.low_reqFighter = st.multiclassRequirement(byName("Fighter"));
	// with good stats Fighter should pass
	st.abilitiesBase = {str: 15, dex: 8, con: 10, int: 14, wis: 8, cha: 8};
	R.good_canAddFighter = st.canMulticlassInto(byName("Fighter")); // Str15 ok, current Wizard int14 ok -> true

	// ---- Warlock 2 / Sorcerer 1: pact separate + combined ----
	st.classes = [{uid: uid(byName("Warlock")), level: 2, subclassUid: null}, {uid: uid(byName("Sorcerer")), level: 1, subclassUid: null}];
	R.warlock_pact = st.pactSlots(); // Warlock 2 pact: 2 slots of level 1
	R.warlock_regular = st.spellSlots(); // only Sorcerer counts (1) -> table[1] = {1:2}
	R.warlock_combinedLevel = st._combinedCasterLevel(); // sorcerer 1 only (pact excluded) = 1

	// ---- pact re-check ----
	st.classes = [{uid: uid(byName("Warlock")), level: 2, subclassUid: null}, {uid: uid(byName("Sorcerer")), level: 1, subclassUid: null}];
	R.warlock_pact2 = st.pactSlots(); // expect {1:2}

	// ---- UI smoke test: render every step for a Cleric 3 / Wizard 2 multiclass with subclasses ----
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 10, dex: 14, con: 14, int: 15, wis: 13, cha: 8};
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;
	const cleric = byName("Cleric"); const wiz = byName("Wizard");
	const clericSub = st.subclassesForClass(cleric)[0];
	const wizSub = st.subclassesForClass(wiz)[0];
	st.classes = [
		{uid: uid(cleric), level: 3, subclassUid: clericSub ? uid(clericSub) : null},
		{uid: uid(wiz), level: 2, subclassUid: wizSub ? uid(wizSub) : null},
	];
	const ui = pg._ui;
	const uiErrors = [];
	const stepIds = ui._steps().map(s => s.id);
	for (let i = 0; i < ui._steps().length; ++i) { try { ui._ixStep = i; ui.render(); } catch (e) { uiErrors.push(`step ${stepIds[i]}: ${e.message}\n${(e.stack || "").split("\n").slice(0, 5).join("\n")}`); } }
	R.ui_steps = stepIds;
	R.ui_errors = uiErrors;
	R.mc_review_classLine = st.classList().map(c => `${c.cls.name}${c.subclassEnt ? ` (${c.subclassEnt.name})` : ""} ${c.level}`).join(" / ");
	R.mc_spellSources = st.spellSources().map(s => `${s.name}[${s.prog}]`);
	R.mc_combinedSlots = st.spellSlots(); // Cleric3(full=3)+Wizard2(full=2)=5 -> table[5]={1:4,2:3,3:2}

	// ---- exercise lazily-rendered class detail panels (toggle handlers) ----
	const detailErrs = [];
	// multiclass "proficiencies gained" detail branch
	try { const tmp = document.createElement("div"); ui._renderClassDetail(tmp, byName("Paladin"), {level: 1, subclassUid: null, mc: true}); R.mc_detail_html = tmp.innerHTML.includes("Proficiencies gained"); } catch (e) { detailErrs.push("classDetail(mc): " + e.message); }
	// open the class step, then fire the toggle on the add-class + first class-row <details>
	ui._ixStep = ui._steps().findIndex(s => s.id === "class"); ui.render();
	try {
		const dets = [...ui._eleRoot.querySelectorAll("details")];
		dets.forEach(d => { d.open = true; d.dispatchEvent(new Event("toggle")); });
		R.opened_details = dets.length;
	} catch (e) { detailErrs.push("toggle: " + e.message); }
	R.detail_errors = detailErrs;

	// ---- v1 save migration: single class + numeric-keyed ASI + flat spellChoices ----
	st.reset();
	const wizUid = uid(byName("Wizard"));
	st.fromJson({
		_v: 1, name: "Old", classUid: wizUid, level: 5, subclassUid: null,
		asiChoices: {"4": {type: "asi", plan: "one", inc: {int: 2}}},
		spellChoices: {cantrips: ["Fire Bolt|PHB"], leveled: ["Magic Missile|PHB"]},
	});
	R.mig_classes = JSON.parse(JSON.stringify(st.classes));
	R.mig_totalLevel = st.totalLevel;
	R.mig_asiKeys = Object.keys(st.asiChoices); // expect ["wizUid@4"]
	R.mig_spellChoices = st.spellChoices; // expect {[wizUid]:{cantrips,leveled}}
	R.mig_intBonus = st.asiBonuses().int; // expect 2 (slot still valid at Wizard L4)

	// ---- multiclass skill/tool proficiency grants (Wizard primary + Rogue + Bard) ----
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 10, dex: 14, con: 12, int: 15, wis: 10, cha: 14};
	st.classes = [{uid: uid(byName("Wizard")), level: 1, subclassUid: null}, {uid: uid(byName("Rogue")), level: 1, subclassUid: null}, {uid: uid(byName("Bard")), level: 1, subclassUid: null}];
	const groups = st.proficiencyChoiceGroups();
	R.mc_skillGroups = groups.filter(g => g.type === "skill").map(g => g.label); // Rogue + Bard (not Wizard primary)
	R.mc_toolGroups = groups.filter(g => g.type === "tool").map(g => g.label); // Bard instrument
	R.mc_fixedTools = [...st.fixedTools()]; // Rogue thieves' tools
	const rogueSkillGroup = groups.find(g => g.type === "skill" && g.key.includes("Rogue"));
	if (rogueSkillGroup) st.profChoices[rogueSkillGroup.key] = ["stealth"];
	R.mc_skillProfsHasStealth = st.skillProfs().has("stealth");
	// render skills + review steps for this 3-class build
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;
	const mc3Errs = [];
	["skills", "review", "spells"].forEach(id => { const ix = ui._steps().findIndex(s => s.id === id); if (ix < 0) return; try { ui._ixStep = ix; ui.render(); } catch (e) { mc3Errs.push(`${id}: ${e.message}`); } });
	R.mc3_renderErrors = mc3Errs;

	// ---- prepared-spell count: half-caster (Paladin) vs full (Cleric), wis/cha +3 ----
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 14, dex: 10, con: 12, int: 10, wis: 16, cha: 16};
	st.classes = [{uid: uid(byName("Paladin")), level: 5, subclassUid: null}];
	R.paladin5_prepared = st.leveledSpellsKnownFor(st.spellSources()[0]); // floor(5/2)+3 = 5
	st.classes = [{uid: uid(byName("Cleric")), level: 5, subclassUid: null}];
	R.cleric5_prepared = st.leveledSpellsKnownFor(st.spellSources()[0]); // 5+3 = 8

	// ---- redundancy locking for multiclass skill choices (bidirectional) ----
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 10, dex: 14, con: 12, int: 15, wis: 12, cha: 14};
	// Acolyte background grants fixed Insight + Religion
	const acolyte = data.backgrounds.find(b => b.name === "Acolyte");
	st.backgroundUid = acolyte ? `${acolyte.name}|${acolyte.source}` : null;
	st.classes = [{uid: uid(byName("Wizard")), level: 1, subclassUid: null}, {uid: uid(byName("Rogue")), level: 1, subclassUid: null}, {uid: uid(byName("Bard")), level: 1, subclassUid: null}];
	R.lock_fixedSkills = [...st.fixedSkillProfs()]; // expect insight, religion (from Acolyte)
	const grpsL = st.proficiencyChoiceGroups();
	const rogueG = grpsL.find(g => g.type === "skill" && g.key.includes("Rogue"));
	const bardG = grpsL.find(g => g.type === "skill" && g.key.includes("Bard"));
	// before choosing anything: Rogue group should lock the Acolyte skill "insight"
	R.lock_rogueLocksInsight = ui._alreadyHasForGroup(rogueG).has("insight");
	// choose Stealth in the Rogue group, then the Bard group must lock "stealth"
	st.profChoices[rogueG.key] = ["stealth"];
	R.lock_bardLocksStealth = ui._alreadyHasForGroup(bardG).has("stealth");
	// and the primary (Wizard) class skill picker also locks the multiclass-chosen "stealth"
	R.lock_primarySkillProfsHasStealth = st.skillProfs().has("stealth");

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\nconsole errors:", errs.length ? errs : "none");
await page.close();
await b.close().catch(() => {});
process.exit(0);
