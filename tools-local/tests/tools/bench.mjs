// Page-load benchmark for the heavy list pages (see tools-local/LOCAL-HOSTING.md for results and
// why the remaining time is in-browser DOM construction, not serving).
//
// Usage: node tools-local/tests/tools/bench.mjs [baseUrl] [mode] [runs] [label]
//   mode "cold" -> fresh isolated browser context per run (no HTTP cache, no SW)
//   mode "warm" -> one context reused; first load warms, rest measured (HTTP cache + service worker)

import {BASE, launchBrowser} from "../lib/harness.mjs";

const baseUrl = (process.argv[2] || BASE).replace(/\/+$/, "");
const mode = process.argv[3] || "cold";
const runs = parseInt(process.argv[4] || "3", 10);
const label = process.argv[5] || mode;

// rowsSel: CSS selector(s) whose summed child count = rendered rows. min: rows needed to call it "ready".
const ROWS_FN = (sel) => `[...document.querySelectorAll('${sel}')].reduce((n,el)=>n+el.childElementCount,0)`;
const PAGES = [
	{name: "index", url: "/index.html", ready: "return !!document.querySelector('#navbar a, nav a')", rowsSel: null},
	{name: "bestiary", url: "/bestiary.html", rowsSel: "#list", min: 20},
	{name: "spells", url: "/spells.html", rowsSel: "#list", min: 20},
	{name: "items", url: "/items.html", rowsSel: "#list-mundane,#list-magic", min: 20},
].map((p) => ({
	...p,
	ready: p.ready || `return ${ROWS_FN(p.rowsSel)} >= ${p.min}`,
}));

const median = (xs) => { const s = [...xs].filter((v) => v != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (n) => (n == null || Number.isNaN(n) ? "  -  " : n.toFixed(0).padStart(5));
const fmtMB = (n) => (n / 1e6).toFixed(2).padStart(7);

async function measureOnce (page, p) {
	await page.evaluateOnNewDocument(() => { window.__t0 = performance.now(); });
	const t0 = Date.now();
	await page.goto(baseUrl + p.url, {waitUntil: "domcontentloaded", timeout: 90000});
	let ready = null;
	try { await page.waitForFunction(`(()=>{${p.ready}})()`, {timeout: 90000, polling: 50}); ready = Date.now() - t0; } catch {}
	try { await page.waitForNetworkIdle({idleTime: 500, timeout: 90000}); } catch {}
	const idle = Date.now() - t0;
	const data = await page.evaluate((rowsSel) => {
		const nav = performance.getEntriesByType("navigation")[0] || {};
		const res = performance.getEntriesByType("resource");
		let wire = 0; let raw = 0;
		for (const r of res) { wire += r.transferSize || 0; raw += r.decodedBodySize || 0; }
		const rows = rowsSel ? [...document.querySelectorAll(rowsSel)].reduce((n, el) => n + el.childElementCount, 0) : 0;
		return {dcl: nav.domContentLoadedEventEnd ?? null, load: nav.loadEventEnd ?? null, reqs: res.length, wire, raw, rows};
	}, p.rowsSel);
	return {ready, idle, ...data};
}

const browser = await launchBrowser();

console.log(`\n=== ${label}  (${baseUrl}, mode=${mode}, runs=${runs}) ===`);
console.log("page              dcl   load  ready  idle  reqs   wireMB   rawMB  rows");
const totals = {ready: [], idle: [], wire: []};

for (const p of PAGES) {
	const samples = [];
	const ctx = mode === "warm" ? await browser.createBrowserContext() : null;
	const total = mode === "warm" ? runs + 1 : runs;
	for (let i = 0; i < total; i++) {
		const context = mode === "warm" ? ctx : await browser.createBrowserContext();
		const page = await context.newPage();
		const m = await measureOnce(page, p);
		if (!(mode === "warm" && i === 0)) samples.push(m);
		await page.close();
		if (mode === "cold") await context.close();
	}
	if (ctx) await ctx.close();
	const med = (k) => median(samples.map((s) => s[k]));
	const r = {dcl: med("dcl"), load: med("load"), ready: med("ready"), idle: med("idle"), reqs: med("reqs"), wire: med("wire"), raw: med("raw"), rows: med("rows")};
	totals.ready.push(r.ready || 0); totals.idle.push(r.idle || 0); totals.wire.push(r.wire || 0);
	console.log(`${p.name.padEnd(16)}${fmt(r.dcl)} ${fmt(r.load)} ${fmt(r.ready)} ${fmt(r.idle)}  ${String(r.reqs).padStart(4)}  ${fmtMB(r.wire)} ${fmtMB(r.raw)}  ${String(r.rows).padStart(4)}`);
}
console.log("-".repeat(72));
console.log(`TOTAL  ready=${totals.ready.reduce((a, b) => a + b, 0).toFixed(0)}ms  idle=${totals.idle.reduce((a, b) => a + b, 0).toFixed(0)}ms  wire=${fmtMB(totals.wire.reduce((a, b) => a + b, 0))}MB`);

await browser.close();
process.exit(0);
