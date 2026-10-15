// Test runner for the fork's browser tests.  Usage (from the repo root):
//
//   npm run local:test                      the pass/fail suite (run after every upstream sync)
//   npm run local:test -- --all             suite + probes + audits (probes/audits: crash/page-error check only)
//   npm run local:test -- vtt- play-        only tests whose name contains "vtt-" or "play-"
//   npm run local:test -- --jobs 3          run 3 at a time (default 2)
//   npm run local:test -- --list            list tests without running them
//   npm run local:test -- --verbose         stream each test's output (forces --jobs 1)
//
// It installs this folder's dependencies on first use, starts the site server (and the VTT relay,
// for the multiplayer tests) if they aren't already running, and stops whatever it started.
// Logs: tools-local/tests/.out/logs/<group>-<name>.log
//
// Pass rules — suite: exits 0, prints "FAILURES: none" (or 0), and no page errors.
//              probes/audits: exit 0 and no page errors (their output is for reading, not asserting).

import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const GROUPS = ["suite", "probes", "audits"];
const RELAY_URL = "http://localhost:5055";
const TIMEOUT_MS = 20 * 60_000;

// region args
const argv = process.argv.slice(2);
const opt = {all: false, groups: new Set(), jobs: 2, list: false, verbose: false, filters: []};
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--all") opt.all = true;
	else if (a === "--suite" || a === "--probes" || a === "--audits") opt.groups.add(a.slice(2));
	else if (a === "--jobs" || a === "-j") opt.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
	else if (a === "--list") opt.list = true;
	else if (a === "--verbose" || a === "-v") opt.verbose = true;
	else if (a === "--help" || a === "-h") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n\nimport")[0]); process.exit(0); }
	else if (a.startsWith("-")) { console.error(`Unknown option ${a} (see --help)`); process.exit(2); }
	else opt.filters.push(a);
}
if (opt.verbose) opt.jobs = 1;
const groups = opt.all ? GROUPS : opt.groups.size ? GROUPS.filter(g => opt.groups.has(g)) : (opt.filters.length ? GROUPS : ["suite"]);
// endregion

// region discover
const tests = groups.flatMap(group => {
	const dir = path.join(TESTS_DIR, group);
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter(f => f.endsWith(".mjs")).sort().map(f => {
		const file = path.join(dir, f);
		const src = fs.readFileSync(file, "utf8");
		return {group, name: f.slice(0, -4), id: `${group}/${f.slice(0, -4)}`, file, needsRelay: /VttNet\.host|localhost:5055/.test(src)};
	});
}).filter(t => !opt.filters.length || opt.filters.some(f => t.id.includes(f)));

if (opt.list) {
	for (const t of tests) console.log(`${t.id}${t.needsRelay ? "  (needs VTT relay)" : ""}`);
	process.exit(0);
}
if (!tests.length) { console.error("No tests matched."); process.exit(2); }
// endregion

// region dependencies
if (!fs.existsSync(path.join(TESTS_DIR, "node_modules", "puppeteer-core", "package.json"))) {
	console.log("Installing test dependencies (one-time: npm install in tools-local/tests)...");
	const r = spawnSync("npm install --no-audit --no-fund", {cwd: TESTS_DIR, stdio: "inherit", shell: true});
	if (r.status !== 0) { console.error("npm install failed in tools-local/tests"); process.exit(1); }
}
const {BASE, ROOT, OUT_DIR, PROFILE_ROOT, PROFILE_PREFIX, findBrowser, killBrowsersByTag} = await import("./lib/harness.mjs");
let browserExe;
try { browserExe = findBrowser(); } catch (e) { console.error(e.message); process.exit(1); }
// endregion

// region servers
const started = [];
const stopStarted = () => { for (const p of started) { try { p.kill(); } catch { /* gone */ } } started.length = 0; };
process.on("exit", stopStarted);

const pIsUp = async (url) => {
	try { const r = await fetch(url, {signal: AbortSignal.timeout(3000)}); return r.ok; } catch { return false; }
};
const pWaitUp = async (url, ms = 30_000) => {
	const tEnd = Date.now() + ms;
	while (Date.now() < tEnd) { if (await pIsUp(url)) return true; await new Promise(resolve => setTimeout(resolve, 300)); }
	return false;
};

