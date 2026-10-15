import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = [];
page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage && globalThis.dbg_charBuilderPage._ui && globalThis.dbg_charBuilderPage._ui._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage;
	const st = pg._ui._state; const ui = pg._ui; const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const byClass = (n) => data.classData.classes.find(c => c.name === n && c.source === "PHB") || data.classData.classes.find(c => c.name === n);
	const itemByName = (n, src) => data.items.find(it => it.name === n && (!src || it.source === src)) || data.items.find(it => it.name === n);
	const add = (n, src) => { const it = itemByName(n, src); st.addToInventory({uid: uid(it), name: it.name}); return it; };
	const R = {};

	st.reset(); st.abilityMethod = "manual";
	st.abilitiesBase = {str: 18, dex: 14, con: 12, int: 10, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Fighter")), level: 5, subclassUid: null}];

	// Arrow-Catching Shield: +2 AC but requires attunement
	const acs = add("Arrow-Catching Shield", "DMG"); st.shieldUid = uid(acs);
	R.acs_reqAttune = st.requiresAttunement(acs);
	R.ac_beforeAttune = st.ac();           // unarmored 10 + dex2 + shield base 2 (no +2) = 14
	R.acHow_before = st.acBreakdown().how;
	st.setAttuned(uid(acs), true);
	R.ac_afterAttune = st.ac();            // 10 + 2 + (2+2) = 16
	R.acHow_after = st.acBreakdown().how;

	// magic weapon gating: Dwarven Thrower (+3, reqAttune)
	const dt = add("Dwarven Thrower", "DMG"); const dtRow = st.inventory.find(r => r.uid === uid(dt)); dtRow.equipped = true;
	const beforeW = st.weaponAttack(dt); R.weapon_beforeAttune = {toHit: beforeW.toHit, magic: beforeW.magic};
	st.setAttuned(uid(dt), true);
	const afterW = st.weaponAttack(dt); R.weapon_afterAttune = {toHit: afterW.toHit, magic: afterW.magic};

	// now attuned to 2 (shield + thrower). Add 2 more attune-required items, expect cap at 3.
	const r1 = add("Ring of Protection", "DMG");
	const r2 = add("Cloak of Protection", "DMG");
	R.attunedCount_at2 = st.attunedCount();
	R.canAttune_at2 = st.canAttuneMore();
	st.setAttuned(uid(r1), true);                 // -> 3
	R.attunedCount_at3 = st.attunedCount();
	R.canAttune_at3 = st.canAttuneMore();         // false
	st.setAttuned(uid(r2), true);                 // blocked (already 3)
	R.attunedCount_blocked = st.attunedCount();   // still 3
	R.r2_attuned = st.isAttuned(uid(r2));         // false

	// breaking attunement frees a slot
	st.setAttuned(uid(r1), false);
	R.attunedCount_afterBreak = st.attunedCount(); // 2
	R.canAttune_afterBreak = st.canAttuneMore();   // true

	// removing an attuned item from inventory clears attunement
	const ix = st.inventory.findIndex(r => r.uid === uid(dt));
	st.removeFromInventory(ix);
	R.thrower_attunedAfterRemove = st.isAttuned(uid(dt)); // false
	R.attunedCount_afterRemove = st.attunedCount();       // shield only -> 1

	// effects gating: needAttune lists equipped-but-unattuned
	st.reset(); st.abilityMethod = "manual";
	st.abilitiesBase = {str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Fighter")), level: 3, subclassUid: null}];
	const sb = add("Sapphire Buckler", "FTD"); st.shieldUid = uid(sb); // resist psychic/thunder, reqAttune
	R.resist_unattuned = st.equippedItemEffects().resist;          // [] (not attuned)
	R.needAttune = st.equippedItemEffects().needAttune;            // [Sapphire Buckler]
	st.setAttuned(uid(sb), true);
	R.resist_attuned = st.equippedItemEffects().resist.sort();     // [psychic, thunder]

	// Artificer raises the cap: 3 (base) -> 4 (L10) -> 5 (L14) -> 6 (L18); L20 Soul of Artifice = +1 save/attuned
	const arti = byClass("Artificer");
	if (arti) {
		const setLvl = (lv) => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10}; st.classes = [{uid: uid(arti), level: lv, subclassUid: null}]; };
		setLvl(5); R.arti_l5_cap = st.attuneMax();   // 3
		setLvl(10); R.arti_l10_cap = st.attuneMax(); // 4
		setLvl(14); R.arti_l14_cap = st.attuneMax(); // 5
		setLvl(18); R.arti_l18_cap = st.attuneMax(); // 6
		// L20 Soul of Artifice: attune to 2 items -> +2 to all saves
		setLvl(20);
		R.arti_l20_cap = st.attuneMax(); // 6
		const baseSave = st.saveMod("dex");
		const a1 = add("Ring of Protection", "DMG"); const a2 = add("Cloak of Protection", "DMG");
		st.setAttuned(uid(a1), true); st.setAttuned(uid(a2), true);
		R.arti_l20_saveDelta = st.saveMod("dex") - baseSave; // +2 (one per attuned item)
	}

	// UI smoke
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;
	const uiErrs = [];
	["skills", "review"].forEach(id => { const ix2 = ui._steps().findIndex(s => s.id === id); try { ui._ixStep = ix2; ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
