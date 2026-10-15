import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = [];
page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage && globalThis.dbg_charBuilderPage._ui && globalThis.dbg_charBuilderPage._ui._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const races = globalThis.dbg_cb.races;
	const U = (r) => `${r.name}|${r.source}`;
	const F = {};
	const add = (k, v) => { (F[k] = F[k] || []).push(v); };

	races.forEach(r => {
		const u = U(r);
		const text = JSON.stringify(r.entries || "").toLowerCase();
		// --- defenses (NOT surfaced in Review today) ---
		if (r.resist) add("resist", `${u} = ${JSON.stringify(r.resist)}`);
		if (r.immune) add("immune", `${u} = ${JSON.stringify(r.immune)}`);
		if (r.vulnerable) add("vulnerable", `${u} = ${JSON.stringify(r.vulnerable)}`);
		if (r.conditionImmune) add("conditionImmune", `${u} = ${JSON.stringify(r.conditionImmune)}`);
		// resistance described only in text
		if (!r.resist && /resistance to [\w, ]+ damage/i.test(text)) { const m = text.match(/resistance to ([\w, ]+?) damage/i); add("resistTextOnly", `${u} = "${m ? m[1] : "?"}"`); }
		// --- granted feats (level-1, not handled by ASI system) ---
		if (r.feats) add("feats", `${u} = ${JSON.stringify(r.feats)}`);
		// --- proficiency edge cases ---
		if (r.savingThrowProficiencies) add("savingThrowProficiencies", `${u} = ${JSON.stringify(r.savingThrowProficiencies)}`);
		if (r.armorProficiencies) add("armorProficiencies", `${u} = ${JSON.stringify(r.armorProficiencies)}`);
		(r.weaponProficiencies || []).forEach(g => { if (g.choose) add("weaponChoose", `${u} = ${JSON.stringify(g.choose)}`); });
		(r.toolProficiencies || []).forEach(g => { if (g && typeof g === "object" && (g.choose || Object.keys(g).some(k => k.startsWith("any")))) add("toolChoose", `${u} = ${JSON.stringify(g)}`); });
		(r.skillProficiencies || []).forEach(g => { if (g && g.choose && g.choose.fromFilter) add("skillFromFilter", `${u} = ${JSON.stringify(g.choose)}`); });
		// expertise on race
		if (r.expertise) add("expertise", u);
		// --- ability formats ---
		const abil = r.ability || [];
		if (!abil.length || abil.every(o => !Object.keys(o).filter(k => k !== "choose" || Object.keys(o.choose || {}).length).length)) add("abilityEmpty", u);
		abil.forEach(opt => {
			if (opt.choose) {
				if (opt.choose.weighted) add("abilityWeighted", `${u} = ${JSON.stringify(opt.choose.weighted)}`);
				else add("abilityChoose", `${u} = from:${opt.choose.from ? opt.choose.from.length : "ALL"} count:${opt.choose.count || 1} amount:${opt.choose.amount || 1}`);
			}
		});
		if (abil.length > 1) add("abilityMultiOption", `${u} = ${abil.length} options`);
		// --- size / speed / senses ---
		if (Array.isArray(r.size) && r.size.length > 1) add("sizeChoose", `${u} = ${JSON.stringify(r.size)}`);
		if (r.size === "V" || r.size === "varies") add("sizeVaries", u);
		if (r.speed && typeof r.speed === "object") { const sp = Object.entries(r.speed).filter(([k, v]) => k !== "walk" && (v === true || typeof v === "object" || (k !== "walk" && typeof v === "number"))); if (sp.length) add("speedExtra", `${u} = ${JSON.stringify(r.speed)}`); }
		["blindsight", "tremorsense", "truesight"].forEach(s => { if (r[s]) add("sensesExtra", `${u} = ${s} ${r[s]}`); });
		if (r.creatureTypes) add("creatureTypes", `${u} = ${JSON.stringify(r.creatureTypes)}`);
		// --- additionalSpells structure ---
		if (r.additionalSpells) {
			if (r.additionalSpells.length > 1) add("addSpellsMultiGroup", `${u} = ${r.additionalSpells.length} groups`);
			r.additionalSpells.forEach(as => {
				if (as.resourceName) add("addSpellsResource", `${u} = ${as.resourceName}`);
				if (as.expanded) add("addSpellsExpanded", u);
				if (as.ability && typeof as.ability === "object" && as.ability.choose) add("addSpellsAbilityChoose", `${u} = ${JSON.stringify(as.ability.choose)}`);
				// known with object-by-level having "rest"/"daily"
				Object.values(as.known || {}).forEach(v => { if (!Array.isArray(v) && v && (v.rest || v.daily)) add("addSpellsKnownRest", u); });
			});
			// does racialSpellsInfo run cleanly?
			try { st.reset(); st.raceUid = u; const info = st.racialSpellsInfo(); if (!info) add("racialSpellsInfoNull", u); } catch (e) { add("racialSpellsInfoError", `${u}: ${e.message}`); }
		}
		// --- natural armor: does the text-parser catch AC-setting races? ---
		if (/\bac\b|armor class|natural armor/.test(text)) {
			const acLike = /your (?:base )?ac (?:is|of|equals)|armor class (?:of|is|equals)|\d{2} \+ your \w+ modifier|natural armor/i.test(text);
			if (acLike) { st.reset(); st.raceUid = u; const na = st.naturalArmor(); if (na) add("naturalArmorOk", `${u} = ${JSON.stringify(na)}`); else add("naturalArmorMISS", `${u}`); }
		}
		// --- text hints of mechanics that may need surfacing ---
		if (/you (?:are|count as|gain) (?:immun|immune)/i.test(text)) add("textImmunity", u);
		if (/swimming speed|you can breathe (?:air and )?water|amphibious/i.test(text)) add("textAmphibious", u);
		if (/you can't be (?:put to sleep|frightened|charmed|paralyzed)/i.test(text)) add("textConditionGuard", u);
	});

	const sources = {}; races.forEach(r => sources[r.source] = (sources[r.source] || 0) + 1);
	const counts = {}; Object.keys(F).forEach(k => counts[k] = F[k].length);
	return {total: races.length, sources, counts, F};
});

console.log("TOTAL RACES:", out.total);
console.log("SOURCES:", JSON.stringify(out.sources));
console.log("\n=== FLAG COUNTS ===");
console.log(JSON.stringify(out.counts, null, 1));
console.log("\n=== DETAILS ===");
for (const [k, arr] of Object.entries(out.F)) {
	console.log(`\n## ${k} (${arr.length})`);
	console.log(arr.slice(0, 60).join("\n"));
}
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
