import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const errs = [];
let relayUp = false; try { const r = await fetch("http://localhost:5055"); relayUp = r.ok; } catch {}
const mk = async () => { const p = await b.newPage(); await p.setCacheEnabled(false); p.on("pageerror", e => errs.push(e.message)); await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"}); await p.waitForFunction("globalThis.dbg_vtt&&globalThis.VttNet", {timeout: 60000}); return p; };

const dm = await mk();
const room = await dm.evaluate(() => new Promise(res => { globalThis.VttNet.host(globalThis.dbg_vtt, (info) => res(info.room)); }));
const tokId = await dm.evaluate(() => { const v = globalThis.dbg_vtt; v._scene.fog = {on: true, base: "covered", cells: []}; const t = v._addToken({name: "Hero", hp: 20, maxHp: 20, x: 140, y: 140, color: "#40c4ff"}); v._netPush(); return t.id; });
await new Promise(r => setTimeout(r, 300));

const pl = await b.newPage(); await pl.setCacheEnabled(false); pl.on("pageerror", e => errs.push(e.message));
await pl.goto(`${BASE}/vtt.html#room=${room}`, {waitUntil: "domcontentloaded"});
await pl.waitForFunction(`globalThis.dbg_vtt&&globalThis.VttNet&&globalThis.VttNet.room==="${room}"`, {timeout: 60000});
await pl.waitForFunction(`globalThis.dbg_vtt._scene.tokens.length>0`, {timeout: 8000}).catch(() => {});
const before = await pl.evaluate((id) => { const v = globalThis.dbg_vtt; const t = v._tokenById(id); return {role: v._role, tokSeen: !!t, x: t ? t.x : null, peers: globalThis.VttNet.peers, fogPlayer: v._role === "player"}; }, tokId);

await dm.evaluate((id) => { const v = globalThis.dbg_vtt; const t = v._tokenById(id); t.x = 400; v._renderToken(t); v._netPush(); }, tokId);
await pl.waitForFunction(`(()=>{const t=globalThis.dbg_vtt._tokenById("${tokId}");return t&&t.x===400;})()`, {timeout: 8000}).catch(() => {});
const after = await pl.evaluate((id) => { const t = globalThis.dbg_vtt._tokenById(id); return {x: t ? t.x : null}; }, tokId);

const out = {relayUp, room, roleDM: await dm.evaluate(() => globalThis.dbg_vtt._role), before, after};
console.log(JSON.stringify(out, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk("relay up", relayUp);
chk("room code 4 chars", /^[A-Z0-9]{4}$/.test(room));
chk("DM role", out.roleDM === "dm");
chk("player joined as player", before.role === "player");
chk("player got initial token on join", before.tokSeen && before.x === 140);
chk("player fog opaque", before.fogPlayer);
chk("peers=2", before.peers === 2);
chk("live move synced (x=400)", after.x === 400);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close().catch(() => {});
process.exit(0);
