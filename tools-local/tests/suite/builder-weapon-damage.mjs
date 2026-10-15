import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const R = {}; const fails = [];
	const uid = (e) => `${e.name}|${e.source}`;
	const item = (n) => data.items.find(i => i.name === n) || data.items.find(i => i.name.startsWith(n));
	const wield = (it) => { st.addToInventory({uid: uid(it), name: it.name}); const row = st.inventory.find(r => r.uid === uid(it)); row.equipped = true; if (it.reqAttune) st.setAttuned(uid(it), true); };
	const setup = () => { st.reset(); st.mode = "pc"; st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10}; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: "Champion|PHB"}]; };

	// --- magic weapon bonus applies to attack & damage ---
	setup();
	const magicWpn = data.items.find(i => i.bonusWeapon && i.dmg1 && i.weapon);
	if (magicWpn) {
		const bonus = parseInt(`${magicWpn.bonusWeapon}`.replace(/[^-0-9]/g, ""), 10);
		wield(magicWpn);
		const a = st.weaponAttack(magicWpn);
		R.magicWpnName = magicWpn.name; R.magicBonus = bonus;
		R.magicDmgApplied = a.magicDmg === bonus; R.magicAtkApplied = a.magicAtk === bonus;
		R.toHitIncludesMagic = a.toHit === st.abilityMod("str") + st.profBonus + bonus;
		R.magicFlag = a.magic === bonus;
	} else R.magicWpn = "NONE";

	// --- extra/conditional damage extracted from item text ---
	const flame = item("Flame Tongue");
	R.flameExtra = flame ? st.weaponExtraDamage(flame) : null; // [{dice:"2d6", type:"fire"}]
	const mace = item("Mace of Disruption");
	R.maceExtra = mace ? st.weaponExtraDamage(mace).map(r => `${r.dice}|${r.type}`) : null; // 2d6|radiant
	// a plain weapon has no extra damage
	const club = item("Club");
	R.plainExtra = club ? st.weaponExtraDamage(club).length : null; // 0

	// --- UI: play attacks show magic + breakdown + extra rider buttons ---
	setup();
	const extraWpn = data.items.find(i => st.isWeapon(i) && i.dmg1 && st.weaponExtraDamage(i).length);
	R.extraWpnName = extraWpn?.name;
	if (extraWpn) wield(extraWpn);
	ui._playMode = true;
	let err = null; try { ui.render(); } catch (e) { err = e.message; }
	if (err) fails.push("play render: " + err);
	const txt = ui._eleRoot.textContent || "";
	R.ui_hasWeapon = extraWpn ? txt.includes(extraWpn.name) : false;
	R.ui_hasExtraButton = [...ui._eleRoot.querySelectorAll("button")].some(x => /\+\d+d\d/.test(x.textContent)); // extra-damage roll button
	R.ui_hasCondition = /when its condition is met/i.test(txt);
	if (/NaN|\[object Object\]|\bundefined\b/.test(txt)) fails.push("dirty attacks text");

	ui._playMode = false; st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
const F = [...out.fails];
const chk = (k, c) => { if (!c) F.push(k); };
if (out.magicWpn !== "NONE") { chk("magicDmgApplied", out.magicDmgApplied); chk("magicAtkApplied", out.magicAtkApplied); chk("toHitIncludesMagic", out.toHitIncludesMagic); }
chk("flameExtra", out.flameExtra && out.flameExtra.some(r => r.dice === "2d6" && r.type === "fire"));
chk("maceExtra", out.maceExtra && out.maceExtra.some(s => s === "2d6|radiant"));
chk("plainExtra", out.plainExtra === 0);
chk("ui_hasExtraButton", out.ui_hasExtraButton);
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
