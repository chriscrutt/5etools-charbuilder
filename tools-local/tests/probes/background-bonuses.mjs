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
	const U = (e) => `${e.name}|${e.source}`;
	const bg = (n, s) => data.backgrounds.find(x => x.name === n && (!s || x.source === s)) || data.backgrounds.find(x => x.name === n);
	const R = {};

	// Background ability bonuses (weighted +2/+1). Acolyte XPHB: int/wis/cha
	const setup = () => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10}; };
	const acolyte = bg("Acolyte", "XPHB");
	if (acolyte) {
		setup(); st.backgroundUid = U(acolyte);
		R.acolyte_options = st.bgAbilityOptions().length; // 2 (2/1 and 1/1/1)
		// pick option 0 (2/1), assign +2 wis +1 cha
		st.bgAbilOption = 0; st.bgAbilWeighted = ["wis", "cha"];
		R.acolyte_wis = st.finalAbility("wis"); // 10 + 2 = 12
		R.acolyte_cha = st.finalAbility("cha"); // 10 + 1 = 11
		R.acolyte_fixedFeats = st.backgroundFixedFeats().map(f => f.name); // Magic Initiate; Cleric (if loaded)
	}

	// Background feat ability bonus: a fixed half-feat (find a 2024 bg whose feat grants ability) — Farmer -> Tough (no abil); test fixed feat presence
	const farmer = bg("Farmer", "XPHB");
	if (farmer) { setup(); st.backgroundUid = U(farmer); R.farmer_fixedFeats = st.backgroundFixedFeats().map(f => f.name); R.farmer_inFeatsTaken = st.featsTaken().some(t => t.className === "Background"); }

	// Background feat CHOICE (Haunted One -> Survivor fixed + a choose)
	const haunted = bg("Haunted One", "RHW") || data.backgrounds.find(x => x.name === "Haunted One" && x.feats);
	if (haunted) { setup(); st.backgroundUid = U(haunted); R.haunted_choice = st.backgroundFeatChoice(); R.haunted_fixed = st.backgroundFixedFeats().map(f => f.name); }

	// Language choose.from (Boros Legionnaire / Clan Crafter)
	const clan = bg("Clan Crafter", "SCAG");
	if (clan) { setup(); st.backgroundUid = U(clan); R.clan_langGroups = st.proficiencyChoiceGroups().filter(g => g.type === "language").map(g => g.label); }

	// 2014 Acolyte (PHB): NO ability/feat -> additive no-op
	const acolyte14 = bg("Acolyte", "PHB");
	setup(); st.backgroundUid = U(acolyte14);
	R.acolyte14_options = st.bgAbilityOptions().length; // 0
	R.acolyte14_str = st.finalAbility("str"); // 10 (unchanged)
	R.acolyte14_feature = (acolyte14.entries || []).filter(e => e && e.name && e.type === "entries").map(e => e.name);

	// UI smoke
	const uiErrs = [];
	[acolyte, farmer, clan, acolyte14].filter(Boolean).forEach(bgEnt => {
		setup(); st.backgroundUid = U(bgEnt); st.classes = [{uid: "Cleric|PHB", level: 3, subclassUid: null}]; st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
		["abilities", "skills", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${bgEnt.name}/${id}: ${e.message}`); } });
	});
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
