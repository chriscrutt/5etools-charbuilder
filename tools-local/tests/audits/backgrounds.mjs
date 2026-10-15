import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const bgs = globalThis.dbg_cb.backgrounds; const st = globalThis.dbg_charBuilderPage._ui._state;
	const U = (e) => `${e.name}|${e.source}`;
	const F = {}; const add = (k, v) => (F[k] = F[k] || []).push(v);
	const fieldFreq = {};
	bgs.forEach(bg => {
		Object.keys(bg).forEach(k => fieldFreq[k] = (fieldFreq[k] || 0) + 1);
		const u = U(bg);
		// 2024-style grants
		if (bg.ability) add("ability", `${u} = ${JSON.stringify(bg.ability)}`);
		if (bg.feats) add("feats", `${u} = ${JSON.stringify(bg.feats)}`);
		// proficiency formats
		(bg.skillProficiencies || []).forEach(g => { if (g?.choose) add("skillChoose", `${u} = ${JSON.stringify(g.choose)}`); else if (g?.any) add("skillAny", `${u} = any ${g.any}`); });
		if (bg.languageProficiencies) add("hasLang", `${u} = ${JSON.stringify(bg.languageProficiencies)}`);
		(bg.toolProficiencies || []).forEach(g => { if (g && typeof g === "object" && (g.choose || Object.keys(g).some(k => k.startsWith("any")))) add("toolChoose", `${u} = ${JSON.stringify(g)}`); });
		if (bg.weaponProficiencies) add("weaponProf", `${u} = ${JSON.stringify(bg.weaponProficiencies)}`);
		if (bg.armorProficiencies) add("armorProf", `${u} = ${JSON.stringify(bg.armorProficiencies)}`);
		if (bg.savingThrowProficiencies) add("saveProf", `${u} = ${JSON.stringify(bg.savingThrowProficiencies)}`);
		if (bg.additionalSpells) add("additionalSpells", `${u}`);
		if (bg.startingEquipment) add("startingEquipment", u);
		// the named feature
		const feat = (bg.entries || []).find(e => e && e.name && /feature/i.test(e.data?.tags?.join(" ") || "") || (e && e.name && e.type === "entries"));
		if ((bg.entries || []).some(e => e && e.name)) add("hasNamedFeature", u);
	});
	// does racialBonuses pick up background ability? (it shouldn't, but check whether bg ability is applied anywhere)
	const bgWithAbil = bgs.find(bg => bg.ability);
	let bgAbilityApplied = null;
	if (bgWithAbil) { st.reset(); st.backgroundUid = U(bgWithAbil); bgAbilityApplied = {bg: bgWithAbil.name, strFinal: st.finalAbility("str"), note: "if 8, bg ability not applied"}; }

	const counts = {}; Object.keys(F).forEach(k => counts[k] = F[k].length);
	const sources = {}; bgs.forEach(bg => sources[bg.source] = (sources[bg.source] || 0) + 1);
	return {total: bgs.length, sources, fieldFreq, counts, F, bgAbilityApplied};
});

console.log("TOTAL BACKGROUNDS:", out.total);
console.log("SOURCES:", JSON.stringify(out.sources));
console.log("\nFIELD FREQ:", JSON.stringify(out.fieldFreq, null, 1));
console.log("\nFLAG COUNTS:", JSON.stringify(out.counts, null, 1));
console.log("\nbgAbilityApplied:", JSON.stringify(out.bgAbilityApplied));
for (const [k, arr] of Object.entries(out.F)) { console.log(`\n## ${k} (${arr.length})`); console.log(arr.slice(0, 40).join("\n")); }
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
