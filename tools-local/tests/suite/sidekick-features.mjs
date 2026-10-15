import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const R = {}; const uiErrs = [];
	const uid = (e) => `${e.name}|${e.source}`;
	const cre = (n) => data.bestiary.find(m => m.name === n);
	const skcls = (n) => data.sidekickClasses.find(c => c.name === n);
	const setSK = (cn, cls, level, extra = {}) => { st.reset(); st.mode = "sidekick"; st.sidekick = {...st._defaultSidekick(), creatureUid: uid(cre(cn)), classUid: uid(skcls(cls)), level, ...extra}; };

	// --- Warrior Martial Role: Attacker +2 ---
	setSK("Wolf", "Warrior Sidekick", 1, {martialRole: "attacker"});
	R.atk_L1 = st.sidekickAttackBonus(); // pbDelta 0 + 2 = 2
	R.bite_L1 = JSON.stringify(st.sidekickAdjustEntries(cre("Wolf").action)).includes("{@hit 6}"); // 4 + 2
	setSK("Wolf", "Warrior Sidekick", 5, {martialRole: "attacker"});
	R.atk_L5 = st.sidekickAttackBonus(); // pbDelta 1 + 2 = 3
	R.bite_L5 = JSON.stringify(st.sidekickAdjustEntries(cre("Wolf").action)).includes("{@hit 7}"); // 4 + 3
	R.dc_notBumpedByAttacker = JSON.stringify(st.sidekickAdjustEntries(cre("Wolf").action)).includes("{@dc 12}"); // DC 11 + pbDelta 1 only (not +2)
	setSK("Wolf", "Warrior Sidekick", 5, {martialRole: "defender"});
	R.atk_defender = st.sidekickAttackBonus(); // just pbDelta 1 (no +2)

	// --- crit range / extra attack / initiative adv / improved defense ---
	setSK("Wolf", "Warrior Sidekick", 3); R.crit_L3 = st.sidekickCritRange(); // 19
	setSK("Wolf", "Warrior Sidekick", 2); R.crit_L2 = st.sidekickCritRange(); // 20
	setSK("Wolf", "Warrior Sidekick", 6); R.extra_L6 = st.sidekickExtraAttacks(); // 2
	setSK("Wolf", "Warrior Sidekick", 15); R.extra_L15 = st.sidekickExtraAttacks(); // 3
	setSK("Wolf", "Warrior Sidekick", 7); R.initAdv_L7 = st.sidekickInitiativeAdv(); // true
	setSK("Wolf", "Warrior Sidekick", 6); R.initAdv_L6 = st.sidekickInitiativeAdv(); // false
	setSK("Wolf", "Warrior Sidekick", 10); R.ac_L10 = st.sidekickAc(); R.ac_base = cre("Wolf").ac[0].ac; // 13 + 1 = 14

	// --- Expert Sharp Mind (L18) save proficiency ---
	setSK("Guard", "Expert Sidekick", 18, {saveProf: "dex", sharpMindSave: "int"});
	R.sharpMind_hasInt = st.sidekickSaveProfs().has("int"); // true
	setSK("Guard", "Expert Sidekick", 17, {sharpMindSave: "int"});
	R.sharpMind_belowLevel = st.sidekickSaveProfs().has("int"); // false (feature not gained yet)

	// --- Spellcaster roles -> ability + spell list ---
	setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "mage"});
	R.mage_ability = st.sidekickSpellAbility(); // int
	R.mage_hasMageArmor = st.sidekickSpellOptions(1).some(s => s.name === "Mage Armor"); // Wizard
	R.mage_noEntangle = !st.sidekickSpellOptions(1).some(s => s.name === "Entangle"); // Entangle is Druid-only
	setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "healer"});
	R.healer_ability = st.sidekickSpellAbility(); // wis
	R.healer_hasEntangle = st.sidekickSpellOptions(1).some(s => s.name === "Entangle"); // Druid -> in Healer
	setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "prodigy"});
	R.prodigy_ability = st.sidekickSpellAbility(); // cha
	R.prodigy_hasEldritchBlast = st.sidekickSpellOptions(0).some(s => s.name === "Eldritch Blast"); // Warlock cantrip

	// --- serialization + migration ---
	setSK("Wolf", "Warrior Sidekick", 7, {martialRole: "attacker"});
	const j = st.toJson(); st.reset(); st.fromJson(j);
	R.ser_role = st.sidekick.martialRole; R.ser_initAdv = st.sidekickInitiativeAdv();
	// old save migration: spellAbility -> spellRole
	st.reset(); st.fromJson({...j, sidekick: {...j.sidekick, classUid: "Spellcaster Sidekick|TCE", spellRole: undefined, spellAbility: "wis"}});
	R.migrate_role = st.sidekickSpellRole(); // "healer"

	// --- UI: pickers render (Warrior martial role, Expert sharp mind, Spellcaster role) + review Combat section ---
	const renderClass = (cn, cls, lvl, extra) => { setSK(cn, cls, lvl, extra); ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "class"); try { ui.render(); } catch (e) { uiErrs.push(`${cls} class: ${e.message}`); } return ui._eleRoot.textContent; };
	R.ui_warriorMartialRole = renderClass("Wolf", "Warrior Sidekick", 1).includes("Martial Role");
	R.ui_expertSharpMind = renderClass("Guard", "Expert Sidekick", 18).includes("Sharp Mind");
	R.ui_spellRole = renderClass("Guard", "Spellcaster Sidekick", 5).includes("Mage");
	R.ui_empowered = renderClass("Guard", "Spellcaster Sidekick", 14).includes("Empowered Spells");
	// review Combat section
	setSK("Wolf", "Warrior Sidekick", 7, {martialRole: "attacker"});
	ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "review");
	try { ui.render(); } catch (e) { uiErrs.push("review: " + e.message); }
	const txt = ui._eleRoot.textContent;
	R.ui_reviewCombat = txt.includes("Combat") && txt.includes("Attacker") && txt.includes("advantage on initiative");
	if (/NaN|\[object Object\]|\bundefined\b/.test(txt)) uiErrs.push("dirty review text");

	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
const EXPECT_FALSE = new Set(["initAdv_L6", "sharpMind_belowLevel"]); // these assertions are correct when false (feature not gained yet)
const fails = Object.entries(out).filter(([k, v]) => (EXPECT_FALSE.has(k) ? v !== false : v === false) || (k === "ui_errors" && v.length));
console.log("\nFAILURES:", fails.length ? fails.map(f => f[0]) : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
