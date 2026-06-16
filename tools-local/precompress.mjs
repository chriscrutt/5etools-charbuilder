// Pre-compress static text assets so the local server can serve them with
// Content-Encoding: br/gzip (http-server's -b/-g flags serve a sibling .br/.gz
// when the browser advertises support). Images/audio/fonts are already
// compressed formats and are skipped.
//
// Usage:  node tools-local/precompress.mjs [--clean]
//   --clean  remove all generated .br/.gz instead of creating them.
//
// Safe to re-run; only (re)writes when the source is newer than the artifact.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clean = process.argv.includes("--clean");

// Extensions worth compressing (text-like, highly compressible).
const EXT = new Set([".json", ".js", ".css", ".html", ".svg", ".xml", ".webmanifest", ".txt"]);
// Directories to skip entirely.
const SKIP_DIR = new Set(["node_modules", ".git", "img", "audio", "fonts", "tools-local"]);

const brotli = (buf) => zlib.brotliCompressSync(buf, {
	params: {
		[zlib.constants.BROTLI_PARAM_QUALITY]: 11,
		[zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
	},
});
const gzip = (buf) => zlib.gzipSync(buf, {level: 9});

let made = 0; let removed = 0; let rawTotal = 0; let brTotal = 0;

function walk (dir) {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		if (ent.isDirectory()) {
			if (SKIP_DIR.has(ent.name)) continue;
			walk(path.join(dir, ent.name));
			continue;
		}
		const full = path.join(dir, ent.name);
		const ext = path.extname(ent.name).toLowerCase();

		if (ext === ".br" || ext === ".gz") {
			if (clean) { fs.rmSync(full); removed++; }
			continue;
		}
		if (clean || !EXT.has(ext)) continue;

		const srcStat = fs.statSync(full);
		if (srcStat.size < 1024) continue; // not worth it for tiny files
		const buf = fs.readFileSync(full);
		rawTotal += buf.length;

		for (const [suffix, fn] of [[".br", brotli], [".gz", gzip]]) {
			const out = full + suffix;
			try { if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcStat.mtimeMs) { if (suffix === ".br") brTotal += fs.statSync(out).size; continue; } } catch {}
			const comp = fn(buf);
			fs.writeFileSync(out, comp);
			if (suffix === ".br") brTotal += comp.length;
			made++;
		}
	}
}

walk(ROOT);

if (clean) console.log(`Removed ${removed} precompressed files.`);
else console.log(`Wrote/updated ${made} compressed files. Source ${(rawTotal / 1e6).toFixed(1)}MB -> brotli ${(brTotal / 1e6).toFixed(1)}MB (${(100 * (1 - brTotal / rawTotal)).toFixed(1)}% smaller).`);
