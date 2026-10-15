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
	const names = (arr) => arr.map(it => it.spell ? it.spell.name : it.feature ? it.feature.name : it.action ? `${it.action}${it.suffix || ""}` : it.name);
	const base = (clsUid, sub) => { st.reset(); st.mode = "pc"; st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 14, con: 14, int: 14, wis: 12, cha: 10}; st.classes = [{uid: clsUid, level: 5, subclassUid: sub || null}]; };

	// --- Fighter 5: Extra Attack + Action Surge ---
	base("Fighter|PHB", "Champion|PHB");
	let o = st.turnOptions();
	R.fighter_action = names(o.action);
	R.fighter_hasExtraAttack = names(o.action).some(n => /2 attacks/.test(n));
	R.fighter_hasActionSurge = names(o.action).some(n => /Action Surge/.test(n));
	R.fighter_hasOA = names(o.reaction).includes("Opportunity Attack");

	// --- Rogue 5: Cunning Action (bonus) + hoverable classFeature ref ---
	base("Rogue|PHB", "Thief|PHB");
	const ro = st.turnOptions();
	R.rogue_bonus = names(ro.bonus); // includes Cunning Action
	R.cunningRef = ro.bonus.find(it => it.feature && it.feature.name === "Cunning Action")?.feature?.ref; // {@classFeature Cunning Action|Rogue|PHB|2}
	ui._playMode = true; try { ui.render(); } catch (e) { fails.push("rogue play: " + e.message); }
	R.ui_featureLink = !!ui._eleRoot.querySelector('a[href*="classes.html"]'); // Cunning Action is a hover link

	// --- Barbarian: Rage (bonus) ---
	base("Barbarian|PHB");
	R.barb_bonus = names(st.turnOptions().bonus); // includes Rage

	// --- Wizard with bonus/reaction spells ---
	base("Wizard|PHB", "School of Evocation|PHB");
	st.spellChoices["Wizard|PHB"] = {cantrips: ["Fire Bolt|PHB"], leveled: ["Shield|PHB", "Misty Step|PHB", "Magic Missile|PHB"]};
	o = st.turnOptions();
	R.wiz_bonus = names(o.bonus); // Misty Step
	R.wiz_reaction = names(o.reaction); // Shield + Opportunity Attack
	R.wiz_castAction = names(o.action).includes("Cast a Spell");

	// --- UI: "On Your Turn" section renders in PC play ---
	base("Fighter|PHB", "Battle Master|PHB"); ui._playMode = true;
	let err = null; try { ui.render(); } catch (e) { err = e.message; }
	R.ui_pcTurnSection = (ui._eleRoot.textContent || "").includes("On Your Turn");
	R.ui_actionLinks = ui._eleRoot.querySelectorAll('a[href*="actions.html"]').length; // hoverable {@action} links
	R.ui_buffsIsSelect = !!ui._eleRoot.querySelector('select option[value="__custom__"]'); // buffs now a <select> like conditions
	if (err) fails.push("pc render: " + err);
	if (/NaN|\[object Object\]|\bundefined\b/.test(ui._eleRoot.textContent || "")) fails.push("dirty pc turn text");

	// --- Sidekick: Expert (Helpful + Cunning Action = bonus), Spellcaster spells ---
	const uid = (e) => `${e.name}|${e.source}`;
	st.reset(); st.mode = "sidekick"; ui._playMode = true; st.sidekick = {...st._defaultSidekick(), creatureUid: uid(data.bestiary.find(m => m.name === "Guard")), classUid: "Expert Sidekick|TCE", level: 5};
	const so = st.sidekickTurnOptions();
	R.skExpert_bonus = names(so.bonus); // Helpful, Cunning Action
	R.skExpert_hasOA = names(so.reaction).includes("Opportunity Attack");
	R.skCunningRef = so.bonus.find(it => it.feature && it.feature.name === "Cunning Action")?.feature?.ref; // {@classFeature Cunning Action|Expert Sidekick|TCE|2}
	try { ui.render(); } catch (e) { fails.push("sk render: " + e.message); }
	R.ui_skTurnSection = (ui._eleRoot.textContent || "").includes("On Your Turn");
	R.ui_skFeatureLink = !!ui._eleRoot.querySelector('a[href*="classes.html"]'); // sidekick class feature link
	// sidekick with stat-block bonus/reaction (e.g. a creature that has them)
	const reactor = data.bestiary.find(m => (m.reaction || []).length);
	if (reactor) { st.sidekick.creatureUid = uid(reactor); R.skStatReaction = st.sidekickTurnOptions().reaction.length > 1; }

	ui._playMode = false; st.reset();
	R.fails = fails;
	return R;
});

console.log(JSON.stringify(out, null, 2));
const allFails = [...out.fails];
["fighter_hasExtraAttack", "fighter_hasActionSurge", "fighter_hasOA", "wiz_castAction"].forEach(k => { if (out[k] !== true) allFails.push(k); });
if (!out.rogue_bonus?.some(n => /Cunning Action/.test(n))) allFails.push("rogue Cunning Action");
if (!out.barb_bonus?.some(n => /Rage/.test(n))) allFails.push("barb Rage");
if (!out.wiz_bonus?.includes("Misty Step")) allFails.push("wiz Misty Step bonus");
if (!out.wiz_reaction?.includes("Shield")) allFails.push("wiz Shield reaction");
if (!out.skExpert_bonus?.some(n => /Helpful|Cunning/.test(n))) allFails.push("sk Expert bonus");
if (!out.ui_pcTurnSection || !out.ui_skTurnSection) allFails.push("turn section render");
console.log("\nFAILURES:", allFails.length ? allFails : "none");
console.log("page errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
