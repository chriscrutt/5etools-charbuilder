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
	const classes = data.classData.classes; const subs = data.classData.subclasses;
	const uid = (e) => `${e.name}|${e.source}`;
	const cls = (n) => classes.find(c => c.name === n && c.source === "PHB") || classes.find(c => c.name === n);
	const sub = (cn, sn) => subs.find(s => s.className === cn && (s.shortName === sn || s.name === sn));
	const R = {};

	const build = (cn, sn, lvl) => { st.reset(); const c = cls(cn); const s = sub(cn, sn); st.classes = [{uid: uid(c), level: lvl, subclassUid: s ? uid(s) : null}]; st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 12, con: 14, int: 12, wis: 16, cha: 14}; return st.spellSources()[0]; };

	// Life Cleric L5 -> always-prepared domain spells (Bless..Spiritual Weapon, Lesser Restoration, Beacon of Hope, Revivify)
	let src = build("Cleric", "Life", 5);
	R.lifeCleric_prepared = st.subclassPreparedSpells(src).map(p => `${p.sp.name} (L${p.level})`);

	// Fiend Warlock L5 -> expanded list adds Fireball etc. to pickable list
	src = build("Warlock", "Fiend", 5);
	const list = st.spellListForSource(src).map(s => s.name);
	R.fiend_hasFireball = list.includes("Fireball");          // expanded
	R.fiend_hasScorchingRay = list.includes("Scorching Ray"); // expanded
	R.fiend_expandedCount = st.subclassExpandedSpells(src).length;

	// Devotion Paladin L5 -> always prepared (Protection from Evil and Good, Sanctuary, etc.)
	src = build("Paladin", "Devotion", 5);
	R.devotionPaladin_prepared = st.subclassPreparedSpells(src).map(p => p.sp.name);

	// EK Fighter L8 -> expanded (its own additionalSpells)
	st.reset(); const f = cls("Fighter"); const ek = sub("Fighter", "EK") || subs.find(s => /eldritch knight/i.test(s.name));
	st.classes = [{uid: uid(f), level: 8, subclassUid: ek ? uid(ek) : null}]; st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 12, con: 14, int: 13, wis: 10, cha: 10};
	const ekSrc = st.spellSources()[0];
	R.ek_source = ekSrc ? ekSrc.name : null;
	R.ek_expandedCount = ekSrc ? st.subclassExpandedSpells(ekSrc).length : null;

	// UI smoke: spells + review for Life Cleric and Fiend Warlock
	const uiErrs = [];
	[["Cleric", "Life", 5], ["Warlock", "Fiend", 5], ["Paladin", "Devotion", 9]].forEach(([cn, sn, lvl]) => {
		build(cn, sn, lvl); st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
		["spells", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); if (ix < 0) return; try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${cn}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
