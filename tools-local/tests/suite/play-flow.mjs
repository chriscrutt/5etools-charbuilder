import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false); await page.setViewport({width: 1280, height: 900});
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(async () => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const R = {}; const fails = [];
	const eq = (l, g, e) => { if (JSON.stringify(g) !== JSON.stringify(e)) fails.push(`${l}: got ${JSON.stringify(g)} exp ${JSON.stringify(e)}`); };
	const btn = (re) => [...ui._eleRoot.querySelectorAll("button")].find(x => re.test(x.textContent));

	// build a Wizard 5 with spells + a wielded weapon
	st.reset(); st.mode = "pc"; st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10};
	st.raceUid = (data.races.find(r => r.name === "Human" && r.source === "PHB") || {}).name ? "Human|PHB" : null;
	st.classes = [{uid: "Wizard|PHB", level: 5, subclassUid: "School of Evocation|PHB"}];
	st.spellChoices["Wizard|PHB"] = {cantrips: ["Fire Bolt|PHB"], leveled: ["Magic Missile|PHB", "Web|PHB"]};
	ui._playMode = true; ui.render();

	// section presence + cleanliness
	const txt = () => ui._eleRoot.textContent || "";
	["Hit Points", "Hit Dice", "Spell Slots", "Spells", "Conditions", "Ability Checks", "Skills"].forEach(s => { if (!txt().includes(s)) fails.push(`missing section: ${s}`); });
	if (/NaN|\[object Object\]|\bundefined\b/.test(txt())) fails.push("dirty text in play render");
	R.maxHp = st.playMaxHp();
	R.rollClasses = ui._eleRoot.querySelectorAll(".cb__roll").length; // hover-rollable ability/save/skill rows
	R.statBoxClickable = ui._eleRoot.querySelectorAll(".cb__stat-box--click").length; // initiative box

	// --- HP: damage via the real button ---
	const inp = ui._eleRoot.querySelector('input[type="number"]'); inp.value = "10";
	btn(/Damage/).click();
	R.afterDmg = st.playCurHp(); eq("dmg", st.playCurHp(), R.maxHp - 10);

	// --- Hit Dice spend (async — rolls via the dice box) ---
	R.hdPool = st.hitDicePool(); // {6:5}
	const hpBeforeHd = st.playCurHp();
	await ui._spendHitDie(6);
	R.hdRemAfter = st.hitDiceRemaining(6); // 4
	R.hdHealed = st.playCurHp() > hpBeforeHd || st.playCurHp() === st.playMaxHp();
	R.rollBoxExists = !!document.querySelector(".rollbox"); // native dice tray appeared

	// --- Spell slots use/restore ---
	st.expendSlot(1); R.l1rem = st.playSlotsRemaining(1);
	st.restoreSlot(1); R.l1rem2 = st.playSlotsRemaining(1);

	// --- Spellbook: cast Web (concentration, lv2) ---
	const web = data.spells.find(s => s.name === "Web" && s.source === "PHB");
	const slotsBefore = st.playSlotsRemaining(2);
	ui._castSpell(web);
	R.castSlotUsed = st.playSlotsRemaining(2) === slotsBefore - 1;
	R.concentration = st.play.concentration; // "Web"

	// --- DOM: click a spell chip to cast Magic Missile (lv1) ---
	ui.render();
	const chip = [...ui._eleRoot.querySelectorAll(".cb__spell-chip")].find(c => /Magic Missile/.test(c.textContent));
	R.chipExists = !!chip;
	const l1before = st.playSlotsRemaining(1);
	if (chip) chip.click();
	R.chipCast = st.playSlotsRemaining(1) === l1before - 1;

	// --- Conditions add/remove ---
	st.addCondition("Prone"); st.addCondition("Poisoned");
	R.conds = st.play.conditions.slice();
	st.removeCondition("Prone");
	R.condsAfter = st.play.conditions.slice();

	// --- Inspiration toggle via button ---
	ui.render();
	const insp0 = st.play.inspiration;
	btn(/Inspiration/).click();
	R.inspToggled = st.play.inspiration !== insp0;

	// --- Death saves: drop to 0, roll, mark pips ---
	st.applyDamage(999); R.at0 = st.playCurHp() === 0;
	ui.render();
	R.deathUiShown = txt().includes("death saving throws");
	R.deathPips = ui._eleRoot.querySelectorAll(".cb__ds-pip").length; // 6
	await ui._rollDeathSave();
	R.deathSaveApplied = (st.play.deathSaves.success + st.play.deathSaves.fail) >= 1 || st.playCurHp() > 0;

	// --- a plain d20 roll runs without error (shows in the dice box, no custom log) ---
	st.play.curHp = st.playMaxHp(); st.play.deathSaves = {success: 0, fail: 0};
	let rollErr = null; try { ui._d20Roll("Test", 5, null); ui._d20Roll("Test adv", 5, {net: "adv", adv: ["x"]}); } catch (e) { rollErr = e.message; }
	R.rollNoError = rollErr == null;

	// --- Long rest restores everything ---
	st.applyDamage(20); st.expendSlot(3); st.spendHitDie(6); st.addCondition("Poisoned"); st.play.concentration = "Web"; st.play.deathSaves = {success: 1, fail: 1};
	st.longRest();
	R.lr_hp = st.playCurHp() === st.playMaxHp();
	R.lr_slots = st.playSlotsRemaining(3) === st.playSlotsTotal(3);
	R.lr_hdRestored = st.hitDiceRemaining(6) > 0; // half of 5 = 2 restored, so 5 (none spent now since only spent 2 earlier)
	R.lr_death = st.play.deathSaves.success === 0 && st.play.deathSaves.fail === 0;
	R.lr_conc = st.play.concentration === null;

	// --- non-caster has no Spells section but everything else renders ---
	st.reset(); st.mode = "pc"; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: "Champion|PHB"}]; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10};
	ui._playMode = true;
	try { ui.render(); } catch (e) { fails.push("fighter play render: " + e.message); }
	R.fighterNoSpells = !txt().includes("Spell Slots");
	R.fighterHasHitDice = txt().includes("Hit Dice");
	if (/NaN|\[object Object\]|\bundefined\b/.test(txt())) fails.push("dirty text fighter play");

	// --- serialization round-trip with full play state ---
	st.reset(); st.classes = [{uid: "Wizard|PHB", level: 5, subclassUid: null}];
	st.applyDamage(7); st.expendSlot(1); st.spendHitDie(6); st.addCondition("Prone"); st.play.inspiration = true; st.play.concentration = "Web";
	const j = st.toJson(); st.reset(); st.fromJson(j);
	R.ser_hp = st.playCurHp(); R.ser_cond = st.play.conditions; R.ser_insp = st.play.inspiration; R.ser_hd = st.hitDiceUsed(6);

	ui._playMode = false; st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\nFAILURES:", out.fails.length);
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
