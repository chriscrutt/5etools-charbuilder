import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
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

	// Tiefling: fire resistance (fixed)
	setRace("Tiefling", "PHB");
	R.tiefling = st.defenses();
	// Aasimar: necrotic + radiant
	setRace("Aasimar", "VGM");
	R.aasimar = st.defenses().resist;
	// Dragonborn base: resistance is a CHOICE
	setRace("Dragonborn", "PHB");
	R.dragonborn_opts = st.raceResistOptions();
	R.dragonborn_beforeChoice = st.defenses().resist; // []
	st.raceResistChoice = "fire";
	R.dragonborn_afterChoice = st.defenses().resist; // [fire]
	// Dragonborn (Red): fixed fire
	setRace("Dragonborn (Red)", "PHB");
	R.dragonbornRed = st.defenses().resist; // [fire]
	R.dragonbornRed_opts = st.raceResistOptions(); // null
	// Yuan-ti Pureblood: poison immunity + condition immune poisoned
	const yt = find("Yuan-ti Pureblood", "VGM");
	if (yt) { st.reset(); st.raceUid = U(yt); R.yuanti = st.defenses(); }
	// race resist + item resist merge: Tiefling wielding Sapphire Buckler (psychic/thunder)
	setRace("Tiefling", "PHB");
	const sb = globalThis.dbg_cb.items.find(it => it.name === "Sapphire Buckler");
	if (sb) { st.addToInventory({uid: U(sb), name: sb.name}); st.shieldUid = U(sb); st.setAttuned(U(sb), true); }
	R.tiefling_plus_item = st.defenses().resist.sort(); // fire + psychic + thunder

	// UI smoke: render skills + review for Dragonborn base (resistance picker) and Tiefling
	const uiErrs = [];
	[["Dragonborn", "PHB"], ["Yuan-ti Pureblood", "VGM"]].forEach(([n, s]) => {
		const r = find(n, s); if (!r) return; st.reset(); st.raceUid = U(r); st.classes = [{uid: "Fighter|PHB", level: 1, subclassUid: null}];
		["skills", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${n}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
