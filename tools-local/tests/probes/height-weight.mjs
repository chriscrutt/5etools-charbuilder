import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

// pick a race with heightAndWeight and render the race step
const setup = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const races = globalThis.dbg_cb.races;
	const r = races.find(x => x.name === "Tiefling (Variant; Winged)") || races.find(x => x.heightAndWeight && !x._isBaseRace);
	if (!r) return {found: false};
	st.reset(); st.raceUid = `${r.name}|${r.source}`;
	pg._ui._ixStep = 0; pg._ui.render();
	const btn = pg._ui._eleRoot.querySelector("button.race__btn-roll-height-weight");
	const disp = pg._ui._eleRoot.querySelector(".race__disp-result-height-weight");
	return {found: true, race: r.name, hasButton: !!btn, dispHiddenBefore: disp ? disp.classList.contains("ve-hidden") : null};
});
console.log("setup:", JSON.stringify(setup));

// click the roll button via real mouse, then read results
const result = await page.evaluate(async () => {
	const root = globalThis.dbg_charBuilderPage._ui._eleRoot;
	const btn = root.querySelector("button.race__btn-roll-height-weight");
	if (!btn) return {clicked: false};
	btn.click();
	await new Promise(r => setTimeout(r, 600));
	const disp = root.querySelector(".race__disp-result-height-weight");
	const h = root.querySelector(".race__disp-result-height");
	const w = root.querySelector(".race__disp-result-weight");
	return {clicked: true, dispHiddenAfter: disp ? disp.classList.contains("ve-hidden") : null, height: h ? h.textContent.trim() : null, weight: w ? w.textContent.trim() : null};
});
console.log("result:", JSON.stringify(result));
console.log("page errors:", errs.length ? errs : "none");

await page.close(); await b.close().catch(() => {});
process.exit(0);
