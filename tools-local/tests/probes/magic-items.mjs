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
	const st = pg._ui._state;
	const ui = pg._ui;
	const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const byClass = (n) => data.classData.classes.find(c => c.name === n && c.source === "PHB") || data.classData.classes.find(c => c.name === n);
	const armorByName = (n) => data.armors.find(a => a.name === n);
	const R = {};

	const setupFighter = () => {
		st.reset();
		st.abilityMethod = "manual";
		st.abilitiesBase = {str: 15, dex: 14, con: 12, int: 10, wis: 10, cha: 10};
		st.classes = [{uid: uid(byClass("Fighter")), level: 1, subclassUid: null}];
		st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
		st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;
	};
	const equip = (name, slot) => { const a = armorByName(name); if (!a) return null; st.addToInventory({uid: uid(a), name: a.name}); if (slot === "armor") st.armorUid = uid(a); else st.shieldUid = uid(a); return a; };

	// A) heavy magic armor (Dwarven Plate +2) + magic shield (Arrow-Catching +2)
	setupFighter();
	R.A_dwarvenPlateFound = !!equip("Dwarven Plate", "armor");
	R.A_arrowShieldFound = !!equip("Arrow-Catching Shield", "shield");
	R.A_ac = st.ac();           // 18+2 + (2+2) = 24
	R.A_how = st.acBreakdown().how;

	// B) magic medium armor + shield with resistances
	setupFighter();
	R.B_blueScaleFound = !!equip("Blue Dragon Scale Mail", "armor"); // MA ac14 +1 resist lightning
	R.B_sapphireFound = !!equip("Sapphire Buckler", "shield");       // S resist psychic, thunder
	R.B_ac = st.ac(); // 14+1 + min(2,2) + 2 = 19
	R.B_resist = st.equippedItemEffects().resist.sort();

	// C) shield advantage text (Sentinel: initiative + perception)
	setupFighter();
	equip("Sentinel Shield", "shield");
	R.C_initiative = st.initiativeAdvDis();
	R.C_advNotes = st.advantageNotes().map(n => `${n.type}:${n.text.slice(0, 40)}`);

	// C2) Spellguard Shield: advantage on saves vs spells
	setupFighter();
	equip("Spellguard Shield", "shield");
	R.C2_advNotes = st.advantageNotes().map(n => `${n.type}:${n.text.slice(0, 50)}`);

	// D) attached spells (Shield of the Hidden Lord: charges fireball / wall of fire) + bonusAc +2
	setupFighter();
	const hidden = equip("Shield of the Hidden Lord", "shield");
	R.D_found = !!hidden;
	const fx = st.equippedItemEffects();
	R.D_spells = fx.spells.map(g => `${g.item}: ${g.entries.map(e => `${e.name}[${e.note}]`).join(", ")}`);
	R.D_attune = fx.attune;
	R.D_ac = st.ac(); // unarmored: 10 + dex2 + shield(2+2)=4 -> 16

	// E) non-proficiency: Wizard equipping a magic shield is not shield-proficient
	st.reset();
	st.abilityMethod = "manual";
	st.abilitiesBase = {str: 10, dex: 14, con: 12, int: 15, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Wizard")), level: 1, subclassUid: null}];
	equip("Arrow-Catching Shield", "shield");
	R.E_warnings = st.armorProficiencyWarnings();
	R.E_nonProf = st.armorEffects().nonProf;

	// F) v1 isShield migration -> shieldUid (mundane shield in inventory)
	st.reset();
	const plainShield = armorByName("Shield");
	st.fromJson({_v: 1, classUid: uid(byClass("Fighter")), level: 1, inventory: [{uid: uid(plainShield), name: "Shield", qty: 1}], isShield: true, armorUid: null});
	R.F_shieldUid = st.shieldUid;
	R.F_isShieldEffective = st.isShieldEffective();

	// UI smoke: render skills + review with magic items equipped
	setupFighter();
	equip("Dwarven Plate", "armor"); equip("Shield of the Hidden Lord", "shield");
	const uiErrs = [];
	["skills", "review"].forEach(id => { const ix = ui._steps().findIndex(s => s.id === id); try { ui._ixStep = ix; ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close();
await b.close().catch(() => {});
process.exit(0);
