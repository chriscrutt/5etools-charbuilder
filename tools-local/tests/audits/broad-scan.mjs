import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();const page=await b.newPage();await page.setCacheEnabled(false);
const perr=[];page.on("pageerror",e=>perr.push(e.message));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.evaluate(()=>VetoolsConfig.set("styleSwitcher","style","classic"));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state",{timeout:60000});
const out=await page.evaluate(()=>{
  const ui=globalThis.dbg_charBuilderPage._ui; const st=ui._state; const data=globalThis.dbg_cb;
  const subUid=(cn,scn)=>{const sc=data.classData.subclasses.find(x=>x.className===cn&&x.name===scn);return sc?sc.name+"|"+sc.source:null;};
  const pats={rawTag:/\{@\w+/, NaN:/\bNaN\b/, undef:/\bundefined\b/, obj:/\[object/, nullStr:/(^|\s)null(\s|$|,|\))/, dblDash:/—\s*—/, emptyParen:/\(\s*\)/};
  const builds=[
    ["Barbarian","Path of the Totem Warrior",12,{str:17,dex:14,con:16,int:8,wis:12,cha:10}],
    ["Paladin","Oath of Devotion",11,{str:16,dex:10,con:14,int:8,wis:10,cha:16}],
    ["Monk","Way of the Open Hand",10,{str:10,dex:17,con:14,int:10,wis:16,cha:8}],
    ["Druid","Circle of the Moon",9,{str:8,dex:14,con:14,int:10,wis:17,cha:10}],
    ["Ranger","Hunter",8,{str:12,dex:17,con:14,int:8,wis:14,cha:10}],
    ["Bard","College of Lore",10,{str:8,dex:14,con:12,int:10,wis:10,cha:17}],
    ["Sorcerer","Draconic Bloodline",13,{str:8,dex:14,con:15,int:10,wis:11,cha:17}],
    ["Rogue","Arcane Trickster",9,{str:8,dex:17,con:14,int:14,wis:10,cha:10}],
    ["Artificer","Battle Smith",11,{str:10,dex:14,con:14,int:17,wis:10,cha:8}],
  ];
  const report={};
  for (const [cls,sc,lvl,abil] of builds){
    st.reset();st.mode="pc";st.abilityMethod="manual";st.abilitiesBase=abil;
    st.raceUid="Human|PHB"; st.classes=[{uid:`${cls}|PHB`,level:lvl,subclassUid:subUid(cls,sc)||subUid(cls,data.classData.subclasses.find(x=>x.className===cls)?.name)}];
    st.backgroundUid="Soldier|PHB";
    const src=st.spellSources()[0]; if(src){ const cs=st.spellListForSource?st.spellListForSource(src):[]; }
    const issues=[];
    for (const mode of ["review","play"]){
      if(mode==="review"){ui._playMode=false;ui._ixStep=ui._steps().findIndex(s=>s.id==="review");}else{ui._playMode=true;}
      try{ui.render();}catch(e){issues.push(`${mode} render: ${e.message}`);continue;}
      const txt=ui._eleRoot.innerText||"";
      for(const[n,re] of Object.entries(pats)){const m=txt.match(re);if(m)issues.push(`${mode}:${n}:'${txt.slice(Math.max(0,m.index-12),m.index+15).replace(/\n/g,"·")}'`);}
    }
    report[`${cls}/${sc} L${lvl}`]=issues;
  }
  st.reset();
  return report;
});
let total=0;
for (const[k,v] of Object.entries(out)){ if(v.length){total+=v.length; console.log("⚠",k); v.forEach(i=>console.log("   ",i)); } else console.log("✓",k); }
console.log("\nTOTAL ISSUES:",total);
console.log("page errors:",perr.length?perr:"none");
await b.close().catch(()=>{});
process.exit(0);
