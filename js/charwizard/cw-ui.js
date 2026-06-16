import {CW} from "../charwizard.js";

/* Small render helper: 5etools entries -> HTML string */
const renderEntries = (entries) => {
	try { return Renderer.get().setFirstSection(true).render({type: "entries", entries: entries || []}); } catch (e) { return ""; }
};
const renderInline = (str) => { try { return Renderer.get().render(`${str}`); } catch (e) { return `${str}`; } };

export class CharWizardUi {
	constructor ({data, state, eleRoot, fnSave}) {
		this._data = data;
		this._state = state;
		this._eleRoot = eleRoot;
		this._fnSave = fnSave;
		this._ixStep = 0;
	}

	_save () { this._fnSave?.(); }

	_steps () {
		const steps = [
			{id: "race", label: "Species", done: () => !!this._state.raceUid, render: (el) => this._renderStepRace(el)},
			{id: "class", label: "Class", done: () => !!this._state.classUid, render: (el) => this._renderStepClass(el)},
			{id: "background", label: "Background", done: () => !!this._state.backgroundUid, render: (el) => this._renderStepBackground(el)},
			{id: "abilities", label: "Abilities", done: () => true, render: (el) => this._renderStepAbilities(el)},
			{id: "skills", label: "Skills & Gear", done: () => true, render: (el) => this._renderStepSkills(el)},
		];
		if (this._state.isCaster()) steps.push({id: "spells", label: "Spells", done: () => true, render: (el) => this._renderStepSpells(el)});
		steps.push({id: "review", label: "Review", done: () => true, render: (el) => this._renderStepReview(el)});
		return steps;
	}

	render () {
		this._eleRoot.empty();
		const steps = this._steps();
		if (this._ixStep >= steps.length) this._ixStep = steps.length - 1;

		const wrp = ee`<div class="cw__wrp ve-p-2"></div>`.appendTo(this._eleRoot);

		// Toolbar
		const inpName = ee`<input class="ve-form-control" style="max-width:280px" placeholder="Character name" value="${(this._state.name || "").qq()}">`
			.onn("change", () => { this._state.name = inpName.val(); this._save(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:8px;flex-wrap:wrap">
			${inpName}
			${this._getToolbarButtons()}
		</div>`;

		// Stepper
		const eleSteps = ee`<div class="cw__steps no-print"></div>`.appendTo(wrp);
		steps.forEach((st, ix) => {
			const isActive = ix === this._ixStep;
			const btn = ee`<div class="cw__step ${isActive ? "cw__step--active" : ""} ${st.done() && !isActive ? "cw__step--done" : ""}"><span class="cw__step-num">${ix + 1}</span>${st.label}</div>`
				.onn("click", () => { this._ixStep = ix; this.render(); });
			btn.appendTo(eleSteps);
		});

		// Body
		const eleBody = ee`<div class="cw__step-body"></div>`.appendTo(wrp);
		steps[this._ixStep].render(eleBody);

		// Footer nav
		const btnBack = ee`<button class="ve-btn ve-btn-default">‹ Back</button>`
			.onn("click", () => { if (this._ixStep > 0) { this._ixStep--; this.render(); } });
		if (this._ixStep === 0) btnBack.attr("disabled", "true");
		const isLast = this._ixStep === steps.length - 1;
		const btnNext = ee`<button class="ve-btn ve-btn-primary">${isLast ? "Done" : "Next ›"}</button>`
			.onn("click", () => { if (!isLast) { this._ixStep++; this.render(); } });
		ee(wrp)`<div class="cw__footer no-print">${btnBack}${btnNext}</div>`;
	}

	_getToolbarButtons () {
		const btnSave = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Saved automatically; click to confirm"><span class="glyphicon glyphicon-floppy-disk"></span> Saved</button>`
			.onn("click", () => { this._save(); JqueryUtil.doToast({type: "success", content: "Character saved to this browser."}); });
		const btnExport = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-download-alt"></span> Export</button>`
			.onn("click", () => DataUtil.userDownload(`${this._state.name || "character"}`, this._state.toJson(), {fileType: "charwizard"}));
		const btnImport = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-upload"></span> Import</button>`
			.onn("click", async () => {
				const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: ["charwizard"]});
				DataUtil.doHandleFileLoadErrorsGeneric(errors);
				if (!jsons?.length) return;
				this._state.fromJson(jsons[0]); this._save(); this._ixStep = 0; this.render();
			});
		const btnPrint = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-print"></span> Print</button>`
			.onn("click", () => { this._ixStep = this._steps().length - 1; this.render(); setTimeout(() => window.print(), 100); });
		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-sm"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", async () => {
				if (!await InputUiUtil.pGetUserBoolean({title: "Reset Character", htmlDescription: "Clear all choices and start over?"})) return;
				this._state.reset(); this._save(); this._ixStep = 0; this.render();
			});
		return ee`<div class="ve-btn-group no-print">${btnSave}${btnExport}${btnImport}${btnPrint}${btnReset}</div>`;
	}

