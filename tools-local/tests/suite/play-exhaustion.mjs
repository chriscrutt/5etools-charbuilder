import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false); await page.setViewport({width: 1280, height: 900});
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const R = {}; const fails = [];

	// --- PC: exhaustion HP-max halving + roll disadvantage merge ---
	st.reset(); st.mode = "pc"; ui._playMode = true; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}]; st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10};
	R.maxHpEx0 = st.playMaxHp();
	st.play.exhaustion = 4; R.maxHpEx4 = st.playMaxHp(); // halved
	R.hpHalved = R.maxHpEx4 === Math.floor(R.maxHpEx0 / 2);
	// merge: check disadv at ex>=1, save/attack at ex>=3
	st.play.exhaustion = 1; R.ex1_check = ui._mergeExhaustion(null, "check")?.net; R.ex1_save = ui._mergeExhaustion(null, "save"); R.ex1_attack = ui._mergeExhaustion(null, "attack");
	st.play.exhaustion = 3; R.ex3_save = ui._mergeExhaustion(null, "save")?.net; R.ex3_attack = ui._mergeExhaustion(null, "attack")?.net;
	// advantage + exhaustion disadvantage cancel to "both" (straight roll)
	st.play.exhaustion = 1; R.ex_cancel = ui._mergeExhaustion({adv: ["x"], dis: [], net: "adv"}, "check")?.net; // "both"

	// --- long rest reduces exhaustion by 1 ---
	st.play.exhaustion = 3; st.longRest(); R.lr_exhaustion = st.play.exhaustion; // 2

	// --- render at each exhaustion level: no errors, effects summary shows ---
	st.play.exhaustion = 0; const txts = [];
	for (let lvl = 0; lvl <= 6; ++lvl) { st.play.exhaustion = lvl; try { ui.render(); } catch (e) { fails.push(`render ex${lvl}: ${e.message}`); } txts.push(ui._eleRoot.textContent || ""); }
	R.ex_uiSpeedHalvedShown = txts[2].includes("Speed");
	R.ex_uiL3Effects = txts[3].includes("Disadvantage on attack rolls");
	R.ex_uiL6Death = txts[6].includes("the character dies");
	R.ex_noDirty = !txts.some(t => /NaN|\[object Object\]|\bundefined\b/.test(t));
	if (!R.ex_noDirty) fails.push("dirty text in exhaustion render");

	// --- Buffs/effects tracker ---
	st.play.exhaustion = 0; st.play.effects = [];
	st.play.effects.push("Bless", "Bardic Inspiration"); ui.render();
	R.buffsShown = (ui._eleRoot.textContent || "").includes("Bless") && (ui._eleRoot.textContent || "").includes("Bardic Inspiration");
	R.buffSectionShown = (ui._eleRoot.textContent || "").includes("Buffs");
	R.buffChips = ui._eleRoot.querySelectorAll(".cb__buff-chip").length; // 2
	R.buffSpellLink = !!ui._eleRoot.querySelector('.cb__buff-chip a[href*="spells.html"]'); // Bless -> hoverable spell link
	st.play.effects = ["Bardic Inspiration"]; ui.render();
	R.buffPlainForNonSpell = !ui._eleRoot.querySelector('.cb__buff-chip a') && (ui._eleRoot.textContent || "").includes("Bardic Inspiration"); // non-spell stays plain text
	// add via the <select> quick-add (matches the conditions dropdown)
	const buffSel = [...ui._eleRoot.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "__custom__"));
	R.buffIsSelect = !!buffSel;
	if (buffSel) { buffSel.value = "Aid"; buffSel.dispatchEvent(new Event("change")); }
	R.buffAdded = st.play.effects.includes("Aid");

	// --- sidekick exhaustion + effects ---
	const uid = (e) => `${e.name}|${e.source}`;
	st.reset(); st.mode = "sidekick"; ui._playMode = true; st.sidekick = {...st._defaultSidekick(), creatureUid: uid(data.bestiary.find(m => m.name === "Wolf")), classUid: "Warrior Sidekick|TCE", level: 5};
	R.skMaxHpEx0 = st.skMaxHp();
	st.skPlay().exhaustion = 4; R.skMaxHpEx4 = st.skMaxHp(); R.skHpHalved = R.skMaxHpEx4 === Math.floor(R.skMaxHpEx0 / 2);
	st.skPlay().exhaustion = 0; st.skPlay().effects = ["Bless"];
	try { ui.render(); } catch (e) { fails.push("sk render: " + e.message); }
	R.skBuffShown = (ui._eleRoot.textContent || "").includes("Bless");
	R.skExhaustShown = (ui._eleRoot.textContent || "").includes("Exhaustion");
	// merge uses sidekick play exhaustion
	st.skPlay().exhaustion = 1; R.skMerge = ui._mergeExhaustion(null, "check")?.net; // dis

	// --- serialization of exhaustion + effects ---
	st.reset(); st.mode = "pc"; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}];
	st.play.exhaustion = 2; st.play.effects = ["Haste", "Bless"];
	const j = st.toJson(); st.reset(); st.fromJson(j);
	R.ser_exhaustion = st.play.exhaustion; R.ser_effects = st.play.effects;
	// old save with no exhaustion field gets default 0
	const j2 = {...j, play: {curHp: null, tempHp: 0}}; st.reset(); st.fromJson(j2); R.ser_oldDefault = st.play.exhaustion;

	ui._playMode = false; st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
const allFails = [...out.fails, ...Object.entries(out).filter(([k, v]) => v === false).map(([k]) => k)];
console.log("\nFAILURES:", allFails.length ? allFails : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
