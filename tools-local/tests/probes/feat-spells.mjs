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
	const feat = (n, s) => data.feats.find(f => f.name === n && (!s || f.source === s)) || data.feats.find(f => f.name === n);
	const R = {};
	const setup = () => { st.reset(); st.abilityMethod = "manual"; st.abilitiesBase = {str: 14, dex: 12, con: 14, int: 13, wis: 10, cha: 16}; st.classes = [{uid: "Fighter|PHB", level: 4, subclassUid: null}]; };
	const key = () => st.asiSlots()[0]?.key;
	const take = (n, s, extra = {}) => { setup(); const k = key(); st.asiChoices[k] = {type: "feat", featUid: uid(feat(n, s)), featAbilChoose: [], featSpellGroup: 0, featSpellChoose: {}, ...extra}; return st.asiChoices[k]; };
	const slim = (info) => ({
		groups: info.groups?.length, groupIx: info.groupIx, ability: info.ability,
		knownFixed: (info.knownFixed || []).map(sp => sp.name),
		knownChoose: (info.knownChoose || []).map(g => ({key: g.key, count: g.count, filter: g.filter, freq: g.freq || null})),
		innate: (info.innate || []).map(i => `${i.sp.name} (${i.freq})`),
	});

	R.asiSlotKey = key();

	// Magic Initiate
	const mi = feat("Magic Initiate", "PHB");
	if (mi) {
		const ch = take("Magic Initiate", "PHB");
		R.mi = slim(st.featSpellsInfo(mi, ch));
		R.mi_labels = st.featSpellsInfo(mi, ch).groups?.map(g => { try { return st.racialSpellGroupLabel(g); } catch { return "?"; } });
		// pick a variant that exists; just exercise group switching to last index
		const n = R.mi.groups || 1; ch.featSpellGroup = n - 1;
		R.mi_last = slim(st.featSpellsInfo(mi, ch));
		R.mi_dc_last = st.featSpellSaveDc(R.mi_last.ability);
	} else R.mi = "MISSING";

	// Fey Touched: Misty Step fixed-innate + 1 enchant/divination choose; ability inherit
	const ft = feat("Fey Touched", "TCE");
	if (ft) {
		const ch = take("Fey Touched", "TCE", {featAbilChoose: ["cha"]});
		R.ft = slim(st.featSpellsInfo(ft, ch));
		R.ft_dc = st.featSpellSaveDc(R.ft.ability);
		const g = (st.featSpellsInfo(ft, ch).knownChoose || [])[0];
		if (g) { const opts = st.racialSpellOptions(g.filter); R.ft_choose_n = opts.length; R.ft_choose_schools = [...new Set(opts.map(sp => sp.school))]; }
	} else R.ft = "MISSING";

	// Shadow Touched
	const sh = feat("Shadow Touched", "TCE");
	if (sh) { const ch = take("Shadow Touched", "TCE", {featAbilChoose: ["wis"]}); R.sh = slim(st.featSpellsInfo(sh, ch)); } else R.sh = "MISSING";

	R.featSpellSourcesCount = st.featSpellSources().length;

	// UI smoke: abilities (feat picker) + review with a feat that grants spells chosen
	const uiErrs = [];
	if (mi) {
		const ch = take("Magic Initiate", "PHB");
		const info = st.featSpellsInfo(mi, ch);
		(info.knownChoose || []).forEach(g => {
			const opts = st.racialSpellOptions(g.filter);
			ch.featSpellChoose[g.key] = opts.slice(0, g.count).map(sp => sp.name);
		});
		st.raceUid = data.races[0] ? `${data.races[0].name}|${data.races[0].source}` : null;
	}
	["abilities", "review"].forEach(id => { const ix = pg._ui._steps().findIndex(x => x.id === id); try { pg._ui._ixStep = ix; pg._ui.render(); } catch (e) { uiErrs.push(`${id}: ${e.message}`); } });
	R.reviewHasFeatSpells = !!pg._ui._eleRoot.textContent.includes("Feat Spells");
	R.ui_errors = uiErrs;
	st.reset();
	return R;
});

console.log(JSON.stringify(out, null, 2));
console.log("\npage errors:", errs.length ? errs : "none");
await page.close(); await b.close().catch(() => {});
process.exit(0);
