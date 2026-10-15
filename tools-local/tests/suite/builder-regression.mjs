import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false); page.setDefaultTimeout(0);
const errs = []; page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => VetoolsConfig.set("styleSwitcher", "style", "classic"));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const out = await page.evaluate(() => {
	const pg = globalThis.dbg_charBuilderPage; const ui = pg._ui; const st = ui._state; const data = globalThis.dbg_cb;
	const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
	const SKILLS = Object.keys(Parser.SKILL_TO_ATB_ABV);
	const num = (v) => typeof v === "number" && isFinite(v);
	const uid = (e) => `${e.name}|${e.source}`;
	const fails = []; const counts = {};
	const tick = (k) => counts[k] = (counts[k] || 0) + 1;

	const scan = (label, step) => {
		const txt = ui._eleRoot.textContent || "";
		if (/NaN/.test(txt)) fails.push(`[${step}] ${label}: NaN in output`);
		if (/\[object Object\]/.test(txt)) fails.push(`[${step}] ${label}: [object Object] in output`);
		if (/\bundefined\b/.test(txt)) fails.push(`[${step}] ${label}: 'undefined' in output`);
	};
	const renderCheck = (stepId, label) => {
		const ix = ui._steps().findIndex(s => s.id === stepId);
		if (ix < 0) return;
		try { ui._ixStep = ix; ui.render(); } catch (e) { fails.push(`[render:${stepId}] ${label}: ${e.message}`); return; }
		tick("renders"); scan(label, stepId);
	};
	const checkStats = (label) => {
		const bad = [];
		const hp = st.maxHp(); const ac = st.ac();
		if (!num(hp)) bad.push("maxHp=" + hp);
		if (!num(ac)) bad.push("ac=" + ac);
		else if (ac < 8 || ac > 30) bad.push(`ac_oob=${ac}`);
		if (!num(st.profBonus)) bad.push("profBonus");
		if (!num(st.initiative())) bad.push("init");
		if (!num(st.passiveScore("perception"))) bad.push("passivePerc");
		ABIL.forEach(a => { const v = st.finalAbility(a); if (!num(v) || v < 1 || v > 30) bad.push("abil:" + a + "=" + v); if (!num(st.saveMod(a))) bad.push("save:" + a); });
		SKILLS.forEach(s => { if (!num(st.skillMod(s))) bad.push("skill:" + s); });
		if (num(hp) && hp < st.level) bad.push(`hp<level (${hp}<${st.level})`);
		// full casters should have a non-empty spell list and slots
		st.spellSources().forEach(src => { if (st.maxSpellLevelForSource(src) > 0 && st.spellListForSource(src).length === 0) bad.push(`emptyspelllist:${src.name}`); });
		if (bad.length) fails.push(`[stats] ${label}: ${bad.join(", ")}`);
	};
	const hpTrack = {};

	const fixedRace = (data.races.find(r => r.name === "Human" && r.source === "PHB") || data.races.find(r => st.isVisible(r)));
	const fixedBg = (data.backgrounds.find(r => r.name === "Acolyte" && r.source === "PHB") || data.backgrounds.find(r => st.isVisible(r)));
	const baseSetup = () => { st.reset(); ui._playMode = false; ui._showSources = false; st.mode = "pc"; st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 14, con: 14, int: 13, wis: 12, cha: 10}; st.raceUid = fixedRace ? uid(fixedRace) : null; st.backgroundUid = fixedBg ? uid(fixedBg) : null; };

	// ---------- Sweep 1: every class at L1/5/11/20 (+ first subclass) ----------
	data.classData.classes.forEach(cls => {
		[1, 5, 11, 20].forEach(level => {
			baseSetup();
			st.classes = [{uid: uid(cls), level, subclassUid: null}];
			const gain = st.subclassGainLevel(cls);
			if (gain && level >= gain) { const subs = st.subclassesForClass(cls); if (subs.length) st.classes[0].subclassUid = uid(subs[0]); }
			const label = `${cls.name} L${level}`;
			tick("classBuilds"); checkStats(label);
			(hpTrack[cls.name] = hpTrack[cls.name] || {})[level] = st.maxHp();
			if (st.profBonus !== (2 + Math.floor((level - 1) / 4))) fails.push(`[pb] ${label}: profBonus ${st.profBonus} wrong for L${level}`);
			if (st.isCaster() && !st.spellSlots() && !st.pactSlots() && level >= 2) fails.push(`[slots] ${label}: caster has no spell slots`);
			["class", "abilities", "skills", "review"].forEach(s => renderCheck(s, label));
			if (st.isCaster() || st.hasRacialSpells()) renderCheck("spells", label);
			try { ui._playMode = true; ui.render(); tick("playRenders"); scan(label, "play"); ui._playMode = false; } catch (e) { fails.push(`[play] ${label}: ${e.message}`); }
		});
	});

	// ---------- Sweep 2: every subclass (at its gain level + a few levels) ----------
	data.classData.subclasses.filter(sc => st.isVisible(sc) && !sc.isReprinted).forEach(sc => {
		const cls = data.classData.classes.find(c => c.name === sc.className && c.source === sc.classSource);
		if (!cls) return;
		baseSetup();
		const gain = st.subclassGainLevel(cls) || 3;
		const level = Math.min(20, gain + 3);
		st.classes = [{uid: uid(cls), level, subclassUid: uid(sc)}];
		const label = `${sc.className}/${sc.name}`;
		tick("subclassBuilds"); checkStats(label);
		renderCheck("review", label);
		if (st.isCaster()) renderCheck("spells", label);
	});

	// ---------- Sweep 3: every race ----------
	data.races.filter(r => st.isVisible(r)).forEach(r => {
		baseSetup();
		st.raceUid = uid(r);
		st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: "Champion|PHB"}];
		const label = `Race ${r.name}|${r.source}`;
		tick("raceBuilds"); checkStats(label);
		renderCheck("race", label); renderCheck("abilities", label); renderCheck("review", label);
	});

	// ---------- Sweep 4: every background ----------
	data.backgrounds.filter(g => st.isVisible(g)).forEach(g => {
		baseSetup();
		st.backgroundUid = uid(g);
		st.classes = [{uid: "Rogue|PHB", level: 5, subclassUid: "Thief|PHB"}];
		const label = `BG ${g.name}|${g.source}`;
		tick("bgBuilds"); checkStats(label);
		renderCheck("background", label); renderCheck("abilities", label); renderCheck("review", label);
	});

	// ---------- Sweep 5: every feat (as an ASI on Fighter 4) ----------
	data.feats.filter(f => st.isVisible(f)).forEach(f => {
		baseSetup();
		st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: "Champion|PHB"}];
		const k = st.asiSlots()[0]?.key; if (!k) return;
		st.asiChoices[k] = {type: "feat", featUid: uid(f), featAbilChoose: []};
		const label = `Feat ${f.name}|${f.source}`;
		tick("featBuilds"); checkStats(label);
		renderCheck("abilities", label); renderCheck("review", label);
	});

	// ---------- Sweep 6: multiclass combos ----------
	[["Fighter|PHB", "Wizard|PHB"], ["Cleric|PHB", "Rogue|PHB"], ["Paladin|PHB", "Warlock|PHB"], ["Barbarian|PHB", "Druid|PHB"], ["Sorcerer|PHB", "Bard|PHB"], ["Ranger|PHB", "Monk|PHB"]].forEach(([a, c]) => {
		baseSetup(); st.abilitiesBase = {str: 15, dex: 15, con: 14, int: 14, wis: 14, cha: 14};
		st.classes = [{uid: a, level: 6, subclassUid: null}, {uid: c, level: 4, subclassUid: null}];
		const label = `MC ${a.split("|")[0]}/${c.split("|")[0]}`;
		tick("mcBuilds"); checkStats(label);
		if (st.totalLevel !== 10) fails.push(`[mc] ${label}: totalLevel ${st.totalLevel} != 10`);
		["class", "review"].forEach(s => renderCheck(s, label));
		if (st.isCaster()) renderCheck("spells", label);
	});

	// ---------- Sweep 7: sidekicks (3 classes × creatures × levels) ----------
	const creSamples = ["Wolf", "Guard", "Sage", "Commoner", "Acolyte", "Cat", "Giant Rat", "Bandit"].map(n => data.bestiary.find(m => m.name === n)).filter(Boolean);
	const SK_SAVE = {"Expert Sidekick": "dex", "Warrior Sidekick": "str", "Spellcaster Sidekick": "wis"};
	data.sidekickClasses.forEach(cls => {
		creSamples.forEach(m => {
			[1, 5, 11, 20].forEach(level => {
				st.reset(); st.mode = "sidekick"; ui._playMode = false;
				st.sidekick = {...st._defaultSidekick(), creatureUid: uid(m), classUid: uid(cls), level, saveProf: SK_SAVE[cls.name] || null, spellAbility: "int"};
				const label = `SK ${cls.name.split(" ")[0]}/${m.name} L${level}`;
				tick("skBuilds");
				const bad = [];
				if (!num(st.sidekickMaxHp())) bad.push("hp");
				if (!num(st.sidekickProfBonus())) bad.push("pb");
				ABIL.forEach(a => { if (!num(st.sidekickAbilityMod(a))) bad.push("abil:" + a); });
				SKILLS.forEach(s => { if (!num(st.sidekickSkillMod(s))) bad.push("skill:" + s); });
				if (bad.length) fails.push(`[sk-stats] ${label}: ${bad.join(",")}`);
				["creature", "class", "review"].forEach(s => { const ix = ui._sidekickSteps().findIndex(x => x.id === s); try { ui._skStep = ix; ui.render(); tick("skRenders"); scan(label, "sk:" + s); } catch (e) { fails.push(`[sk-render:${s}] ${label}: ${e.message}`); } });
			});
		});
	});

	// ---------- Sweep 8: serialization round-trip (complex builds) ----------
	const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	[() => { baseSetup(); st.classes = [{uid: "Wizard|PHB", level: 8, subclassUid: "School of Evocation|PHB"}, {uid: "Cleric|PHB", level: 3, subclassUid: "Life Domain|PHB"}]; st.spellChoices["Wizard|PHB"] = {cantrips: ["Fire Bolt|PHB"], leveled: ["Magic Missile|PHB"]}; }, () => { st.reset(); st.mode = "sidekick"; st.sidekick = {...st._defaultSidekick(), creatureUid: "Sage|CM", classUid: "Spellcaster Sidekick|TCE", level: 7, spellAbility: "int", spellChoices: {cantrips: ["Light|PHB"], leveled: []}}; }].forEach((fn, i) => {
		fn(); const j1 = st.toJson(); st.reset(); st.fromJson(j1); const j2 = st.toJson();
		tick("serTests"); if (!deepEq(j1, j2)) fails.push(`[serialize#${i}]: round-trip mismatch`);
	});

	// HP monotonicity across levels per class
	Object.entries(hpTrack).forEach(([cn, lv]) => { if (lv[1] != null && lv[20] != null && !(lv[20] > lv[11] && lv[11] > lv[5] && lv[5] > lv[1])) fails.push(`[hp-mono] ${cn}: ${lv[1]}/${lv[5]}/${lv[11]}/${lv[20]} not increasing`); });

	// ---------- Sweep 9: empty state renders every step ----------
	st.reset();
	ui._steps().forEach(s => renderCheck(s.id, "EMPTY"));
	st.mode = "sidekick"; ui._sidekickSteps().forEach(s => { const ix = ui._sidekickSteps().findIndex(x => x.id === s.id); try { ui._skStep = ix; ui.render(); } catch (e) { fails.push(`[empty-sk:${s.id}]: ${e.message}`); } });
	st.reset();

	return {counts, failCount: fails.length, fails: fails.slice(0, 80)};
});

console.log("Counts:", JSON.stringify(out.counts));
console.log("\nFAILURES:", out.failCount);
out.fails.forEach(f => console.log("  ✗ " + f));
console.log("\npage errors:", errs.length ? errs.slice(0, 20) : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
