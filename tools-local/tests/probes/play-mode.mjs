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
	const R = {};
	const setup = (clsUid, lvl) => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10}; st.classes = [{uid: clsUid, level: lvl, subclassUid: null}]; st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null; };

	// --- HP (Wizard 5) ---
	setup("Wizard|PHB", 5);
	R.maxHp = st.playMaxHp();
	R.curHp_default = st.playCurHp(); // == max when curHp null
	st.setTempHp(5); R.temp = st.playTempHp();
	st.applyDamage(3); R.afterDmg3_temp = st.playTempHp(); R.afterDmg3_hp = st.playCurHp(); // temp 5->2, hp unchanged
	st.applyDamage(10); R.afterDmg10_temp = st.playTempHp(); R.afterDmg10_hp = st.playCurHp(); // temp 2->0, hp -8
	st.applyHealing(4); R.afterHeal4 = st.playCurHp();
	st.setTempHp(2); R.tempNoStack = st.playTempHp(); // 2 < current temp(0) ... current temp is 0, so becomes 2
	st.applyDamage(999); R.hpFloor = st.playCurHp(); // 0
	st.longRest(); R.afterLongRest_hp = st.playCurHp(); R.afterLongRest_temp = st.playTempHp();

	// --- Spell slots (Wizard 5: {1:4,2:3,3:2}) ---
	R.slots = st.spellSlots();
	st.expendSlot(1); st.expendSlot(1); R.l1_rem = st.playSlotsRemaining(1); // 4-2=2
	st.restoreSlot(1); R.l1_rem2 = st.playSlotsRemaining(1); // 3
	for (let i = 0; i < 10; ++i) st.expendSlot(3); R.l3_rem = st.playSlotsRemaining(3); // floors at 0 (total 2)
	st.longRest(); R.l1_afterRest = st.playSlotsRemaining(1); R.l3_afterRest = st.playSlotsRemaining(3); // back to full

	// --- Pact slots (Warlock 5) ---
	setup("Warlock|PHB", 5);
	R.pact = st.pactSlots(); R.pactTotal = st.playPactTotal(); R.pactLevel = st.playPactLevel();
	st.expendPact(); st.expendPact(); st.expendPact(); R.pactRem = st.playPactRemaining(); // floors at 0 if total<3
	st.shortRest(); R.pactAfterShort = st.playPactRemaining(); // restored

	// (Rolls now go through the site's own dice roller, Renderer.dice.pRollEntry, instead of a
	// play-state roll log; suite/play-flow covers them.)

	// --- serialization round-trips play state ---
	st.applyDamage(7); st.expendSlot(1);
	const j = st.toJson(); R.json_hasPlay = !!j.play; R.json_curHp = j.play.curHp;
	st.reset(); st.fromJson(j); R.restored_curHp = st.play.curHp; R.restored_expended1 = st.play.expended[1];

	// --- UI smoke: play mode render (Wizard + Warlock) + roll buttons present ---
	const uiErrs = [];
	setup("Wizard|PHB", 5);
	try { pg._ui._playMode = true; pg._ui.render(); } catch (e) { uiErrs.push("wizard play: " + e.message); }
	R.play_hasHp = pg._ui._eleRoot.textContent.includes("Hit Points");
	R.play_hasSlots = pg._ui._eleRoot.textContent.includes("Spell Slots");
	R.play_hasSkills = pg._ui._eleRoot.textContent.includes("Skills");
	setup("Warlock|PHB", 5);
	try { pg._ui.render(); } catch (e) { uiErrs.push("warlock play: " + e.message); }
	R.play_hasPact = pg._ui._eleRoot.textContent.includes("Pact");
	// no-class guard
	st.reset();
	try { pg._ui.render(); } catch (e) { uiErrs.push("noclass play: " + e.message); }
	R.play_noClassGuard = pg._ui._eleRoot.textContent.includes("Build your character first");
	pg._ui._playMode = false;
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
