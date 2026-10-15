import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const fails = [];
	const eq = (label, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) fails.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); };
	const base = () => { st.reset(); st.mode = "pc"; ui._playMode = false; st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 14, con: 14, int: 15, wis: 13, cha: 10}; st.raceUid = null; };

	// ---- exact-value spot checks ----
	// Wizard 5: PB +3, slots 4/3/2, DC = 8 + 3 + int(+2) = 13
	base(); st.classes = [{uid: "Wizard|PHB", level: 5, subclassUid: null}];
	eq("wiz5.pb", st.profBonus, 3);
	eq("wiz5.slots", st.spellSlots(), {1: 4, 2: 3, 3: 2});
	eq("wiz5.dc", st.spellSaveDcFor(st.spellSources()[0]), 13);
	eq("wiz5.atk", st.spellAtkBonusFor(st.spellSources()[0]), 5);

	// Fighter 5 unarmored: AC = 10 + dex(+2) = 12; with subclass Champion no change
	base(); st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: "Champion|PHB"}];
	eq("fig5.acUnarmored", st.ac(), 12);
	eq("fig5.pb", st.profBonus, 3);
	eq("fig5.numAttacks", st.numAttacks(), 2); // Extra Attack at 5

	// Barbarian 5 unarmored defense: 10 + dex(+2) + con(+2) = 14
	base(); st.classes = [{uid: "Barbarian|PHB", level: 5, subclassUid: null}];
	eq("barb5.acUnarmored", st.ac(), 14);

	// Monk 5 unarmored defense: 10 + dex(+2) + wis(+1) = 13
	base(); st.classes = [{uid: "Monk|PHB", level: 5, subclassUid: null}];
	eq("monk5.acUnarmored", st.ac(), 13);

	// Multiclass Wizard 6 / Cleric 3 = caster level 9 combined slots
	base(); st.classes = [{uid: "Wizard|PHB", level: 6, subclassUid: null}, {uid: "Cleric|PHB", level: 3, subclassUid: null}];
	eq("mc.casterLvl.slots", st.spellSlots(), {1: 4, 2: 3, 3: 3, 4: 3, 5: 1});
	eq("mc.totalLevel", st.totalLevel, 9);

	// Warlock 5 pact magic: 2 slots of level 3
	base(); st.classes = [{uid: "Warlock|PHB", level: 5, subclassUid: null}];
	eq("warlock5.pact", st.pactSlots(), {3: 2});

	// Passive Perception with proficiency: Cleric (Perception not auto) — use a build w/ known prof via skill choice
	base(); st.classes = [{uid: "Ranger|PHB", level: 1, subclassUid: null}]; st.classSkillChoices = ["perception", "stealth"];
	// PP = 10 + wis(+1) + PB(+2) = 13
	eq("ranger.passivePerc", st.passiveScore("perception"), 13);

	// HP: Fighter 1 (d10) con+2 = 12; Sorcerer 1 (d6) con+2 = 8
	base(); st.classes = [{uid: "Fighter|PHB", level: 1, subclassUid: null}]; eq("fig1.hp", st.maxHp(), 12);
	base(); st.classes = [{uid: "Sorcerer|PHB", level: 1, subclassUid: null}]; eq("sorc1.hp", st.maxHp(), 8);

	// ---- DOM interaction click-through ----
	const ix = (id) => ui._steps().findIndex(s => s.id === id);
	const click = (sel, root = ui._eleRoot) => { const el = root.querySelector(sel); if (!el) return false; el.click(); return true; };
	st.reset(); ui._ixStep = 0; ui._playMode = false; ui.render();
	const dom = {};
	// race step: click the first creature/race pick row
	dom.raceStepHasPicks = !!ui._eleRoot.querySelector(".cb__pick");
	dom.raceClicked = click(".cb__pick");
	dom.raceSet = !!st.raceUid;
	// class step
	ui._ixStep = ix("class"); ui.render();
	dom.classClicked = click(".cb__pick");
	dom.classSet = !!st.classUid;
	// background step
	ui._ixStep = ix("background"); ui.render();
	dom.bgClicked = click(".cb__pick");
	dom.bgSet = !!st.backgroundUid;
	// review renders
	ui._ixStep = ix("review"); ui.render();
	dom.reviewText = (ui._eleRoot.textContent || "").length > 200;

	// play mode: take damage via the real button
	ui._playMode = true; ui.render();
	const hp0 = st.playCurHp();
	const inp = ui._eleRoot.querySelector('input[type="number"]'); if (inp) { inp.value = "5"; }
	const dmgBtn = [...ui._eleRoot.querySelectorAll("button")].find(x => /Damage/.test(x.textContent));
	if (dmgBtn) dmgBtn.click();
	dom.damageApplied = st.playCurHp() === hp0 - 5;
	ui._playMode = false;

	// sidekick mode: toggle + pick creature + class via DOM
	st.mode = "sidekick"; ui._skStep = 0; ui.render();
	dom.skCreatureClicked = click(".cb__pick");
	dom.skCreatureSet = !!st.sidekick.creatureUid;
	ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "class"); ui.render();
	// class cards aren't .cb__pick; click the first card (a div with cursor:pointer containing a class link)
	const card = [...ui._eleRoot.querySelectorAll("div")].find(d => /Expert|Warrior|Spellcaster/.test(d.textContent) && d.style.cursor === "pointer");
	if (card) card.click();
	dom.skClassSet = !!st.sidekick.classUid;
	ui._skStep = ui._sidekickSteps().findIndex(s => s.id === "review"); ui.render();
	dom.skReviewText = (ui._eleRoot.textContent || "").includes("Hit Points");

	Object.entries(dom).forEach(([k, v]) => { if (v !== true) fails.push(`dom.${k} = ${v}`); });

	st.reset(); st.mode = "pc";
	return {fails, dom};
});

console.log("DOM interaction:", JSON.stringify(out.dom, null, 1));
console.log("\nFAILURES:", out.fails.length);
out.fails.forEach(f => console.log("  ✗ " + f));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
