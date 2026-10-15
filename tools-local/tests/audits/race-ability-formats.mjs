import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
// load once, force Classic style, reload so race data is migrated for 2014
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage && globalThis.dbg_charBuilderPage._ui && globalThis.dbg_charBuilderPage._ui._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const races = globalThis.dbg_cb.races; const st = globalThis.dbg_charBuilderPage._ui._state;
	const U = (r) => `${r.name}|${r.source}`;
	const fmt = {fixedOnly: 0, simpleChoose: 0, weighted: 0, multiOption: 0, empty: 0, weird: []};
	const weirdKeys = new Set();
	races.forEach(r => {
		const abil = r.ability || [];
		if (!abil.length) { fmt.empty++; return; }
		if (abil.length > 1) fmt.multiOption++;
		abil.forEach(opt => {
			Object.keys(opt).forEach(k => { if (k !== "choose" && !["str", "dex", "con", "int", "wis", "cha"].includes(k)) weirdKeys.add(`${k} (${U(r)})`); });
			if (opt.choose) { if (opt.choose.weighted) fmt.weighted++; else fmt.simpleChoose++; }
			else fmt.fixedOnly++;
		});
	});
	// sanity: compute racialBonuses for some staples and confirm nonzero where expected
	const probe = {};
	const check = (name, src, expectKey) => {
		const r = races.find(x => x.name === name && (!src || x.source === src)) || races.find(x => x.name === name);
		if (!r) { probe[name] = "NOT FOUND"; return; }
		st.reset(); st.raceUid = U(r);
		probe[`${name}|${r.source}`] = {bonuses: st.racialBonuses(), opts: (r.ability || []).length, chooseMeta: st.racialChooseMeta()};
	};
	check("Half-Elf", "PHB"); check("Hill Dwarf"); check("Dwarf (Hill)", "PHB"); check("Variant Human"); check("Human (Variant)", "PHB"); check("Mountain Dwarf"); check("Dwarf (Mountain)", "PHB"); check("Dragonborn", "PHB"); check("Elf (High)", "PHB");
	const sampleEmpty = races.filter(r => !(r.ability || []).length).slice(0, 12).map(U);
	return {total: races.length, classCfg: VetoolsConfig.get("styleSwitcher", "style"), fmt, weirdKeys: [...weirdKeys], sampleEmpty, probe};
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
