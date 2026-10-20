// A background whose `feats` lists alternatives (BMT's Ruined: Alert, Skilled or Tough) lets you pick
// ONE: nothing is granted until you choose, the choice has its own pickers (Skilled's proficiencies),
// and it's the only background feat afterwards.
import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page = await b.newPage(); await page.setCacheEnabled(false);
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.evaluate(() => { VetoolsConfig.set("styleSwitcher", "style", "classic"); VetoolsConfig.set("styleSwitcher", "isFrCanonOnly", false); });
await page.goto(BASE + "/charbuilder.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state", {timeout: 60000});

const r = await page.evaluate(() => {
	const ui = dbg_charBuilderPage._ui; const st = ui._state; const R = {};
	const bgFeats = () => st.featsTaken().filter(f => f.className === "Background").map(f => f.featUid);
	st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 10};
	st.raceUid = "Human|PHB"; st.classes = [{uid: "Fighter|PHB", level: 5, subclassUid: null}];
	st.backgroundUid = "Ruined|BMT"; st.bgFeat = {featUid: null, featAbilChoose: []};
	R.grantedBeforeChoosing = bgFeats();
	R.issueBefore = st.validationIssues().some(i => i.title === "Background feat");

	ui._playMode = false; ui._ixStep = ui._steps().findIndex(s => s.id === "abilities"); ui.render();
	const sel = [...ui._eleRoot.querySelectorAll("label")].find(l => /^Choose one/.test(l.textContent.trim()))?.querySelector("select");
	R.options = sel ? [...sel.options].map(o => o.textContent) : null;

	const hp0 = st.maxHp();
	const acrobaticsCount = () => (ui._eleRoot.textContent.match(/Acrobatics/g) || []).length;
	R.acrobaticsBefore = acrobaticsCount();
	const pick = (uidRe) => { const s = [...ui._eleRoot.querySelectorAll("label")].find(l => /^Choose one/.test(l.textContent.trim())).querySelector("select"); s.value = [...s.options].find(o => uidRe.test(o.value)).value; s.dispatchEvent(new Event("change", {bubbles: true})); };
	pick(/^skilled\|/i);
	R.afterSkilled = bgFeats();
	R.issueAfter = st.validationIssues().some(i => i.title === "Background feat");
	R.acrobaticsAfterSkilled = acrobaticsCount();
	const tool = st._toolOptions("ANY")[0];
	st.bgFeat.featSkillToolChoose = ["skill:acrobatics", "skill:arcana", `tool:${tool}`];
	R.skilledSkills = ["acrobatics", "arcana", "history"].map(k => `${k}=${st.skillProfType(k)}`);
	R.skilledTool = {tool, has: [...st.featToolProfs()].some(t => t.toLowerCase() === `${tool}`.toLowerCase())};
	pick(/^tough\|/i);
	R.afterTough = bgFeats();
	R.toughHpGain = st.maxHp() - hp0;
	R.saved = st.toJson().bgFeat?.featUid;
	st.reset();
	return R;
});

console.log(JSON.stringify(r, null, 2));
const F = []; const chk = (k, c) => { if (!c) F.push(k); };
chk(`nothing granted before choosing (${r.grantedBeforeChoosing})`, r.grantedBeforeChoosing.length === 0);
chk("a 'choose your background feat' warning shows until you pick", r.issueBefore && !r.issueAfter);
chk(`the picker offers exactly Alert, Skilled, Tough (${r.options})`, r.options && ["Alert", "Skilled", "Tough"].every(n => r.options.some(o => o.startsWith(n))) && r.options.length === 4);
chk(`picking Skilled gives just Skilled (${r.afterSkilled})`, r.afterSkilled.length === 1 && /^Skilled\|/i.test(r.afterSkilled[0]));
chk(`Skilled's own proficiency picker appears (Acrobatics mentions ${r.acrobaticsBefore} → ${r.acrobaticsAfterSkilled})`, r.acrobaticsAfterSkilled > r.acrobaticsBefore);
chk(`Skilled's picks become proficiencies (${r.skilledSkills})`, r.skilledSkills[0] === "acrobatics=full" && r.skilledSkills[1] === "arcana=full" && r.skilledSkills[2] === "history=none");
chk(`Skilled's tool pick counts (${JSON.stringify(r.skilledTool)})`, r.skilledTool.has);
chk(`switching to Tough replaces it (${r.afterTough})`, r.afterTough.length === 1 && /^Tough\|/i.test(r.afterTough[0]));
chk(`Tough adds 2 HP per level at level 5 (+${r.toughHpGain})`, r.toughHpGain === 10);
chk("the choice is saved", /^Tough\|/i.test(r.saved || ""));
console.log("\nFAILURES:", F.length ? F : "none");
console.log("page errors:", errs.length ? errs : "none");
await b.close();
process.exit(0);
