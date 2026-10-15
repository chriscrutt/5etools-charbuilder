// The fork's 2014-only mode: a fresh visitor gets Classic style, and Classic style hides every
// non-classic (2024+) source site-wide; switching Style to Modern brings 2024 content back.
// See tools-local/docs/EDITION-2014.md. Replaces the old print-only edition.mjs/edition2.mjs.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
const F = []; const chk = (k, c) => { if (!c) F.push(k); };

async function pCheckStyle (style) {
	const page = await b.newPage(); await page.setCacheEnabled(false);
	page.on("pageerror", e => errs.push(`[${style ?? "default"}] ${e.message}`));
	await page.goto(BASE + "/classes.html", {waitUntil: "domcontentloaded"});
	if (style) {
		await page.evaluate(s => VetoolsConfig.set("styleSwitcher", "style", s), style);
		await page.goto(BASE + "/classes.html", {waitUntil: "domcontentloaded"});
	}
	await page.waitForFunction("document.querySelectorAll('#list .lst__row, #list li').length > 3", {timeout: 60000});
	await new Promise(resolve => setTimeout(resolve, 1500)); // let the list settle
	const res = await page.evaluate(() => {
		const sources = Object.keys(Parser.SOURCE_JSON_TO_FULL);
		const nonClassic = sources.filter(s => !SourceUtil.isClassicSource(s));
		return {
			cfg: VetoolsConfig.get("styleSwitcher", "style"),
			rows: [...document.querySelectorAll("#list .lst__row, #list li")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
			nNonClassic: nonClassic.length,
			nonClassicNotExcluded: nonClassic.filter(s => !ExcludeUtil.isExcluded("x", "class", s)),
			classicExcluded: ["PHB", "DMG", "MM", "XGE", "TCE", "MPMM"].filter(s => ExcludeUtil.isExcluded("x", "class", s)),
			phbLegacy: SourceUtil.isLegacySourceWotc("PHB"),
			vgmLegacy: SourceUtil.isLegacySourceWotc("VGM"),
		};
	});
	await page.close();
	return res;
}

const def = await pCheckStyle(null);
const classic = await pCheckStyle("classic");
const modern = await pCheckStyle("one");
console.log(JSON.stringify({
	default: {...def, rows: def.rows.length},
	classic: {...classic, rows: classic.rows},
	modern: {...modern, rows: modern.rows},
}, null, 2));

chk("fresh visitor defaults to Classic style", def.cfg === "classic");
chk("Classic: style saved as classic", classic.cfg === "classic");
chk("Classic: the class list has 12+ classes", classic.rows.length >= 12);
chk("Classic: no 2024 (PHB'24) classes listed", !classic.rows.some(r => /'24\b/.test(r)));
chk("Classic: there are non-classic sources to hide", classic.nNonClassic > 0);
chk(`Classic: every non-classic source is excluded (leaked: ${classic.nonClassicNotExcluded.join(", ")})`, classic.nonClassicNotExcluded.length === 0);
chk(`Classic: 2014-era books are NOT excluded (wrongly hidden: ${classic.classicExcluded.join(", ")})`, classic.classicExcluded.length === 0);
chk("Classic: PHB is not marked legacy", classic.phbLegacy === false);
chk("Classic: VGM is still legacy (superseded by MPMM)", classic.vgmLegacy === true);
chk("Modern: style saved as one", modern.cfg === "one");
chk("Modern: 2024 (PHB'24) classes are listed", modern.rows.some(r => /'24\b/.test(r)));
chk("Modern: non-classic sources are no longer excluded", modern.nonClassicNotExcluded.length === modern.nNonClassic);
chk("Modern: PHB is legacy again", modern.phbLegacy === true);

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
