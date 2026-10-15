// Shared browser harness for the fork's tests, probes, audits and tools.
//
// Launches a headless Chromium-family browser (Chrome, Edge, Chromium or Brave) and connects
// puppeteer-core to it over the DevTools protocol. We spawn the browser ourselves with
// `--remote-debugging-port=0` and read the chosen port from `<profile>/DevToolsActivePort`,
// rather than using `puppeteer.launch()`, because:
//   - Edge on Windows hands off from its launcher process, which breaks `puppeteer.launch()`;
//   - a random port + a throwaway profile per script means scripts never collide when the
//     runner executes several at once.
//
// Environment:
//   CHROME_PATH            browser executable to use (default: first one found, see findBrowser)
//   FORK_TEST_BASE         site under test (default http://localhost:5050)
//   FORK_TEST_PROFILE_ROOT where throwaway browser profiles go (default: OS temp dir; on Linux,
//                          tools-local/tests/.out/profiles, because snap-packaged Chromium can't
//                          see the host's /tmp)

import puppeteer from "puppeteer-core";
import {execFileSync, spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const TESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(TESTS_DIR, "..", "..");
export const OUT_DIR = path.join(TESTS_DIR, ".out");
export const BASE = (process.env.FORK_TEST_BASE || "http://localhost:5050").replace(/\/+$/, "");
export const PROFILE_PREFIX = "5et-test-";
export const PROFILE_ROOT = process.env.FORK_TEST_PROFILE_ROOT
	|| (process.platform === "linux" ? path.join(OUT_DIR, "profiles") : os.tmpdir());

const _which = (cmd) => {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {encoding: "utf8"});
	return r.status === 0 ? (r.stdout.split(/\r?\n/)[0].trim() || null) : null;
};

export function findBrowser () {
	if (process.env.CHROME_PATH) {
		if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
		throw new Error(`CHROME_PATH is set but does not exist: ${process.env.CHROME_PATH}`);
	}
	const env = process.env;
	const candidates = {
		win32: [
			[env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"],
			[env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"],
			[env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"],
			[env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"],
			[env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"],
			[env["ProgramFiles"], "BraveSoftware/Brave-Browser/Application/brave.exe"],
		].filter(([base]) => base).map(([base, rel]) => path.join(base, rel)),
		darwin: [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		],
	}[process.platform] || [];
	for (const p of candidates) if (fs.existsSync(p)) return p;
	for (const cmd of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"]) {
		const p = _which(cmd);
		if (p) return p;
	}
	throw new Error("No Chrome/Edge/Chromium/Brave found. Install one, or set CHROME_PATH to its executable.");
}

const _live = new Set();

/**
 * Start a headless browser and connect to it. The browser (and its throwaway profile) is cleaned
 * up when the script exits, even on a crash; scripts should still `await browser.close()` when done.
 * @param {object} [opts]
 * @param {string[]} [opts.args] extra browser flags, e.g. ["--window-size=1400,1000"]
 * @param {number} [opts.protocolTimeout] CDP call timeout (ms); the regression suite needs minutes
 */
export async function launchBrowser ({args = [], protocolTimeout = 600_000} = {}) {
	const exe = findBrowser();
	fs.mkdirSync(PROFILE_ROOT, {recursive: true});
	const profile = fs.mkdtempSync(path.join(PROFILE_ROOT, PROFILE_PREFIX));
	const proc = spawn(exe, [
		"--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
		"--no-sandbox", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio",
		"--remote-debugging-port=0", `--user-data-dir=${profile}`,
		...args,
		"about:blank",
	], {detached: true, stdio: "ignore"});
	let spawnErr = null;
	proc.on("error", e => { spawnErr = e; });
	proc.unref();
	const rec = {profile, pid: proc.pid, closed: false};
	_live.add(rec);

	const portFile = path.join(profile, "DevToolsActivePort");
	let wsEndpoint = null;
	for (let i = 0; i < 200 && !wsEndpoint && !spawnErr; i++) {
		try {
			const [port, wsPath] = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
			if (port && wsPath) wsEndpoint = `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
		} catch { /* not written yet */ }
		if (!wsEndpoint) await new Promise(resolve => setTimeout(resolve, 150));
	}
	if (spawnErr) throw new Error(`Could not start browser ${exe}: ${spawnErr.message}`);
	if (!wsEndpoint) throw new Error(`Browser did not expose a DevTools port within 30s: ${exe}`);

	const browser = await puppeteer.connect({browserWSEndpoint: wsEndpoint, protocolTimeout});
	browser.on("disconnected", () => { rec.closed = true; });

	// Scripts end with `await browser.close(); process.exit(0)`. The browser keeps its profile files
	// locked for a moment after closing, so wait here until the profile can be deleted.
	const closeOrig = browser.close.bind(browser);
	browser.close = async () => {
		try { await closeOrig(); } catch { /* already closed */ }
		rec.closed = true;
		if (await _pRemoveDir(rec.profile)) _live.delete(rec);
	};
	return browser;
}

async function _pRemoveDir (dir, timeoutMs = 10_000) {
	const tEnd = Date.now() + timeoutMs;
	while (true) {
		try {
			fs.rmSync(dir, {recursive: true, force: true});
			return true;
		} catch {
			if (Date.now() > tEnd) return false;
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	}
}

/** Kill browser processes whose command line contains `tag` (a profile dir name or the prefix). */
export function killBrowsersByTag (tag) {
	if (process.platform === "win32") {
		// The spawned PID may only have been a launcher, so match the real processes by command line.
		const ps = `Get-CimInstance Win32_Process | Where-Object { @('chrome.exe','msedge.exe','brave.exe','chromium.exe') -contains $_.Name -and $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
		try { execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {stdio: "ignore"}); } catch { /* none left */ }
	} else {
		try { execFileSync("pkill", ["-9", "-f", tag], {stdio: "ignore"}); } catch { /* none left */ }
	}
}

function _killBrowser (rec) {
	if (process.platform === "win32") killBrowsersByTag(path.basename(rec.profile));
	else {
		try { process.kill(-rec.pid, "SIGKILL"); } catch { /* already gone */ }
	}
}

function _cleanupSync () {
	for (const rec of _live) {
		if (!rec.closed) _killBrowser(rec);
		try { fs.rmSync(rec.profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}); } catch { /* locked; the runner sweeps leftovers */ }
	}
	_live.clear();
}

process.on("exit", _cleanupSync);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(130));
