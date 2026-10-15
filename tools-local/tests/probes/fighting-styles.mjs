import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const cls = (n) => data.classData.classes.find(c => c.name === n);
	const item = (n) => data.items.find(it => it.name === n);
	const fs = (n) => data.fightingStyles.find(o => o.name === n);
	const R = {};
	R.fsLoaded = data.fightingStyles.length;

	// Fighter L1 -> 1 fighting style slot; FS:F options include Defense/Archery/Dueling
	st.reset(); st.classes = [{uid: uid(cls("Fighter")), level: 1, subclassUid: null}];
	st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10};
	R.fighter_slots = st.fightingStyleSlots();
	R.fighter_optNames = st.fightingStyleOptions().map(o => o.name);

	// Defense style + worn armor -> +1 AC
	const chain = item("Chain Mail") || data.armors.find(a => `${a.type || ""}`.split("|")[0] === "HA");
	st.addToInventory({uid: uid(chain), name: chain.name}); st.armorUid = uid(chain);
	const acNoStyle = st.ac();
	st.fightingStyles = [uid(fs("Defense"))];
	R.ac_noStyle = acNoStyle; R.ac_defense = st.ac(); R.acHow = st.acBreakdown().how;

	// Archery -> +2 ranged attack; Dueling -> +2 one-handed melee damage
	st.fightingStyles = [uid(fs("Archery"))];
	const lb = item("Longbow"); st.addToInventory({uid: uid(lb), name: lb.name}); st.inventory.find(r => r.uid === uid(lb)).equipped = true;
	const bowAtk = st.weaponAttack(lb);
	R.archery_bowToHit = bowAtk.toHit; // dex+2 + prof+2 + style+2 = +6 (dex14)
	st.fightingStyles = [uid(fs("Dueling"))];
	const ls = item("Longsword");
	const lsAtk = st.weaponAttack(ls);
	R.dueling_swordDmg = st.fmtWeaponDamage(lsAtk.dmg1, lsAtk); // 1d8 + str3 + 2 = +5
	// Dueling should NOT apply to a two-handed weapon
	const gs = item("Greatsword");
	const gsAtk = st.weaponAttack(gs);
	R.dueling_greatswordDmg = st.fmtWeaponDamage(gsAtk.dmg1, gsAtk); // 2d6 + str3 (no +2, it's 2H)

	// Wizard -> no fighting style
	st.reset(); st.classes = [{uid: uid(cls("Wizard")), level: 1, subclassUid: null}];
	R.wizard_slots = st.fightingStyleSlots();

	// UI smoke
	st.reset(); st.classes = [{uid: uid(cls("Fighter")), level: 5, subclassUid: null}]; st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	const uiErrs = [];
	["skills", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
