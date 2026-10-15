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
	const goClass = () => { ui._ixStep = ui._steps().findIndex(s => s.id === "class"); };
	const render = (lbl) => { try { ui.render(); } catch (e) { uiErrs.push(`${lbl}: ${e.message}`); } };
	const lowAbil = () => { st.abilityMethod = "manual"; st.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8}; }; // meets no MC requirement

	// --- Single class: Remove returns to the chooser ---
	st.reset(); lowAbil(); st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}];
	st.spellChoices["Fighter|PHB"] = {cantrips: [], leveled: []};
	goClass(); render("single-render");
	ui._removeClass(0);
	R.afterRemove_classUid = st.classUid; // null
	R.afterRemove_classesLen = st.classes.length; // 1 (placeholder uid null)
	R.afterRemove_placeholderNull = st.classes[0].uid === null;

	// --- Single class: Change to a different class, keep level, clear old choices ---
	st.reset(); lowAbil(); st.classes = [{uid: "Fighter|PHB", level: 7, subclassUid: "Champion|PHB"}];
	st.spellChoices["Fighter|PHB"] = {cantrips: ["x"], leveled: []};
	st.classSkillChoices = ["athletics"]; st.asiChoices["Fighter|PHB@4"] = {type: "asi"};
	ui._changeClass(0, "Wizard|PHB");
	R.changed_uid = st.classUid; // Wizard|PHB
	R.changed_level = st.classes[0].level; // 7 kept
	R.changed_subReset = st.classes[0].subclassUid; // null
	R.changed_oldSpellsGone = !st.spellChoices["Fighter|PHB"];
	R.changed_skillsReset = st.classSkillChoices.length; // 0
	R.changed_asiGone = !st.asiChoices["Fighter|PHB@4"];

	// --- Change mode renders a chooser; primary (ix 0) is UNFILTERED even with low abilities ---
	st.reset(); lowAbil(); st.classes = [{uid: "Fighter|PHB", level: 3, subclassUid: null}];
	ui._changeClassIx = 0; goClass(); render("change-primary");
	R.changeMode_heading = ui._eleRoot.textContent.includes("Change class");
	const allClasses = st.filterVisible(data.classData.classes).length;
	// count pick rows in the chooser list
	R.changeMode_optionCount = ui._eleRoot.querySelectorAll(".cb__pick").length;
	R.changeMode_showsAll = R.changeMode_optionCount === allClasses; // primary change shows every class
	ui._changeClassIx = null;

	// --- Multiclass: secondary change is filtered by MC requirement ---
	st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 15, dex: 15, con: 14, int: 10, wis: 13, cha: 10};
	st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}, {uid: "Rogue|PHB", level: 1, subclassUid: null}];
	ui._changeClassIx = 1; goClass(); render("change-secondary");
	R.changeSecondary_options = ui._eleRoot.querySelectorAll(".cb__pick").length;
	R.changeSecondary_lessThanAll = R.changeSecondary_options < allClasses; // filtered
	ui._changeClassIx = null;

	// --- Remove secondary class works ---
	st.reset(); st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}, {uid: "Wizard|PHB", level: 2, subclassUid: null}];
	ui._removeClass(1);
	R.removeSecondary_len = st.classes.length; // 1
	R.removeSecondary_primary = st.classUid; // Fighter|PHB

	// --- Class row shows Change + Remove buttons for a single class ---
	st.reset(); st.classes = [{uid: "Fighter|PHB", level: 3, subclassUid: null}];
	ui._changeClassIx = null; goClass(); render("row-buttons");
	R.row_hasChangeBtn = [...ui._eleRoot.querySelectorAll("button")].some(b => /Change/.test(b.textContent));
	R.row_hasRemoveBtn = [...ui._eleRoot.querySelectorAll("button .glyphicon-remove")].length > 0;

	R.ui_errors = uiErrs;
	st.reset(); ui._changeClassIx = null;
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
