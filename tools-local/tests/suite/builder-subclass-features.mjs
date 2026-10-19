// Subclass features above the subclass's first level reach the builder: 5etools wraps each one in an
// unnamed {type: "entries", level, entries: [feature]}, which the builder unwraps at load
// (CharBuilderPage._pLoadClasses). Checks the data, the Class step display (including the class's
// "Path Feature" lines naming what they grant), the review/play feature list and turn options.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "style", "classic"); VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", false); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(async () => {
	const ui = dbg_charBuilderPage._ui; const st = ui._state; const d = dbg_cb;
	const R = {};
	const scs = d.classData.subclasses;
	R.nSubclasses = scs.length;
	R.unnamedLeft = scs.filter(sc => (sc.subclassFeatures || []).some(g => (g || []).some(f => !f?.name))).map(sc => `${sc.name}|${sc.source}`).slice(0, 5);
	R.multiLevel = scs.filter(sc => new Set((sc.subclassFeatures || []).flat().map(f => f.level)).size >= 3).length;

	const sc = scs.find(x => x.name === "Path of the Battlerager" && x.className === "Barbarian" && x.classSource === "PHB");
	R.battleragerLevels = (sc.subclassFeatures || []).flat().map(f => `${f.name}@${f.level}`);

	st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 15, int: 8, wis: 12, cha: 10};
	st.raceUid = "Dwarf (Mountain)|PHB";
	st.classes = [{uid: "Barbarian|PHB", level: 20, subclassUid: `${sc.name}|${sc.source}`}];
	ui._playMode = false; ui._ixStep = ui._steps().findIndex(s => s.id === "class"); ui.render();
	const det = [...ui._eleRoot.querySelectorAll("details")].find(x => /Features & details/.test(x.querySelector("summary")?.textContent || ""));
	det.open = true; await new Promise(resolve => setTimeout(resolve, 100)); // the panel renders on its toggle event
	const txt = ui._eleRoot.textContent.replace(/\s+/g, " ");
	R.classStepHas = ["Reckless Abandon", "Battlerager Charge", "Spiked Retribution"].filter(n => txt.includes(n));
	R.pathFeatureSummaries = [...ui._eleRoot.querySelectorAll("summary")].map(s => s.textContent.replace(/\s+/g, " ").trim()).filter(t => /Path [Ff]eature|Primal Path/.test(t));

	R.featureSectionNames = st.featureSections().flatMap(s => s.items.map(f => f.name));
	const turn = st.turnOptions();
	R.bonusActions = (turn.bonus || []).map(o => o.name || o.feature?.name || o.spell?.name || "").filter(Boolean);

	// a second, unrelated subclass. (Its 2nd-level Sculpt Spells is nested inside the "School of Evocation" feature.)
	st.classes = [{uid: "Wizard|PHB", level: 14, subclassUid: "School of Evocation|PHB"}];
	R.evocationFeatures = st.featureSections().flatMap(s => s.items.map(f => f.name)).filter(n => /School of Evocation|Potent Cantrip|Empowered Evocation|Overchannel/.test(n));
	st.reset();
	return R;
});

console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`no unnamed subclass-feature wrappers left (${r.unnamedLeft})`, r.unnamedLeft.length === 0);
chk(`most subclasses span 3+ feature levels (${r.multiLevel}/${r.nSubclasses})`, r.multiLevel > r.nSubclasses * 0.8);
chk("Battlerager data has its 6/10/14 features", ["Reckless Abandon@6", "Battlerager Charge@10", "Spiked Retribution@14"].every(x => r.battleragerLevels.includes(x)));
chk(`Class step shows all three (${r.classStepHas})`, r.classStepHas.length === 3);
chk("L6 'Path Feature' names what it grants", r.pathFeatureSummaries.some(t => /L6: Path Feature → Reckless Abandon/.test(t)));
chk("L14 'Path feature' names what it grants", r.pathFeatureSummaries.some(t => /L14: Path feature → Spiked Retribution/.test(t)));
chk("review/play feature list includes them", ["Reckless Abandon", "Battlerager Charge", "Spiked Retribution"].every(n => r.featureSectionNames.includes(n)));
chk(`Evocation 14 has its 2/6/10/14 features (${r.evocationFeatures})`, ["School of Evocation", "Potent Cantrip", "Empowered Evocation", "Overchannel"].every(n => r.evocationFeatures.includes(n)));

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
