// "Hide older printings" (st.hideLegacy): hides only things superseded by a later *2014-era* printing.
// Regression: subclass reprint uids are `shortName|className|classSource|source`; parsing field [1] read
// the class name, which counted as a 1970 "classic" source, so PHB/XGE subclasses reprinted in the
// hidden 2024 PHB (Berserker, Totem Warrior, Zealot, …) disappeared.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "style", "classic"); VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", false); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(() => {
	const st = dbg_charBuilderPage._ui._state; const d = dbg_cb;
	const cls = (n) => d.classData.classes.find(c => c.name === n && c.source === "PHB");
	const scNames = (n) => st.subclassesForClass(cls(n)).map(sc => `${sc.shortName}|${sc.source}`);
	const isClassic = (s) => SourceUtil.isClassicSource(s);
	st.hideLegacy = true;
	const R = {barbarian: scNames("Barbarian"), rogue: scNames("Rogue"), sorcerer: scNames("Sorcerer")};
	// every hidden subclass must have a reprint in a 2014-era source; every shown one must not
	const all = d.classData.subclasses.filter(sc => d.classData.classes.some(c => c.name === sc.className && c.source === sc.classSource));
	R.wronglyHidden = all.filter(sc => !st.isVisible(sc) && st._sourceAllowed(sc.source) && !(sc.reprintedAs || []).some(rep => { const s = st.constructor._reprintSource(rep); return s && s !== sc.source && isClassic(s); })).map(sc => `${sc.shortName}|${sc.source}`).slice(0, 10);
	R.wronglyShown = all.filter(sc => st.isVisible(sc) && (sc.reprintedAs || []).some(rep => { const s = st.constructor._reprintSource(rep); return s && s !== sc.source && isClassic(s); })).map(sc => `${sc.shortName}|${sc.source}`).slice(0, 10);
	R.aasimarVgmHidden = !st.isVisible(d.races.find(x => x.name === "Aasimar" && x.source === "VGM"));
	R.reprintSourceParse = [st.constructor._reprintSource("Berserker|Barbarian|XPHB|XPHB"), st.constructor._reprintSource("Aasimar|MPMM"), st.constructor._reprintSource({uid: "Rogue|XPHB"}), st.constructor._reprintSource("Nope|NotASource")];
	st.hideLegacy = false;
	return R;
});

console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`Barbarian keeps Berserker, Totem Warrior, Zealot (${r.barbarian})`, ["Berserker|PHB", "Totem Warrior|PHB", "Zealot|XGE"].every(x => r.barbarian.includes(x)));
chk(`no subclass hidden without a 2014-era reprint (${r.wronglyHidden})`, r.wronglyHidden.length === 0);
chk(`no subclass with a 2014-era reprint left visible (${r.wronglyShown})`, r.wronglyShown.length === 0);
chk("VGM Aasimar is still hidden (superseded by MPMM)", r.aasimarVgmHidden);
chk(`reprint uid parsing (${r.reprintSourceParse})`, JSON.stringify(r.reprintSourceParse) === JSON.stringify(["XPHB", "MPMM", "XPHB", null]));

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
