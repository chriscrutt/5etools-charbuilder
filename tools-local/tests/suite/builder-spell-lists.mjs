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
	const R = {}; const fails = [];
	const subUid = (cn, scn) => { const sc = data.classData.subclasses.find(x => x.className === cn && x.name === scn); return sc ? `${sc.name}|${sc.source}` : null; };
	const setup = (clsUid, lvl, sub) => { st.reset(); st.mode = "pc"; st.hiddenSources = []; st.hideLegacy = false; st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 16}; st.classes = [{uid: clsUid, level: lvl, subclassUid: sub || null}]; };

	// --- Wild Magic Sorcerer: Chaos Bolt (XGE) now in the spell list ---
	setup("Sorcerer|PHB", 5, subUid("Sorcerer", "Wild Magic Sorcery"));
	const src = st.spellSources()[0];
	const list = st.spellListForSource(src);
	const bySource = {}; list.forEach(s => bySource[s.source] = (bySource[s.source] || 0) + 1);
	R.sorc_total = list.length;
	R.sorc_hasChaosBolt = list.some(s => s.name === "Chaos Bolt");
	R.sorc_sources = Object.keys(bySource).sort();
	R.sorc_hasNonPhb = list.some(s => s.source !== "PHB");
	R.sorc_sampleXge = list.filter(s => s.source === "XGE").slice(0, 5).map(s => s.name);

	// --- Wizard includes supplement spells (e.g. XGE) ---
	setup("Wizard|PHB", 5, null);
	const wlist = st.spellListForSource(st.spellSources()[0]);
	R.wiz_hasXge = wlist.some(s => s.source === "XGE"); R.wiz_total = wlist.length;

	// --- Cleric (Healer would be for sidekick; here just core) ---
	setup("Cleric|PHB", 5, subUid("Cleric", "Life Domain"));
	R.cleric_total = st.spellListForSource(st.spellSources()[0]).length;

	// --- racialSpellOptions(class=Sorcerer) includes Chaos Bolt (variant) ---
	setup("Fighter|PHB", 4, null);
	const sorcL1 = st.racialSpellOptions("level=1|class=Sorcerer");
	R.racialSorc_hasChaosBolt = sorcL1.some(s => s.name === "Chaos Bolt");

	// --- sidekick Spellcaster (Prodigy = Bard+Warlock) gets Warlock variant spells ---
	st.reset(); st.mode = "sidekick"; st.sidekick = {...st._defaultSidekick(), creatureUid: `${data.bestiary.find(m => m.name === "Guard").name}|${data.bestiary.find(m => m.name === "Guard").source}`, classUid: "Spellcaster Sidekick|TCE", level: 5, spellRole: "prodigy"};
	const prodL1 = st.sidekickSpellOptions(1);
	R.prodigy_count = prodL1.length;

	// --- UI: spell step shows Chaos Bolt for the Sorcerer ---
	setup("Sorcerer|PHB", 5, subUid("Sorcerer", "Wild Magic Sorcery"));
	const ix = ui._steps().findIndex(s => s.id === "spells");
	try { ui._ixStep = ix; ui.render(); } catch (e) { fails.push("spells render: " + e.message); }
	R.ui_hasChaosBolt = (ui._eleRoot.textContent || "").includes("Chaos Bolt");

	st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
const F = [...out.fails];
const chk = (k, c) => { if (!c) F.push(k); };
chk("sorc_hasChaosBolt", out.sorc_hasChaosBolt);
chk("sorc_hasNonPhb", out.sorc_hasNonPhb);
chk("wiz_hasXge", out.wiz_hasXge);
chk("racialSorc_hasChaosBolt", out.racialSorc_hasChaosBolt);
chk("ui_hasChaosBolt", out.ui_hasChaosBolt);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
