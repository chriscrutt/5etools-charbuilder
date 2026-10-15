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
	const uid = (e) => `${e.name}|${e.source}`;
	const cre = (n) => data.bestiary.find(m => m.name === n);
	const skcls = (n) => data.sidekickClasses.find(c => c.name === n);
	const setSK = (cn, cls, level, extra = {}) => { st.reset(); st.mode = "sidekick"; ui._playMode = true; st.sidekick = {...st._defaultSidekick(), creatureUid: uid(cre(cn)), classUid: uid(skcls(cls)), level, ...extra}; };
	const renderPlay = () => { try { ui.render(); } catch (e) { fails.push(`render: ${e.message}`); } return ui._eleRoot.textContent || ""; };

	// --- render every class at every level: sections present, no dirty text ---
	["Warrior Sidekick", "Expert Sidekick", "Spellcaster Sidekick"].forEach(cls => {
		[1, 5, 11, 20].forEach(level => {
			setSK(cls === "Spellcaster Sidekick" ? "Guard" : "Wolf", cls, level);
			const txt = renderPlay();
			const label = `${cls.split(" ")[0]} L${level}`;
			["Hit Points", "Rest, Hit Dice", "Conditions", "Ability Checks", "Skills", "Class Features"].forEach(s => { if (!txt.includes(s)) fails.push(`${label}: missing ${s}`); });
			if (/NaN|\[object Object\]|\bundefined\b/.test(txt)) fails.push(`${label}: dirty text`);
		});
	});

	// --- HP: damage/heal ---
	setSK("Wolf", "Warrior Sidekick", 5);
	R.skMaxHp = st.skMaxHp(); // 31
	st.skApplyDamage(10); R.skAfterDmg = st.skCurHp();
	st.skApplyHealing(4); R.skAfterHeal = st.skCurHp();
	st.skSetTempHp(5); st.skApplyDamage(3); R.skTempAbsorb = st.skTempHp(); // 5-3=2

	// --- Hit Dice ---
	setSK("Wolf", "Warrior Sidekick", 5);
	const f = st.sidekickHitDie(); R.hdFaces = f; R.hdTotal = st.skHitDicePool()[f]; // 8, 5
	st.skSpendHitDie(f); R.hdRem = st.skHitDiceRemaining(f); // 4

	// --- Feature resources: Second Wind / Indomitable ---
	setSK("Wolf", "Warrior Sidekick", 2);
	let res = st.sidekickFeatureResources();
	R.warriorL2_features = res.map(r => `${r.name}:${r.max}`); // Second Wind:1
	st.skUseFeature("secondWind"); R.sw_used = st.skFeatureRemaining(res[0]); // 0
	st.skShortRest(); R.sw_afterShort = st.skFeatureRemaining(st.sidekickFeatureResources()[0]); // 1 (restored)
	setSK("Wolf", "Warrior Sidekick", 11);
	R.warriorL11_features = st.sidekickFeatureResources().map(r => `${r.name}:${r.max}`); // Second Wind:1, Indomitable:1
	setSK("Wolf", "Warrior Sidekick", 20);
	R.warriorL20_features = st.sidekickFeatureResources().map(r => `${r.name}:${r.max}`); // Second Wind:2, Indomitable:2
	// indomitable NOT restored by short rest, restored by long rest
	st.skUseFeature("indomitable"); st.skShortRest();
	R.indom_afterShort = st.skFeatureRemaining(st.sidekickFeatureResources().find(r => r.key === "indomitable")); // 1 (used 1 of 2)
	st.skLongRest(); R.indom_afterLong = st.skFeatureRemaining(st.sidekickFeatureResources().find(r => r.key === "indomitable")); // 2

	// --- Long rest restores HP + slots + half hit dice ---
	setSK("Wolf", "Warrior Sidekick", 8);
	st.skApplyDamage(20); for (let i = 0; i < 8; ++i) st.skSpendHitDie(st.sidekickHitDie());
	st.skLongRest();
	R.lr_hpFull = st.skCurHp() === st.skMaxHp();
	R.lr_hdRestored = st.skHitDiceRemaining(st.sidekickHitDie()); // 8 used, half(4) restored -> 4 remaining

	// --- Spellcaster slots + cast ---
	setSK("Guard", "Spellcaster Sidekick", 5, {spellRole: "mage", spellChoices: {cantrips: ["Fire Bolt|PHB"], leveled: ["Magic Missile|PHB"]}});
	R.skSlots = st.sidekickSpellProgress().slots;
	const mm = data.spells.find(s => s.name === "Magic Missile" && s.source === "PHB");
	const before = st.skSlotsRemaining(1); st.skCastSpell(mm); R.skCastUsed = st.skSlotsRemaining(1) === before - 1;

	// --- death saves on sidekick play state ---
	setSK("Wolf", "Warrior Sidekick", 5); st.skApplyDamage(999);
	R.sk_at0 = st.skCurHp() === 0;
	const txt0 = renderPlay(); R.sk_deathUi = txt0.includes("death saving throws") && ui._eleRoot.querySelectorAll(".cb__ds-pip").length === 6;

	// --- attacks: stat-block actions render with adjusted to-hit + clickable dice rollers ---
	setSK("Wolf", "Warrior Sidekick", 5, {martialRole: "attacker"});
	renderPlay();
	R.sk_attacksHaveRollers = ui._eleRoot.querySelectorAll(".ve-roller, [data-packed-dice]").length > 0; // {@hit}/{@damage} clickable
	R.sk_attacksHaveBite = (ui._eleRoot.textContent || "").includes("Bite");

	// --- serialization of sidekick play state ---
	setSK("Wolf", "Warrior Sidekick", 5); st.skApplyDamage(7); st.skSpendHitDie(st.sidekickHitDie()); st.skUseFeature("secondWind"); st.skPlay().conditions = ["Prone"]; st.skPlay().inspiration = true;
	const j = st.toJson(); st.reset(); st.fromJson(j);
	R.ser_curHp = st.skCurHp(); R.ser_cond = st.skPlay().conditions; R.ser_insp = st.skPlay().inspiration; R.ser_sw = st.skFeatureUsed("secondWind");

	// --- PC play still works (no regression from refactor) ---
	st.reset(); st.mode = "pc"; ui._playMode = true; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}]; st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10};
	let pcErr = null; try { ui.render(); } catch (e) { pcErr = e.message; }
	R.pcPlayOk = pcErr == null && (ui._eleRoot.textContent || "").includes("Hit Points");

	// --- DOM: click an ability roll, dice tray appears ---
	setSK("Wolf", "Warrior Sidekick", 5); renderPlay();
	const rollEl = ui._eleRoot.querySelector(".cb__roll");
	if (rollEl) rollEl.click();
	R.rollBox = !!document.querySelector(".rollbox");

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
