import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = []; const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message));
await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await p.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});

// 1) math via statics
const math = await p.evaluate(() => {
	const V = globalThis.dbg_vtt.constructor;
	const th = V._partyThresholds([3, 3, 3, 3]);
	return {
		th, mult4: V._encMultiplier(4, 4), mult1: V._encMultiplier(1, 4), mult8: V._encMultiplier(8, 4),
		smallParty: V._encMultiplier(4, 2), bigParty: V._encMultiplier(4, 6),
		soloVsBigParty: V._encMultiplier(1, 6), soloVsSmallParty: V._encMultiplier(1, 2), hordeVsSmallParty: V._encMultiplier(15, 2), hordeVsBigParty: V._encMultiplier(15, 6),
		th7: V._partyThresholds([7]), th10: V._partyThresholds([10]),
		diffGoblins: V._encDifficulty(400, th), diffBoss: V._encDifficulty(1800, th), diffTrivial: V._encDifficulty(100, th),
	};
});

// 2) open the modal, ensure it renders
await p.evaluate(() => globalThis.dbg_vtt._openEncounterBuilder());
await p.waitForFunction(`document.querySelector(".vtt-modal--enc")`, {timeout: 8000});
const modalOk = await p.evaluate(() => !!document.querySelector(".vtt-enc-totals") && !!document.querySelector(".vtt-enc-foot"));
await p.evaluate(() => document.querySelector(".vtt-modal-backdrop")?.remove());

// 3) add an encounter to the board (4 goblins) and verify tokens + monUid + difficulty label
const board = await p.evaluate(async () => {
	const v = globalThis.dbg_vtt; const V = v.constructor;
	const mons = await v._loadBestiary();
	const gob = mons.find(m => m.name === "Goblin" && /MM/i.test(m.source)) || mons.find(m => m.name === "Goblin");
	const uid = `${gob.name}|${gob.source}`;
	const enc = {party: [3, 3, 3, 3], list: [{uid, name: gob.name, source: gob.source, crStr: v._crStr(gob.cr), xp: Parser.crToXpNumber(gob.cr), qty: 4}]};
	const before = v._scene.tokens.length;
	v._addEncounterToBoard(enc, false);
	const toks = v._scene.tokens.slice(before);
	// recompute the displayed difficulty for this enc
	const th = V._partyThresholds(enc.party);
	const base = enc.list.reduce((s, it) => s + it.xp * it.qty, 0);
	const adj = base * V._encMultiplier(4, 4);
	return {added: toks.length, allHaveUid: toks.every(t => t.monUid === uid), gobXp: Parser.crToXpNumber(gob.cr), base, adj, diff: V._encDifficulty(adj, th), positionsUnique: new Set(toks.map(t => `${t.x},${t.y}`)).size};
});

console.log(JSON.stringify({math, modalOk, board}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("L3×4 thresholds (easy300/med600/hard900/deadly1600)", math.th.easy === 300 && math.th.medium === 600 && math.th.hard === 900 && math.th.deadly === 1600);
chk("4 monsters → ×2", math.mult4 === 2);
chk("1 monster → ×1", math.mult1 === 1);
chk("8 monsters → ×2.5", math.mult8 === 2.5);
chk("small party (2) bumps mult up (×2.5)", math.smallParty === 2.5);
chk("big party (6) bumps mult down (×1.5)", math.bigParty === 1.5);
chk("DMG: 1 monster vs 6+ PCs → ×0.5", math.soloVsBigParty === 0.5);
chk("DMG: 1 monster vs <3 PCs → ×1.5", math.soloVsSmallParty === 1.5);
chk("DMG: 15+ monsters vs <3 PCs → ×5", math.hordeVsSmallParty === 5);
chk("DMG: 15+ monsters vs 6+ PCs → ×3", math.hordeVsBigParty === 3);
chk("DMG: L7 medium threshold 750", math.th7.medium === 750);
chk("DMG: L10 deadly threshold 2800", math.th10.deadly === 2800);
chk("400 adj XP = easy", math.diffGoblins === "easy");
chk("1800 adj XP = deadly", math.diffBoss === "deadly");
chk("100 adj XP = trivial", math.diffTrivial === "trivial");
chk("modal renders", modalOk);
chk("4 goblin tokens added", board.added === 4);
chk("tokens tagged with monUid", board.allHaveUid);
chk("goblin = 50 XP", board.gobXp === 50);
chk("base 200, adj 400, easy", board.base === 200 && board.adj === 400 && board.diff === "easy");
chk("tokens spread (not all stacked)", board.positionsUnique > 1);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
