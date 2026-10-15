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
	const uid = (e) => `${e.name}|${e.source}`;
	const item = (n) => data.items.find(i => i.name === n) || data.items.find(i => i.name.startsWith(n));
	const R = {};
	const setup = () => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10}; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}]; };
	const wear = (it, attune = true) => { st.addToInventory({uid: uid(it), name: it.name}); const row = st.inventory.find(r => r.uid === uid(it)); row.equipped = true; if (attune && it.reqAttune) st.setAttuned(uid(it), true); };

	// Belt of Dwarvenkind -> +2 Con (flat)
	setup();
	const belt = item("Belt of Dwarvenkind");
	R.con_before = st.finalAbility("con"); // 12
	if (belt) { wear(belt); R.con_after = st.finalAbility("con"); R.belt_abilityField = belt.ability; } // 14

	// Ioun Stone of Agility -> +2 Dex
	setup();
	const ioun = item("Ioun Stone, Agility");
	if (ioun) { R.dex_before = st.finalAbility("dex"); wear(ioun); R.dex_after = st.finalAbility("dex"); } // 12 -> 14

	// Ioun Stone of Mastery -> +1 proficiency bonus
	setup();
	const mastery = item("Ioun Stone, Mastery");
	R.prof_before = st.profBonus; // +3 at level 5
	if (mastery) { wear(mastery); R.prof_after = st.profBonus; } // +4

	// Stone of Good Luck -> +1 to ability checks (skills)
	setup();
	const luck = item("Stone of Good Luck");
	if (luck) { const athBefore = st.skillMod("athletics"); wear(luck); R.luck_skillDelta = st.skillMod("athletics") - athBefore; } // +1

	// critThreshold weapon (Sword of Kas / Butcher's Bib): crit 19-20
	setup();
	const critWpn = data.items.find(i => i.critThreshold && i.weapon) || item("Sword of Kas");
	if (critWpn) { wear(critWpn); const a = st.weaponAttack(critWpn); R.critThreshold = a.critThreshold; }

	// item bonus NOT applied until attuned (Belt reqAttune)
	setup();
	if (belt) { wear(belt, false); R.con_unattuned = st.finalAbility("con"); } // 12 (not attuned)

	// UI smoke
	const uiErrs = [];
	setup(); if (belt) wear(belt); if (mastery) wear(mastery);
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	["abilities", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	// check Magic Item Effects items are links now
	R.miEffectsHasItemLink = !!pg._ui._eleRoot.querySelector('a[href*="items.html"]');
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
