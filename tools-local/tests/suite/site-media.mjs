// Images (the separate 5etools-img repo, cloned into img/) are present and served locally:
// monster tokens resolve to this server and load, and a creature's art renders on the bestiary page.
// Fails with a pointer to the setup docs when img/ hasn't been cloned.
import fs from "node:fs";
import path from "node:path";
import {BASE, ROOT, launchBrowser} from "../lib/harness.mjs";

const F = []; const chk = (k, c) => { if (!c) F.push(k); };
const errs = [];

const hasImgRepo = fs.existsSync(path.join(ROOT, "img", ".git"));
chk("img/ is a clone of 5etools-img (see tools-local/docs/SETUP.md)", hasImgRepo);

const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
page.on("pageerror", e => errs.push(e.message));
const imgResponses = {ok: 0, failed: []};
page.on("response", r => {
	if (!/\/img\/.*\.(webp|png|jpg)$/i.test(r.url())) return;
	if (r.status() < 400) imgResponses.ok++;
	else imgResponses.failed.push(`${r.status()} ${r.url()}`);
});

await page.goto(BASE + "/bestiary.html#goblin_mm", {waitUntil: "domcontentloaded"});
await page.waitForFunction("document.querySelector('#pagecontent')?.innerText.includes('Goblin')", {timeout: 60000});

const res = await page.evaluate(async () => {
	const fetchStatus = async (url) => { try { return (await fetch(url, {cache: "no-store"})).status; } catch { return 0; } };
	// Relative when images are served by this site; an absolute remote URL means the site is
	// pointed at someone else's image host instead of the local img/ clone.
	const tokenUrl = new URL(Renderer.monster.getTokenUrl({name: "Goblin", source: "MM"}), location.href).href;
	const coverUrl = new URL("img/covers/PHB.webp", location.href).href;
	// The token img in the stat block header loads lazily; give it a moment.
	for (let i = 0; i < 40; i++) {
		const img = document.querySelector("#float-token img, .stats__token img, img[src*='/tokens/']");
		if (img?.complete && img.naturalWidth) break;
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	const tokenImg = document.querySelector("#float-token img, .stats__token img, img[src*='/tokens/']");
	return {
		tokenUrl,
		tokenStatus: await fetchStatus(tokenUrl),
		coverStatus: await fetchStatus(coverUrl),
		tokenImgShown: !!(tokenImg && tokenImg.naturalWidth > 0),
	};
});
console.log(JSON.stringify({hasImgRepo, ...res, imgResponses}, null, 2));

chk(`token URL is served by this site (${res.tokenUrl})`, res.tokenUrl.startsWith(BASE));
chk(`Goblin token loads (HTTP ${res.tokenStatus})`, res.tokenStatus === 200);
chk(`PHB cover loads (HTTP ${res.coverStatus})`, res.coverStatus === 200);
chk("Goblin token renders on the bestiary page", res.tokenImgShown);
chk(`no failed /img/ requests (${imgResponses.failed.slice(0, 3).join("; ")})`, imgResponses.failed.length === 0);

console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
