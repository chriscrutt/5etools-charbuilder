// Screenshot sweep of the Character Builder: ~16 archetypes (and both sidekick types) across the
// creation steps, review sheet and play mode. Use it to eyeball UI/theme changes.
// Output: tools-local/tests/.out/screens/*.png
import {BASE, OUT_DIR, launchBrowser} from "../lib/harness.mjs";
import {mkdirSync} from "node:fs";
import path from "node:path";
const DIR=path.join(OUT_DIR,"screens"); mkdirSync(DIR,{recursive:true});
const b = await launchBrowser({args: ["--force-device-scale-factor=1","--window-size=940,1200"]});const page=await b.newPage();
await page.setCacheEnabled(false);
await page.setViewport({width:940,height:1200,deviceScaleFactor:2});
const errs=[];page.on("pageerror",e=>errs.push(e.message));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.evaluate(()=>VetoolsConfig.set("styleSwitcher","style","classic"));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state",{timeout:60000});

// configure a build in-page, set the step / play mode, return nothing; screenshot taken from node side
async function setup(fn){ await page.evaluate(fn); }
async function shoot(name){
  // neutralize any capped-height scroll container so the element capture shows everything
  await page.evaluate(()=>{document.querySelectorAll("#charbuilder-main *").forEach(e=>{const cs=getComputedStyle(e);if(cs.maxHeight!=="none"){e.style.maxHeight="none";}if(cs.overflowY==="auto"||cs.overflowY==="scroll"){e.style.overflow="visible";}});});
  await new Promise(r=>setTimeout(r,120));
  const el=await page.$("#charbuilder-main");
  await el.screenshot({path:`${DIR}/${name}.png`});
  console.log("shot",name);
}

const HELPERS = `
  const ui=globalThis.dbg_charBuilderPage._ui; const st=ui._state; const data=globalThis.dbg_cb;
  const subUid=(cn,scn)=>{const sc=data.classData.subclasses.find(x=>x.className===cn&&x.name===scn);return sc?sc.name+"|"+sc.source:null;};
  const stepIx=(id)=>ui._steps().findIndex(s=>s.id===id);
  const goStep=(id)=>{ui._playMode=false;ui._ixStep=stepIx(id);ui.render();};
  const goPlay=()=>{ui._playMode=true;ui.render();};
  const wield=(name)=>{const it=data.items.find(i=>i.name===name);if(!it)return;const uid=it.name+"|"+it.source;st.addToInventory({uid,name:it.name});const row=st.inventory.find(r=>r.uid===uid);if(row)row.equipped=true;};
  const setSpells=(cantrips,leveled)=>{const src=st.spellSources()[0];if(!src)return;st.spellChoices[src.uid]={cantrips,leveled};};
  const basePc=(abil)=>{st.reset();st.mode="pc";st.hiddenSources=[];st.hideLegacy=false;st.abilityMethod="manual";st.abilitiesBase=abil;};
`;

// ---------- Wizard (Evocation) L9 ----------
await setup(new Function(`${HELPERS}
  basePc({str:8,dex:14,con:14,int:17,wis:12,cha:10});
  st.raceUid="Elf (High)|PHB"; st.classes=[{uid:"Wizard|PHB",level:9,subclassUid:subUid("Wizard","School of Evocation")}];
  st.backgroundUid="Sage|PHB";
  setSpells(["Fire Bolt|PHB","Mage Hand|PHB","Prestidigitation|PHB"],["Magic Missile|PHB","Shield|PHB","Misty Step|PHB","Fireball|PHB","Counterspell|PHB","Ice Storm|PHB"]);
  goStep("abilities");
`));
await shoot("wiz_abilities");
await setup(new Function(`${HELPERS} goStep("skills");`)); await shoot("wiz_skills");
await setup(new Function(`${HELPERS} goStep("spells");`)); await shoot("wiz_spells");
await setup(new Function(`${HELPERS} goStep("review");`)); await shoot("wiz_review");
await setup(new Function(`${HELPERS} goPlay();`)); await shoot("wiz_play");
await setup(new Function(`${HELPERS} goStep("race");`)); await shoot("step_race");
await setup(new Function(`${HELPERS} goStep("class");`)); await shoot("step_class");

