// First stop when a page breaks after an upstream sync: loads a page (Classic style) and dumps
// uncaught page errors, console errors, failed requests, and whether the fork's apps booted.
//
// Usage: node tools-local/tests/tools/diag.mjs [page.html]      (default: charbuilder.html)
//
// Typical sync breakage looks like "PAGEERROR: X is not defined" or "x.empty is not a function"
// with a clean merge: upstream renamed a global/element method the fork's code calls. Adapt it in
// js/fork-compat.js (see tools-local/docs/UPKEEP.md), not at the call sites.
import {BASE, launchBrowser} from "../lib/harness.mjs";

const pageName = (process.argv[2] || "charbuilder.html").replace(/^\/+/, "");
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; const consoleErrs = []; const failed = [];
page.on("pageerror", e => errs.push(e.message));
page.on("console", m => { if (m.type() === "error") consoleErrs.push(m.text()); });
page.on("response", r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/${pageName}`, {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic")).catch(e => errs.push(`could not set Classic style: ${e.message}`));
await page.goto(`${BASE}/${pageName}`, {waitUntil: "domcontentloaded"});

const BOOT = {
	"charbuilder.html": "globalThis.dbg_charBuilderPage?._ui?._state",
	"vtt.html": "globalThis.dbg_vtt",
};
let booted = null;
if (BOOT[pageName]) {
	try { await page.waitForFunction(BOOT[pageName], {timeout: 30000}); booted = true; } catch { booted = false; }
} else {
	await new Promise(resolve => setTimeout(resolve, 5000));
}

const st = await page.evaluate(() => ({
	elementApi: {
		veT: typeof globalThis.veT, veEs: typeof globalThis.veEs, veE: typeof globalThis.veE,
		ee: typeof globalThis.ee, es: typeof globalThis.es, e_: typeof globalThis.e_,
		forkCompatPatched: !!globalThis.ElementUtil?.__veeFlatPatched,
	},
	style: (() => { try { return VetoolsConfig.get("styleSwitcher", "style"); } catch { return null; } })(),
}));

console.log(`PAGE: ${BASE}/${pageName}`);
if (booted !== null) console.log(`APP BOOTED: ${booted}`);
console.log("STATE:", JSON.stringify(st, null, 2));
console.log(`PAGE ERRORS (${errs.length}):`); errs.slice(0, 15).forEach(e => console.log(`  ${e}`));
console.log(`CONSOLE ERRORS (${consoleErrs.length}):`); [...new Set(consoleErrs)].slice(0, 15).forEach(e => console.log(`  ${e}`));
console.log(`4xx/5xx RESPONSES (${failed.length}):`); [...new Set(failed)].slice(0, 15).forEach(u => console.log(`  ${u}`));
console.log("(A 404 for sw-injector.js is normal in dev: it's a build-time file.)");
await b.close();
process.exit(0);
