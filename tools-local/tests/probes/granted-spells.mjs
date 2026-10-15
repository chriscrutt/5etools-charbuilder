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
	const setup = (clsUid, lvl, subUid) => { st.reset(); st.hiddenSources = []; st.hideLegacy = false; st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 12, con: 14, int: 16, wis: 16, cha: 16}; st.classes = [{uid: clsUid, level: lvl, subclassUid: subUid || null}]; };
	const subUid = (cn, scn) => { const sc = data.classData.subclasses.find(x => x.className === cn && x.name === scn); return sc ? `${sc.name}|${sc.source}` : null; };
	const src0 = () => st.spellSources()[0];

	// --- Subclass: Light Domain (Cleric 5) — bonus cantrip (known) + always-prepared ---
	setup("Cleric|PHB", 5, subUid("Cleric", "Light Domain"));
	{
		const info = st.subclassSpellInfo(src0());
		R.light_known = info.knownFixed.map(s => s.name); // ["Light"]
		R.light_prepared = info.prepared.map(p => `${p.sp.name}@${p.level}`); // burning hands@1 ... fireball@5
		R.light_inList = st.spellListForSource(src0()).some(s => s.name === "Light");
	}

	// --- Subclass: Totem Barbarian (5) — innate ritual spells ---
	setup("Barbarian|PHB", 5, subUid("Barbarian", "Path of the Totem Warrior"));
	{
		const sc = src0() || {subclassEnt: st.subclassEnt, level: 5}; // Barbarian isn't a caster source; build a pseudo-src
		const pseudo = {subclassEnt: st.subclassEnt, level: 5};
		const info = st.subclassSpellInfo(pseudo);
		R.totem_innate = info.innate.map(i => `${i.sp.name} (${i.freq})`); // Beast Sense (ritual), Speak with Animals (ritual)
	}

	// --- Subclass: Lore Bard (6) — Additional Magical Secrets (knownChoose, multi-level any class) ---
	setup("Bard|PHB", 6, subUid("Bard", "College of Lore"));
	{
		const info = st.subclassSpellInfo(src0());
		R.lore_chooseCount = info.knownChoose.length; // 2
		const g = info.knownChoose[0];
		R.lore_filter = g?.filter; // "level=0;1;2;3"
		const opts = g ? st.racialSpellOptions(g.filter) : [];
		R.lore_optLevels = [...new Set(opts.map(s => s.level))].sort(); // [0,1,2,3]
		R.lore_optN = opts.length;
	}

	// --- Background: Azorius Functionary + Bard — expanded spells added to list ---
	setup("Bard|PHB", 5, subUid("Bard", "College of Lore"));
	st.backgroundUid = (() => { const bg = data.backgrounds.find(x => x.name === "Azorius Functionary" && x.source === "GGR"); return bg ? `${bg.name}|${bg.source}` : null; })();
	{
		const bg = st.backgroundSpellsInfo();
		R.azorius_expandedN = bg ? bg.expanded.length : null;
		R.azorius_inList_hold = st.spellListForSource(src0()).some(s => s.name === "Hold Person"); // s2 expanded
		R.azorius_inList_dominate = st.spellListForSource(src0()).some(s => s.name === "Dominate Person"); // s5 — Bard5 max spell lvl 3, should be EXCLUDED
	}

	// --- Race: Mark of Warding (Dwarf) + Wizard — known + expanded ---
	setup("Wizard|PHB", 5);
	st.raceUid = (() => { const r = data.races.find(x => x.name === "Dwarf (Mark of Warding)" && x.source === "ERLW"); return r ? `${r.name}|${r.source}` : null; })();
	{
		const rs = st.racialSpellsInfo();
		R.warding_known = rs ? rs.knownFixed.map(s => s.name) : null; // Alarm, Mage Armor
		R.warding_expandedN = rs ? rs.expanded.length : null;
		R.warding_inList_knock = st.spellListForSource(src0()).some(s => s.name === "Knock"); // s2 expanded -> in Wizard5 list
	}

	// --- Feat: Mark of Detection — |source suffix + nested-freq prepared (=innate) + expanded ---
	setup("Wizard|PHB", 5);
	const feat = data.feats.find(f => f.name === "Mark of Detection");
	if (feat) {
		const k = st.asiSlots()[0]?.key;
		// give an ASI slot: Wizard 4 has one; level 5 has the L4 slot
		setup("Wizard|PHB", 4);
		const key = st.asiSlots()[0]?.key;
		st.asiChoices[key] = {type: "feat", featUid: `${feat.name}|${feat.source}`, featAbilChoose: [], featSpellGroup: 0, featSpellChoose: {}};
		const info = st.featSpellsInfo(feat, st.asiChoices[key]);
		R.detection_innate = info.innate.map(i => `${i.sp.name} (${i.freq})`); // Detect Magic (1/day), See Invisibility (1/day at L3)
		R.detection_expandedN = info.expanded.length;
		R.detection_seeInvisResolved = info.innate.some(i => /Invisibility/i.test(i.sp.name)); // |xphb suffix resolved
	} else R.detection = "MISSING_FEAT";

	// --- _spellByName strips |source ---
	R.byName_pipe = !!st._spellByName("see invisibility|xphb");
	R.byName_hash = !!st._spellByName("light#c");

	// --- classSubclassSpellInfos covers a non-caster subclass (Totem) ---
	setup("Barbarian|PHB", 5, subUid("Barbarian", "Path of the Totem Warrior"));
	R.totem_inReview = st.classSubclassSpellInfos().length; // 1 (innate rituals)

	// --- UI smoke: spell step + review for each granting source, no errors ---
	const uiErrs = [];
	const renderSteps = (ids) => ids.forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); if (ix < 0) { uiErrs.push(`${id}: step missing`); return; } try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });

	// Light Domain Cleric: spell step shows bonus + review
	setup("Cleric|PHB", 5, subUid("Cleric", "Light Domain"));
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	renderSteps(["spells", "review"]);
	R.ui_light_bonus = pg._ui._eleRoot.textContent.includes("Bonus spells");
	R.ui_light_reviewSubclass = pg._ui._eleRoot.textContent.includes("Subclass Spells");

	// Lore Bard: knownChoose picker renders + can store a pick
	setup("Bard|PHB", 6, subUid("Bard", "College of Lore"));
	renderSteps(["spells"]);
	const loreInfo = st.subclassSpellInfo(st.spellSources()[0]);
	const lk = loreInfo.knownChoose[0]?.key;
	if (lk) { st.subclassSpellChoices[lk] = ["Counterspell"]; }
	renderSteps(["spells", "review"]);
	R.ui_lore_stored = lk ? (st.subclassSpellChoices[lk]?.length === 1) : null;

	// Azorius Bard: background spells section
	setup("Bard|PHB", 5, subUid("Bard", "College of Lore"));
	st.backgroundUid = (() => { const bg = data.backgrounds.find(x => x.name === "Azorius Functionary" && x.source === "GGR"); return bg ? `${bg.name}|${bg.source}` : null; })();
	renderSteps(["spells", "review"]);
	R.ui_bg_section = pg._ui._eleRoot.textContent.includes("Background Spells");

	// Totem Barbarian review (non-caster: no spell step, but review shows Subclass Spells)
	setup("Barbarian|PHB", 5, subUid("Barbarian", "Path of the Totem Warrior"));
	st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	renderSteps(["review"]);
	R.ui_totem_review = pg._ui._eleRoot.textContent.includes("Beast Sense");

	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
