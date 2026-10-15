import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();const page=await b.newPage();await page.setCacheEnabled(false);
const errs=[];page.on("pageerror",e=>errs.push(e.message));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.evaluate(()=>VetoolsConfig.set("styleSwitcher","style","classic"));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state",{timeout:60000});
const out=await page.evaluate(()=>{
  const ui=globalThis.dbg_charBuilderPage._ui; const st=ui._state; const data=globalThis.dbg_cb;
  const R={}; const fails=[]; const uid=(e)=>`${e.name}|${e.source}`;
  const ring=data.items.filter(i=>i.reqAttune && i.name!=="Ring of Protection").slice(0,3);
  st.reset(); st.mode="pc"; st.abilityMethod="manual"; st.abilitiesBase={str:10,dex:14,con:12,int:10,wis:10,cha:10}; st.classes=[{uid:"Fighter|PHB",level:5,subclassUid:null}];

  // attune 3 items, then Clear → attunement must reset to 0 and not be "full"
  ring.forEach(it=>{ st.addToInventory({uid:uid(it),name:it.name}); st.setAttuned(uid(it),true); });
  R.attunedBeforeClear = st.attunedCount();
  st.inventory=[]; st.armorUid=null; st.shieldUid=null; st.attunedUids=[]; // (what the Clear button now does)
  R.attunedAfterClear = st.attunedCount();

  // simulate an OLD save with stale attunedUids but only 1 unrelated item → count must be inventory-aware (0), can attune
  st.attunedUids=["Ghost|XYZ","Stale|ABC","Gone|DEF"]; // none in inventory
  const aoar=data.items.find(i=>i.name==="Armor of Acid Resistance");
  if(aoar){ st.addToInventory({uid:uid(aoar),name:aoar.name}); }
  R.staleCount = st.attunedCount(); // should be 0 (stale uids not in inv)
  R.canAttuneWithStale = st.canAttuneMore(); // true

  // generic-variant template detection
  R.aoarIsTemplate = aoar ? st._isGenericVariantTemplate(aoar) : "NOT FOUND";

  // search-add must exclude templates but include concrete variants
  st.reset(); st.mode="pc"; st.classes=[{uid:"Fighter|PHB",level:5}];
  ui._ixStep=ui._steps().findIndex(s=>s.id==="skills"); ui.render();
  const search=[...ui._eleRoot.querySelectorAll('input[placeholder="Search items to add…"]')][0];
  const typeSearch=(q)=>{ search.value=q; search.dispatchEvent(new Event("input",{bubbles:true})); return [...ui._eleRoot.querySelectorAll(".cb__pick span:first-child")].map(s=>s.textContent); };
  const res=typeSearch("acid resistance");
  R.searchHasTemplate = res.some(n=>n==="Armor of Acid Resistance");        // should be FALSE now
  R.searchHasConcrete = res.some(n=>/(Breastplate|Chain Mail|Chain Shirt|Plate|Hide|Scale|Splint|Half Plate|Ring Mail|Leather) of Acid Resistance/.test(n)); // should be TRUE
  R.searchSample = res.slice(0,6);

  // a concrete variant is wearable (in data.armors → Wear button path)
  const concrete=data.items.find(i=>/Chain Mail of Acid Resistance$/i.test(i.name) && `${i.type||""}`.split("|")[0]==="HA");
  R.concreteInArmors = concrete ? data.armors.some(a=>a.name===concrete.name&&a.source===concrete.source) : "none";

  st.reset();
  R.fails=fails; return R;
});
console.log(JSON.stringify(out,null,2));
const F=[...out.fails]; const chk=(k,c)=>{if(!c)F.push(k);};
chk("attuned 3 before clear", out.attunedBeforeClear===3);
chk("attuned 0 after clear", out.attunedAfterClear===0);
chk("stale count is 0 (inv-aware)", out.staleCount===0);
chk("can attune despite stale uids", out.canAttuneWithStale===true);
chk("AoAR detected as template", out.aoarIsTemplate===true);
chk("search excludes template", out.searchHasTemplate===false);
chk("search includes concrete", out.searchHasConcrete===true);
chk("concrete variant in armors", out.concreteInArmors===true);
console.log("\nFAILURES:", F.length?F:"none");
console.log("page errors:", errs.length?errs:"none");
await page.close();await b.close().catch(()=>{});
process.exit(0);
