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
	const R = {};
	st.reset();
	const races = () => st.filterVisible(data.races).length;
	R.races_all = races();
	R.totalSources = st.allSources().length;

	// hide a specific source (LFL)
	st.hiddenSources = ["LFL"];
	R.lfl_racesGone = st.filterVisible(data.races).every(r => r.source !== "LFL");
	R.lfl_itemsGone = data.items.filter(i => i.source === "LFL").length === 0 || !st.filterVisible(data.items.filter(i => i.source === "LFL")).length;

	// hide legacy: VGM Aasimar (reprinted by MPMM=classic) hidden; PHB content (reprinted by XPHB only) kept
	st.hiddenSources = []; st.hideLegacy = true;
	const vgmAas = data.races.find(r => r.name === "Aasimar" && r.source === "VGM");
	R.vgmAasimar_legacy = vgmAas ? !st.isVisible(vgmAas) : null; // true (hidden)
	const phbDwarf = data.races.find(r => /Dwarf/.test(r.name) && r.source === "PHB");
	R.phbDwarf_visible = phbDwarf ? st.isVisible(phbDwarf) : null; // true (kept — XPHB reprint isn't classic)

	// Forgotten Realms + neutral preset behavior: GGR (Ravnica) hidden, PHB kept
	st.hideLegacy = false;
	const NON_FR = pg._ui.constructor._NON_FR_SOURCES;
	st.hiddenSources = st.allSources().filter(s => s.group !== 0 || NON_FR.has(s.source)).map(s => s.source);
	R.ggr_hidden = !st._sourceAllowed("GGR");
	R.phb_shown = st._sourceAllowed("PHB");
	R.xge_shown = st._sourceAllowed("XGE");
	R.scag_shown = st._sourceAllowed("SCAG"); // FR -> shown

	// Official only: homebrew/partnered/UA hidden, core shown
	st.hiddenSources = st.allSources().filter(s => s.group !== 0).map(s => s.source);
	R.officialOnly_phb = st._sourceAllowed("PHB");

	// UI smoke: open the Sources panel
	st.reset();
	const uiErrs = [];
	try { pg._ui._showSources = true; pg._ui.render(); R.panelRendered = !!pg._ui._eleRoot.textContent.includes("Content Sources"); pg._ui._showSources = false; pg._ui.render(); } catch (e) { uiErrs.push("panel: " + e.message); }
	// also render a chooser after hiding sources
	st.hiddenSources = ["LFL", "GGR", "MOT"];
	try { pg._ui._ixStep = pg._ui._steps().findIndex(s => s.id === "race"); pg._ui.render(); } catch (e) { uiErrs.push("race: " + e.message); }
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
