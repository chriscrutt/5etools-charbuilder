import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();
const page=await b.newPage();await page.setCacheEnabled(false);
const errs=[];page.on("pageerror",e=>errs.push(e.message));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.evaluate(()=>VetoolsConfig.set("styleSwitcher","style","classic"));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state",{timeout:60000});

const out = await page.evaluate(() => {
	const pg=globalThis.dbg_charBuilderPage; const ui=pg._ui; const st=ui._state; const data=globalThis.dbg_cb;
	const R={}; const fails=[];
	const bst=data.bestiary;
	const crNum=(cr)=>{if(cr==null)return null;const m={"0":0,"1/8":.125,"1/4":.25,"1/2":.5};const v=typeof cr==="object"?cr.cr:cr;if(v in m)return m[v];const n=Number(v);return Number.isNaN(n)?null:n;};

	R.total = bst.length;
	const noCr = bst.filter(m=>m.cr==null);
	R.noCrCount = noCr.length;
	R.noCrSamples = noCr.slice(0,6).map(m=>`${m.name}|${m.source}`);
	// every loaded creature is either unknown-CR or CR ≤ 1/2
	R.allWithinRule = bst.every(m=>{const n=crNum(m.cr);return n==null||n<=0.5;});
	// a CR-2 creature (Ogre) must still be absent
	R.ogreAbsent = !bst.some(m=>m.name==="Ogre" && m.source==="MM");

	// special-HP summon (Aberrant Spirit: hp.special "40 + …") gets base 40, not 0
	st.reset(); st.mode="sidekick";
	st.sidekick = {...st._defaultSidekick(), creatureUid:"Aberrant Spirit|TCE", classUid:"Warrior Sidekick|TCE", level:1};
	R.aberrantHp = st.sidekickReady() ? st.sidekickMaxHp() : "(not found)";

	// --- build a sidekick from an unknown-CR creature ---
	const pick = bst.find(m=>m.cr==null && m.hp && (m.hp.average||m.hp.formula));
	R.picked = pick ? `${pick.name}|${pick.source}` : null;
	if (pick) {
		st.reset(); st.mode="sidekick";
		st.sidekick = {...st._defaultSidekick(), creatureUid:`${pick.name}|${pick.source}`, classUid:"Warrior Sidekick|TCE", level:5, martialRole:"defender"};
		R.ready = st.sidekickReady();
		R.maxHp = st.sidekickMaxHp();
		R.crText = ui._skCrText(st.sidekickCreature());
		// render review + play
		const ix = ui._steps?.() ? null : null;
		try { ui._skStep = 2; ui.render(); } catch(e){ fails.push("review render: "+e.message); }
		try { ui._playMode=true; ui.render(); } catch(e){ fails.push("play render: "+e.message); }
		const txt = ui._eleRoot.textContent||"";
		R.play_hasName = txt.includes(pick.name);
		R.play_showsCrUnknown = /CR \?/.test(txt);
		if (/NaN|\[object Object\]|undefined/.test(txt)) fails.push("dirty sidekick text");
		ui._playMode=false;
	}
	st.reset();
	R.fails=fails;
	return R;
});

console.log(JSON.stringify(out,null,2));
const F=[...out.fails]; const chk=(k,c)=>{if(!c)F.push(k);};
chk("noCr present", out.noCrCount>0);
chk("aberrant special-HP base", out.aberrantHp===40);
chk("allWithinRule", out.allWithinRule);
chk("ogreAbsent", out.ogreAbsent);
chk("built unknown-CR sidekick", out.ready);
chk("maxHp sane", out.maxHp>0);
chk("crText ?", out.crText==="?");
chk("play shows name", out.play_hasName);
chk("play shows CR ?", out.play_showsCrUnknown);
console.log("\nFAILURES:", F.length?F:"none");
console.log("page errors:", errs.length?errs:"none");
await page.close();await b.close().catch(()=>{});
process.exit(0);