	/* ----- generic chooser (list + preview) ----- */
	_renderChooser (eleBody, {entities, getSel, setSel, renderDetail, subtitle}) {
		const wrp = ee`<div></div>`.appendTo(eleBody);
		if (subtitle) ee(wrp)`<p class="ve-muted ve-mb-1">${subtitle}</p>`;
		const body = ee`<div class="cw__body"></div>`.appendTo(wrp);
		const colList = ee`<div class="cw__col-list"></div>`.appendTo(body);
		const colDetail = ee`<div class="cw__col-detail"></div>`.appendTo(body);

		const inpSearch = ee`<input class="ve-form-control ve-mb-1" placeholder="Search…">`;
		colList.appendChild(inpSearch);
		const listWrp = ee`<div class="cw__pick-list"></div>`.appendTo(colList);

		const renderDetailFor = (uid) => {
			colDetail.empty();
			const ent = entities.find(e => CW.uid(e) === uid);
			if (!ent) { ee(colDetail)`<div class="ve-muted ve-p-3">Select an option from the list.</div>`; return; }
			renderDetail(colDetail, ent);
		};

		const renderList = (term) => {
			listWrp.empty();
			const t = (term || "").toLowerCase().trim();
			entities
				.filter(e => !t || e.name.toLowerCase().includes(t) || `${e.source}`.toLowerCase().includes(t))
				.forEach(ent => {
					const uid = CW.uid(ent);
					const row = ee`<div class="cw__pick ${getSel() === uid ? "cw__pick--sel" : ""}"><span>${ent.name}</span><span class="cw__pick-src" title="${Parser.sourceJsonToFull(ent.source).qq()}">${ent.source}</span></div>`
						.onn("click", () => {
							setSel(uid);
							this._save();
							[...listWrp.children].forEach(c => c.classList.remove("cw__pick--sel"));
							row.classList.add("cw__pick--sel");
							renderDetailFor(uid);
						});
					row.appendTo(listWrp);
				});
		};
		inpSearch.onn("input", () => renderList(inpSearch.val()));
		renderList("");
		renderDetailFor(getSel());
	}

	/* ----- generic chip multi-picker (updates in place, no full re-render) ----- */
	_renderChipPicker (wrp, {items, getValue, getLabel, getTitle = null, arr, max, counterEle = null, gridStyle = "display:flex;flex-wrap:wrap;gap:4px"}) {
		const grid = ee`<div style="${gridStyle}"></div>`.appendTo(wrp);
		const refresh = () => {
			const atMax = arr.length >= max;
			[...grid.querySelectorAll("input[type=checkbox]")].forEach(inp => { if (!inp.checked) inp.disabled = atMax; });
			if (counterEle) counterEle.txt(`${arr.length}/${max}`);
		};
		items.forEach(item => {
			const val = getValue(item);
			const isChosen = arr.includes(val);
			const chip = ee`<label class="cw__chip" style="cursor:pointer" title="${(getTitle ? getTitle(item) : "").qq()}">${getLabel(item)} <input type="checkbox" ${isChosen ? "checked" : ""}></label>`;
			const input = chip.querySelector("input");
			input.addEventListener("change", () => {
				if (input.checked) { if (arr.length < max) arr.push(val); else input.checked = false; } else { const i = arr.indexOf(val); if (i >= 0) arr.splice(i, 1); }
				this._save();
				refresh();
			});
			chip.appendTo(grid);
		});
		refresh();
		return grid;
	}

