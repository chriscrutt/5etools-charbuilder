import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
const mk = async () => { const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message)); await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"}); await p.waitForFunction("globalThis.dbg_vtt&&globalThis.VttNet", {timeout: 60000}); return p; };

// local handout test (no network): create + show
const dm = await mk();
const local = await dm.evaluate(() => {
	const v = globalThis.dbg_vtt;
	const h = {id: "h1", title: "The Sealed Letter", text: "Meet me at the docks at midnight.\n— A friend", img: ""};
	v._handoutsLoad().push(h); v._handoutsSave(); v._renderHandouts();
	v._showHandout(h);
	const panel = document.querySelector(".vtt-handout");
	return {listHasIt: !!document.querySelector(".vtt-handout-row__name"), shown: !!panel, title: panel?.querySelector(".vtt-statblock__title")?.textContent, text: panel?.querySelector(".vtt-handout__text")?.textContent};
});
await dm.evaluate(() => document.querySelector(".vtt-handout")?.remove());

// network: host, player joins, DM shows handout -> player sees it
const room = await dm.evaluate(() => new Promise(res => globalThis.VttNet.host(globalThis.dbg_vtt, i => res(i.room))));
const pl = await mk();
await pl.evaluate((room) => new Promise(res => globalThis.VttNet.join(globalThis.dbg_vtt, room, () => res())), room);
await pl.waitForFunction(`globalThis.VttNet.room==="${room}"`, {timeout: 8000});
// DM shows a handout
await dm.evaluate(() => { const h = {id: "h2", title: "Goblin Ambush", text: "You spot movement in the brush…", img: ""}; globalThis.dbg_vtt._showHandout(h); globalThis.VttNet.sendHandout(h); });
await pl.waitForFunction(`document.querySelector(".vtt-handout")`, {timeout: 8000}).catch(() => {});
const playerGot = await pl.evaluate(() => { const p = document.querySelector(".vtt-handout"); return {shown: !!p, title: p?.querySelector(".vtt-statblock__title")?.textContent, text: p?.querySelector(".vtt-handout__text")?.textContent}; });

console.log(JSON.stringify({local, room, playerGot}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("handout saved to list", local.listHasIt);
chk("local preview shows", local.shown && local.title === "The Sealed Letter");
chk("local text rendered w/ line breaks", /docks at midnight/.test(local.text || ""));
chk("hosted room", /^[A-Z0-9]{4}$/.test(room));
chk("player received handout popup", playerGot.shown);
chk("player sees correct title", playerGot.title === "Goblin Ambush");
chk("player sees correct text", /movement in the brush/.test(playerGot.text || ""));
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