// ---------- Fighter (Champion) L5, martial ----------
await setup(new Function(`${HELPERS}
  basePc({str:16,dex:14,con:15,int:8,wis:12,cha:10});
  st.raceUid="Dwarf (Mountain)|PHB"; st.classes=[{uid:"Fighter|PHB",level:5,subclassUid:subUid("Fighter","Champion")}];
  st.backgroundUid="Soldier|PHB";
  wield("Longsword"); wield("Shield"); wield("Javelin");
  goStep("review");
`));
await shoot("fighter_review");
await setup(new Function(`${HELPERS} goPlay();`)); await shoot("fighter_play");

// ---------- Cleric (Life) L7 ----------
await setup(new Function(`${HELPERS}
  basePc({str:14,dex:10,con:14,int:10,wis:17,cha:12});
  st.raceUid="Human|PHB"; st.classes=[{uid:"Cleric|PHB",level:7,subclassUid:subUid("Cleric","Life Domain")}];
  st.backgroundUid="Acolyte|PHB";
  setSpells(["Sacred Flame|PHB","Guidance|PHB","Light|PHB"],["Cure Wounds|PHB","Bless|PHB","Spiritual Weapon|PHB","Spirit Guardians|PHB","Revivify|PHB"]);
  wield("Mace"); wield("Shield");
  goStep("review");
`));
await shoot("cleric_review");
await setup(new Function(`${HELPERS} goPlay();`)); await shoot("cleric_play");

// ---------- Warlock (Fiend) L9, pact magic ----------
await setup(new Function(`${HELPERS}
  basePc({str:8,dex:14,con:14,int:10,wis:12,cha:17});
  st.raceUid="Tiefling|PHB"; st.classes=[{uid:"Warlock|PHB",level:9,subclassUid:subUid("Warlock","The Fiend")}];
  st.backgroundUid="Charlatan|PHB";
  setSpells(["Eldritch Blast|PHB","Mage Hand|PHB"],["Hex|PHB","Hunger of Hadar|XGE","Fireball|PHB","Fly|PHB"]);
  goStep("review");
`));
await shoot("warlock_review");
await setup(new Function(`${HELPERS} goPlay();`)); await shoot("warlock_play");

// ---------- Multiclass Fighter 5 / Rogue 3 ----------
await setup(new Function(`${HELPERS}
  basePc({str:10,dex:17,con:14,int:12,wis:10,cha:13});
  st.raceUid="Halfling (Lightfoot)|PHB"; st.classes=[{uid:"Fighter|PHB",level:5,subclassUid:subUid("Fighter","Battle Master")},{uid:"Rogue|PHB",level:3,subclassUid:subUid("Rogue","Thief")}];
  st.backgroundUid="Criminal|PHB";
  wield("Rapier"); wield("Shortbow");
  goStep("review");
`));
await shoot("mc_review");
await setup(new Function(`${HELPERS} goPlay();`)); await shoot("mc_play");

// ---------- Sidekick: Warrior (Defender) L6 from a Wolf ----------
await setup(new Function(`${HELPERS}
  st.reset(); st.mode="sidekick"; st.hiddenSources=[]; st.hideLegacy=false;
  st.sidekick={...st._defaultSidekick(), creatureUid:"Wolf|MM", classUid:"Warrior Sidekick|TCE", level:6, martialRole:"defender", saveProf:"con"};
  ui._skStep=2; ui.render();
`));
await shoot("sk_warrior_review");
await setup(new Function(`${HELPERS} ui._playMode=true; ui.render();`)); await shoot("sk_warrior_play");

// ---------- Sidekick: Spellcaster (Mage) L5 from a Guard ----------
await setup(new Function(`${HELPERS}
  st.reset(); st.mode="sidekick"; st.hiddenSources=[]; st.hideLegacy=false;
  st.sidekick={...st._defaultSidekick(), creatureUid:"Guard|MM", classUid:"Spellcaster Sidekick|TCE", level:5, spellRole:"mage"};
  const lv=st.sidekickSpellOptions?(st.sidekickSpellOptions(1)):[];
  st.sidekick.spellChoices={cantrips:["Fire Bolt|PHB","Mage Hand|PHB"],leveled:["Magic Missile|PHB","Shield|PHB"]};
  ui._skStep=2; ui.render();
`));
await shoot("sk_caster_review");
await setup(new Function(`${HELPERS} ui._playMode=true; ui.render();`)); await shoot("sk_caster_play");

console.log("\nscreenshots in", DIR);
console.log("page errors:", errs.length?errs:"none");
await b.close().catch(()=>{});
process.exit(0);
