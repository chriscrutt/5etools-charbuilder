import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const races = globalThis.dbg_cb.races;
	const U = (r) => `${r.name}|${r.source}`;
	const find = (n, s) => races.find(r => r.name === n && (!s || r.source === s)) || races.find(r => r.name === n);
	const R = {};
	const setRace = (n, s) => { st.reset(); const r = find(n, s); st.raceUid = U(r); return r; };

	// Mountain Dwarf -> light + medium armor proficiency
	setRace("Dwarf (Mountain)", "PHB");
	R.mtnDwarf_armor = [...st.armorProficiencies()];

	// Dwarf tool choice group present
	setRace("Dwarf (Hill)", "PHB");
	R.dwarf_groups = st.proficiencyChoiceGroups().map(g => `${g.type}: ${g.label} [${g.options.length}]`);

	// Satyr instrument choice
	const satyr = find("Satyr", "MPMM") || find("Satyr");
	if (satyr) { st.reset(); st.raceUid = U(satyr); R.satyr_groups = st.proficiencyChoiceGroups().filter(g => g.type === "tool").map(g => g.label); }

	// Hobgoblin weapon choice -> pick 2 martial weapons -> they count as proficient
	const hob = find("Hobgoblin", "VGM") || find("Hobgoblin");
	if (hob) {
		st.reset(); st.raceUid = U(hob);
		const wg = st.proficiencyChoiceGroups().find(g => g.type === "weapon");
		R.hob_weaponGroup = wg ? `${wg.label} [opts:${wg.options.length}]` : "MISSING";
		if (wg) {
			st.profChoices[wg.key] = ["Greatsword", "Longbow"];
			st.abilityMethod = "manual"; st.abilitiesBase = {str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10};
			const gs = globalThis.dbg_cb.items.find(it => it.name === "Greatsword");
			R.hob_proficientGreatsword = st._proficientWithWeapon(gs); // true via chosen
			const lb = globalThis.dbg_cb.items.find(it => it.name === "Longbow");
			R.hob_proficientLongbow = lb ? st._proficientWithWeapon(lb) : null;
			const rapier = globalThis.dbg_cb.items.find(it => it.name === "Rapier");
			R.hob_notProficientRapier = !st._proficientWithWeapon(rapier); // not chosen, hobgoblin not martial-proficient by default
		}
	}

	// UI smoke: render skills step for Mountain Dwarf + Hobgoblin
	const uiErrs = [];
	[["Dwarf (Mountain)", "PHB"], ["Hobgoblin", "VGM"]].forEach(([n, s]) => {
		const r = find(n, s); if (!r) return; st.reset(); st.raceUid = U(r); st.classes = [{uid: `Fighter|PHB`, level: 1, subclassUid: null}];
		const ix = pg._ui._steps().findIndex(x => x.id === "skills"); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${n}: ${e.message}`); }
	});
	R.ui_errors = uiErrs;

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
