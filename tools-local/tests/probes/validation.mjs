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
	const R = {}; const uiErrs = [];
	const uid = (e) => `${e.name}|${e.source}`;
	const takeFeat = (feat) => { const k = st.asiSlots()[0]?.key; st.asiChoices[k] = {type: "feat", featUid: uid(feat), featAbilChoose: []}; return k; };
	const stepIssues = (id) => st.validationIssues().filter(i => i.step === id);

	// --- A) ability-prereq feat (e.g. Str 13) becomes invalid when the ability drops ---
	const abilFeat = data.feats.find(f => f.prerequisite?.some(p => p.ability) && !f.prerequisite.some(p => p.race || p.spellcasting));
	if (abilFeat) {
		const req = abilFeat.prerequisite.find(p => p.ability).ability[0]; const [ab, sc] = Object.entries(req)[0];
		st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8}; st.abilitiesBase[ab] = sc; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}];
		takeFeat(abilFeat);
		R.A_feat = abilFeat.name; R.A_metWhenHigh = st.meetsFeatPrereq(abilFeat); // true
		st.abilitiesBase[ab] = sc - 2; // drop below requirement
		R.A_metWhenLow = st.meetsFeatPrereq(abilFeat); // false
		R.A_issue = st.validationIssues().some(i => i.title === abilFeat.name && i.step === "abilities");
	} else R.A = "NO_ABIL_FEAT";

	// --- B) spellcasting-prereq feat invalid after dropping a casting subclass (ASI slot stays valid) ---
	// pick a feat whose ONLY checkable prereq is spellcasting (so abilities don't independently fail it)
	const spellFeat = data.feats.find(f => f.name === "War Caster") || data.feats.find(f => f.prerequisite?.length === 1 && Object.keys(f.prerequisite[0]).length === 1 && /spellcasting/i.test(Object.keys(f.prerequisite[0])[0]));
	if (spellFeat) {
		const ek = data.classData.subclasses.find(s => s.className === "Fighter" && s.name === "Eldritch Knight");
		st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10}; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: ek ? `${ek.name}|${ek.source}` : null}];
		takeFeat(spellFeat);
		R.B_feat = spellFeat.name; R.B_metAsEK = st.meetsFeatPrereq(spellFeat); // true (EK casts)
		st.classes[0].subclassUid = "Champion|PHB"; // drop the casting subclass; same ASI slot Fighter|PHB@4
		R.B_metAsChampion = st.meetsFeatPrereq(spellFeat); // false
		R.B_issue = st.validationIssues().some(i => i.title === spellFeat.name);
	} else R.B = "NO_SPELL_FEAT";

	// --- C) race-prereq feat invalid after changing race ---
	const raceFeat = data.feats.find(f => f.prerequisite?.some(p => p.race));
	if (raceFeat) {
		const reqRace = raceFeat.prerequisite.find(p => p.race).race[0].name; // e.g. "elf"
		const matching = data.races.find(r => r.name.toLowerCase().includes(`${reqRace}`.toLowerCase()));
		const nonMatching = data.races.find(r => !r.name.toLowerCase().includes(`${reqRace}`.toLowerCase()) && !/elf/i.test(r.name));
		st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16}; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}];
		st.raceUid = matching ? uid(matching) : null;
		takeFeat(raceFeat);
		R.C_feat = raceFeat.name; R.C_reqRace = reqRace; R.C_metMatching = st.meetsFeatPrereq(raceFeat); // true
		st.raceUid = nonMatching ? uid(nonMatching) : null;
		R.C_metNonMatching = st.meetsFeatPrereq(raceFeat); // false
		R.C_issue = st.validationIssues().some(i => i.title === raceFeat.name);
	} else R.C = "NO_RACE_FEAT";

	// --- D) multiclass requirement issue when ability too low ---
	st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 8, dex: 8, con: 14, int: 8, wis: 8, cha: 8}; // Wizard needs Int 13
	st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}, {uid: "Wizard|PHB", level: 1, subclassUid: null}];
	R.D_issueLowInt = stepIssues("class").length; // >=1
	st.abilitiesBase.int = 13; st.abilitiesBase.str = 13; // meet both Fighter(Str13/Dex13) and Wizard(Int13)
	st.abilitiesBase.dex = 13;
	R.D_issueAfterFix = stepIssues("class").length; // 0

	// --- E) level > 20 error ---
	st.reset(); st.classes = [{uid: "Fighter|PHB", level: 21, subclassUid: null}];
	R.E_levelError = st.validationIssues().some(i => i.severity === "error" && i.step === "class");

	// --- F) valid character: no issues ---
	st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8}; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: "Champion|PHB"}];
	R.F_noIssues = st.validationIssues().length; // 0

	// --- UI: warning step + banner ---
	if (abilFeat) {
		const req = abilFeat.prerequisite.find(p => p.ability).ability[0]; const [ab, sc] = Object.entries(req)[0];
		st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8}; st.abilitiesBase[ab] = sc; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}];
		takeFeat(abilFeat); st.abilitiesBase[ab] = sc - 2; // now invalid
		ui._ixStep = ui._steps().findIndex(s => s.id === "class"); // view a different step so abilities shows --warn
		try { ui.render(); } catch (e) { uiErrs.push("warnstep: " + e.message); }
		R.UI_warnStep = ui._eleRoot.querySelectorAll(".cb__step--warn").length >= 1;
		ui._ixStep = ui._steps().findIndex(s => s.id === "abilities");
		try { ui.render(); } catch (e) { uiErrs.push("banner: " + e.message); }
		R.UI_banner = ui._eleRoot.textContent.includes("compatibility issue");
		ui._ixStep = ui._steps().findIndex(s => s.id === "review");
		try { ui.render(); } catch (e) { uiErrs.push("review: " + e.message); }
		R.UI_reviewBanner = ui._eleRoot.textContent.includes("compatibility issue");
	}
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
