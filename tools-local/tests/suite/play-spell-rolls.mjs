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
	const spByName=(n)=>data.spells.find(s=>s.name===n);
	const subUid=(cn,scn)=>{const sc=data.classData.subclasses.find(x=>x.className===cn&&x.name===scn);return sc?`${sc.name}|${sc.source}`:null;};
	const setup=(uid,lvl,sub)=>{st.reset();st.mode="pc";st.hiddenSources=[];st.hideLegacy=false;st.abilityMethod="manual";st.abilitiesBase={str:8,dex:14,con:14,int:12,wis:10,cha:16};st.classes=[{uid,level:lvl,subclassUid:sub||null}];};

	// Sorcerer 11 — Int/Cha caster; pick a source
	setup("Sorcerer|PHB",11,subUid("Sorcerer","Wild Magic Sorcery"));
	const src=st.spellSources()[0];
	const info=(n)=>st.spellRollInfo(spByName(n),src);

	// Fire Bolt: ranged spell attack, scales to 3d10 at L11, fire
	const fb=info("Fire Bolt");
	R.firebolt={atk:fb.atk, dmg:fb.damage.map(d=>`${d.dice}|${d.type||""}|${d.kind}`), save:fb.save};

	// Fireball: DEX save, 8d6 fire, +1d6/slot scaling
	const fbl=info("Fireball");
	R.fireball={atk:fbl.atk, save:fbl.save, dmg:fbl.damage.map(d=>`${d.dice}|${d.type||""}`), scale:fbl.scaleNote};

	// Chaos Bolt: ranged attack, 2d8 + 1d6, no single type, but a d8 damage-type table
	const cb=info("Chaos Bolt");
	R.chaosbolt={atk:cb.atk!=null, save:cb.save, dmg:cb.damage.map(d=>`${d.dice}|${d.type||"none"}`), table:cb.typeTable};
	// Fireball has no type table
	R.fireballNoTable = info("Fireball").typeTable;

	// spell attack bonus sanity: prof(4) + cha mod(3) = 7
	R.expectedAtk = st.profBonus + st.abilityMod(st.spellAbilityFor(src));

	// Cleric 5 — healing extraction
	setup("Cleric|PHB",5,subUid("Cleric","Life Domain"));
	const src2=st.spellSources()[0];
	const cw=st.spellRollInfo(spByName("Cure Wounds"),src2);
	R.cureWounds={save:cw.save, atk:cw.atk, dmg:cw.damage.map(d=>`${d.dice}|${d.kind}`)};
	const gw=st.spellRollInfo(spByName("Guiding Bolt"),src2); // radiant ranged attack 4d6
	R.guidingBolt={atk:gw.atk!=null, dmg:gw.damage.map(d=>`${d.dice}|${d.type||""}`)};

	// --- UI: render the spellbook, confirm Attack/Dmg buttons exist ---
	setup("Sorcerer|PHB",11,subUid("Sorcerer","Wild Magic Sorcery"));
	// give Fire Bolt + Fireball to the build so they appear in playSpellbook
	const sid=src.uid;
	st.spellChoices[sid]={cantrips:[`Fire Bolt|PHB`], leveled:[`Fireball|PHB`,`Chaos Bolt|XGE`]};
	ui._playMode=true;
	try { ui.render(); } catch(e){ fails.push("play render: "+e.message); }
	const root=ui._eleRoot;
	const btns=[...root.querySelectorAll("button")].map(x=>x.textContent.trim());
	R.ui_hasSpellAttackBtn = btns.some(t=>/^Attack \+\d/.test(t));
	R.ui_hasDmgBtn = btns.some(t=>/^Dmg \d/.test(t));
	R.ui_hasCastBtn = btns.some(t=>/^Cast/.test(t));
	R.ui_hasSaveDc = !!root.querySelector(".cb__save-dc");
	R.ui_saveDcText = root.querySelector(".cb__save-dc")?.textContent?.trim();
	R.ui_dmgSamples = btns.filter(t=>/^Dmg /.test(t)).slice(0,4);
	R.ui_hasTypeBtn = btns.some(t=>/^Roll type \(d8\)/.test(t));
	if (/NaN|\[object|undefined/.test(root.textContent)) fails.push("dirty spellbook text");

	// --- click an Attack button → routes to dice tray (ve-roller / dice output) ---
	ui._playMode=false; st.reset();
	R.fails=fails;
	return R;
});

console.log(JSON.stringify(out,null,2));
const F=[...out.fails]; const chk=(k,c)=>{if(!c)F.push(k);};
chk("firebolt.atk=7", out.firebolt.atk===7);
chk("firebolt 3d10 fire", out.firebolt.dmg.some(s=>s==="3d10|fire|damage"));
chk("fireball DEX save", out.fireball.save && /dex/i.test(out.fireball.save.abil));
chk("fireball 8d6 fire", out.fireball.dmg.some(s=>s==="8d6|fire"));
chk("fireball scaleNote", /\+1d6\/slot/.test(out.fireball.scale||""));
chk("chaosbolt attack", out.chaosbolt.atk);
chk("chaosbolt 2d8+1d6 no-type", out.chaosbolt.dmg.some(s=>/2d8 \+ 1d6\|none/.test(s)));
chk("chaosbolt typeTable d8", out.chaosbolt.table && out.chaosbolt.table.faces===8);
chk("chaosbolt table map", out.chaosbolt.table && out.chaosbolt.table.map["1"]==="Acid" && out.chaosbolt.table.map["3"]==="Fire" && out.chaosbolt.table.map["8"]==="Thunder");
chk("fireball no table", out.fireballNoTable==null);
chk("ui Roll type btn", out.ui_hasTypeBtn);
chk("expectedAtk=7", out.expectedAtk===7);
chk("cureWounds heal", out.cureWounds.dmg.some(s=>/\|heal/.test(s)) && !out.cureWounds.save && out.cureWounds.atk==null);
chk("guidingBolt attack+4d6", out.guidingBolt.atk && out.guidingBolt.dmg.some(s=>s==="4d6|radiant"));
chk("ui spell Attack btn", out.ui_hasSpellAttackBtn);
chk("ui Dmg btn", out.ui_hasDmgBtn);
chk("ui Cast btn", out.ui_hasCastBtn);
chk("ui save DC badge", out.ui_hasSaveDc);
console.log("\nFAILURES:", F.length?F:"none");
console.log("page errors:", errs.length?errs:"none");
await page.close();await b.close().catch(()=>{});
process.exit(0);
