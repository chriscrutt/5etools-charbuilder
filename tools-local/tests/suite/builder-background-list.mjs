// The background step's grouped list: "Variant Criminal (Spy)", "Baldur's Gate Criminal" and
// "Myriad Operative (Criminal)" collapse under Criminal (grouping is by naming convention).
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "style", "classic"); VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", false); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(() => {
	const ui = dbg_charBuilderPage._ui; const st = ui._state;
	st.reset(); ui._chooserOpen = {};
	ui._ixStep = ui._steps().findIndex(s => s.id === "background"); ui.render();
	const rows = () => [...document.querySelector(".cb__pick-list").children];
	const R = {nEntities: st.filterVisible(dbg_cb.backgrounds).length, nCollapsed: rows().length};
	const hdr = rows().find(e => e.classList.contains("cb__pick-group") && e.firstElementChild.textContent.trim() === "▸ Criminal");
	hdr.click();
	R.criminal = rows().filter(e => e.classList.contains("cb__pick--d1")).map(e => e.firstElementChild.textContent.trim());
	rows().find(e => e.classList.contains("cb__pick--d1") && e.firstElementChild.textContent.trim() === "Variant: Spy").click();
	R.sel = st.backgroundUid;
	st.reset();
	return R;
});
console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`collapsed list is shorter (${r.nCollapsed} rows for ${r.nEntities})`, r.nCollapsed < r.nEntities);
chk(`Criminal group holds its variants (${r.criminal})`, ["Criminal", "Baldur's Gate", "Variant: Spy"].every(x => r.criminal.includes(x)) && r.criminal[0] === "Criminal");
chk("clicking a variant selects it", r.sel === "Variant Criminal (Spy)|PHB");
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