	/* ----- Step: Race ----- */
	_renderStepRace (el) {
		this._renderChooser(el, {
			subtitle: "Choose your character's species/race. Ability bonuses, speed, size, and traits come from here.",
			entities: this._data.races,
			getSel: () => this._state.raceUid,
			setSel: (uid) => { this._state.raceUid = uid; this._state.raceAbilChoices = []; },
			renderDetail: (col, ent) => {
				let html;
				try { html = Renderer.race.getCompactRenderedString(ent); } catch (e) { html = renderEntries(ent.entries); }
				ee(col)`<table class="w-100 stats">${html}</table>`;
			},
		});
	}

	/* ----- Step: Class ----- */
	_renderStepClass (el) {
		const wrp = ee`<div></div>`.appendTo(el);
		// level + subclass controls
		const ctrl = ee`<div class="ve-flex-v-center ve-mb-2" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(wrp);
		const inpLevel = ee`<input type="number" min="1" max="20" class="ve-form-control" style="width:70px" value="${this._state.level}">`
			.onn("change", () => {
				let v = Math.max(1, Math.min(20, parseInt(inpLevel.val(), 10) || 1));
				this._state.level = v; inpLevel.val(v); this._save(); this.render();
			});
		ee(ctrl)`<label class="ve-flex-v-center" style="gap:6px">Level ${inpLevel}</label>`;

		const subs = this._state.subclassesForClass();
		const gainLv = this._state.subclassGainLevel();
		if (this._state.classUid && subs.length && this._state.level >= gainLv) {
			const sel = ee`<select class="ve-form-control" style="width:auto"><option value="">— ${(this._state.classEnt?.subclassTitle || "Subclass").qq()} —</option></select>`;
			subs.forEach(sc => { const o = ee`<option value="${CW.uid(sc).qq()}">${sc.name} (${sc.source})</option>`; o.appendTo(sel); });
			sel.val(this._state.subclassUid || "");
			sel.onn("change", () => { this._state.subclassUid = sel.val() || null; this._save(); });
			ee(ctrl)`<label class="ve-flex-v-center" style="gap:6px">${this._state.classEnt?.subclassTitle || "Subclass"}: ${sel}</label>`;
		} else if (this._state.classUid && subs.length) {
			ee(ctrl)`<span class="ve-muted ve-small">${this._state.classEnt?.subclassTitle || "Subclass"} chosen at level ${gainLv}</span>`;
		}

		this._renderChooser(wrp, {
			subtitle: "Choose your class. Hit dice, saving throws, proficiencies, features, and (if any) spellcasting come from here.",
			entities: this._data.classData.classes,
			getSel: () => this._state.classUid,
			setSel: (uid) => { this._state.classUid = uid; this._state.subclassUid = null; this._state.classSkillChoices = []; this._state.spellChoices = {cantrips: [], leveled: []}; },
			renderDetail: (col, cls) => this._renderClassDetail(col, cls),
		});
	}

	_renderClassDetail (col, cls) {
		const hd = cls.hd ? `d${cls.hd.faces}` : "—";
		const saves = (cls.proficiency || []).map(a => CW.ABIL_FULL[a]).join(", ") || "—";
		const sp = cls.startingProficiencies || {};
		const skillMeta = (sp.skills || []).find(g => g?.choose);
		const skillsText = skillMeta ? `Choose ${skillMeta.choose.count} from ${(skillMeta.choose.from || []).map(s => s.toTitleCase()).join(", ")}` : "—";
		ee(col)`<div>
			<h4 class="ve-mt-0">${cls.name} <span class="ve-muted ve-small">(${cls.source})</span></h4>
			<div><b>Hit Die:</b> ${hd} &nbsp; <b>Saving Throws:</b> ${saves}</div>
			<div><b>Armor:</b> ${renderInline((sp.armor || []).map(a => `${typeof a === "string" ? a : a.proficiency || ""}`).join(", ") || "—")}</div>
			<div><b>Weapons:</b> ${renderInline((sp.weapons || []).map(a => `${typeof a === "string" ? a : a.proficiency || ""}`).join(", ") || "—")}</div>
			<div><b>Skills:</b> ${skillsText.qq()}</div>
			${cls.spellcastingAbility ? `<div><b>Spellcasting:</b> ${CW.ABIL_FULL[cls.spellcastingAbility]} (${cls.casterProgression || "?"} caster)</div>` : ""}
			<hr class="hr-2">
			<div><b>Features through level ${this._state.level}:</b></div>
			${this._renderClassFeatureList(cls)}
		</div>`;
	}

	_renderClassFeatureList (cls) {
		const lines = [];
		(cls.classFeatures || []).slice(0, this._state.level).forEach((lvFeats, ix) => {
			(lvFeats || []).forEach(f => { if (f?.name && !f.isClassFeatureVariant) lines.push(`<li><b>L${ix + 1}:</b> ${f.name.qq()}</li>`); });
		});
		return `<ul class="ve-pl-4">${lines.join("")}</ul>`;
	}

	/* ----- Step: Background ----- */
	_renderStepBackground (el) {
		this._renderChooser(el, {
			subtitle: "Choose a background. It grants skill proficiencies, languages/tools, and starting equipment.",
			entities: this._data.backgrounds,
			getSel: () => this._state.backgroundUid,
			setSel: (uid) => { this._state.backgroundUid = uid; },
			renderDetail: (col, ent) => {
				let html;
				try { html = Renderer.background.getCompactRenderedString(ent); } catch (e) { html = renderEntries(ent.entries); }
				ee(col)`<table class="w-100 stats">${html}</table>`;
			},
		});
	}

	/* ----- Step: Abilities ----- */
	_renderStepAbilities (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);

		const methods = [["pointbuy", "Point Buy"], ["array", "Standard Array"], ["manual", "Manual / Rolled"]];
		const selWrp = ee`<div class="ve-btn-group ve-mb-3"></div>`.appendTo(wrp);
		methods.forEach(([id, lbl]) => {
			const b = ee`<button class="ve-btn ${st.abilityMethod === id ? "ve-btn-primary" : "ve-btn-default"}">${lbl}</button>`
				.onn("click", () => { st.abilityMethod = id; this._initAbilitiesForMethod(); this._save(); this.render(); });
			b.appendTo(selWrp);
		});

		// racial "choose" UI
		const chooseMeta = st.racialChooseMeta();
		if (chooseMeta) {
			const cw = ee`<div class="ve-mb-2"><b>Racial bonus choice:</b> pick ${chooseMeta.count} (+${chooseMeta.amount} each)</div>`.appendTo(wrp);
			const row = ee`<div style="display:flex;gap:8px;flex-wrap:wrap"></div>`.appendTo(cw);
			chooseMeta.from.forEach(abv => {
				const checked = st.raceAbilChoices.includes(abv);
				const cb = ee`<label class="cw__chip" style="cursor:pointer">${CW.ABIL_FULL[abv]} <input type="checkbox" ${checked ? "checked" : ""}></label>`;
				cb.find?.("input");
				const input = cb.querySelector("input");
				input.addEventListener("change", () => {
					if (input.checked) { if (st.raceAbilChoices.length < chooseMeta.count) st.raceAbilChoices.push(abv); else input.checked = false; } else st.raceAbilChoices = st.raceAbilChoices.filter(x => x !== abv);
					this._save(); this.render();
				});
				cb.appendTo(row);
			});
		}

		if (st.abilityMethod === "pointbuy") this._renderPointBuy(wrp);
		else if (st.abilityMethod === "array") this._renderStandardArray(wrp);
		else this._renderManual(wrp);
	}

	_initAbilitiesForMethod () {
		const st = this._state;
		if (st.abilityMethod === "pointbuy") st.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		else if (st.abilityMethod === "array") st.abilitiesBase = {str: null, dex: null, con: null, int: null, wis: null, cha: null};
		else st.abilitiesBase = {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
	}

	_abilityCard (abv, inner) {
		const st = this._state;
		const racial = st.racialBonuses()[abv];
		const base = st.abilitiesBase[abv];
		const total = base == null ? null : base + racial;
		const mod = total == null ? null : CW.mod(total);
		return ee`<div class="cw__abil">
			<div class="cw__abil-name">${abv}</div>
			${inner}
			<div class="cw__abil-score">${total == null ? "—" : total}</div>
			<div class="cw__abil-mod">${mod == null ? "" : CW.fmtMod(mod)}</div>
			<div class="cw__abil-sub">${base == null ? "" : `base ${base}${racial ? ` ${CW.fmtMod(racial)} racial` : ""}`}</div>
		</div>`;
	}

	_renderPointBuy (wrp) {
		const st = this._state;
		const info = ee`<div class="ve-mb-2"></div>`.appendTo(wrp);
		const grid = ee`<div class="cw__abil-grid"></div>`.appendTo(wrp);
		const update = () => { const spent = st.pointBuySpent(); info.html(`<b>Points:</b> ${spent} / ${CW.POINT_BUY_BUDGET} spent &nbsp; <span class="ve-muted">(scores 8–15)</span>${spent > CW.POINT_BUY_BUDGET ? ` <span class="cw__err">over budget!</span>` : ""}`); };
		CW.ABILITIES.forEach(abv => {
			const dec = ee`<button class="ve-btn ve-btn-default ve-btn-xs">−</button>`.onn("click", () => { if (st.abilitiesBase[abv] > 8) { st.abilitiesBase[abv]--; this._save(); this.render(); } });
			const inc = ee`<button class="ve-btn ve-btn-default ve-btn-xs">+</button>`.onn("click", () => {
				const next = st.abilitiesBase[abv] + 1;
				if (next <= 15 && (st.pointBuySpent() - CW.POINT_BUY_COST[st.abilitiesBase[abv]] + CW.POINT_BUY_COST[next]) <= CW.POINT_BUY_BUDGET) { st.abilitiesBase[abv]++; this._save(); this.render(); }
			});
			this._abilityCard(abv, ee`<div class="ve-flex-vh-center" style="gap:6px;margin:2px 0">${dec}${inc}</div>`).appendTo(grid);
		});
		update();
	}

	_renderStandardArray (wrp) {
		const st = this._state;
		ee(wrp)`<p class="ve-muted">Assign each value (15, 14, 13, 12, 10, 8) to one ability.</p>`;
		const grid = ee`<div class="cw__abil-grid"></div>`.appendTo(wrp);
		const used = CW.ABILITIES.map(a => st.abilitiesBase[a]).filter(v => v != null);
		CW.ABILITIES.forEach(abv => {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="margin:2px 0"><option value="">—</option></select>`;
			CW.STANDARD_ARRAY.forEach(v => {
				const isUsedElsewhere = used.includes(v) && st.abilitiesBase[abv] !== v;
				const o = ee`<option value="${v}" ${isUsedElsewhere ? "disabled" : ""}>${v}</option>`; o.appendTo(sel);
			});
			sel.val(st.abilitiesBase[abv] == null ? "" : `${st.abilitiesBase[abv]}`);
			sel.onn("change", () => { const v = sel.val(); st.abilitiesBase[abv] = v === "" ? null : Number(v); this._save(); this.render(); });
			this._abilityCard(abv, sel).appendTo(grid);
		});
	}

	_renderManual (wrp) {
		const st = this._state;
		ee(wrp)`<p class="ve-muted">Enter scores directly (e.g. rolled 4d6-drop-lowest).</p>`;
		const grid = ee`<div class="cw__abil-grid"></div>`.appendTo(wrp);
		CW.ABILITIES.forEach(abv => {
			const inp = ee`<input type="number" min="1" max="30" class="ve-form-control ve-input-xs" style="width:64px;margin:2px auto" value="${st.abilitiesBase[abv] ?? 10}">`
				.onn("change", () => { st.abilitiesBase[abv] = Math.max(1, Math.min(30, parseInt(inp.val(), 10) || 10)); this._save(); this.render(); });
			this._abilityCard(abv, inp).appendTo(grid);
		});
	}

	/* ----- Step: Skills & Gear ----- */
	_renderStepSkills (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);

		// class skill choices
		const meta = st.classSkillChoiceMeta();
		ee(wrp)`<h4 class="ve-mt-0">Skill Proficiencies</h4>`;
		if (!st.classEnt) ee(wrp)`<p class="ve-muted">Choose a class first.</p>`;
		else if (meta) {
			const counter = ee`<span class="ve-muted">${st.classSkillChoices.length}/${meta.count}</span>`;
			ee(wrp)`<p class="ve-muted">From <b>${st.classEnt.name}</b>: choose ${meta.count} (${counter}).</p>`;
			this._renderChipPicker(wrp, {items: meta.from, getValue: s => s, getLabel: s => CW.skillName(s), arr: st.classSkillChoices, max: meta.count, counterEle: counter});
		} else ee(wrp)`<p class="ve-muted">No class skill choices.</p>`;

		// background fixed skills
		const bgSkills = [...st.skillProfs()].filter(s => {
			const bg = st.backgroundEnt; return (bg?.skillProficiencies || []).some(g => g[s] === true);
		});
		if (bgSkills.length) ee(wrp)`<p><b>From background:</b> ${bgSkills.map(s => CW.skillName(s)).join(", ")}</p>`;

		// Equipment
		ee(wrp)`<h4>Starting Equipment</h4>`;
		const eqWrp = ee`<div></div>`.appendTo(wrp);
		this._renderEquipment(eqWrp);
	}

	_renderEquipment (wrp) {
		const st = this._state;
		const cls = st.classEnt; const bg = st.backgroundEnt;
		const lines = [];
		(cls?.startingEquipment?.default || []).forEach(s => lines.push({src: cls.name, text: s}));
		if (bg?.startingEquipment) {
			// background equipment may be structured; render its display form
			try {
				const html = Renderer.background.getCompactRenderedString
					? null : null;
			} catch (e) { /* noop */ }
		}
		if (!lines.length) { ee(wrp)`<p class="ve-muted">No starting equipment listed (choose a class).</p>`; }
		lines.forEach((ln, ix) => {
			const opts = this._splitEquipChoice(ln.text);
			if (opts.length > 1) {
				const box = ee`<div class="ve-mb-1"><span class="ve-muted ve-small">${ln.src}:</span></div>`.appendTo(wrp);
				opts.forEach((opt, optIx) => {
					const chosen = (st.equipmentChoices[ix] ?? 0) === optIx;
					const radio = ee`<label class="ve-flex-v-center" style="gap:6px;cursor:pointer"><input type="radio" name="cw-eq-${ix}" ${chosen ? "checked" : ""}> <span>${renderInline(opt)}</span></label>`;
					radio.querySelector("input").addEventListener("change", () => { st.equipmentChoices[ix] = optIx; this._save(); });
					radio.appendTo(box);
				});
			} else {
				ee(wrp)`<div class="ve-mb-1"><span class="ve-muted ve-small">${ln.src}:</span> ${renderInline(ln.text)}</div>`;
			}
		});
		// background equipment as plain reference
		if (bg) ee(wrp)`<div class="ve-mb-1"><span class="ve-muted ve-small">${bg.name}:</span> ${this._renderBgEquip(bg)}</div>`;
	}

	_renderBgEquip (bg) {
		const eq = bg.startingEquipment;
		if (!eq) return "—";
		try {
			const parts = [];
			eq.forEach(grp => {
				const items = grp._ || grp.a || grp.b || [];
				items.forEach(it => {
					if (typeof it === "string") parts.push(renderInline(it));
					else if (it.item) parts.push(renderInline(it.displayName || it.item));
					else if (it.special) parts.push(`${it.quantity ? `${it.quantity} ` : ""}${it.special}`);
				});
			});
			return parts.join(", ") || "—";
		} catch (e) { return "—"; }
	}

	_splitEquipChoice (text) {
		// split "(a) X or (b) Y" into ["X", "Y"]; otherwise single
		if (!/\([a-d]\)/.test(text)) return [text];
		return text.split(/\s*\([a-d]\)\s*/).map(s => s.replace(/^\s*or\s+/i, "").replace(/,\s*$/, "").trim()).filter(Boolean);
	}

	/* ----- Step: Spells ----- */
	_renderStepSpells (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);
		if (!st.isCaster()) { ee(wrp)`<p class="ve-muted">This class isn't a spellcaster.</p>`; return; }

		const dc = st.spellSaveDc(); const atk = st.spellAtkBonus();
		ee(wrp)`<div class="ve-mb-2">
			<b>Spellcasting ability:</b> ${CW.ABIL_FULL[st.spellAbility()] || "—"} &nbsp;
			<b>Save DC:</b> ${dc ?? "—"} &nbsp; <b>Attack:</b> ${atk == null ? "—" : CW.fmtMod(atk)}
			<br><b>Slots:</b> ${this._fmtSlots(st.spellSlots())}
		</div>`;

		// dedupe by name so multi-edition reprints (e.g. PHB + XPHB) don't appear twice
		const dedupe = (arr) => { const seen = new Set(); return arr.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }); };
		const all = st.spellListForClass();
		const cantrips = dedupe(all.filter(s => s.level === 0).sort((a, b) => SortUtil.ascSortLower(a.name, b.name)));
		const maxLv = st.maxSpellLevel();
		const leveled = dedupe(all.filter(s => s.level >= 1 && s.level <= maxLv).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)));

		this._renderSpellPicker(wrp, `Cantrips`, cantrips, st.spellChoices.cantrips, st.cantripsKnown());
		this._renderSpellPicker(wrp, st.classEnt?.preparedSpells ? `Prepared spells` : `Spells known`, leveled, st.spellChoices.leveled, st.leveledSpellsKnown());
	}

	_fmtSlots (slots) {
		if (!slots || !Object.keys(slots).length) return "—";
		return Object.entries(slots).map(([lv, n]) => `${Parser.getOrdinalForm(+lv)}: ${n}`).join(", ");
	}

	_renderSpellPicker (wrp, label, spells, chosenArr, max) {
		const counter = ee`<span class="ve-muted ve-small">${chosenArr.length}/${max}</span>`;
		ee(wrp)`<h4 class="ve-mb-1">${label} (${counter})</h4>`;
		if (!spells.length) { ee(wrp)`<p class="ve-muted ve-small">None available at this level.</p>`; return; }
		this._renderChipPicker(wrp, {
			items: spells,
			getValue: sp => CW.uid(sp),
			getLabel: sp => `${sp.level ? `<span class="ve-muted ve-small">${sp.level}</span> ` : "✦ "}${sp.name}`,
			getTitle: sp => `${Parser.spLevelToFull(sp.level)} ${Parser.spSchoolAbvToFull(sp.school)}`,
			arr: chosenArr,
			max,
			counterEle: counter,
			gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:230px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px",
		});
	}

	/* ----- Step: Review (character sheet) ----- */
	_renderStepReview (el) {
		const st = this._state;
		const missing = [];
		if (!st.raceUid) missing.push("species");
		if (!st.classUid) missing.push("class");
		if (!st.backgroundUid) missing.push("background");
		const wrp = ee`<div class="cw__sheet"></div>`.appendTo(el);
		if (missing.length) ee(wrp)`<div class="cw__err no-print">Still missing: ${missing.join(", ")}. The sheet below fills in as you complete steps.</div>`;

		const race = st.raceEnt; const cls = st.classEnt; const bg = st.backgroundEnt; const sc = st.subclassEnt;
		const subtitle = [race?.name, bg?.name].filter(Boolean).join(" • ");
		const classLine = cls ? `${cls.name}${sc ? ` (${sc.name})` : ""} ${st.level}` : "";

		ee(wrp)`<div class="cw__sheet-head">
			<div><div style="font-size:24px;font-weight:bold">${(st.name || "Unnamed Character").qq()}</div>
			<div class="ve-muted">${[classLine, subtitle].filter(Boolean).join(" — ").qq()}</div></div>
			<div class="ve-text-right"><div><b>Proficiency Bonus</b> ${CW.fmtMod(st.profBonus)}</div>
			<div><b>Size</b> ${st.size()} &nbsp; <b>Speed</b> ${st.speedString()}</div></div>
		</div>`;

		// core stat boxes
		const hp = st.maxHp();
		const boxes = ee`<div class="cw__sheet-grid"></div>`.appendTo(wrp);
		const box = (lbl, val) => ee(boxes)`<div class="cw__stat-box"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
		box("Armor Class", cls ? st.ac() : "—");
		box("Hit Points", hp ?? "—");
		box("Hit Dice", cls ? `${st.level}d${st.hitDie()}` : "—");
		box("Initiative", CW.fmtMod(st.initiative()));
		box("Passive Perception", st.passivePerception());

		// abilities + saves
		const secA = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		ee(secA)`<h4>Ability Scores & Saving Throws</h4>`;
		const abilGrid = ee`<div class="cw__abil-grid"></div>`.appendTo(secA);
		CW.ABILITIES.forEach(abv => {
			const total = st.finalAbility(abv); const mod = st.abilityMod(abv);
			const saveProf = st.saveProfs().has(abv);
			ee(abilGrid)`<div class="cw__abil"><div class="cw__abil-name">${abv}</div>
				<div class="cw__abil-score">${total}</div><div class="cw__abil-mod">${CW.fmtMod(mod)}</div>
				<div class="cw__abil-sub">save ${CW.fmtMod(st.saveMod(abv))}${saveProf ? " ●" : ""}</div></div>`;
		});

		// skills
		const secS = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		ee(secS)`<h4>Skills</h4>`;
		const skillWrp = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(secS);
		CW.skills().sort().forEach(sk => {
			const prof = st.skillProfs().has(sk);
			ee(skillWrp)`<div style="break-inside:avoid">${prof ? "●" : "○"} ${CW.skillName(sk)} <span class="ve-muted">(${CW.ABILITIES.includes(CW.skillAbil(sk)) ? CW.skillAbil(sk) : ""})</span> <b>${CW.fmtMod(st.skillMod(sk))}</b></div>`;
		});

		// proficiencies & languages
		const awt = st.armorWeaponToolProfs();
		const secP = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		ee(secP)`<h4>Proficiencies & Languages</h4>
			<div><b>Armor:</b> ${renderInline(awt.armor.join(", ") || "—")}</div>
			<div><b>Weapons:</b> ${renderInline(awt.weapons.join(", ") || "—")}</div>
			${awt.tools.length ? `<div><b>Tools:</b> ${renderInline(awt.tools.join(", "))}</div>` : ""}
			<div><b>Languages:</b> ${st.languages().join(", ") || "—"}</div>
			${st.senses().length ? `<div><b>Senses:</b> ${st.senses().join(", ")}</div>` : ""}`;

		// spellcasting
		if (st.isCaster()) {
			const secSp = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			const chosenC = st.spellChoices.cantrips.map(u => u.split("|")[0]);
			const chosenL = st.spellChoices.leveled.map(u => u.split("|")[0]);
			ee(secSp)`<h4>Spellcasting</h4>
				<div><b>Ability:</b> ${CW.ABIL_FULL[st.spellAbility()]} &nbsp; <b>Save DC:</b> ${st.spellSaveDc()} &nbsp; <b>Attack:</b> ${CW.fmtMod(st.spellAtkBonus())}</div>
				<div><b>Slots:</b> ${this._fmtSlots(st.spellSlots())}</div>
				<div><b>Cantrips:</b> ${chosenC.join(", ") || "—"}</div>
				<div><b>${st.classEnt?.preparedSpells ? "Prepared" : "Known"}:</b> ${chosenL.join(", ") || "—"}</div>`;
		}

		// features
		const feats = st.featuresByLevel();
		if (feats.length) {
			const secF = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secF)`<h4>Class & Subclass Features</h4>`;
			feats.forEach(({level, items}) => {
				items.forEach(f => {
					const det = ee`<details style="margin:2px 0"><summary><b>L${level}:</b> ${f.name.qq()} <span class="ve-muted ve-small">(${f.kind})</span></summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`;
					det.appendTo(secF);
				});
			});
		}

		// race traits
		if (race?.entries?.length) {
			const secR = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secR)`<h4>${race.name} Traits</h4><div>${renderEntries(race.entries)}</div>`;
		}
	}
}
