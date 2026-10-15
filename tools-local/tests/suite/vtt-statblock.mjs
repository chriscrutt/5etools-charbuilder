import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = []; const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message));
await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await p.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});

const uid = await p.evaluate(async () => {
	const v = globalThis.dbg_vtt; const mons = await v._loadBestiary();
	const gob = mons.find(m => m.name === "Goblin");
	const t = v._addMonsterToken(gob, {rollHp: false, rollInit: false});
	return t.monUid;
});
await p.evaluate((uid) => globalThis.dbg_vtt._openStatblock(uid), uid);
await p.waitForFunction(`document.querySelector(".vtt-statblock .ve-stats")`, {timeout: 8000});

const res = await p.evaluate(() => {
	const sb = document.querySelector(".vtt-statblock");
	const txt = sb.textContent || "";
	const dice = sb.querySelectorAll("[data-packed-dice]");
	// capture rolls
	window.__rolls = []; globalThis.dbg_vtt._roll = (expr, label) => window.__rolls.push({expr, label});
	let firstRollExpr = null;
	if (dice.length) { const d = JSON.parse(dice[0].getAttribute("data-packed-dice")); firstRollExpr = d.toRoll; dice[0].click(); }
	return {
		title: sb.querySelector(".vtt-statblock__title")?.textContent,
		hasStats: !!sb.querySelector(".ve-stats"),
		mentionsScimitar: /Scimitar/i.test(txt),
		mentionsNimble: /Nimble Escape/i.test(txt),
		nDice: dice.length,
		firstRollExpr,
		rolled: window.__rolls,
	};
});
// draggable check: head has cursor move
const draggable = await p.evaluate(() => getComputedStyle(document.querySelector(".vtt-statblock__head")).cursor);

console.log(JSON.stringify({res, draggable}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("title = Goblin", res.title === "Goblin");
chk("renders ve-stats table", res.hasStats);
chk("has Scimitar attack", res.mentionsScimitar);
chk("has Nimble Escape trait", res.mentionsNimble);
chk("has clickable dice", res.nDice > 0);
chk("clicking a die fires _roll", res.rolled.length === 1 && !!res.rolled[0].expr);
chk("rolled expr matches the die", res.rolled.length && res.rolled[0].expr === res.firstRollExpr.replace(/\s+/g, ""));
chk("head is draggable (cursor move)", draggable === "move");
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
