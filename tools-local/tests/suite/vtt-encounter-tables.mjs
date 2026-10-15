import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = []; const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message));
await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await p.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});

// 1) parsing helpers (deterministic)
const helpers = await p.evaluate(() => {
	const v = globalThis.dbg_vtt;
	return {
		r_0205: v._parseRollRange("02-05"), r_01: v._parseRollRange("01"), r_9600: v._parseRollRange("96-00"), r_endash: v._parseRollRange("1–2"),
		r_objExact: v._parseRollRange({type: "cell", roll: {exact: 3}}), r_objRange: v._parseRollRange({roll: {min: 2, max: 5}}),
		die100: v._rollTableDie("{@dice d100}", 0).label, die20: v._rollTableDie("d20", 0).label,
		d100InRange: (() => { for (let i = 0; i < 50; i++) { const x = v._rollTableDie("{@dice d100}", 0).roll; if (x < 1 || x > 100) return false; } return true; })(),
		creatures: v._extractCreatures(["3", "A youngster ({@creature commoner}) runs past, chased by a {@creature goblin|MM} and an {@creature ankylosaurus}."]),
	};
});

// 2) open modal + render a table
await p.evaluate(() => globalThis.dbg_vtt._openEncounterTables());
await p.waitForFunction(`document.querySelector(".vtt-tbl tr")`, {timeout: 15000});
const modal = await p.evaluate(() => {
	const srcSel = document.querySelectorAll(".vtt-modal--enc select")[0];
	const tblSel = document.querySelectorAll(".vtt-modal--enc select")[1];
	const rows = document.querySelectorAll(".vtt-tbl tr").length;
	// roll
	const rollBtn = [...document.querySelectorAll(".vtt-tbl-head button")].find(x => /Roll/.test(x.textContent));
	rollBtn?.click();
	const hits = document.querySelectorAll(".vtt-tbl-row--hit").length;
	const resultTxt = document.querySelector(".vtt-tbl-rolled")?.textContent || "";
	return {nSources: srcSel.options.length, nTables: tblSel.options.length, rows, hits, resultTxt, sourceSample: [...srcSel.options].slice(0, 3).map(o => o.textContent)};
});
await p.evaluate(() => document.querySelector(".vtt-modal-backdrop")?.remove());

// 3) add-to-builder flow (deterministic creatures)
const added = await p.evaluate(async () => {
	const v = globalThis.dbg_vtt; v._enc = {party: [3, 3, 3, 3], list: []};
	await v._addTableCreaturesToBuilder([{name: "Goblin", source: "MM"}, {name: "Worg", source: "MM"}, {name: "Nonexistent Beast", source: "ZZZ"}]);
	const list = v._encLoad().list;
	document.querySelector(".vtt-modal-backdrop")?.remove();
	return {names: list.map(x => x.name), goblinXp: list.find(x => x.name === "Goblin")?.xp};
});

console.log(JSON.stringify({helpers, modal, added}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("range '02-05' → [2,5]", JSON.stringify(helpers.r_0205) === "[2,5]");
chk("range '01' → [1,1]", JSON.stringify(helpers.r_01) === "[1,1]");
chk("range '96-00' → [96,100]", JSON.stringify(helpers.r_9600) === "[96,100]");
chk("en-dash '1–2' → [1,2]", JSON.stringify(helpers.r_endash) === "[1,2]");
chk("obj exact → [3,3]", JSON.stringify(helpers.r_objExact) === "[3,3]");
chk("obj min/max → [2,5]", JSON.stringify(helpers.r_objRange) === "[2,5]");
chk("die label d100", helpers.die100 === "d100");
chk("die label d20", helpers.die20 === "d20");
chk("d100 rolls within 1..100", helpers.d100InRange);
chk("extracts 3 creatures incl source", helpers.creatures.length === 3 && helpers.creatures.some(c => c.name === "goblin" && c.source === "MM") && helpers.creatures.some(c => c.name === "commoner"));
chk("modal has multiple sources", modal.nSources >= 3);
chk("table dropdown populated", modal.nTables >= 1);
chk("table renders rows", modal.rows > 1);
chk("rolling highlights exactly one row", modal.hits === 1);
chk("result shows a roll", /\d/.test(modal.resultTxt));
chk("add-to-builder resolved Goblin + Worg", added.names.includes("Goblin") && added.names.includes("Worg"));
chk("unknown creature skipped (not added)", !added.names.includes("Nonexistent Beast"));
chk("Goblin carried 50 XP", added.goblinXp === 50);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
