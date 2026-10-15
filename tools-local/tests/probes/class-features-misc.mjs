import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const cls = (n) => data.classData.classes.find(c => c.name === n);
	const sub = (cn, sn) => data.classData.subclasses.find(s => s.className === cn && (s.shortName === sn || s.name === sn));
	const R = {};

	// Aura of Protection: Paladin L6, Cha 16 (+3) -> +3 to all saves
	st.reset(); st.classes = [{uid: uid(cls("Paladin")), level: 6, subclassUid: null}];
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16};
	R.paladin_dexSave_L6 = st.saveMod("dex"); // dex0 + aura(cha+3) = +3 (dex not proficient)
	st.classes[0].level = 5;
	R.paladin_dexSave_L5 = st.saveMod("dex"); // no aura yet -> +0

	// Diamond Soul: Monk L14 -> proficient in all saves
	st.reset(); st.classes = [{uid: uid(cls("Monk")), level: 14, subclassUid: null}];
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 12, dex: 16, con: 14, int: 10, wis: 16, cha: 10};
	R.monk_allSaveProf = [...st.saveProfs()].sort().length; // 6
	R.monk_chaSave = st.saveMod("cha"); // cha0 + prof5 = +5 (proficient via Diamond Soul, prof at L14 = +5)

	// Draconic Resilience AC: Draconic Sorcerer, no armor, Dex 14 -> AC 13+2 = 15
	st.reset(); const drac = sub("Sorcerer", "Draconic") || sub("Sorcerer", "Draconic Bloodline");
	st.classes = [{uid: uid(cls("Sorcerer")), level: 3, subclassUid: drac ? uid(drac) : null}];
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16};
	R.draconic_ac = st.ac(); R.draconic_acHow = st.acBreakdown().how;

	// Expertise from features: Ranger Deft Explorer (+1), Knowledge Cleric Blessings (+2)
	st.reset(); st.classes = [{uid: uid(cls("Ranger")), level: 2, subclassUid: null}];
	R.ranger_expertise = st.expertiseSlots(); // Deft Explorer is Tasha's; may be 0 if not in features -> check
	st.reset(); const know = sub("Cleric", "Knowledge");
	st.classes = [{uid: uid(cls("Cleric")), level: 3, subclassUid: know ? uid(know) : null}];
	R.knowledgeCleric_expertise = st.expertiseSlots(); // +2

	// Class languages + Extra Attack
	st.reset(); st.classes = [{uid: uid(cls("Druid")), level: 1, subclassUid: null}];
	R.druid_langs = st.classLanguages();
	st.reset(); st.classes = [{uid: uid(cls("Rogue")), level: 1, subclassUid: null}];
	R.rogue_langs = st.classLanguages();
	st.reset(); st.classes = [{uid: uid(cls("Fighter")), level: 11, subclassUid: null}];
	R.fighter_attacks_L11 = st.numAttacks(); // 3
	st.classes[0].level = 5; R.fighter_attacks_L5 = st.numAttacks(); // 2
	st.reset(); st.classes = [{uid: uid(cls("Wizard")), level: 5, subclassUid: null}];
	R.wizard_attacks = st.numAttacks(); // 1

	// Mystic Arcanum: Warlock L11 -> 6th, L17 -> 6,7,8,9
	st.reset(); st.classes = [{uid: uid(cls("Warlock")), level: 11, subclassUid: null}];
	R.warlock_arcanumL11 = st.mysticArcanumLevels();
	st.classes[0].level = 17; R.warlock_arcanumL17 = st.mysticArcanumLevels();
	R.warlock_arcanum6opts = st.mysticArcanumOptions(6).length > 0;

	// UI smoke
	const uiErrs = [];
	const builds = [["Paladin", null, 6], ["Sorcerer", drac ? drac.shortName : null, 3], ["Warlock", null, 17], ["Monk", null, 14]];
	builds.forEach(([cn, sn, lvl]) => {
		st.reset(); const s = sn ? sub(cn, sn) : null; st.classes = [{uid: uid(cls(cn)), level: lvl, subclassUid: s ? uid(s) : null}];
		st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
		["skills", "spells", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); if (ix < 0) return; try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${cn}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
