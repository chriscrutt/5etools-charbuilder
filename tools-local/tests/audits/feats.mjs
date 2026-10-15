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
	const feat = (n, s) => data.feats.find(f => f.name === n && (!s || f.source === s)) || data.feats.find(f => f.name === n);
	const R = {};
	// give a Fighter L4 (one ASI) -> use the ASI slot for a feat
	const setup = () => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 10}; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}]; };
	const asiKey = () => st.asiSlots()[0].key;
	const takeFeat = (n, s, extra = {}) => { setup(); st.asiChoices[asiKey()] = {type: "feat", featUid: uid(feat(n, s)), featAbilChoose: [], ...extra}; };

	// Heavily Armored -> heavy armor proficiency + str
	takeFeat("Heavily Armored", "PHB");
	R.heavilyArmored_armor = [...st.armorProficiencies()].includes("heavy");
	R.heavilyArmored_str = st.finalAbility("str"); // 14 + 1 = 15

	// Resilient (con) -> con save proficiency + ability
	takeFeat("Resilient", "PHB", {featAbilChoose: ["con"], featSaveChoose: ["con"]});
	R.resilient_conSaveProf = st.saveProfs().has("con");
	R.resilient_conSave = st.saveMod("con"); // con 14(+2) +1 ability=+3, prof +2 = +5

	// Weapon Master -> proficient with chosen weapons
	takeFeat("Weapon Master", "PHB", {featWeaponChoose: ["Greatsword", "Longbow"]});
	const gs = data.items.find(i => i.name === "Greatsword");
	R.weaponMaster_proficient = st._proficientWithWeapon(gs); // but Fighter already martial... use a non-martial class? Fighter is martial. Check name match instead
	R.weaponMaster_names = [...st.weaponProficiencies().names].filter(n => n === "greatsword").length > 0;

	// Skill Expert -> skill prof + expertise + ability
	takeFeat("Skill Expert", "TCE", {featAbilChoose: ["dex"], featSkillChoose: ["stealth"], featExpertiseChoose: ["stealth"]});
	R.skillExpert_stealthProf = st.skillProfs().has("stealth");
	R.skillExpert_stealthType = st.skillProfType("stealth"); // expertise

	// Linguist -> 3 languages + int
	takeFeat("Linguist", "PHB", {featLangChoose: ["Draconic", "Goblin", "Abyssal"]});
	R.linguist_langs = st.chosenLanguages().filter(l => ["Draconic", "Goblin", "Abyssal"].includes(l)).length;

	// Mobile -> +10 speed ; Alert -> +5 init ; Observant -> +5 passive perception
	takeFeat("Mobile", "PHB"); R.mobile_speed = st.speedString();
	takeFeat("Alert", "PHB"); R.alert_init = st.initiative(); // dex+2 + 5 = 7
	takeFeat("Observant", "PHB", {featAbilChoose: ["wis"]}); R.observant_passivePerc = st.passiveScore("perception");

	// UI smoke: render abilities/skills/review with a feat that has many choices (Prodigy via racial feat on Variant Human)
	const uiErrs = [];
	["Heavily Armored", "Resilient", "Skill Expert", "Weapon Master", "Linguist"].forEach(fn => {
		takeFeat(fn, fn === "Skill Expert" ? "TCE" : null);
		st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
		["abilities", "skills", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${fn}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
