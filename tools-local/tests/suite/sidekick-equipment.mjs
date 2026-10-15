import {BASE, launchBrowser} from "../lib/harness.mjs";
const b = await launchBrowser();const page=await b.newPage();await page.setCacheEnabled(false);
const errs=[];page.on("pageerror",e=>errs.push(e.message));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.evaluate(()=>VetoolsConfig.set("styleSwitcher","style","classic"));
await page.goto(BASE + "/charbuilder.html",{waitUntil:"domcontentloaded"});
await page.waitForFunction("globalThis.dbg_charBuilderPage?._ui?._state",{timeout:60000});

const out = await page.evaluate(() => {
	const ui=globalThis.dbg_charBuilderPage._ui; const st=ui._state; const data=globalThis.dbg_cb;
	const R={}; const fails=[];
	const item=(n)=>data.items.find(i=>i.name===n);
	const armor=(n)=>data.armors.find(a=>a.name===n);
	const uid=(e)=>`${e.name}|${e.source}`;

	// --- Sidekick: Wolf, Warrior 6 (Defender), proficient simple+martial+shields ---
	st.reset(); st.mode="sidekick";
	st.sidekick={...st._defaultSidekick(), creatureUid:"Guard|MM", classUid:"Warrior Sidekick|TCE", level:6, martialRole:"attacker", saveProf:"con"};
	const baseAc = st.sidekickAc(); R.baseAc = baseAc; // Guard stat-block AC 16

	// equip chain mail + shield
	const cm=armor("Chain Mail")||item("Chain Mail"); const sh=armor("Shield")||item("Shield");
	st.skAddToInventory({uid:uid(cm),name:cm.name}); st.skAddToInventory({uid:uid(sh),name:sh.name});
	st.sidekick.armorUid=uid(cm); st.sidekick.shieldUid=uid(sh);
	R.armorAc = st.sidekickAc(); // Chain Mail 16 + Shield 2 = 18 (Improved Defense only at L10)
	R.acFrom = st.sidekickAcFromText();

	// wield a longsword → weapon attack with sidekick mods (Str mod + PB + attacker +2)
	const ls=item("Longsword"); st.skAddToInventory({uid:uid(ls),name:ls.name});
	const lsRow=st.sidekick.inventory.find(r=>r.uid===uid(ls)); lsRow.equipped=true;
	const atk=st.sidekickWeaponAttack(ls);
	R.lsToHit=atk.toHit; R.lsProf=atk.prof; R.lsDmgBonus=atk.dmgBonus; R.lsAbility=atk.ability;
	R.expectToHit = st.sidekickAbilityMod("str") + st.sidekickProfBonus() + 2; // attacker +2
	R.wieldedCount = st.sidekickWieldedWeapons().length;

	// Ring of Protection: +1 AC + +1 saves (needs attunement)
	const ring=item("Ring of Protection");
	let ringTested=false;
	if (ring) {
		st.skAddToInventory({uid:uid(ring),name:ring.name});
		const rRow=st.sidekick.inventory.find(r=>r.uid===uid(ring)); rRow.equipped=true;
		const acBeforeAttune=st.sidekickAc(); st.sidekickSetAttuned(uid(ring),true);
		R.ringAcDelta = st.sidekickAc() - acBeforeAttune; // +1 once attuned
		R.ringSaveBonus = st.sidekickItemSaveBonus(); // +1
		ringTested=true;
	}
	R.ringTested=ringTested;

	// --- render the Equipment step + Review + Play, no errors, shows weapon ---
	ui._skStep = ui._sidekickSteps().findIndex(s=>s.id==="equipment");
	try{ui.render();}catch(e){fails.push("equipment step: "+e.message);}
	R.equipStepHasInv = /Equipment|Attunement/.test(ui._eleRoot.innerText||"");
	ui._skStep = ui._sidekickSteps().findIndex(s=>s.id==="review");
	try{ui.render();}catch(e){fails.push("review: "+e.message);}
	R.reviewHasLongsword = /Longsword/.test(ui._eleRoot.innerText||"");
	try{ui._playMode=true; ui.render();}catch(e){fails.push("play: "+e.message);}
	const ptxt=ui._eleRoot.innerText||"";
	R.playHasWeaponAttackBtn=[...ui._eleRoot.querySelectorAll("button")].some(x=>/^Attack \+/.test(x.textContent));
	if(/NaN|\[object|undefined/.test(ptxt)) fails.push("dirty play text");
	ui._playMode=false;

	// --- serialization round-trip ---
	const json=st.toJson(); st.reset(); st.fromJson(json);
	R.serArmor = st.sidekick.armorUid===uid(cm); R.serWielded = st.sidekickWieldedWeapons().length===1;
	R.serAttuned = ring ? st.sidekickIsAttuned(uid(ring)) : true;

	st.reset();
	R.fails=fails; return R;
});

console.log(JSON.stringify(out,null,2));
const F=[...out.fails]; const chk=(k,c)=>{if(!c)F.push(k);};
chk("baseAc Guard 16", out.baseAc===16);
chk("armorAc 18 (chain+shield)", out.armorAc===18);
chk("acFrom mentions Chain Mail+Shield", /Chain Mail/.test(out.acFrom)&&/Shield/.test(out.acFrom));
chk("longsword toHit matches", out.lsToHit===out.expectToHit);
chk("longsword proficient", out.lsProf===true);
chk("wielded count 1", out.wieldedCount===1);
if(out.ringTested){chk("ring +1 AC when attuned", out.ringAcDelta===1); chk("ring +1 saves", out.ringSaveBonus===1);}
chk("equip step renders inv", out.equipStepHasInv);
chk("review shows longsword", out.reviewHasLongsword);
chk("play weapon attack button", out.playHasWeaponAttackBtn);
chk("ser armor", out.serArmor); chk("ser wielded", out.serWielded); chk("ser attuned", out.serAttuned);
console.log("\nFAILURES:", F.length?F:"none");
console.log("page errors:", errs.length?errs:"none");
await page.close();await b.close().catch(()=>{});
process.exit(0);
