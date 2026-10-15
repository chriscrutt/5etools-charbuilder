// Fog of war hides what's under it: a player's opaque fog must cover tokens (they used to paint
// above the fog because of their inline z-index), and with fog off the token is visible (control).
// Checks real composited pixels: screenshot a point inside the token and decode it in the page.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const p = await b.newPage(); await p.setCacheEnabled(false);
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto(BASE + "/vtt.html", {waitUntil: "domcontentloaded"});
await p.waitForFunction("globalThis.dbg_vtt", {timeout: 60000});

const pt = await p.evaluate(() => {
	const v = globalThis.dbg_vtt;
	v._role = "player";
	const t = v._addToken({name: "Hero", hp: 20, maxHp: 20, x: 160, y: 160, color: "#ff00ff"});
	v._scene.fog = {on: true, base: "covered", cells: []};
	v._renderFog();
	const el = [...document.querySelectorAll(".vtt-token")].find(e => e.textContent.includes("H")) || document.querySelector(".vtt-token");
	el.scrollIntoView?.({block: "center", inline: "center"});
	const r = el.getBoundingClientRect();
	// a quarter of the way in: inside a round token, clear of the initials in the middle
	return {x: Math.round(r.left + r.width * 0.25), y: Math.round(r.top + r.height * 0.25), tokId: t.id};
});

const pixelAt = async ({x, y}) => {
	const b64 = await p.screenshot({clip: {x, y, width: 1, height: 1}, encoding: "base64"});
	return p.evaluate(async (data) => {
		const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
		const cv = document.createElement("canvas"); cv.width = 1; cv.height = 1;
		const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
		return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
	}, b64);
};
const near = (a, bb, tol = 12) => a.every((c, i) => Math.abs(c - bb[i]) <= tol);
const FOG = [6, 8, 12];

const underFog = await pixelAt(pt);
await p.evaluate(() => { const v = globalThis.dbg_vtt; v._scene.fog.on = false; v._renderFog(); });
const noFog = await pixelAt(pt);

console.log(JSON.stringify({pt, underFog, noFog}, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`control: with fog off the token is visible (got rgb ${noFog})`, !near(noFog, FOG, 30));
chk(`player fog covers the token (got rgb ${underFog}, fog is rgb ${FOG})`, near(underFog, FOG));
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
