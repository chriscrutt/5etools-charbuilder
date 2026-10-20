// The race step's grouped list: base races collapse under headers, generated versions (dragon
// colors, half-elf feature picks) fold behind a "▸ N" toggle, search auto-expands, the selection's
// group opens by itself, and the "Hide older printings" checkbox drives st.hideLegacy.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "style", "classic"); VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", false); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(async () => {
	const ui = dbg_charBuilderPage._ui; const st = ui._state;
	const goRace = () => { ui._playMode = false; ui._ixStep = ui._steps().findIndex(s => s.id === "race"); ui.render(); };
	const list = () => ui._eleRoot.querySelector(".cb__pick-list");
	const rows = () => [...list().children];
	const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
	const header = (name) => rows().find(el => el.classList.contains("cb__pick-group") && [`▸ ${name}`, `▾ ${name}`].includes(el.firstElementChild.textContent.trim()));
	const pick = (label) => rows().find(el => el.classList.contains("cb__pick") && el.firstElementChild.textContent.trim() === label);
	const search = (q) => { const inp = ui._eleRoot.querySelector(".cb__col-list input"); inp.value = q; inp.dispatchEvent(new Event("input", {bubbles: true})); };
	const R = {};

	st.reset(); st.hideLegacy = false; ui._chooserOpen = {}; goRace();
	R.nEntities = st.filterVisible(dbg_cb.races).length;
	R.nRowsCollapsed = rows().length;
	R.firstPickIsRace = !!rows().find(el => el.classList.contains("cb__pick"));
	R.dragonbornCollapsed = !pick("Ravenite");
	header("Dragonborn").click();
	R.dragonbornTops = rows().filter(el => el.classList.contains("cb__pick--d1")).map(el => el.firstElementChild.textContent.trim());
	const ravenite = pick("Ravenite"); R.raveniteVerBadge = ravenite?.querySelector(".cb__pick-ver")?.textContent.trim();
	ravenite.querySelector(".cb__pick-ver").click();
	R.raveniteColorsShown = rows().filter(el => el.classList.contains("cb__pick--d2")).length;
	R.selAfterToggle = st.raceUid; // toggling versions must not select
	rows().find(el => el.classList.contains("cb__pick--d2") && el.firstElementChild.textContent.trim() === "Black").click();
	R.selVersion = st.raceUid;

	// search expands matching groups only
	search("hill");
	R.searchRows = rows().map(text);
	search("");

	// selection's group opens by itself on a fresh render
	st.raceUid = "Dwarf (Hill)|PHB"; ui._chooserOpen = {}; goRace();
	R.autoOpened = !!pick("Hill") && pick("Hill").classList.contains("cb__pick--sel");

	// hide older printings
	const cb = ui._eleRoot.querySelector("label input[type=checkbox]");
	cb.checked = true; cb.dispatchEvent(new Event("change", {bubbles: true}));
	R.hideLegacy = st.hideLegacy;
	R.nEntitiesLegacyHidden = st.filterVisible(dbg_cb.races).length;
	search("aasimar");
	R.aasimarSources = rows().filter(el => el.classList.contains("cb__pick")).map(el => el.querySelector(".cb__pick-src").textContent);
	// Monsters of the Multiverse standalone reprints join their families (via reprintedAs, or the name for Astral Elf)
	const families = (hideLegacy) => {
		st.reset(); st.hideLegacy = hideLegacy; ui._chooserOpen = {}; goRace();
		document.querySelectorAll(".cb__pick-group").forEach(g => g.click());
		const out = {loose: []}; let cur = null;
		rows().forEach(el => {
			if (el.classList.contains("cb__pick-group")) { cur = el.firstElementChild.textContent.replace(/^[▸▾]s*/, "").trim(); out[cur] = []; return; }
			const label = el.firstElementChild.textContent.trim(); const src = el.querySelector(".cb__pick-src")?.textContent;
			if (el.classList.contains("cb__pick--d1")) out[cur].push(`${label}|${src}`); else if (!el.classList.contains("cb__pick--d2")) { out.loose.push(`${label}|${src}`); cur = null; }
		});
		return out;
	};
	for (const hl of [false, true]) {
		const fam = families(hl);
		R[`families_hideLegacy_${hl}`] = {Elf: fam.Elf, Gnome: fam.Gnome, Dwarf: fam.Dwarf, Gith: fam.Gith, strayLoose: fam.loose.filter(x => ["Deep Gnome", "Eladrin", "Duergar", "Sea Elf", "Shadar-Kai", "Githyanki", "Githzerai", "Astral Elf"].includes(x.split("|")[0]))};
	}
	st.hideLegacy = false; st.reset();
	return R;
});

console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`collapsed list is much shorter than the entity list (${r.nRowsCollapsed} rows for ${r.nEntities})`, r.nRowsCollapsed < r.nEntities / 2);
chk("a selectable race row exists before any expanding", r.firstPickIsRace);
chk("groups start collapsed", r.dragonbornCollapsed);
chk(`Dragonborn expands to its lineages, base first (${r.dragonbornTops})`, r.dragonbornTops[0] === "Base race" && ["Dragonborn", "Draconblood", "Ravenite", "Chromatic", "Gem", "Metallic"].every(x => r.dragonbornTops.includes(x)));
chk("Ravenite folds 10 colors behind a toggle", r.raveniteVerBadge === "▸ 10");
chk("toggle shows the 10 colors", r.raveniteColorsShown === 10);
chk("toggling versions doesn't select", r.selAfterToggle == null);
chk("clicking a version selects it", r.selVersion === "Dragonborn (Ravenite; Black)|EGW");
chk("search 'hill' shows the Dwarf group with Hill", r.searchRows.some(x => x.startsWith("▾ Dwarf")) && r.searchRows.some(x => x.startsWith("Hill")));
chk("search hides non-matching groups", !r.searchRows.some(x => /Dragonborn/.test(x)));
chk("the selected race's group opens by itself", r.autoOpened);
chk("checkbox turns on hide-legacy", r.hideLegacy === true && r.nEntitiesLegacyHidden < r.nEntities);
for (const hl of [false, true]) {
	const fam = r[`families_hideLegacy_${hl}`];
	chk(`[hide older=${hl}] MPMM reprints aren't loose rows (${fam.strayLoose})`, fam.strayLoose.length === 0);
	chk(`[hide older=${hl}] Elf has Eladrin, Sea, Shadar-Kai (MPMM) and Astral (AAG) (${fam.Elf})`, ["Eladrin|MPMM", "Sea|MPMM", "Shadar-Kai|MPMM", "Astral|AAG"].every(x => fam.Elf?.includes(x)));
	chk(`[hide older=${hl}] Gnome has Deep (MPMM) (${fam.Gnome})`, fam.Gnome?.includes("Deep|MPMM"));
	chk(`[hide older=${hl}] Dwarf has Duergar (MPMM) (${fam.Dwarf})`, fam.Dwarf?.includes("Duergar|MPMM"));
	chk(`[hide older=${hl}] Gith has Githyanki and Githzerai (${fam.Gith})`, ["Githyanki|MPMM", "Githzerai|MPMM"].every(x => fam.Gith?.includes(x)));
}
chk(`older printings gone (Aasimar sources: ${r.aasimarSources})`, r.aasimarSources.length && !r.aasimarSources.includes("VGM"));

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
