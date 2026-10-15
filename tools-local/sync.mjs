// Sync this fork with upstream 5etools: the site (merged into the current branch) and the images
// (img/, a separate clone of 5etools-img, fast-forwarded). Never rewrites history or force-anything.
//
//   npm run local:sync               fetch + merge upstream site, npm install if the lockfile changed,
//                                    fast-forward img/
//   npm run local:sync -- --check    report what's new and what's risky; change nothing
//   npm run local:sync -- --no-img   skip the images
//   npm run local:sync -- --remote <name>   upstream remote to use (default: auto-detect)
//
// Afterwards run `npm run local:test`. See tools-local/docs/UPKEEP.md for what to do when the merge
// conflicts or the tests fail (usually: adapt js/fork-compat.js).

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
	console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n\nimport")[0]);
	process.exit(0);
}
const isCheck = argv.includes("--check");
const isNoImg = argv.includes("--no-img");
const remoteArg = argv.includes("--remote") ? argv[argv.indexOf("--remote") + 1] : null;

const git = (args, {cwd = ROOT, allowFail = false} = {}) => {
	const r = spawnSync("git", args, {cwd, encoding: "utf8"});
	if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
	return {ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim()};
};
const say = (s = "") => console.log(s);
const die = (s) => { console.error(`\n✖ ${s}`); process.exit(1); };

// region upstream remote
const remotes = git(["remote", "-v"]).out.split("\n").filter(l => l.endsWith("(fetch)")).map(l => {
	const [name, url] = l.split(/\s+/);
	return {name, url};
});
const isOfficial = (url) => /5etools-mirror-\d+\/5etools-src(\.git)?\/?$/i.test(url);
const upstream = remoteArg
	? remotes.find(r => r.name === remoteArg)
	: remotes.find(r => r.name === "upstream") || remotes.find(r => isOfficial(r.url));
if (!upstream) {
	die(`No upstream remote found. Add the official 5etools source, e.g.:
    git remote add upstream https://github.com/5etools-mirror-3/5etools-src.git
  (The mirror org number changes when the repo moves; see tools-local/docs/UPKEEP.md.)`);
}
// endregion

// region preconditions
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
if (branch === "HEAD") die("Detached HEAD: check out your customization branch first.");
const dirty = git(["status", "--porcelain", "--untracked-files=no"]).out;
if (dirty && !isCheck) die(`Uncommitted changes to tracked files; commit or stash them first:\n${dirty}`);
// endregion

// region fetch + report
say(`Fetching ${upstream.name} (${upstream.url})...`);
git(["fetch", upstream.name]);
const up = `${upstream.name}/main`;
const versionAt = (ref) => { try { return JSON.parse(git(["show", `${ref}:package.json`]).out).version; } catch { return "?"; } };
const behind = +git(["rev-list", "--count", `HEAD..${up}`]).out;
say(`\nSite: ${branch} is at v${versionAt("HEAD")}; ${up} is at v${versionAt(up)} (${behind} new upstream commit${behind === 1 ? "" : "s"}).`);