if (!(await pIsUp(`${BASE}/index.html`))) {
	const u = new URL(BASE);
	if (!["localhost", "127.0.0.1"].includes(u.hostname)) { console.error(`Site not reachable at ${BASE}`); process.exit(1); }
	const bin = path.join(ROOT, "node_modules", "http-server", "bin", "http-server");
	if (!fs.existsSync(bin)) { console.error("http-server is missing: run `npm install` in the repo root first."); process.exit(1); }
	console.log(`Starting the site server on port ${u.port || 80}...`);
	started.push(spawn(process.execPath, [bin, ROOT, "-p", u.port || "80", "-c-1", "--cors", "-s"], {stdio: "ignore"}));
	if (!(await pWaitUp(`${BASE}/index.html`))) { console.error("The site server did not come up."); process.exit(1); }
}
if (tests.some(t => t.needsRelay) && !(await pIsUp(RELAY_URL))) {
	console.log("Starting the VTT relay on port 5055 (for the multiplayer tests)...");
	started.push(spawn(process.execPath, [path.join(ROOT, "tools-local", "vtt-server.mjs")], {stdio: "ignore", env: {...process.env, VTT_PORT: "5055"}}));
	if (!(await pWaitUp(RELAY_URL, 15_000))) console.warn("Warning: the VTT relay did not come up; multiplayer tests will fail.");
}
// endregion

// region housekeeping: remove browser profiles left behind by crashed/killed runs (older than an hour)
try {
	for (const d of fs.readdirSync(PROFILE_ROOT)) {
		if (!d.startsWith(PROFILE_PREFIX)) continue;
		const p = path.join(PROFILE_ROOT, d);
		if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, {recursive: true, force: true});
	}
} catch { /* best effort */ }
// endregion

// region run
const LOG_DIR = path.join(OUT_DIR, "logs");
fs.mkdirSync(LOG_DIR, {recursive: true});

const judge = (t, code, out, timedOut) => {
	if (timedOut) return `timed out after ${TIMEOUT_MS / 60_000} min`;
	if (code !== 0) return `exited with code ${code}`;
	const pageErrs = out.match(/page errors:\s*(.*)/i);
	if (pageErrs && !/^none\b/i.test(pageErrs[1].trim())) return "page errors";
	const fails = out.match(/^\s*FAILURES:\s*(.*)$/m);
	if (t.group === "suite" && !fails) return "no FAILURES line printed";
	if (fails && !/^(none|0)\s*$/i.test(fails[1].trim())) return "assertion failures";
	return null;
};

const pRunOne = (t) => new Promise(resolve => {
	const t0 = Date.now();
	const child = spawn(process.execPath, [t.file], {cwd: ROOT, env: {...process.env, FORK_TEST_BASE: BASE}});
	let out = "";
	const onData = (d) => { out += d; if (opt.verbose) process.stdout.write(d); };
	child.stdout.on("data", onData);
	child.stderr.on("data", onData);
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
	child.on("close", (code) => {
		clearTimeout(timer);
		const logFile = path.join(LOG_DIR, `${t.group}-${t.name}.log`);
		fs.writeFileSync(logFile, out);
		resolve({t, secs: (Date.now() - t0) / 1000, reason: judge(t, code, out, timedOut), out, logFile, crashed: timedOut || code !== 0});
	});
});

console.log(`Running ${tests.length} test(s) against ${BASE} with ${path.basename(browserExe)}, ${opt.jobs} at a time\n`);
const results = [];
const queue = [...tests];
await Promise.all(Array.from({length: Math.min(opt.jobs, queue.length)}, async () => {
	while (queue.length) {
		const r = await pRunOne(queue.shift());
		results.push(r);
		console.log(`${r.reason ? "FAIL" : "ok  "}  ${r.t.id.padEnd(40)} ${r.secs.toFixed(1).padStart(6)}s${r.reason ? `  — ${r.reason}` : ""}`);
	}
}));
// Any browser still running belongs to a test that was killed or crashed.
if (results.some(r => r.crashed)) killBrowsersByTag(PROFILE_PREFIX);
stopStarted();
// endregion

// region report
const failed = results.filter(r => r.reason);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed  (logs: ${path.relative(ROOT, LOG_DIR)})`);
for (const r of failed) {
	console.log(`\n──── ${r.t.id}: ${r.reason}  (${path.relative(ROOT, r.logFile)})`);
	console.log(r.out.trimEnd().split("\n").slice(-25).join("\n"));
}
process.exit(failed.length ? 1 : 0);
// endregion
