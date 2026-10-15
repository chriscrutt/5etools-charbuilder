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
	const st = pg._ui._state; const ui = pg._ui; const data = globalThis.dbg_cb;
	const uid = (e) => `${e.name}|${e.source}`;
	const byClass = (n) => data.classData.classes.find(c => c.name === n && c.source === "PHB") || data.classData.classes.find(c => c.name === n);
	const itemByName = (n, src) => data.items.find(it => it.name === n && (!src || it.source === src)) || data.items.find(it => it.name === n);
	const wield = (n, src) => { const it = itemByName(n, src); if (!it) return null; st.addToInventory({uid: uid(it), name: it.name}); const row = st.inventory.find(r => r.uid === uid(it)); row.equipped = true; return it; };
	const R = {};

	// Fighter (martial prof) Str 18 (+4), Dex 14 (+2), level 5 (prof +3)
	st.reset(); st.abilityMethod = "manual";
	st.abilitiesBase = {str: 18, dex: 14, con: 12, int: 10, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Fighter")), level: 5, subclassUid: null}];
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;

	R.f_prof = [...st.weaponProficiencies().cats]; // [simple, martial]
	// Longsword (martial, versatile 1d8/1d10, slashing) -> str
	wield("Longsword", "PHB");
	let a = st.weaponAttack(itemByName("Longsword", "PHB"));
	R.longsword = {toHit: a.toHit, prof: a.prof, ability: a.ability, dmg1: st.fmtWeaponDamage(a.dmg1, a), dmg2: st.fmtWeaponDamage(a.dmg2, a)}; // +4str+3prof=+7; 1d8+4 / 1d10+4
	// Rapier (finesse) -> uses better of Str/Dex => Str 18
	let r = st.weaponAttack(itemByName("Rapier", "PHB"));
	R.rapier = {toHit: r.toHit, ability: r.ability}; // finesse, str>=dex -> str -> +7
	// Shortbow (ranged) -> dex
	let sb = st.weaponAttack(itemByName("Shortbow", "PHB"));
	R.shortbow = {toHit: sb.toHit, ability: sb.ability, dmg: st.fmtWeaponDamage(sb.dmg1, sb)}; // +2dex+3prof=+5; 1d6+2 piercing
	// Magic: Dwarven Thrower (+3, martial, versatile) -> +4+3prof+3magic=+10; dmg 1d8+4+3=+7
	const dt = wield("Dwarven Thrower", "DMG");
	R.dwarvenThrowerFound = !!dt;
	if (dt) { let d = st.weaponAttack(dt); R.dwarvenThrower = {toHit: d.toHit, dmg: st.fmtWeaponDamage(d.dmg1, d), magic: d.magic}; }

	// Wizard (only specific simple weapons: dagger/dart/sling/quarterstaff/light crossbow)
	st.reset(); st.abilityMethod = "manual";
	st.abilitiesBase = {str: 8, dex: 16, con: 12, int: 16, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Wizard")), level: 1, subclassUid: null}];
	R.wiz_names = [...st.weaponProficiencies().names];
	const dag = st.weaponAttack(itemByName("Dagger", "PHB"));
	R.wiz_dagger = {toHit: dag.toHit, prof: dag.prof, ability: dag.ability}; // dagger finesse, dex16(+3) better; prof yes(+2) -> +5
	const ls = st.weaponAttack(itemByName("Longsword", "PHB"));
	R.wiz_longsword = {toHit: ls.toHit, prof: ls.prof}; // not proficient -> no prof bonus: str-1 -> -1
	// magic weapon proficiency follows base item: "Dagger of Venom" baseItem dagger -> proficient
	const dov = itemByName("Dagger of Venom");
	R.wiz_daggerOfVenom_prof = dov ? st.weaponAttack(dov).prof : null;

	// UI smoke: render review + skills with wielded weapons
	st.reset(); st.abilityMethod = "manual";
	st.abilitiesBase = {str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10};
	st.classes = [{uid: uid(byClass("Fighter")), level: 3, subclassUid: null}];
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	st.backgroundUid = data.backgrounds[0] ? `${data.backgrounds[0].name}|${data.backgrounds[0].source}` : null;
	wield("Longsword", "PHB"); wield("Shortbow", "PHB");
	const uiErrs = [];
	["skills", "review"].forEach(id => { const ix = ui._steps().findIndex(s => s.id === id); try { ui._ixStep = ix; ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.ui_errors = uiErrs;
	R.wieldedCount = st.wieldedWeapons().length;

	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
