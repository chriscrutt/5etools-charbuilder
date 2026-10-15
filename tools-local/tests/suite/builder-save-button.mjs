import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
const cb = await b.newPage(); await cb.setCacheEnabled(false); cb.on("pageerror", e => errs.push(e.message));
await cb.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await cb.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 90000});

const out = await cb.evaluate(async () => {
	const ui = globalThis.dbg_charBuilderPage._ui;
	await StorageUtil.pSet("charbuilder_roster", []); ui._rosterId = null;
	ui._state.name = "Krusk Battlerager"; ui._ixStep = ui._steps().length - 1; ui.render();
	// the last-step footer button should now read "Save Character" (not a dead "Done")
	const btn = [...document.querySelectorAll(".cb__footer button")].find(x => /Save Character/i.test(x.textContent));
	const label = btn?.textContent?.trim();
	btn?.click();
	// wait for the async roster write
	let roster = []; for (let i = 0; i < 40; i++) { roster = (await StorageUtil.pGet("charbuilder_roster")) || []; if (roster.length) break; await new Promise(r => setTimeout(r, 100)); }
	const after1 = roster.length; const id1 = ui._rosterId;
	// click again — should UPDATE, not duplicate
	const btn2 = [...document.querySelectorAll(".cb__footer button")].find(x => /Save Character/i.test(x.textContent));
	btn2?.click();
	for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 100)); }
	const after2 = ((await StorageUtil.pGet("charbuilder_roster")) || []).length;
	return {label, after1, after2, id1, name1: roster[0]?.summary?.name};
});

console.log(JSON.stringify(out, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("last-step button reads 'Save Character'", /Save Character/i.test(out.label || ""));
chk("clicking it saves to the roster", out.after1 === 1 && out.name1 === "Krusk Battlerager");
chk("rosterId set after save", !!out.id1);
chk("clicking again does NOT duplicate", out.after2 === 1);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
