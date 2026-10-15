import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const R = {}; const uiErrs = [];
	const cre = (n, s) => data.bestiary.find(m => m.name === n && (!s || m.source === s)) || data.bestiary.find(m => m.name === n);
	const skcls = (n) => data.sidekickClasses.find(c => c.name === n);
	const uid = (e) => `${e.name}|${e.source}`;

	R.bestiaryCount = data.bestiary.length;
	R.sidekickClasses = (data.sidekickClasses || []).map(c => c.name);
	R.allCrUnder = data.bestiary.every(m => { const cr = typeof m.cr === "object" ? m.cr.cr : m.cr; const map = {"0": 0, "1/8": .125, "1/4": .25, "1/2": .5}; const n = cr in map ? map[cr] : Number(cr); return n <= 0.5; });

	const setSK = (creatureName, className, level, extra = {}) => {
		st.reset(); st.mode = "sidekick";
		const m = cre(creatureName); const c = skcls(className);
		st.sidekick = {...st._defaultSidekick(), creatureUid: m ? uid(m) : null, classUid: c ? uid(c) : null, level, ...extra};
		return {m, c};
	};

	// --- Wolf Warrior 5 ---
	const {m: wolf} = setSK("Wolf", "Warrior Sidekick", 5, {saveProf: "con", skillChoices: ["athletics", "intimidation"]});
	R.wolf_str = st.sidekickAbility("str"); // 12
	R.wolf_pb = st.sidekickProfBonus(); // +3
	R.wolf_hitDie = st.sidekickHitDie(); // 8 (Medium)
	R.wolf_hp = st.sidekickMaxHp(); // 11 + 4*max(1,floor(4.5+1))=11+20=31
	R.wolf_ac = st.sidekickAc(); // 13
	R.wolf_conSave = st.sidekickSaveMod("con"); // +1 + 3 = +4
	R.wolf_perception = st.sidekickSkillMod("perception"); // wis+1 + pb3 = +4 (creature proficient)
	R.wolf_athletics = st.sidekickSkillMod("athletics"); // str+1 + pb3 = +4 (chosen)
	R.wolf_stealthProf = st.sidekickSkillProfType("stealth"); // "full" (from stat block)
	R.wolf_featNames = st.sidekickFeatures().map(f => `${f.level}:${f.name}`);
	R.wolf_asiLevels = st.sidekickAsiLevels();

	// --- ASI applies ---
	setSK("Wolf", "Warrior Sidekick", 8, {asi: {4: {inc: {con: 2}}}});
	R.asi_con = st.sidekickAbility("con"); // 12 + 2 = 14
	R.asi_hpUsesNewCon = st.sidekickMaxHp(); // recomputed with con +2

	// --- Expert expertise slots ---
	setSK("Wolf", "Expert Sidekick", 3, {skillChoices: ["acrobatics", "athletics", "history", "insight", "investigation"]});
	R.expert_expSlotsL3 = st.sidekickExpertiseSlots(); // 2
	setSK("Wolf", "Expert Sidekick", 15);
	R.expert_expSlotsL15 = st.sidekickExpertiseSlots(); // 4

	// --- Spellcaster (Guard, humanoid) ---
	const {m: guard} = setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "mage"});
	const prog = st.sidekickSpellProgress();
	R.caster_prog = prog ? {cantrips: prog.cantrips, known: prog.known, slots: prog.slots} : null;
	R.caster_dc = st.sidekickSpellSaveDc();
	R.caster_listClass = st.sidekickSpellListClasses().join("+"); // Wizard
	R.caster_cantripOpts = st.sidekickSpellOptions(0).length > 0;
	R.caster_qualifiesWeapons = st.sidekickQualifiesWeapons(); // true (humanoid)

	// --- TCE faithfulness: hit die from stat-block formula + PB-delta on attacks/DCs ---
	setSK("Wolf", "Warrior Sidekick", 1);
	R.tce_die_L1 = st.sidekickHitDie(); // d8 from "2d8 + 2"
	R.tce_pbDelta_L1 = st.sidekickPbDelta(); // 0 (PB 2)
	setSK("Wolf", "Warrior Sidekick", 5);
	R.tce_pbDelta_L5 = st.sidekickPbDelta(); // +1 (PB 3)
	const adj5 = st.sidekickAdjustEntries(cre("Wolf").action);
	R.tce_biteAdjusted = JSON.stringify(adj5).includes("{@hit 5}") && JSON.stringify(adj5).includes("{@dc 12}"); // 4->5, 11->12
	setSK("Wolf", "Warrior Sidekick", 9);
	R.tce_pbDelta_L9 = st.sidekickPbDelta(); // +2 (PB 4)
	const adj9 = st.sidekickAdjustEntries(cre("Wolf").action);
	R.tce_biteAdjusted9 = JSON.stringify(adj9).includes("{@hit 6}") && JSON.stringify(adj9).includes("{@dc 13}"); // 4->6, 11->13

	// --- feat in place of an ASI (half-feat ability bonus applies) ---
	const resilient = data.feats.find(f => f.name === "Resilient"); // half-feat: +1 to chosen ability
	setSK("Wolf", "Warrior Sidekick", 4);
	if (resilient) {
		st.sidekick.asi = {4: {type: "feat", featUid: uid(resilient), featAbilChoose: ["con"]}};
		R.feat_conBefore = 12 + 1; // not yet; compute baseline
		R.feat_con = st.sidekickAbility("con"); // 12 + 1 (Resilient +1 con) = 13
		R.feat_listed = st.sidekickFeats().map(f => `${f.level}:${f.feat.name}`);
	} else R.feat = "NO_RESILIENT";

	// --- proficiency derivation (Warrior on Wolf=beast vs Guard=humanoid) ---
	setSK("Wolf", "Warrior Sidekick", 5);
	R.warriorBeast_armor = st.sidekickArmorProfs(); // all armor
	R.warriorBeast_weapons = st.sidekickWeaponProfs(); // [] — Wolf is a beast with no weapon
	setSK("Guard", "Warrior Sidekick", 5);
	R.warriorHumanoid_weapons = st.sidekickWeaponProfs(); // simple+martial+shields (humanoid)
	setSK("Guard", "Expert Sidekick", 5);
	R.expertHumanoid_toolCount = st.sidekickToolProfCount(); // 2
	R.expertBeast_toolCount = (() => { setSK("Wolf", "Expert Sidekick", 5); return st.sidekickToolProfCount(); })(); // 0 (beast, no weapon)

	// --- Sage (CM, CR 1/2, has stat-block spellcasting) — DC bumps with PB, renders in review ---
	const sage = cre("Sage", "CM");
	if (sage) {
		st.reset(); st.mode = "sidekick"; st.sidekick = {...st._defaultSidekick(), creatureUid: uid(sage), classUid: uid(skcls("Expert Sidekick")), level: 9};
		R.sage_pbDelta = st.sidekickPbDelta(); // +2 at L9
		const adj = st.sidekickAdjustEntries(sage.spellcasting);
		R.sage_dcBumped = JSON.stringify(adj).includes("{@dc 16}"); // 14 + 2 = 16
		R.sage_hitBumped = JSON.stringify(adj).includes("{@hit 8}"); // 6 + 2 = 8
		ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "review");
		try { ui.render(); } catch (e) { uiErrs.push("sage-review: " + e.message); }
		R.sage_reviewHasSpellcasting = ui._eleRoot.textContent.includes("Stat-Block Spellcasting");
		R.sage_reviewShowsDc16 = ui._eleRoot.textContent.includes("16"); // DC 16 visible
	} else R.sage = "NO_SAGE";

	// --- serialization round-trips ---
	setSK("Wolf", "Warrior Sidekick", 5, {saveProf: "dex"});
	const j = st.toJson(); R.json_mode = j.mode; R.json_skCreature = j.sidekick.creatureUid;
	st.reset(); st.fromJson(j); R.restored_mode = st.mode; R.restored_hp = st.sidekickMaxHp();

	// --- UI smoke: creature / class / review in sidekick mode ---
	setSK("Wolf", "Warrior Sidekick", 5, {saveProf: "con", skillChoices: ["athletics", "perception"]});
	["creature", "class", "review"].forEach(id => {
		ui._skStep = ui._sidekickSteps().findIndex(s => s.id === id);
		try { ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); }
	});
	R.ui_reviewHasHp = ui._eleRoot.textContent.includes("Hit Points");
	R.ui_reviewHasFeatures = /Warrior Sidekick Features|Features/.test(ui._eleRoot.textContent);
	// spellcaster UI
	setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "mage"});
	ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "class");
	try { ui.render(); } catch (e) { uiErrs.push("caster-class: " + e.message); }
	R.ui_casterSpellcasting = ui._eleRoot.textContent.includes("Spellcasting");
	// mode toggle + PC mode still works
	st.mode = "pc"; ui._ixStep = 0;
	try { ui.render(); } catch (e) { uiErrs.push("pc-mode: " + e.message); }

	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
