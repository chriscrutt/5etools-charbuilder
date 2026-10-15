import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];

// --- Character Builder: save two characters to the roster ---
const cb = await b.newPage(); await cb.setCacheEnabled(false); cb.on("pageerror", e => errs.push("CB: " + e.message));
await cb.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await cb.waitForFunction("globalThis.dbg_charBuilderPage && dbg_charBuilderPage._ui && dbg_charBuilderPage._ui._state", {timeout: 90000});
const saved = await cb.evaluate(async () => {
	const ui = globalThis.dbg_charBuilderPage._ui;
	ui._state.name = "Tordek Stoutblade"; await ui._pSaveToRoster();
	const firstId = ui._rosterId;
	ui._rosterId = null; ui._state.name = "Mialee Quickfoot"; await ui._pSaveToRoster();
	const roster = await StorageUtil.pGet("charbuilder_roster");
	return {count: roster.length, names: roster.map(e => e.summary?.name), firstId, secondId: ui._rosterId, sample: roster.find(e => e.summary?.name === "Mialee Quickfoot")?.summary};
});
// modal opens?
await cb.evaluate(() => globalThis.dbg_charBuilderPage._ui._pOpenRoster());
await cb.waitForFunction(`[...document.querySelectorAll('.ve-btn')].some(b=>/Save current|Update saved/.test(b.textContent))`, {timeout: 8000}).catch(() => {});
const modalRows = await cb.evaluate(() => document.body.textContent.match(/Tordek Stoutblade|Mialee Quickfoot/g)?.length || 0);

// --- VTT (same browser → shared IndexedDB): import a character ---
const vtt = await b.newPage(); await vtt.setCacheEnabled(false); vtt.on("pageerror", e => errs.push("VTT: " + e.message));
await vtt.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await vtt.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});
const imp = await vtt.evaluate(async () => {
	const v = globalThis.dbg_vtt;
	const roster = (await StorageUtil.pGet("charbuilder_roster")) || [];
	const entry = roster.find(e => e.summary?.name === "Tordek Stoutblade");
	const before = v._scene.tokens.length;
	v._addCharacterToken(entry);
	const t = v._scene.tokens[v._scene.tokens.length - 1];
	const elTok = v._tokEls.get(t.id);
	return {rosterSeen: roster.length, added: v._scene.tokens.length - before, name: t.name, isPc: t.isPc, charId: t.charId, ac: t.ac, maxHp: t.maxHp, hasPcRing: elTok?.classList.contains("vtt-token--pc"), hasAcBadge: !!elTok?.querySelector(".vtt-token__ac")};
});

// a complete character (with HP) → token must get an HP bar
const synth = await vtt.evaluate(() => {
	const v = globalThis.dbg_vtt;
	const entry = {id: "synthX", summary: {name: "Borin Fireforge", maxHp: 28, ac: 18, sizeAbv: "M", race: "Dwarf", classLabel: "Fighter 3"}};
	v._addCharacterToken(entry);
	const t = v._scene.tokens[v._scene.tokens.length - 1];
	const elTok = v._tokEls.get(t.id);
	return {maxHp: t.maxHp, hp: t.hp, ac: t.ac, hasHpBar: !!elTok?.querySelector(".vtt-token__hpbar")};
});

console.log(JSON.stringify({saved, modalRows, imp, synth}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("two characters saved", saved.count === 2);
chk("names stored in summary", saved.names.includes("Tordek Stoutblade") && saved.names.includes("Mialee Quickfoot"));
chk("each save got its own id", saved.firstId && saved.secondId && saved.firstId !== saved.secondId);
chk("summary computes a numeric AC", typeof saved.sample.ac === "number");
chk("My Characters modal lists both", modalRows >= 2);
chk("VTT reads the shared roster", imp.rosterSeen === 2);
chk("imported one token", imp.added === 1);
chk("token name carried over", imp.name === "Tordek Stoutblade");
chk("token flagged as PC", imp.isPc === true && !!imp.charId);
chk("token shows PC ring + AC badge", imp.hasPcRing && imp.hasAcBadge);
chk("complete char → token HP 28 + AC 18 + HP bar", synth.maxHp === 28 && synth.hp === 28 && synth.ac === 18 && synth.hasHpBar);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
