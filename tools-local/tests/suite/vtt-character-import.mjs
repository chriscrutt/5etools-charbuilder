import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
const poll = async (page, fn, arg, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await page.evaluate(fn, arg); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return null; };

// 1) Character Builder: build a character (set a name), do NOT save to roster; clear the roster to prove the current-build path
const cb = await b.newPage(); await cb.setCacheEnabled(false); cb.on("pageerror", e => errs.push("CB:" + e.message));
await cb.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await cb.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 90000});
await cb.evaluate(async () => { await StorageUtil.pSet("charbuilder_roster", []); const ui = globalThis.dbg_charBuilderPage._ui; ui._rosterId = null; ui._state.name = "Lidda Swiftblade"; ui.render(); });
const snapName = await poll(cb, async () => (await StorageUtil.pGet("charbuilder_current"))?.summary?.name);

// 2) VTT (same browser): Import Character should show the current build with NO explicit roster save
const vtt = await b.newPage(); await vtt.setCacheEnabled(false); vtt.on("pageerror", e => errs.push("VTT:" + e.message));
await vtt.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await vtt.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});
await vtt.evaluate(() => globalThis.dbg_vtt._openCharacterImport());
await vtt.waitForFunction(`document.querySelector(".vtt-modal--enc .vtt-enc-row, .vtt-modal--enc .vtt-mini")`, {timeout: 8000});
const modal1 = await vtt.evaluate(() => {
	const rows = [...document.querySelectorAll(".vtt-enc-row")];
	const names = rows.map(r => r.querySelector(".vtt-enc-row__name")?.textContent || "");
	const curMarked = rows.some(r => /current build/i.test(r.textContent));
	// click "Add to board"
	const addBtn = rows[0]?.querySelector("button");
	const before = globalThis.dbg_vtt._scene.tokens.length;
	addBtn?.click();
	const t = globalThis.dbg_vtt._scene.tokens[globalThis.dbg_vtt._scene.tokens.length - 1];
	return {nRows: rows.length, names, curMarked, added: globalThis.dbg_vtt._scene.tokens.length - before, tokName: t?.name, tokIsPc: t?.isPc};
});

// 3) De-dup: save current to roster, snapshot now has rosterId; import should show ONE entry, not a duplicate
await cb.evaluate(async () => { const ui = globalThis.dbg_charBuilderPage._ui; await ui._pSaveToRoster(); ui.render(); });
await poll(cb, async () => { const c = await StorageUtil.pGet("charbuilder_current"); return c?.rosterId ? 1 : 0; });
await vtt.evaluate(() => document.querySelector(".vtt-modal-backdrop")?.remove());
await vtt.evaluate(() => globalThis.dbg_vtt._openCharacterImport());
await vtt.waitForFunction(`document.querySelector(".vtt-modal--enc .vtt-enc-row")`, {timeout: 8000});
const modal2 = await vtt.evaluate(() => {
	const rows = [...document.querySelectorAll(".vtt-enc-row")];
	return {nRows: rows.length, liddaCount: rows.filter(r => /Lidda Swiftblade/.test(r.textContent)).length};
});

console.log(JSON.stringify({snapName, modal1, modal2}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("builder wrote a current-character snapshot", snapName === "Lidda Swiftblade");
chk("VTT import shows the current build with empty roster", modal1.nRows === 1 && modal1.names[0].includes("Lidda Swiftblade"));
chk("current build is labelled", modal1.curMarked);
chk("Add to board creates a PC token", modal1.added === 1 && modal1.tokName === "Lidda Swiftblade" && modal1.tokIsPc === true);
chk("no duplicate after saving current to roster", modal2.nRows === 1 && modal2.liddaCount === 1);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
