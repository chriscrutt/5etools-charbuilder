import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = []; const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message));
await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await p.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});

const out = await p.evaluate(async () => {
	const v = globalThis.dbg_vtt; const V = v.constructor;
	await v._loadBestiary();
	const party = [5, 5, 5, 5]; const players = party.length;
	const th = V._partyThresholds(party);
	const bands = {easy: [th.easy, th.medium], medium: [th.medium, th.hard], hard: [th.hard, th.deadly], deadly: [th.deadly, Math.round(th.deadly * 1.5)]};
	const adjOf = (list) => { const n = list.reduce((s, it) => s + it.qty, 0); const base = list.reduce((s, it) => s + it.xp * it.qty, 0); return base * V._encMultiplier(n, players); };
	const res = {};
	for (const diff of ["easy", "medium", "hard", "deadly"]) {
		const [lo, hi] = bands[diff]; let inBand = 0, nonEmpty = 0, closeEnough = 0; const N = 50;
		for (let i = 0; i < N; i++) {
			const enc = {party, list: []};
			v._generateEncounter(enc, diff, "any");
			if (enc.list.length) nonEmpty++;
			const adj = adjOf(enc.list);
			if (adj >= lo && adj < hi) inBand++;
			if (adj >= lo * 0.8 && adj <= hi * 1.2) closeEnough++;
		}
		res[diff] = {band: [lo, hi], inBandPct: Math.round(100 * inBand / N), closePct: Math.round(100 * closeEnough / N), nonEmpty};
	}
	// environment fidelity: forest
	let forestTotal = 0, forestOk = 0;
	const mons = v._bestiaryCache;
	for (let i = 0; i < 30; i++) {
		const enc = {party, list: []}; v._generateEncounter(enc, "medium", "forest");
		enc.list.forEach(it => { forestTotal++; const m = mons.find(x => `${x.name}|${x.source}` === it.uid); if ((m?.environment || []).includes("forest")) forestOk++; });
	}
	// variety: two generations differ
	const e1 = {party, list: []}; v._generateEncounter(e1, "hard", "any");
	const e2 = {party, list: []}; v._generateEncounter(e2, "hard", "any");
	const sig = (l) => l.map(x => `${x.uid}x${x.qty}`).sort().join(",");
	return {res, forestTotal, forestOk, varied: sig(e1.list) !== sig(e2.list), sample: e1.list.map(x => `${x.qty}× ${x.name} (CR ${x.crStr})`)};
});

console.log(JSON.stringify(out, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
["easy", "medium", "hard", "deadly"].forEach(d => {
	chk(`${d}: always non-empty`, out.res[d].nonEmpty === 50);
	chk(`${d}: ≥70% land in band`, out.res[d].inBandPct >= 70);
	chk(`${d}: ≥95% close to band`, out.res[d].closePct >= 95);
});
chk("environment filter: all forest picks are forest creatures", out.forestTotal > 0 && out.forestOk === out.forestTotal);
chk("generations vary", out.varied);
console.log("\nsample (hard):", out.sample);
console.log("FAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
