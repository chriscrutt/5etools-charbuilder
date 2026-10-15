import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage();
await page.setCacheEnabled(false);
const errs = [];
page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage && globalThis.dbg_charBuilderPage._ui && globalThis.dbg_charBuilderPage._ui._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const st = pg._ui._state; const ui = pg._ui; const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const byClass = (n) => data.classData.classes.find(c => c.name === n && c.source === "PHB") || data.classData.classes.find(c => c.name === n);
	const itemByName = (n) => data.items.find(it => it.name === n);
	const wear = (n, attune) => { const it = itemByName(n); if (!it) return null; st.addToInventory({uid: uid(it), name: it.name}); const row = st.inventory.find(r => r.uid === uid(it)); row.equipped = true; if (attune) st.setAttuned(uid(it), true); return it; };
	const R = {};

	const setup = (cls, lvl, ab) => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = ab; st.classes = [{uid: uid(byClass(cls)), level: lvl, subclassUid: null}]; st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null; st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null; };

	// Ring of Protection + Cloak of Protection: +1 AC & +1 save each (need attunement). Unarmored Wizard dex14(+2)
	setup("Wizard", 1, {str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10});
	R.ac_base = st.ac(); // 10 + 2 = 12
	R.save_base = st.saveMod("dex");
	wear("Ring of Protection", false); wear("Cloak of Protection", false); // worn but NOT attuned -> inactive
	R.ac_wornUnattuned = st.ac(); // still 12 (need attunement)
	st.setAttuned("Ring of Protection|DMG", true); st.setAttuned("Cloak of Protection|DMG", true);
	R.ac_attuned = st.ac(); // 12 + 1 + 1 = 14
	R.save_attuned_delta = st.saveMod("dex") - R.save_base; // +2 (two protection items)

	// Amulet of Health sets Con to 19 (from 12) when attuned
	setup("Fighter", 1, {str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10});
	R.con_before = st.finalAbility("con"); // 12
	wear("Amulet of Health", true);
	R.con_afterAmulet = st.finalAbility("con"); // 19
	R.conMod_after = st.abilityMod("con");     // +4
	R.amulet_effect = st.equippedItemEffects().abilitySet;

	// Bracers of Defense: +2 AC only while unarmored & no shield
	setup("Monk", 2, {str: 12, dex: 16, con: 12, int: 10, wis: 14, cha: 10});
	wear("Bracers of Defense", true);
	R.bracers_unarmored_ac = st.ac(); // Monk unarmored 10+dex3+wis2=15, +2 bracers = 17
	// add + wear plate, bracers should NOT apply
	const plate = itemByName("Plate") || itemByName("Plate Armor") || data.armors.find(a => `${a.type || ""}`.split("|")[0] === "HA"); st.addToInventory({uid: uid(plate), name: plate.name}); st.armorUid = uid(plate);
	R.bracers_armored_acHow = st.acBreakdown().how; // should not contain "(items)" since bracers inactive while armored

	// Wand of the War Mage +1: +1 spell attack & DC (Wizard)
	setup("Wizard", 5, {str: 8, dex: 14, con: 12, int: 18, wis: 10, cha: 10});
	const src = st.spellSources()[0];
	R.dc_before = st.spellSaveDcFor(src); R.atk_before = st.spellAtkBonusFor(src);
	const wand = data.items.find(it => it.bonusSpellAttack && it.bonusSpellSaveDc && st.isHoldable(it) && !it.reqAttune) || data.items.find(it => it.bonusSpellAttack && st.isHoldable(it));
	if (wand) { st.addToInventory({uid: uid(wand), name: wand.name}); const row = st.inventory.find(r => r.uid === uid(wand)); row.equipped = true; if (wand.reqAttune) st.setAttuned(uid(wand), true); }
	R.wandFound = wand ? wand.name : false;
	R.wand_holdable = wand ? st.isHoldable(wand) : null;
	R.dc_after = st.spellSaveDcFor(src); R.atk_after = st.spellAtkBonusFor(src); // +1 each

	// UI smoke + Attacks-table cell count
	setup("Fighter", 3, {str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10});
	const ls = itemByName("Longsword"); st.addToInventory({uid: uid(ls), name: ls.name}); st.inventory.find(r => r.uid === uid(ls)).equipped = true;
	wear("Ring of Protection", true);
	const uiErrs = [];
	["skills", "review"].forEach(id => { const ix = ui._steps().findIndex(s => s.id === id); try { ui._ixStep = ix; ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;
	// inspect the rendered Attacks table: data row should have 4 <td> cells
	const atkRow = ui._eleRoot.querySelector(".cb__atk-tbl tbody tr");
	R.atk_cellCount = atkRow ? atkRow.querySelectorAll("td").length : 0; // expect 4

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
