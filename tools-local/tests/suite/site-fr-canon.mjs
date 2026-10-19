// The "Forgotten Realms Canon Only" toggle (Settings menu / Preferences): official WotC 2014 books
// that are setting-neutral or Forgotten Realms only. See tools-local/docs/EDITION-2014.md.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
const F = []; const chk = (k, c) => { if (!c) F.push(k); };

const CANON = ["PHB", "DMG", "MM", "XGE", "TCE", "MPMM", "SCAG", "ToA", "SKT", "FTD", "WDH", "BGDIA", "PaBTSO"];
const NOT_CANON = ["ERLW", "GGR", "MOT", "EGW", "SCC", "AAG", "DSotDQ", "VRGR", "CoS", "WBtW", "AI", "RMR", "JttRC", "ScreenSpelljammer", "XPHB"];

async function pCheck ({isFrOnly, style}) {
	const page = await b.newPage(); await page.setCacheEnabled(false);
	page.on("pageerror", e => errs.push(`[fr=${isFrOnly} ${style}] ${e.message}`));
	await page.goto(BASE + "/races.html", {waitUntil: "domcontentloaded"});
	await page.evaluate((v, s) => { VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", v); VetoolsConfig.set("styleSwitcher", "style", s); }, isFrOnly, style);
	await page.goto(BASE + "/races.html", {waitUntil: "domcontentloaded"});
	await page.waitForFunction("document.querySelectorAll('#list > *').length > 5", {timeout: 60000});
	await new Promise(resolve => setTimeout(resolve, 1500));
	const res = await page.evaluate((canon, notCanon) => ({
		hiddenCanon: canon.filter(s => ExcludeUtil.isExcluded("x", "race", s)),
		shownNotCanon: notCanon.filter(s => !ExcludeUtil.isExcluded("x", "race", s)),
		rows: [...document.querySelectorAll("#list > *")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
		navLabel: [...document.querySelectorAll("li span")].map(e => e.textContent).find(t => /Forgotten Realms Canon Only/.test(t)) || null,
	}), CANON, NOT_CANON);
	await page.close();
	return res;
}

const on = await pCheck({isFrOnly: true, style: "classic"});
const onModern = await pCheck({isFrOnly: true, style: "one"});
const off = await pCheck({isFrOnly: false, style: "classic"});

// the Character Builder's data honours the toggle too (incl. subclasses)
const page = await b.newPage(); await page.setCacheEnabled(false);
page.on("pageerror", e => errs.push(`[builder] ${e.message}`));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", true); VetoolsConfig.set("styleSwitcher", "style", "classic"); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});
const builder = await page.evaluate(() => {
	const d = globalThis.dbg_cb; const bad = (arr) => arr.filter(x => !SourceUtil.isFrCanonSource(x.source)).map(x => `${x.name}|${x.source}`);
	return {races: bad(d.races).slice(0, 5), subclasses: bad(d.classData.subclasses).slice(0, 5), spells: bad(d.spells).slice(0, 5), nRaces: d.races.length};
});

console.log(JSON.stringify({on: {...on, rows: on.rows.length}, onModern: {...onModern, rows: onModern.rows.length}, off: {...off, rows: off.rows.length}, builder}, null, 2));

chk(`on: canon books visible (wrongly hidden: ${on.hiddenCanon})`, on.hiddenCanon.length === 0);
chk(`on: other settings / UA-style / 2024 hidden (leaked: ${on.shownNotCanon})`, on.shownNotCanon.length === 0);
chk("on: races list has no Warforged (Eberron)", !on.rows.some(r => /Warforged/.test(r)));
chk("on: races list still has Dwarf", on.rows.some(r => /Dwarf/.test(r)));
chk("on: navbar shows the toggle checked", on.navLabel?.startsWith("✓"));
chk(`on + Modern style: still 2014 + FR only (leaked: ${onModern.shownNotCanon})`, onModern.shownNotCanon.length === 0 && onModern.hiddenCanon.length === 0);
chk("off: Eberron visible again", !off.shownNotCanon.length ? false : off.shownNotCanon.includes("ERLW"));
chk("off: navbar toggle unchecked", off.navLabel && !off.navLabel.startsWith("✓"));
chk("off: fewer rows hidden than on", off.rows.length > on.rows.length);
chk(`builder: races all canon (bad: ${builder.races})`, builder.races.length === 0 && builder.nRaces > 10);
chk(`builder: subclasses all canon (bad: ${builder.subclasses})`, builder.subclasses.length === 0);
chk(`builder: spells all canon (bad: ${builder.spells})`, builder.spells.length === 0);

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
