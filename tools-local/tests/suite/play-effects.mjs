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
	const setup = (clsUid, lvl, race) => { st.reset(); st.mode = "pc"; ui._playMode = true; st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10}; st.raceUid = race || "Human|PHB"; st.classes = [{uid: clsUid, level: lvl, subclassUid: null}]; st.play.effects = []; };

	// --- Rage (Barbarian) ---
	setup("Barbarian|PHB", 5); st.play.effects = ["Rage"];
	R.rage_active = st.activeEffects().map(e => e.name); // ["Rage"]
	R.rage_resist = st.playResistances().sort(); // bludgeoning/piercing/slashing
	R.rage_strCheckAdv = st.effectAdv(null, "check", "str")?.net; // adv
	R.rage_strSaveAdv = st.effectAdv(null, "save", "str")?.net; // adv
	R.rage_dexCheckNoAdv = st.effectAdv(null, "check", "dex"); // null
	R.rage_riders = st.playDamageRiders(); // +2 at L5
	setup("Barbarian|PHB", 9); st.play.effects = ["Rage"]; R.rage_dmg9 = st._rageDamage();
	setup("Barbarian|PHB", 16); st.play.effects = ["Rage"]; R.rage_dmg16 = st._rageDamage();
	// Rage only for Barbarians
	setup("Wizard|PHB", 5); st.play.effects = ["Rage"]; R.rage_nonBarb = st.activeEffects().length; // 0

	// --- Mage Armor (Wizard, unarmored) ---
	setup("Wizard|PHB", 5); const acBase = st.ac(); st.play.effects = ["Mage Armor"];
	R.mageArmor_ac = st.playAc(); R.mageArmor_delta = st.playAc() - acBase; // +3
	// + Shield of Faith
	st.play.effects = ["Mage Armor", "Shield of Faith"]; R.mageArmorSoF_delta = st.playAc() - acBase; // +5
	// Shield spell
	st.play.effects = ["Shield"]; R.shield_delta = st.playAc() - acBase; // +5
	// Barkskin min 16
	st.play.effects = ["Barkskin"]; R.barkskin_ac = st.playAc(); // >= 16

	// --- Haste ---
	setup("Fighter|PHB", 5); const baseSpeed = st._walkSpeed(); const baseAtk = st.numAttacks();
	st.play.effects = ["Haste"];
	R.haste_acDelta = st.playAc() - st.ac(); // +2
	R.haste_speed = st.playWalkSpeed(); R.haste_speedDouble = st.playWalkSpeed() === baseSpeed * 2;
	R.haste_attacks = st.playNumAttacks(); R.haste_attackPlus = st.playNumAttacks() === baseAtk + 1;
	R.haste_dexSaveAdv = st.effectAdv(null, "save", "dex")?.net; // adv

	// --- Aid (HP) ---
	setup("Fighter|PHB", 5); const hpBase = st.maxHp(); st.play.effects = ["Aid"];
	R.aid_maxHp = st.playMaxHp(); R.aid_plus5 = st.playMaxHp() === hpBase + 5;

	// --- Bless / Bane (roll dice) ---
	setup("Cleric|PHB", 5); st.play.effects = ["Bless"];
	R.bless_atkDice = st.effectAttackDice(); R.bless_saveDice = st.effectSaveDice(); // +1d4
	st.play.effects = ["Bane"]; R.bane_atkDice = st.effectAttackDice(); // -1d4
	st.play.effects = ["Bless", "Bane"]; R.both_atkDice = st.effectAttackDice(); // +1d4-1d4

	// --- Longstrider / Slow speed ---
	setup("Wizard|PHB", 5); const bs = st._walkSpeed();
	st.play.effects = ["Longstrider"]; R.longstrider_speed = st.playWalkSpeed(); R.longstrider_plus10 = st.playWalkSpeed() === bs + 10;
	st.play.effects = ["Slow"]; R.slow_speed = st.playWalkSpeed(); R.slow_acDelta = st.playAc() - st.ac(); // -2 AC, half speed

	// --- exhaustion + effect speed stack (Haste ×2 then exhaustion ½) ---
	setup("Fighter|PHB", 5); const fs = st._walkSpeed(); st.play.effects = ["Haste"]; st.play.exhaustion = 2;
	R.hasteExhaust_speed = st.playWalkSpeed(); // (30*2)/2 = 30

	// --- UI: active effect details + AC/speed boxes reflect ---
	setup("Barbarian|PHB", 9); st.play.effects = ["Rage"]; st.play.exhaustion = 0;
	let err = null; try { ui.render(); } catch (e) { err = e.message; }
	if (err) fails.push("rage play render: " + err);
	const txt = ui._eleRoot.textContent || "";
	R.ui_effectDetails = txt.includes("Active Effect Details") && txt.includes("Resistances");
	if (/NaN|\[object Object\]|\bundefined\b/.test(txt)) fails.push("dirty effect text");

	// serialization keeps effects
	setup("Barbarian|PHB", 5); st.play.effects = ["Rage", "Bless"];
	const j = st.toJson(); st.reset(); st.fromJson(j); R.ser_effects = st.play.effects;

	ui._playMode = false; st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
const F = [...out.fails];
const chk = (k, cond) => { if (!cond) F.push(k); };
chk("rage_resist", JSON.stringify(out.rage_resist) === JSON.stringify(["bludgeoning", "piercing", "slashing"]));
chk("rage_strCheckAdv", out.rage_strCheckAdv === "adv");
chk("rage_strSaveAdv", out.rage_strSaveAdv === "adv");
chk("rage_dexCheckNoAdv", out.rage_dexCheckNoAdv === null);
chk("rage_dmg5", out.rage_riders?.[0]?.includes("+2"));
chk("rage_dmg9", out.rage_dmg9 === 3); chk("rage_dmg16", out.rage_dmg16 === 4);
chk("rage_nonBarb", out.rage_nonBarb === 0);
chk("mageArmor", out.mageArmor_delta === 3);
chk("mageArmorSoF", out.mageArmorSoF_delta === 5);
chk("shield", out.shield_delta === 5);
chk("barkskin", out.barkskin_ac >= 16);
chk("haste_ac", out.haste_acDelta === 2);
chk("haste_speedDouble", out.haste_speedDouble); chk("haste_attackPlus", out.haste_attackPlus);
chk("haste_dexSave", out.haste_dexSaveAdv === "adv");
chk("aid", out.aid_plus5);
chk("bless_atk", out.bless_atkDice === "+1d4"); chk("bless_save", out.bless_saveDice === "+1d4");
chk("bane_atk", out.bane_atkDice === "-1d4"); chk("both", out.both_atkDice === "+1d4-1d4");
chk("longstrider", out.longstrider_plus10); chk("slow_ac", out.slow_acDelta === -2);
chk("hasteExhaust", out.hasteExhaust_speed === 30);
chk("ui_effectDetails", out.ui_effectDetails);
chk("ser_effects", JSON.stringify(out.ser_effects) === JSON.stringify(["Rage", "Bless"]));
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