let mergeNeeded = behind > 0;
if (mergeNeeded) {
	say(git(["log", "--oneline", "--no-decorate", `HEAD..${up}`]).out.split("\n").slice(0, 15).map(l => `  ${l}`).join("\n"));
	const changedUpstream = new Set(git(["diff", "--name-only", `HEAD...${up}`]).out.split("\n").filter(Boolean));
	const changedHere = git(["diff", "--name-only", `${up}...HEAD`]).out.split("\n").filter(Boolean);
	const both = changedHere.filter(f => changedUpstream.has(f));
	say(`  ${changedUpstream.size} files changed upstream.`);
	if (both.length) say(`  Files both upstream and this fork have changed (where conflicts would be): ${both.join(", ")}`);

	// The fork's custom pages call the old flat element API; js/fork-compat.js adapts it. If upstream
	// touched that API again, the merge can be clean and the builder/VTT still break at runtime.
	const apiHits = git(["diff", `HEAD...${up}`, "--", "js/utils.js"]).out.split("\n")
		.filter(l => /^[-+]/.test(l) && /_getOrModify_bindMethods|_ElementUtilVee|globalThis\.(ee|es|e_|veT|veEs|veE|veEm)\b|defineProperty\(ele, "vee"/.test(l));
	if (apiHits.length) {
		say(`\n⚠ Upstream changed the DOM element-helper API that js/fork-compat.js adapts (${apiHits.length} changed lines in js/utils.js).`);
		say("  Merge, then run the tests; if the Character Builder or VTT break, update js/fork-compat.js (UPKEEP.md).");
	}
}
// endregion

// region merge
if (mergeNeeded && !isCheck) {
	const lockBefore = git(["rev-parse", "HEAD:package-lock.json"], {allowFail: true}).out;
	say(`\nMerging ${up} into ${branch}...`);
	const m = git(["merge", "--no-edit", up], {allowFail: true});
	if (!m.ok) {
		const conflicted = git(["diff", "--name-only", "--diff-filter=U"], {allowFail: true}).out;
		die(`Merge stopped with conflicts${conflicted ? ` in:\n  ${conflicted.split("\n").join("\n  ")}` : `:\n${m.err || m.out}`}
Resolve them keeping the fork's additions (see tools-local/docs/UPKEEP.md), then \`git add\` + \`git commit\`.
To back out instead: git merge --abort`);
	}
	say(`  Merged: now at v${versionAt("HEAD")} (${git(["rev-parse", "--short", "HEAD"]).out}).`);
	const lockAfter = git(["rev-parse", "HEAD:package-lock.json"], {allowFail: true}).out;
	if (lockBefore !== lockAfter) {
		say("  package-lock.json changed upstream; running npm install...");
		const r = spawnSync("npm install --no-audit --no-fund", {cwd: ROOT, stdio: "inherit", shell: true});
		if (r.status !== 0) die("npm install failed.");
	}
	// Keep a local `main` (if there is one) as a plain mirror of upstream.
	if (branch !== "main" && git(["rev-parse", "--verify", "--quiet", "refs/heads/main"], {allowFail: true}).ok) {
		if (git(["merge-base", "--is-ancestor", "main", up], {allowFail: true}).ok) git(["branch", "-f", "main", up]);
	}
}
// endregion

// region images
if (!isNoImg) {
	const imgDir = path.join(ROOT, "img");
	const imgUrl = upstream.url.replace(/5etools-src(\.git)?\/?$/i, "5etools-img.git");
	if (!fs.existsSync(path.join(imgDir, ".git"))) {
		say(`\nImages: img/ is not a git clone. To get them (about 6 GB):
    git clone --depth 1 ${imgUrl} img`);
	} else {
		say("\nFetching images (img/)...");
		git(["fetch"], {cwd: imgDir});
		const imgBehind = +git(["rev-list", "--count", "HEAD..@{u}"], {cwd: imgDir}).out;
		const imgVer = (ref) => git(["log", "-1", "--format=%s", ref], {cwd: imgDir}).out;
		say(`  img/ is at "${imgVer("HEAD")}"; upstream is at "${imgVer("@{u}")}" (${imgBehind} new commit${imgBehind === 1 ? "" : "s"}).`);
		if (imgBehind && !isCheck) {
			if (git(["status", "--porcelain"], {cwd: imgDir}).out) die("img/ has local changes; the images repo should be an untouched clone.");
			const m = git(["merge", "--ff-only", "@{u}"], {cwd: imgDir, allowFail: true});
			if (!m.ok) die(`Could not fast-forward img/:\n${m.err}`);
			say("  Images updated.");
		}
	}
}
// endregion

// region next steps
// `npm run local:precompress` writes .br/.gz siblings that serve:fast prefers over the real files.
const hasPrecompressed = (dir) => {
	try {
		return fs.readdirSync(dir, {withFileTypes: true}).some(d => d.isDirectory() ? hasPrecompressed(path.join(dir, d.name)) : /\.(br|gz)$/.test(d.name));
	} catch { return false; }
};
const precompressed = ["data", "js", "css"].some(d => hasPrecompressed(path.join(ROOT, d)));
say("");
if (isCheck) say("(--check: nothing was changed.)");
else {
	say("Next:");
	say("  npm run local:test        confirm the Character Builder, VTT and 2014-only mode still work");
	if (precompressed) say("  npm run local:precompress  your precompressed .br/.gz files are now stale (serve:fast would serve them)");
	say("  Restart the server, and hard-refresh the browser (serve:fast sends long cache headers).");
}
// endregion
