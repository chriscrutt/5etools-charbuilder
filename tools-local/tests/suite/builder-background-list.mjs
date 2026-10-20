// The background step's grouped list: "Variant Criminal (Spy)" and "Myriad Operative (Criminal)" collapse
// under Criminal (grouping is by naming convention). Baldur's Gate versions are hidden by default; the
// "Use Baldur's Gate versions" checkbox shows each one in place of its standard background and swaps the
// current pick to its counterpart, both ways.
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
	const goBg = () => { ui._playMode = false; ui._ixStep = ui._steps().findIndex(s => s.id === "background"); ui.render(); };
	const rows = () => [...document.querySelector(".cb__pick-list").children];
	const label = (e) => e.firstElementChild.textContent.trim();
	const src = (e) => e.querySelector(".cb__pick-src")?.textContent;
	const openGroup = (name) => rows().find(e => e.classList.contains("cb__pick-group") && label(e) === `▸ ${name}`)?.click();
	const groupRows = () => rows().filter(e => e.classList.contains("cb__pick--d1")).map(e => `${label(e)}|${src(e)}`);
	const toggle = () => { const cb = [...document.querySelectorAll("label")].find(l => /Use Baldur's Gate versions/.test(l.textContent))?.querySelector("input"); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", {bubbles: true})); };
	const R = {};

	st.reset(); st.useBaldursGateBackgrounds = false; ui._chooserOpen = {}; goBg();
	R.nEntities = st.filterVisible(dbg_cb.backgrounds).length;
	R.nCollapsedOff = rows().length;
	R.anyBgShownOff = rows().some(e => /Baldur's Gate/.test(e.textContent));
	openGroup("Criminal");
	R.criminalOff = groupRows();

	st.backgroundUid = "Criminal|PHB";
	toggle(); // on
	R.flag = st.useBaldursGateBackgrounds;
	R.selAfterOn = st.backgroundUid;
	ui._chooserOpen = {}; goBg(); openGroup("Criminal");
	R.criminalOn = groupRows();
	R.charlatanOn = rows().filter(e => !e.classList.contains("cb__pick-group") && !/d1|d2/.test(e.className)).map(e => `${label(e)}|${src(e)}`).filter(x => /Charlatan/.test(x));
	R.plainCharlatanOn = rows().some(e => label(e) === "Charlatan");

	st.reset(); R.flagSurvivesReset = st.useBaldursGateBackgrounds;
	st.backgroundUid = "Baldur's Gate Noble|BGDIA"; goBg();
	toggle(); // off
	R.selAfterOff = st.backgroundUid;
	st.reset(); st.useBaldursGateBackgrounds = false;
	return R;
});
console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`collapsed list is shorter (${r.nCollapsedOff} rows for ${r.nEntities})`, r.nCollapsedOff < r.nEntities);
chk("Baldur's Gate versions hidden by default", !r.anyBgShownOff);
chk(`default Criminal group: Criminal + its variants, no Baldur's Gate (${r.criminalOff})`, r.criminalOff[0] === "Criminal|PHB" && r.criminalOff.includes("Variant: Spy|PHB") && !r.criminalOff.some(x => /Baldur/.test(x)));
chk("turning it on sets the preference", r.flag === true);
chk(`turning it on swaps Criminal → Baldur's Gate Criminal (${r.selAfterOn})`, r.selAfterOn === "Baldur's Gate Criminal|BGDIA");
chk(`with it on, Baldur's Gate replaces the standard Criminal (${r.criminalOn})`, r.criminalOn[0] === "Baldur's Gate|BGDIA" && !r.criminalOn.includes("Criminal|PHB") && r.criminalOn.includes("Variant: Spy|PHB"));
chk(`a background with no variants becomes a single Baldur's Gate row (${r.charlatanOn})`, r.charlatanOn.includes("Baldur's Gate Charlatan|BGDIA") && !r.plainCharlatanOn);
chk("the preference survives a character reset", r.flagSurvivesReset === true);
chk(`turning it off swaps back to the PHB background (${r.selAfterOff})`, r.selAfterOff === "Noble|PHB");
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
