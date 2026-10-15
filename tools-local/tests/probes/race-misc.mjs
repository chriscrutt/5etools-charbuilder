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
	const set = (n, s) => { st.reset(); const r = find(n, s); if (r) st.raceUid = U(r); return r; };
	const R = {};

	// size choice: default Medium, switchable to Small
	set("Aasimar", "MPMM");
	R.aasimar_sizeOpts = st.sizeOptions();
	R.aasimar_sizeDefault = st.size();      // Medium
	st.sizeChoice = "S"; R.aasimar_sizeSmall = st.size(); // Small

	// natural armor "+N bonus" parse
	R.lizardfolkDMG = (set("Lizardfolk", "DMG"), st.naturalArmor()); // {base:13, abil:dex}
	R.troglodyteDMG = (set("Troglodyte", "DMG"), st.naturalArmor()); // {base:11, abil:dex}
	R.lizardfolkVGM = (set("Lizardfolk", "VGM"), st.naturalArmor()); // still {base:13}

	// creature type + senses
	R.centaurType = (set("Centaur", "MPMM") || set("Centaur"), st.creatureType());
	R.grimlockSenses = (set("Grimlock", "DMG"), st.senses());

	// additionalSpells: multi-group (Astral Elf) -> spells from >1 group
	const ae = find("Astral Elf", "AAG");
	if (ae) {
		st.reset(); st.raceUid = U(ae); st.classes = [{uid: "Wizard|PHB", level: 8, subclassUid: null}];
		R.astralElf_groups = ae.additionalSpells.length;
		R.astralElf_default = st.racialSpellsInfo().knownFixed.map(s => s.name); // 1 cantrip (group 0), not all 3
		R.astralElf_labels = st.racialSpellGroups().map(g => st.racialSpellGroupLabel(g));
		st.raceSpellGroup = 2; R.astralElf_variant2 = st.racialSpellsInfo().knownFixed.map(s => s.name); // group 2
	}

	// known-per-rest routed to innate (Firbolg: Detect Magic + Disguise Self 1/rest)
	const fb = find("Firbolg", "VGM");
	if (fb) { st.reset(); st.raceUid = U(fb); st.classes = [{uid: "Druid|PHB", level: 3, subclassUid: null}]; const info = st.racialSpellsInfo(); R.firbolg_innate = info.innate.map(i => `${i.sp.name} (${i.freq})`); }

	// UI smoke for a multi-group + size + natural-armor + creature-type race set
	const uiErrs = [];
	[["Aasimar", "MPMM"], ["Lizardfolk", "DMG"], ["Astral Elf", "AAG"], ["Firbolg", "VGM"]].forEach(([n, s]) => {
		const r = find(n, s); if (!r) return; st.reset(); st.raceUid = U(r); st.classes = [{uid: "Druid|PHB", level: 5, subclassUid: null}];
		["skills", "spells", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); if (ix < 0) return; try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${n}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
