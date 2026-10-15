import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const races = globalThis.dbg_cb.races; const feats = globalThis.dbg_cb.feats;
	const U = (e) => `${e.name}|${e.source}`;
	const findRace = (n, s) => races.find(r => r.name === n && (!s || r.source === s)) || races.find(r => r.name === n);
	const findFeat = (n) => feats.find(f => f.name === n);
	const R = {};

	const vh = findRace("Human (Variant)", "PHB");
	st.reset(); st.raceUid = U(vh);
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10};
	R.raceFeatCount = st.raceFeatCount(); // 1

	// pick Resilient (half-feat: +1 to one ability + save prof) -> ability bonus applies
	const resilient = findFeat("Resilient");
	if (resilient) {
		st.raceFeat = {featUid: U(resilient), featAbilChoose: ["con"]};
		R.con_before = 12; R.con_after = st.finalAbility("con"); // +1 -> 13
		R.featsTaken = st.featsTaken().map(t => `${t.className}:${t.featUid}`);
	}

	// Tough as racial feat -> +2 HP per level reflected in maxHp
	const tough = findFeat("Tough");
	if (tough) {
		st.reset(); st.raceUid = U(vh); st.abilityMethod = "manual"; st.abilitiesBase = {str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10};
		st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}];
		const hpNoFeat = st.maxHp();
		st.raceFeat = {featUid: U(tough), featAbilChoose: []};
		R.hp_noFeat = hpNoFeat; R.hp_withTough = st.maxHp(); R.hp_delta = st.maxHp() - hpNoFeat; // +10 at level 5
	}

	// dup prevention: racial feat = Tough should disable Tough in ASI picker (featsTaken includes race)
	R.toughTakenAsRace = st.featsTaken().some(t => t.featUid === U(tough) && t.key === "race");

	// non-feat race shows no racial feat slot
	const dwarf = findRace("Dwarf (Hill)", "PHB");
	st.reset(); st.raceUid = U(dwarf);
	R.dwarf_raceFeatCount = st.raceFeatCount(); // 0

	// UI smoke: abilities + review for Variant Human with a racial feat
	st.reset(); st.raceUid = U(vh); st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}];
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 10};
	if (tough) st.raceFeat = {featUid: U(tough), featAbilChoose: []};
	const uiErrs = [];
	["abilities", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
