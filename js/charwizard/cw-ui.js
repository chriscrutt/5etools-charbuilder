import {CW} from "../charwizard.js";

/* Small render helper: 5etools entries -> HTML string */
const renderEntries = (entries) => {
	try { return Renderer.get().setFirstSection(true).render({type: "entries", entries: entries || []}); } catch (e) { return ""; }
};
const renderInline = (str) => { try { return Renderer.get().render(`${str}`); } catch (e) { return `${str}`; } };
// inline hover attributes (5etools tooltip) for a span/element, without navigation on click
const hoverAttrs = (page, ent) => {
	try {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[page](ent);
		return `data-vet-page="${page}" data-vet-source="${`${ent.source}`.qq()}" data-vet-hash="${`${hash}`.qq()}" onmouseover="Renderer.hover.pHandleLinkMouseOver(event, this)" onmouseleave="Renderer.hover.handleLinkMouseLeave(event, this)" onmousemove="Renderer.hover.handleLinkMouseMove(event, this)" style="cursor:help;text-decoration:underline dotted"`;
	} catch (e) { return ""; }
};
// clickable + hoverable reference link that opens in a new tab
const refLink = (page, ent, label) => {
	try {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[page](ent);
		return `<a href="${page}#${`${hash}`.qq()}" target="_blank" rel="noopener noreferrer" ${hoverAttrs(page, ent)}>${`${label ?? ent.name}`.qq()}</a>`;
	} catch (e) { return `${label ?? ent?.name ?? ""}`.qq(); }
};
const spellSpan = (name, source) => refLink(UrlUtil.PG_SPELLS, {name, source});
// badge for {adv:[], dis:[], net} — adv + dis cancel to a straight roll
const advDisBadge = (ad) => {
	if (!ad || !ad.net) return "";
	if (ad.net === "both") return `<span class="cw__advdis cw__advdis--none" title="Advantage (${ad.adv.join(", ").qq()}) and disadvantage (${ad.dis.join(", ").qq()}) cancel — roll a straight d20">ADV+DIS</span>`;
	const srcs = (ad.net === "adv" ? ad.adv : ad.dis).join(", ");
	return `<span class="cw__advdis cw__advdis--${ad.net}" title="${srcs.qq()}">${ad.net === "adv" ? "ADV" : "DIS"}</span>`;
};

export class CharWizardUi {
	constructor ({data, state, eleRoot, fnSave}) {
		this._data = data;
		this._state = state;
		this._eleRoot = eleRoot;
		this._fnSave = fnSave;
		this._ixStep = 0;

		// open every reference link (rendered @tags, spells, items, etc.) in a new tab so the builder isn't navigated away
		this._eleRoot.addEventListener("click", (evt) => {
			const a = evt.target.closest?.("a[href]");
			if (!a) return;
			const href = a.getAttribute("href");
			if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
			if (a.target === "_blank") return; // links we built already open in a new tab
			evt.preventDefault();
			window.open(a.href, "_blank", "noopener,noreferrer");
		});
	}

	_save () { this._fnSave?.(); }

	// "Race" under 2014 rules, "Species" under 2024 rules
	_raceWord () { return this._data.styleHint === "one" ? "Species" : "Race"; }

	_steps () {
		const st = this._state;
		const steps = [
			{id: "race", label: this._raceWord(), done: () => !!st.raceUid, render: (el) => this._renderStepRace(el)},
			{id: "class", label: "Class", done: () => !!st.classUid, render: (el) => this._renderStepClass(el)},
			{id: "background", label: "Background", done: () => !!st.backgroundUid, render: (el) => this._renderStepBackground(el)},
			{id: "abilities", label: "Abilities", done: () => true, render: (el) => this._renderStepAbilities(el)},
		];
		steps.push({id: "skills", label: "Skills & Gear", done: () => true, render: (el) => this._renderStepSkills(el)});
		if (st.isCaster() || st.hasRacialSpells()) steps.push({id: "spells", label: "Spells", done: () => true, render: (el) => this._renderStepSpells(el)});
		steps.push({id: "review", label: "Review", done: () => true, render: (el) => this._renderStepReview(el)});
		return steps;
	}

	render () {
		const scrollTop = this._eleRoot.scrollTop || 0;
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

		if (scrollTop) this._eleRoot.scrollTop = scrollTop;
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
	_renderChooser (eleBody, {entities, getSel, setSel, renderDetail, subtitle, onAfterSelect = null}) {
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
							if (onAfterSelect) { onAfterSelect(); return; }
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
	_renderChipPicker (wrp, {items, getValue, getLabel, getTitle = null, arr, max, counterEle = null, gridStyle = "display:flex;flex-wrap:wrap;gap:4px", disabledFn = null}) {
		const grid = ee`<div style="${gridStyle}"></div>`.appendTo(wrp);
		const refresh = () => {
			const atMax = arr.length >= max;
			[...grid.querySelectorAll("label")].forEach(lbl => {
				const inp = lbl.querySelector("input"); if (!inp) return;
				const lockedReason = lbl.dataset.lockedReason;
				inp.disabled = !!lockedReason || (!inp.checked && atMax);
			});
			if (counterEle) counterEle.txt(`${arr.length}/${max}`);
		};
		items.forEach(item => {
			const val = getValue(item);
			const isChosen = arr.includes(val);
			const lock = disabledFn ? disabledFn(item) : null; // string reason or null
			const chip = ee`<label class="cw__chip ${lock ? "cw__chip--locked" : ""}" style="cursor:${lock ? "not-allowed" : "pointer"}" title="${(lock || (getTitle ? getTitle(item) : "")).qq()}">${getLabel(item)}${lock ? " ✓" : ""} <input type="checkbox" ${isChosen ? "checked" : ""}></label>`;
			if (lock) chip.dataset.lockedReason = lock;
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
			subtitle: `Choose your character's ${this._raceWord().toLowerCase()}. Ability bonuses, speed, size, and traits come from here.`,
			entities: this._data.races,
			getSel: () => this._state.raceUid,
			setSel: (uid) => { this._state.raceUid = uid; this._state.raceAbilOption = 0; this._state.raceAbilChoices = []; this._state.raceAbilWeighted = []; this._state.raceSpellChoices = {}; this._state.raceSpellAbility = null; this._state.clearProfChoicesForSource("race"); },
			renderDetail: (col, ent) => {
				let html;
				try { html = Renderer.race.getCompactRenderedString(ent); } catch (e) { html = renderEntries(ent.entries); }
				ee(col)`<table class="w-100 stats">${html}</table>`;
			},
		});
	}

	/* ----- Step: Class (multiclass-aware) ----- */
	_renderStepClass (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);
		const chosen = st.classList();

		// no class yet -> full chooser for the first (primary) class
		if (!chosen.length) {
			this._renderChooser(wrp, {
				subtitle: "Choose your class. Hit dice, saving throws, proficiencies, features, and (if any) spellcasting come from your first class.",
				entities: this._data.classData.classes,
				getSel: () => st.classes[0]?.uid || null,
				setSel: (uid) => this._setPrimaryClass(uid),
				renderDetail: (col, cls) => this._renderClassDetail(col, cls, {level: st.classes[0]?.level || 1, subclassUid: null}),
				onAfterSelect: () => this.render(),
			});
			return;
		}

		ee(wrp)`<h4 class="ve-mt-0">Classes <span class="ve-muted ve-small">— total level ${st.totalLevel}, proficiency +${st.profBonus}</span></h4>`;
		if (st.totalLevel > 20) ee(wrp)`<div class="cw__err ve-small ve-mb-2"><span class="glyphicon glyphicon-warning-sign"></span> Total level ${st.totalLevel} exceeds the maximum of 20.</div>`;
		st.classes.forEach((row, ix) => this._renderClassRow(wrp, row, ix));
		this._renderAddClass(wrp);
	}

	_setPrimaryClass (uid) {
		const st = this._state;
		const old = st.classes[0]?.uid;
		if (old === uid) return;
		st.classes[0] = {uid, level: st.classes[0]?.level || 1, subclassUid: null};
		st.classSkillChoices = [];
		st.expertiseChoices = [];
		if (old) { delete st.spellChoices[old]; Object.keys(st.asiChoices).forEach(k => { if (k.startsWith(`${old}@`)) delete st.asiChoices[k]; }); }
		st.clearProfChoicesForSource("class");
		this._save();
	}

	_addClass (uid) {
		const st = this._state;
		if (!st.classList().length) { this._setPrimaryClass(uid); return; }
		if (st.classes.some(c => c.uid === uid)) return;
		st.classes.push({uid, level: 1, subclassUid: null});
		this._save();
	}

	_removeClass (ix) {
		const st = this._state;
		const uid = st.classes[ix]?.uid;
		st.classes.splice(ix, 1);
		if (!st.classes.length) st.classes = [{uid: null, level: 1, subclassUid: null}];
		if (uid) { delete st.spellChoices[uid]; Object.keys(st.asiChoices).forEach(k => { if (k.startsWith(`${uid}@`)) delete st.asiChoices[k]; }); st.clearProfChoicesForSource(uid); }
		this._save(); this.render();
	}

	// one row in the class list: name, level, subclass, remove, collapsible detail
	_renderClassRow (wrp, row, ix) {
		const st = this._state;
		const cls = this._data.classData.classes.find(c => CW.uid(c) === row.uid);
		if (!cls) return;
		const card = ee`<div class="cw__class-row" style="border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:10px;margin-bottom:10px"></div>`.appendTo(wrp);
		const head = ee`<div class="ve-flex-v-center" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(card);
		ee(head)`<b>${ix === 0 ? `<span class="ve-muted ve-small">1st</span> ` : ""}${renderInline(`{@class ${cls.name}|${cls.source}}`)}</b>`;

		const inpLevel = ee`<input type="number" min="1" max="20" class="ve-form-control" style="width:64px" value="${row.level}">`
			.onn("change", () => { const v = Math.max(1, Math.min(20, parseInt(inpLevel.val(), 10) || 1)); row.level = v; inpLevel.val(v); this._save(); this.render(); });
		ee(head)`<label class="ve-flex-v-center" style="gap:6px">Level ${inpLevel}</label>`;

		const subs = st.subclassesForClass(cls);
		const gainLv = st.subclassGainLevel(cls);
		if (subs.length && row.level >= gainLv) {
			const sel = ee`<select class="ve-form-control" style="width:auto"><option value="">— ${(cls.subclassTitle || "Subclass").qq()} —</option></select>`;
			subs.forEach(sc => ee`<option value="${CW.uid(sc).qq()}">${sc.name} (${sc.source})</option>`.appendTo(sel));
			sel.val(row.subclassUid || "");
			sel.onn("change", () => { row.subclassUid = sel.val() || null; this._save(); this.render(); });
			ee(head)`<label class="ve-flex-v-center" style="gap:6px">${cls.subclassTitle || "Subclass"}: ${sel}</label>`;
		} else if (subs.length) {
			ee(head)`<span class="ve-muted ve-small">${cls.subclassTitle || "Subclass"} at level ${gainLv}</span>`;
		}

		if (st.classes.length > 1) {
			ee(head)`${ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove this class"><span class="glyphicon glyphicon-remove"></span></button>`.onn("click", () => this._removeClass(ix))}`;
		}

		// multiclass ability-score requirement (secondary classes only)
		if (ix > 0) {
			const req = st.multiclassRequirement(cls);
			if (req.reqText) ee(card)`<div class="ve-small ve-mt-1 ${req.ok ? "ve-muted" : "cw__err"}">Multiclass requirement: ${req.reqText.qq()}${req.ok ? " ✓" : ` — not met`}</div>`;
		}

		const det = ee`<details class="ve-mt-1"><summary class="ve-small ve-bold">Features &amp; details</summary></details>`.appendTo(card);
		det.addEventListener("toggle", () => {
			if (!det.open || det.dataset.rendered) return;
			det.dataset.rendered = "1";
			this._renderClassDetail(ee`<div class="ve-mt-1"></div>`.appendTo(det), cls, row);
		});
	}

	// "add a class" — filtered to classes the character meets multiclass prerequisites for
	_renderAddClass (wrp) {
		const st = this._state;
		const taken = new Set(st.classes.map(c => c.uid).filter(Boolean));
		const available = this._data.classData.classes.filter(cls => !taken.has(CW.uid(cls)));
		const eligible = available.filter(cls => st.canMulticlassInto(cls));
		const hidden = available.length - eligible.length;

		const det = ee`<details class="ve-mt-1"><summary class="ve-bold">＋ Add a class (multiclass)</summary></details>`.appendTo(wrp);
		const body = ee`<div class="ve-mt-2"></div>`.appendTo(det);
		det.addEventListener("toggle", () => {
			if (!det.open || det.dataset.rendered) return;
			det.dataset.rendered = "1";
			if (!eligible.length) { ee(body)`<p class="ve-muted">No classes available to add${hidden ? ` — you don't meet the ability-score requirements for the remaining ${hidden} class${hidden > 1 ? "es" : ""}.` : "."}</p>`; return; }
			this._renderChooser(body, {
				subtitle: `Pick a class to add. Only classes you meet the multiclass ability-score requirements for are shown${hidden ? ` (${hidden} hidden — requirement not met)` : ""}. Your new class starts at level 1.`,
				entities: eligible,
				getSel: () => null,
				setSel: (uid) => this._addClass(uid),
				renderDetail: (col, cls) => this._renderClassDetail(col, cls, {level: 1, subclassUid: null, mc: true}),
				onAfterSelect: () => this.render(),
			});
		});
	}

	_renderClassDetail (col, cls, opts = null) {
		const st = this._state;
		let level = 1; let subEnt = null;
		if (opts) { level = opts.level || 1; subEnt = opts.subclassEnt ?? st._subclassEntFor(cls, opts.subclassUid); } else { const inBuild = st.classList().find(c => c.uid === CW.uid(cls)); level = inBuild?.level || 1; subEnt = inBuild?.subclassEnt || null; }
		const hd = cls.hd ? `d${cls.hd.faces}` : "—";
		const saves = (cls.proficiency || []).map(a => CW.ABIL_FULL[a]).join(", ") || "—";
		const sp = cls.startingProficiencies || {};
		const skillMeta = (sp.skills || []).find(g => g?.choose);
		const skillsText = skillMeta ? `Choose ${skillMeta.choose.count} from ${(skillMeta.choose.from || []).map(s => s.toTitleCase()).join(", ")}` : "—";
		// when adding as a multiclass, show the limited proficiencies gained instead of the full starting set
		const mc = opts?.mc ? cls.multiclassing : null;
		const mcProf = mc?.proficienciesGained;
		ee(col)`<div>
			<h4 class="ve-mt-0">${cls.name} <span class="ve-muted ve-small">(${cls.source})</span></h4>
			<div><b>Hit Die:</b> ${hd}${opts?.mc ? "" : ` &nbsp; <b>Saving Throws:</b> ${saves}`}</div>
			${opts?.mc && mc?.requirements ? `<div><b>Multiclass req:</b> ${st.multiclassRequirement(cls).reqText.qq()}</div>` : ""}
			<div><b>${opts?.mc ? "Proficiencies gained" : "Armor"}:</b> ${renderInline((mcProf ? mcProf.armor : sp.armor || []).map(a => `${typeof a === "string" ? a : a.proficiency || ""}`).join(", ") || "—")}${opts?.mc ? "" : ""}</div>
			${opts?.mc ? "" : `<div><b>Weapons:</b> ${renderInline((sp.weapons || []).map(a => `${typeof a === "string" ? a : a.proficiency || ""}`).join(", ") || "—")}</div>`}
			${opts?.mc && mcProf ? `<div><b>Weapons/tools:</b> ${renderInline([...(mcProf.weapons || []), ...(mcProf.tools || [])].map(a => `${typeof a === "string" ? a : a.proficiency || ""}`).join(", ") || "—")}</div>` : ""}
			${opts?.mc && mcProf?.skills ? `<div><b>Skills:</b> ${mcProf.skills.map(g => g.choose ? `choose ${g.choose.count || 1} from ${(g.choose.from || []).map(s => s.toTitleCase()).join(", ")}` : "").filter(Boolean).join("; ").qq()}</div>` : ""}
			${opts?.mc ? "" : `<div><b>Skills:</b> ${skillsText.qq()}</div>`}
			${cls.spellcastingAbility ? `<div><b>Spellcasting:</b> ${CW.ABIL_FULL[cls.spellcastingAbility]} (${cls.casterProgression || "?"} caster)</div>` : ""}
		</div>`;
		if (opts?.mc) ee(col)`<div class="ve-muted ve-small ve-mt-1">Multiclassing grants only a limited set of this class's proficiencies (not its saving throws or full skill list).</div>`;

		if ((cls.classTableGroups || []).length) {
			const tblDet = ee`<details class="ve-mt-2"><summary class="ve-bold">Class progression table</summary></details>`.appendTo(col);
			ee`<div style="overflow-x:auto">${this._classTableHtml(cls)}</div>`.appendTo(tblDet);
		}

		ee(col)`<h4 class="ve-mt-2">Class Features</h4>`;
		this._renderFeaturesFull(col, cls.classFeatures || [], level);

		const subs = st.subclassesForClass(cls);
		if (subEnt) {
			ee(col)`<h4 class="ve-mt-2">${subEnt.name.qq()} <span class="ve-muted ve-small">(${(cls.subclassTitle || "Subclass").qq()})</span></h4>`;
			this._renderFeaturesFull(col, subEnt.subclassFeatures || [], level);
		} else if (subs.length) {
			ee(col)`<p class="ve-muted ve-mt-2"><b>${(cls.subclassTitle || "Subclass")}s</b> (${subs.length}): ${subs.map(s => s.name).join(", ").qq()}.<br>Available at level ${st.subclassGainLevel(cls)}.</p>`;
		}
	}

	// Collapsible full-text features, keyed by each feature's own level (works for class + subclass).
	// Features <= curLevel shown; higher levels behind a button.
	_renderFeaturesFull (col, featuresByLevel, curLevel) {
		const all = [];
		(featuresByLevel || []).forEach((lvArr, ix) => {
			(lvArr || []).forEach(f => { if (f?.name && !f.isClassFeatureVariant) all.push({...f, _lvl: f.level || (ix + 1)}); });
		});
		all.sort((a, b) => a._lvl - b._lvl);
		const maxLv = all.length ? Math.max(...all.map(f => f._lvl)) : 20;
		const renderInto = (target, f) => {
			ee`<details style="margin:2px 0"><summary><b>L${f._lvl}:</b> ${f.name.qq()}</summary><div class="ve-pl-3 ve-small ve-mt-1">${renderEntries(f.entries)}</div></details>`.appendTo(target);
		};
		const upTo = all.filter(f => f._lvl <= curLevel);
		const higher = all.filter(f => f._lvl > curLevel);
		if (!upTo.length) ee(col)`<p class="ve-muted ve-small">No features through level ${curLevel}.</p>`;
		upTo.forEach(f => renderInto(col, f));
		if (higher.length) {
			const btn = ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-mt-1">Show higher-level features (L${curLevel + 1}–${maxLv})</button>`.appendTo(col);
			const moreWrp = ee`<div></div>`.appendTo(col);
			btn.onn("click", () => { btn.remove(); higher.forEach(f => renderInto(moreWrp, f)); });
		}
	}

	// Build the class progression table (Level / Prof / Features / class-table columns + spell slots) as HTML.
	_classTableHtml (cls) {
		const cols = [];
		(cls.classTableGroups || []).forEach(g => {
			const rows = g.rowsSpellProgression || g.rows || [];
			(g.colLabels || []).forEach((lbl, ci) => cols.push({lbl, rows, ci, title: g.title}));
		});
		const cell = (v) => {
			if (v == null || v === "" || v === 0) return "—";
			if (typeof v === "number") return `${v}`;
			if (typeof v === "string") return renderInline(v);
			if (v.entry != null) return renderInline(v.entry);
			if (v.type === "bonus") return CW.fmtMod(v.value);
			if (v.type === "bonusSpeed") return `+${v.value} ft.`;
			if (v.value != null) return `${v.value}`;
			return "—";
		};
		let html = `<table class="w-100 ve-small cw__class-tbl"><thead><tr><th>Level</th><th>Prof</th><th>Features</th>${cols.map(c => `<th>${renderInline(c.lbl)}</th>`).join("")}</tr></thead><tbody>`;
		for (let lv = 1; lv <= 20; ++lv) {
			const feats = (cls.classFeatures[lv - 1] || []).filter(f => f?.name && !f.isClassFeatureVariant).map(f => f.name.qq()).join(", ") || "—";
			html += `<tr><td>${Parser.getOrdinalForm(lv)}</td><td>${CW.fmtMod(CW.profBonus(lv))}</td><td class="cw__class-tbl-feat">${feats}</td>`;
			cols.forEach(c => { html += `<td>${cell(c.rows?.[lv - 1]?.[c.ci])}</td>`; });
			html += `</tr>`;
		}
		return `${html}</tbody></table>`;
	}

	/* ----- Step: Background ----- */
	_renderStepBackground (el) {
		this._renderChooser(el, {
			subtitle: "Choose a background. It grants skill proficiencies, languages/tools, and starting equipment.",
			entities: this._data.backgrounds,
			getSel: () => this._state.backgroundUid,
			setSel: (uid) => { this._state.backgroundUid = uid; this._state.clearProfChoicesForSource("bg"); },
			renderDetail: (col, ent) => {
				let html;
				try { html = Renderer.background.getCompactRenderedString(ent); } catch (e) { html = renderEntries(ent.entries); }
				ee(col)`<table class="w-100 stats">${html}</table>`;
			},
		});
	}

	/* ----- Step: Abilities (incl. racial bonuses, ASIs & feats — so totals are complete) ----- */
	_renderStepAbilities (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);

		ee(wrp)`<p class="ve-muted ve-small">Set your base scores, then apply racial bonuses, ASIs, and feats below — the totals on the cards update live.</p>`;

		// 1) base score method + editable cards (cards show the grand total)
		const methods = [["pointbuy", "Point Buy"], ["array", "Standard Array"], ["manual", "Manual / Rolled"]];
		const selWrp = ee`<div class="ve-btn-group ve-mb-2"></div>`.appendTo(wrp);
		methods.forEach(([id, lbl]) => {
			ee`<button class="ve-btn ${st.abilityMethod === id ? "ve-btn-primary" : "ve-btn-default"}">${lbl}</button>`
				.onn("click", () => { st.abilityMethod = id; this._initAbilitiesForMethod(); this._save(); this.render(); })
				.appendTo(selWrp);
		});
		if (st.abilityMethod === "pointbuy") this._renderPointBuy(wrp);
		else if (st.abilityMethod === "array") this._renderStandardArray(wrp);
		else this._renderManual(wrp);

		// 2) racial bonuses
		ee(wrp)`<hr class="hr-2 ve-mt-3">`;
		this._renderRacialAbility(wrp);

		// 3) ASIs & feats (merged here so the totals above reflect them)
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4 class="ve-mt-0">Ability Score Improvements &amp; Feats</h4>`;
		if (st.asiSlots().length) this._renderStepAsi(wrp);
		else ee(wrp)`<div class="ve-muted ve-small">${st.classUid ? `No Ability Score Improvements available yet (each class's first is usually at its level 4).` : "Choose a class first."}</div>`;
	}

	/* ----- Racial ability bonuses (fixed / choose / weighted; multi-option) ----- */
	_renderRacialAbility (wrp) {
		const st = this._state;
		const opts = st.raceAbilityOptions();
		if (!opts.length) {
			if (st.raceUid) ee(wrp)`<div class="ve-mb-2 ve-muted ve-small">This ${this._raceWord().toLowerCase()} grants no ability score increases${this._data.styleHint === "one" ? " — under 2024 rules, ability bonuses come from your background." : "."}</div>`;
			return;
		}
		const box = ee`<div class="ve-mb-3"></div>`.appendTo(wrp);
		ee(box)`<div class="ve-mb-1"><b>Racial Ability Bonuses</b> <span class="ve-muted ve-small">(${st.raceEnt.name.qq()})</span></div>`;
		if (opts.length > 1) {
			ee(box)`<div class="ve-muted ve-small ve-mb-1">Choose one option:</div>`;
			const optRow = ee`<div class="ve-btn-group ve-mb-2"></div>`.appendTo(box);
			opts.forEach((opt, i) => {
				const active = (st.raceAbilOption || 0) === i;
				ee`<button class="ve-btn ve-btn-xs ${active ? "ve-btn-primary" : "ve-btn-default"}">${String.fromCharCode(97 + i)}) ${this._raceAbilOptionLabel(opt).qq()}</button>`
					.onn("click", () => { st.raceAbilOption = i; st.raceAbilChoices = []; st.raceAbilWeighted = []; this._save(); this.render(); })
					.appendTo(optRow);
			});
		}
		this._renderRaceAbilityOption(box, st.activeRaceAbilityOption());
	}

	_raceAbilOptionLabel (opt) {
		if (opt.choose?.weighted) return (opt.choose.weighted.weights || []).map(w => `+${w}`).join(" / ");
		if (opt.choose) return `choose ${opt.choose.count || 1} (+${opt.choose.amount || 1})`;
		const fixed = Object.entries(opt).filter(([k]) => CW.ABILITIES.includes(k)).map(([k, v]) => `${CW.fmtMod(v)} ${k.toUpperCase()}`);
		return fixed.join(", ") || "—";
	}

	_renderRaceAbilityOption (box, ab) {
		const st = this._state;
		if (!ab) return;
		const fixed = Object.entries(ab).filter(([k, v]) => CW.ABILITIES.includes(k) && typeof v === "number");
		if (fixed.length) ee(box)`<div class="ve-mb-1"><b>Fixed:</b> ${fixed.map(([k, v]) => `${CW.fmtMod(v)} ${CW.ABIL_FULL[k]}`).join(", ")}</div>`;
		const ch = ab.choose;
		if (ch?.weighted) this._renderRaceAbilityWeighted(box, ch.weighted);
		else if (ch) {
			const from = ch.from || CW.ABILITIES; const count = ch.count || 1; const amount = ch.amount || 1;
			const counter = ee`<span class="ve-muted">${st.raceAbilChoices.length}/${count}</span>`;
			ee(box)`<div class="ve-mb-1">Choose ${count} different (+${amount} each) (${counter}):</div>`;
			this._renderChipPicker(box, {items: from, getValue: a => a, getLabel: a => CW.ABIL_FULL[a] || a, arr: st.raceAbilChoices, max: count, counterEle: counter});
		}
	}

	_renderRaceAbilityWeighted (box, weighted) {
		const st = this._state;
		const weights = weighted.weights || [];
		let from = (weighted.from || CW.ABILITIES).filter(a => CW.ABILITIES.includes(a));
		if (!from.length) from = CW.ABILITIES;
		st.raceAbilWeighted = st.raceAbilWeighted || [];
		st.raceAbilWeighted.length = weights.length;
		ee(box)`<div class="ve-muted ve-small ve-mb-1">Assign each bonus to a different ability:</div>`;
		const row = ee`<div class="ve-flex-v-center" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(box);
		weights.forEach((w, i) => {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— ability —</option></select>`;
			from.forEach(abv => {
				const usedElsewhere = st.raceAbilWeighted.some((a, j) => j !== i && a === abv);
				ee`<option value="${abv}" ${usedElsewhere ? "disabled" : ""}>${CW.ABIL_FULL[abv]}</option>`.appendTo(sel);
			});
			sel.val(st.raceAbilWeighted[i] || "");
			sel.onn("change", () => { st.raceAbilWeighted[i] = sel.val(); this._save(); this.render(); });
			ee(row)`<label class="ve-flex-v-center" style="gap:4px"><b>+${w} to</b> ${sel}</label>`;
		});
	}

	_initAbilitiesForMethod () {
		const st = this._state;
		if (st.abilityMethod === "pointbuy") st.abilitiesBase = {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8};
		else if (st.abilityMethod === "array") st.abilitiesBase = {str: null, dex: null, con: null, int: null, wis: null, cha: null};
		else st.abilitiesBase = {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
	}

	_abilityCard (abv, inner) {
		const st = this._state;
		const base = st.abilitiesBase[abv];
		const racial = st.racialBonuses()[abv];
		const asi = st.asiBonuses()[abv];
		const clsf = st.classFeatureAbilityBonuses()[abv];
		const total = base == null ? null : st.finalAbility(abv);
		const mod = total == null ? null : CW.mod(total);
		const parts = [];
		if (base != null) parts.push(`base ${base}`);
		if (racial) parts.push(`${CW.fmtMod(racial)} race`);
		if (asi) parts.push(`${CW.fmtMod(asi)} ASI`);
		if (clsf) parts.push(`${CW.fmtMod(clsf)} class`);
		return ee`<div class="cw__abil">
			<div class="cw__abil-name">${abv}</div>
			${inner}
			<div class="cw__abil-score">${total == null ? "—" : total}</div>
			<div class="cw__abil-mod">${mod == null ? "" : CW.fmtMod(mod)}</div>
			<div class="cw__abil-sub">${base == null ? "" : parts.join(" ")}</div>
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

	/* ----- Step: ASI & Feats (one slot per class's ASI level) ----- */
	_renderStepAsi (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);
		const slots = st.asiSlots();
		ee(wrp)`<p class="ve-muted">You have ${slots.length} Ability Score Improvement${slots.length > 1 ? "s" : ""} to assign — each can instead be a feat. Ability increases below are applied to your scores automatically.</p>`;
		const feats = [...this._data.feats].sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		slots.forEach(slot => {
			const key = slot.key;
			if (!st.asiChoices[key]) st.asiChoices[key] = {type: "asi", plan: "one", inc: {}};
			const ch = st.asiChoices[key];
			const card = ee`<div style="border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:10px;margin-bottom:10px"></div>`.appendTo(wrp);
			const label = st.isMulticlassed() ? `${slot.className} — level ${slot.classLevel}` : `Level ${slot.classLevel}`;
			ee(card)`<div class="ve-flex-v-center" style="gap:12px"><b>${label.qq()}</b>${this._asiModeToggle(key, ch)}</div>`;
			const body = ee`<div class="ve-mt-2"></div>`.appendTo(card);
			if (ch.type === "asi") this._renderAsiAbility(body, ch);
			else this._renderAsiFeat(body, key, ch, feats);
		});
	}

	_asiModeToggle (key, ch) {
		const mk = (id, lbl) => ee`<button class="ve-btn ve-btn-xs ${ch.type === id ? "ve-btn-primary" : "ve-btn-default"}">${lbl}</button>`
			.onn("click", () => {
				if (ch.type === id) return;
				this._state.asiChoices[key] = id === "asi" ? {type: "asi", plan: "one", inc: {}} : {type: "feat", featUid: null, featAbilChoose: []};
				this._save(); this.render();
			});
		return ee`<div class="ve-btn-group">${mk("asi", "Ability Scores")}${mk("feat", "Feat")}</div>`;
	}

	_renderAsiAbility (body, ch) {
		const st = this._state;
		const planSel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="one">+2 to one ability</option><option value="two">+1 to two abilities</option></select>`;
		planSel.val(ch.plan || "one");
		planSel.onn("change", () => { ch.plan = planSel.val(); ch.inc = {}; this._save(); this.render(); });
		ee(body)`<label class="ve-flex-v-center" style="gap:6px">Improvement ${planSel}</label>`;
		const incKeys = Object.keys(ch.inc || {});
		const mkAbilSel = (slotIx, amount) => {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— ability —</option></select>`;
			CW.ABILITIES.forEach(abv => { ee`<option value="${abv}">${CW.ABIL_FULL[abv]} (${st.finalAbility(abv)} → ${st.finalAbility(abv) + amount})</option>`.appendTo(sel); });
			sel.val(incKeys[slotIx] || "");
			sel.onn("change", () => {
				const cur = [...incKeys]; cur[slotIx] = sel.val();
				const inc = {};
				if (ch.plan === "one") { if (cur[0]) inc[cur[0]] = 2; } else { if (cur[0]) inc[cur[0]] = (inc[cur[0]] || 0) + 1; if (cur[1]) inc[cur[1]] = (inc[cur[1]] || 0) + 1; }
				ch.inc = inc; this._save(); this.render();
			});
			return sel;
		};
		const row = ee`<div class="ve-flex-v-center ve-mt-1" style="gap:8px;flex-wrap:wrap"></div>`.appendTo(body);
		if (ch.plan === "two") { mkAbilSel(0, 1).appendTo(row); mkAbilSel(1, 1).appendTo(row); } else mkAbilSel(0, 2).appendTo(row);
		// cap warning
		const over = CW.ABILITIES.filter(a => st.finalAbility(a) > 20);
		if (over.length) ee(body)`<div class="cw__err ve-small">Note: ${over.map(a => a.toUpperCase()).join(", ")} now exceeds 20 (ASIs normally cap at 20).</div>`;
	}

	_renderAsiFeat (body, key, ch, feats) {
		const st = this._state;
		const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:340px"><option value="">— choose a feat —</option></select>`;
		let hiddenForPrereq = 0;
		feats.forEach(f => {
			const uid = CW.uid(f);
			const takenElsewhere = st.featsTaken().some(t => t.featUid === uid && t.key !== key);
			const meets = st.meetsFeatPrereq(f);
			if (!meets && ch.featUid !== uid) { hiddenForPrereq++; return; } // filter out feats you don't qualify for
			ee`<option value="${uid.qq()}" ${takenElsewhere ? "disabled" : ""}>${f.name} (${f.source})${takenElsewhere ? " — taken" : ""}</option>`.appendTo(sel);
		});
		sel.val(ch.featUid || "");
		sel.onn("change", () => { ch.featUid = sel.val() || null; ch.featAbilChoose = []; this._save(); this.render(); });
		ee(body)`<label class="ve-flex-v-center" style="gap:6px">Feat ${sel}</label>${hiddenForPrereq ? `<span class="ve-muted ve-small ve-ml-2">(${hiddenForPrereq} hidden — prerequisites not met)</span>` : ""}`;
		if (!ch.featUid) return;
		const feat = this._data.feats.find(f => CW.uid(f) === ch.featUid);
		if (!feat) return;
		if (feat.prerequisite) {
			let preHtml = ""; try { preHtml = Renderer.utils.prerequisite.getHtml(feat.prerequisite) || ""; } catch (e) { preHtml = ""; }
			if (preHtml) ee(body)`<div class="ve-small ve-muted ve-mt-1">Prerequisite: ${preHtml}</div>`;
		}
		(feat.ability || []).forEach(ab => {
			if (!ab.choose) {
				const fixed = Object.entries(ab).filter(([k]) => CW.ABILITIES.includes(k)).map(([k, v]) => `${CW.fmtMod(v)} ${k.toUpperCase()}`);
				if (fixed.length) ee(body)`<div class="ve-small ve-mt-1"><b>Grants:</b> ${fixed.join(", ")}</div>`;
				return;
			}
			const cnt = ab.choose.count || 1;
			ch.featAbilChoose = ch.featAbilChoose || [];
			const counter = ee`<span class="ve-muted">${ch.featAbilChoose.length}/${cnt}</span>`;
			ee(body)`<div class="ve-mt-1 ve-small"><b>+${ab.choose.amount || 1}</b> to ${cnt} of (${counter}):</div>`;
			this._renderChipPicker(body, {items: ab.choose.from, getValue: a => a, getLabel: a => CW.ABIL_FULL[a], arr: ch.featAbilChoose, max: cnt, counterEle: counter});
		});
		ee`<div class="ve-mt-2 ve-small">${renderEntries(feat.entries)}</div>`.appendTo(body);
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
			ee(wrp)`<p class="ve-muted">From <b>${st.classEnt.name}</b>: choose ${meta.count} (${counter}). <span class="ve-small">Skills you already have are locked — pick different ones so nothing is wasted.</span></p>`;
			const already = new Set([...st.skillProfs()]); st.classSkillChoices.forEach(s => already.delete(s));
			this._renderChipPicker(wrp, {
				items: meta.from,
				getValue: s => s,
				getLabel: s => CW.skillName(s),
				arr: st.classSkillChoices,
				max: meta.count,
				counterEle: counter,
				disabledFn: s => already.has(s) ? "Already proficient (from background, race, or another choice)" : null,
			});
		} else ee(wrp)`<p class="ve-muted">No class skill choices.</p>`;

		// background fixed skills
		const bgSkills = [...st.skillProfs()].filter(s => {
			const bg = st.backgroundEnt; return (bg?.skillProficiencies || []).some(g => g[s] === true);
		});
		if (bgSkills.length) ee(wrp)`<p><b>From background:</b> ${bgSkills.map(s => CW.skillName(s)).join(", ")}</p>`;

		// Expertise (Rogue/Bard) — double proficiency on chosen skills you're already proficient in
		const expSlots = st.expertiseSlots();
		if (expSlots > 0) {
			st.expertiseChoices = st.expertiseChoices.filter(s => st.skillProfs().has(s)); // drop stale picks
			const proficientSkills = [...st.skillProfs()].filter(s => CW.skillAbil(s)).sort();
			const counter = ee`<span class="ve-muted">${st.expertiseChoices.length}/${expSlots}</span>`;
			ee(wrp)`<p class="ve-mt-2"><b>Expertise</b> <span class="ve-muted">— double your proficiency bonus on ${expSlots} skill${expSlots > 1 ? "s" : ""} you're proficient in (${counter})</span></p>`;
			if (!proficientSkills.length) ee(wrp)`<p class="ve-muted ve-small">Choose your skill proficiencies first.</p>`;
			else this._renderChipPicker(wrp, {items: proficientSkills, getValue: s => s, getLabel: s => CW.skillName(s), arr: st.expertiseChoices, max: expSlots, counterEle: counter});
		}

		// Languages / tools / race+bg skill choices
		this._renderProficiencyChoices(wrp);

		// Defense / armor — you can only wear armor/shields you own (equip from the Inventory below)
		ee(wrp)`<h4>Defense (Armor Class)</h4>`;
		const invArmors = st.inventoryArmors();
		const defWrp = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(wrp);
		const armorSel = ee`<select class="ve-form-control ve-input-xs" style="max-width:280px"><option value="">No armor (unarmored)</option></select>`;
		invArmors.forEach(a => { ee`<option value="${CW.uid(a).qq()}">${a.name} — AC ${a.ac || "?"} (${`${a.type || ""}`.split("|")[0]})</option>`.appendTo(armorSel); });
		armorSel.val(st.armorEnt() ? st.armorUid : "");
		armorSel.onn("change", () => { st.armorUid = armorSel.val() || null; this._save(); this.render(); });
		if (!invArmors.length) armorSel.attr("disabled", "true");
		const hasShield = st.hasShieldInInventory();
		const shieldCb = ee`<label class="ve-flex-v-center" style="gap:6px;cursor:pointer" title="${hasShield ? "" : "Add a shield to your inventory to use one"}"><input type="checkbox" ${st.isShieldEffective() ? "checked" : ""} ${hasShield ? "" : "disabled"}> Shield (+2)</label>`;
		shieldCb.querySelector("input").addEventListener("change", (e) => { st.isShield = e.target.checked; this._save(); this.render(); });
		ee(defWrp)`<label class="ve-flex-v-center" style="gap:6px">Armor ${armorSel}</label>${shieldCb}`;
		ee(wrp)`<div class="ve-mb-1"><b>Armor Class: ${st.ac()}</b> <span class="ve-muted ve-small">— ${st.acBreakdown().how.qq()}</span></div>`;
		if (!invArmors.length && !hasShield) ee(wrp)`<div class="ve-muted ve-small ve-mb-2">Add armor or a shield to your inventory below to equip it.</div>`;
		st.armorProficiencyWarnings().forEach(w => ee(wrp)`<div class="cw__err ve-small ve-mb-1"><span class="glyphicon glyphicon-warning-sign"></span> ${w.qq()}</div>`);

		// Equipment choices (a)/(b)
		ee(wrp)`<h4>Starting Equipment <span class="ve-muted ve-small">(choose options, then add to inventory)</span></h4>`;
		const eqWrp = ee`<div></div>`.appendTo(wrp);
		this._renderEquipment(eqWrp);

		// Inventory
		this._renderInventory(wrp);
	}

	/* ----- Inventory ----- */
	_renderInventory (wrp) {
		const st = this._state;
		ee(wrp)`<h4 class="ve-mt-3">Inventory</h4>`;
		const ctrl = ee`<div class="ve-flex-v-center ve-mb-2" style="gap:8px;flex-wrap:wrap"></div>`.appendTo(wrp);
		const btnAdd = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Resolve your chosen class + background starting gear into items">＋ Add starting equipment</button>`
			.onn("click", () => { st.addStartingEquipmentToInventory(); this._save(); this.render(); });
		const btnClear = ee`<button class="ve-btn ve-btn-danger ve-btn-xs">Clear</button>`
			.onn("click", () => { st.inventory = []; this._save(); this.render(); });
		ee(ctrl)`${btnAdd}${btnClear}`;

		// search-add (results flow inline below the input)
		const searchWrp = ee`<div style="max-width:320px"></div>`.appendTo(wrp);
		const search = ee`<input class="ve-form-control ve-input-xs" placeholder="Search items to add…">`.appendTo(searchWrp);
		const results = ee`<div class="cw__pick-list" style="max-height:200px;display:none"></div>`.appendTo(searchWrp);
		const listWrp = ee`<div class="ve-mt-2"></div>`.appendTo(wrp);
		const renderList = () => this._renderInventoryList(listWrp);
		search.onn("input", () => {
			const t = search.val().toLowerCase().trim();
			results.empty();
			if (t.length < 2) { results.style.display = "none"; return; }
			const matches = (this._data.items || []).filter(it => it.name.toLowerCase().includes(t)).slice(0, 20);
			results.style.display = matches.length ? "block" : "none";
			matches.forEach(it => {
				ee`<div class="cw__pick"><span>${it.name}</span><span class="cw__pick-src">${it.source}</span></div>`
					.onn("click", () => { st.addToInventory({uid: CW.uid(it), name: it.name, qty: 1}); this._save(); search.val(""); results.empty(); results.style.display = "none"; renderList(); })
					.appendTo(results);
			});
		});

		renderList();
	}

	_renderInventoryList (listWrp) {
		const st = this._state;
		listWrp.empty();
		if (!st.inventory.length) { ee(listWrp)`<p class="ve-muted ve-small">No items yet — add your starting equipment or search above.</p>`; return; }
		const tbl = ee`<table class="w-100"><tbody></tbody></table>`.appendTo(listWrp);
		const tb = tbl.querySelector("tbody");
		st.inventory.forEach((row, ix) => {
			const tr = ee`<tr style="border-bottom:1px solid rgba(127,127,127,.15)"></tr>`.appendTo(tb);
			const nameCell = ee`<td class="ve-py-1"></td>`.appendTo(tr);
			if (row.choiceCategory && !row.uid) {
				// unresolved "choose a weapon" slot -> dropdown of matching weapons
				const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:220px"><option value="">— choose ${`a ${row.name}`.replace(" (choose)", "").qq()} —</option></select>`;
				st.weaponOptions(row.choiceCategory).forEach(n => ee`<option>${n.qq()}</option>`.appendTo(sel));
				sel.onn("change", () => {
					const name = sel.val(); if (!name) return;
					const it = st._resolveItem(name, "");
					row.uid = it ? CW.uid(it) : null; row.name = it ? it.name : name; delete row.choiceCategory;
					this._save(); this._renderInventoryList(listWrp);
				});
				nameCell.appendChild(sel);
			} else {
				ee(nameCell)`${row.uid ? renderInline(`{@item ${row.name}|${row.uid.split("|")[1]}}`) : `${row.name}`.qq()}`;
			}
			// "Wear" control for mundane armor/shields -> drives AC
			const armorEnt = row.uid ? (this._data.armors || []).find(a => CW.uid(a) === row.uid) : null;
			const wearCell = ee`<td class="ve-py-1 ve-text-center"></td>`.appendTo(tr);
			if (armorEnt) {
				const typeAbv = `${armorEnt.type || ""}`.split("|")[0];
				const isShieldItem = typeAbv === "S";
				const worn = isShieldItem ? st.isShield : st.armorUid === row.uid;
				ee`<button class="ve-btn ve-btn-xs ${worn ? "ve-btn-success" : "ve-btn-default"}">${worn ? "Worn ✓" : "Wear"}</button>`
					.onn("click", () => {
						if (isShieldItem) st.isShield = !st.isShield;
						else st.armorUid = worn ? null : row.uid;
						this._save(); this.render();
					})
					.appendTo(wearCell);
			}
			const dec = ee`<button class="ve-btn ve-btn-default ve-btn-xs">−</button>`.onn("click", () => { if (row.qty > 1) { row.qty--; } else { st.removeFromInventory(ix); } this._save(); this._renderInventoryList(listWrp); });
			const inc = ee`<button class="ve-btn ve-btn-default ve-btn-xs">+</button>`.onn("click", () => { row.qty++; this._save(); this._renderInventoryList(listWrp); });
			ee(tr)`<td class="ve-py-1 ve-text-center" style="white-space:nowrap">${dec} <b>${row.qty}</b> ${inc}</td>`;
			const rm = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove"><span class="glyphicon glyphicon-remove"></span></button>`.onn("click", () => { st.removeFromInventory(ix); this._save(); this._renderInventoryList(listWrp); });
			ee(tr)`<td class="ve-py-1 ve-text-right">${rm}</td>`;
		});
	}

	_renderEquipment (wrp) {
		const st = this._state;
		const cls = st.classEnt; const bg = st.backgroundEnt;
		const lines = [];
		(cls?.startingEquipment?.default || []).forEach(s => lines.push({src: cls.name, text: s}));
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

	/* ----- choosable proficiencies (languages / tools / race+bg skill choices) ----- */
	_renderProficiencyChoices (wrp) {
		const st = this._state;
		const groups = st.proficiencyChoiceGroups();
		if (!groups.length) return;
		ee(wrp)`<h4 class="ve-mt-3">Languages, Tools &amp; Other Choices</h4>`;
		groups.forEach(g => {
			if (!st.profChoices[g.key]) st.profChoices[g.key] = [];
			const arr = st.profChoices[g.key];
			const norm = (o) => g.type === "skill" ? o : `${o}`.toTitleCase();
			const already = this._alreadyHasForGroup(g);
			const counter = ee`<span class="ve-muted">${arr.length}/${g.count}</span>`;
			ee(wrp)`<div class="ve-mt-2 ve-mb-1">${g.label.qq()} (${counter}):</div>`;
			this._renderChipPicker(wrp, {
				items: g.options,
				getValue: o => norm(o),
				getLabel: o => g.type === "skill" ? CW.skillName(o) : `${o}`.toTitleCase(),
				arr,
				max: g.count,
				counterEle: counter,
				disabledFn: o => already.has(norm(o)) ? "Already proficient" : null,
				gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:200px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px",
			});
		});
	}

	_alreadyHasForGroup (g) {
		const st = this._state;
		const out = new Set();
		const otherChoices = (type) => st.proficiencyChoiceGroups().filter(x => x.type === type && x.key !== g.key).forEach(x => (st.profChoices[x.key] || []).forEach(v => out.add(type === "tool" ? `${v}`.toTitleCase() : v)));
		if (g.type === "skill") { st.fixedSkillProfs().forEach(s => out.add(s)); st.classSkillChoices.forEach(s => out.add(s)); otherChoices("skill"); } else if (g.type === "language") { st.fixedLanguages().forEach(l => out.add(l)); otherChoices("language"); } else { st.fixedTools().forEach(t => out.add(t)); otherChoices("tool"); }
		return out;
	}

	_renderBgEquip (bg) {
		const eq = bg.startingEquipment;
		if (!eq) return "—";
		// build proper {@item ...} tags so items are clickable links (matching the Backgrounds page)
		const fmtItem = (ref, display) => `{@item ${ref}${display ? `|${display}` : ""}}`;
		try {
			const parts = [];
			eq.forEach(grp => {
				const items = grp._ || grp.a || grp.b || [];
				items.forEach(it => {
					if (typeof it === "string") parts.push(renderInline(fmtItem(it)));
					else if (it.item) parts.push(renderInline(fmtItem(it.item, it.displayName)) + (it.quantity > 1 ? ` ×${it.quantity}` : ""));
					else if (it.special) parts.push(`${it.quantity ? `${it.quantity} ` : ""}${it.special}`.qq());
				});
			});
			return parts.join(", ") || "—";
		} catch (e) { return "—"; }
	}

	_splitEquipChoice (text) { return CW.splitEquipChoice(text); }

	/* ----- Step: Spells ----- */
	_renderStepSpells (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);
		const sources = st.spellSources();
		const nonPactMulti = sources.filter(s => s.prog !== "pact").length > 1;

		if (sources.length) {
			const slots = st.spellSlots(); const pact = st.pactSlots();
			ee(wrp)`<div class="ve-mb-2"><b>Spell Slots:</b> ${this._fmtSlots(slots)}${pact ? ` &nbsp; <b>Pact Magic:</b> ${this._fmtSlots(pact)}` : ""}${nonPactMulti ? ` <span class="ve-muted ve-small">(combined multiclass slots)</span>` : ""}</div>`;
		}

		const dedupe = (arr) => { const seen = new Set(); return arr.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }); };
		sources.forEach((src, ix) => {
			if (ix) ee(wrp)`<hr class="hr-2 ve-mt-3">`;
			const dc = st.spellSaveDcFor(src); const atk = st.spellAtkBonusFor(src);
			ee(wrp)`<h4 class="ve-mt-0">${src.name.qq()} Spellcasting</h4>
				<div class="ve-mb-2"><b>Ability:</b> ${CW.ABIL_FULL[src.ability] || "—"} &nbsp; <b>Save DC:</b> ${dc ?? "—"} &nbsp; <b>Attack:</b> ${atk == null ? "—" : CW.fmtMod(atk)}</div>`;
			const bucket = st.spellChoicesFor(src.uid);
			const all = st.spellListForSource(src);
			const cantrips = dedupe(all.filter(s => s.level === 0).sort((a, b) => SortUtil.ascSortLower(a.name, b.name)));
			const maxLv = st.maxSpellLevelForSource(src);
			const leveled = dedupe(all.filter(s => s.level >= 1 && s.level <= maxLv).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)));
			const nCantrips = st.cantripsKnownFor(src);
			if (nCantrips) this._renderSpellPicker(wrp, `Cantrips`, cantrips, bucket.cantrips, nCantrips);
			this._renderSpellPicker(wrp, src.preparedSpells ? `Prepared spells` : `Spells known`, leveled, bucket.leveled, st.leveledSpellsKnownFor(src));
		});

		if (st.hasRacialSpells()) this._renderRacialSpells(wrp);
		if (!sources.length && !st.hasRacialSpells()) ee(wrp)`<p class="ve-muted">No spellcasting.</p>`;
	}

	_renderRacialSpells (wrp) {
		const st = this._state;
		const info = st.racialSpellsInfo(); if (!info) return;
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>${st.raceEnt.name.qq()} — Innate Spellcasting</h4>`;
		if (info.abilityChoices) {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"></select>`;
			info.abilityChoices.forEach(a => ee`<option value="${a}">${CW.ABIL_FULL[a]}</option>`.appendTo(sel));
			sel.val(st.racialSpellAbility());
			sel.onn("change", () => { st.raceSpellAbility = sel.val(); this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-1"><b>Spellcasting ability:</b> ${sel} <span class="ve-muted ve-small">(Save DC ${st.racialSpellSaveDc() ?? "—"})</span></div>`;
		} else if (info.ability) ee(wrp)`<div class="ve-mb-1"><b>Spellcasting ability:</b> ${CW.ABIL_FULL[info.ability]} <span class="ve-muted ve-small">(Save DC ${st.racialSpellSaveDc() ?? "—"})</span></div>`;
		const sl = (sp) => refLink(UrlUtil.PG_SPELLS, sp);
		if (info.knownFixed.length) ee(wrp)`<div class="ve-mb-1"><b>Known:</b> ${info.knownFixed.map(sl).join(", ")}</div>`;
		if (info.innate.length) ee(wrp)`<div class="ve-mb-1"><b>Innate:</b> ${info.innate.map(i => `${sl(i.sp)} <span class="ve-muted ve-small">(${i.freq}${i.level > 1 ? `, from L${i.level}` : ""})</span>`).join(", ")}</div>`;
		info.knownChoose.forEach(g => {
			if (!st.raceSpellChoices[g.key]) st.raceSpellChoices[g.key] = [];
			const arr = st.raceSpellChoices[g.key];
			const seen = new Set();
			const opts = st.racialSpellOptions(g.filter).filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
			const counter = ee`<span class="ve-muted ve-small">${arr.length}/${g.count}</span>`;
			ee(wrp)`<div class="ve-mt-1"><b>Choose ${g.count} spell${g.count > 1 ? "s" : ""}</b> (${counter}):</div>`;
			this._renderChipPicker(wrp, {items: opts, getValue: sp => sp.name, getLabel: sp => `${sp.level ? `<span class="ve-muted ve-small">${sp.level}</span> ` : "✦ "}${sl(sp)}`, arr, max: g.count, counterEle: counter, gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:200px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px"});
		});
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
			getLabel: sp => `${sp.level ? `<span class="ve-muted ve-small">${sp.level}</span> ` : "✦ "}${refLink(UrlUtil.PG_SPELLS, sp)}`,
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
		if (!st.raceUid) missing.push(this._raceWord().toLowerCase());
		if (!st.classUid) missing.push("class");
		if (!st.backgroundUid) missing.push("background");
		const wrp = ee`<div class="cw__sheet"></div>`.appendTo(el);
		if (missing.length) ee(wrp)`<div class="cw__err no-print">Still missing: ${missing.join(", ")}. The sheet below fills in as you complete steps.</div>`;

		const race = st.raceEnt; const cls = st.classEnt; const bg = st.backgroundEnt;
		const subtitle = [race?.name, bg?.name].filter(Boolean).join(" • ");
		const classLine = st.classList().map(c => `${c.cls.name}${c.subclassEnt ? ` (${c.subclassEnt.name})` : ""} ${c.level}`).join(" / ");

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
		box("Hit Dice", st.classList().length ? st.hitDiceString() : "—");
		ee(boxes)`<div class="cw__stat-box"><div class="lbl">Initiative</div><div class="val">${CW.fmtMod(st.initiative())} ${advDisBadge(st.initiativeAdvDis())}</div></div>`;
		box("Passive Perception", st.passiveScore("perception"));
		box("Passive Investigation", st.passiveScore("investigation"));
		box("Passive Insight", st.passiveScore("insight"));

		// abilities + saves
		const secA = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		ee(secA)`<h4>Ability Scores & Saving Throws</h4>`;
		const abilGrid = ee`<div class="cw__abil-grid"></div>`.appendTo(secA);
		CW.ABILITIES.forEach(abv => {
			const total = st.finalAbility(abv); const mod = st.abilityMod(abv);
			const saveProf = st.saveProfs().has(abv);
			ee(abilGrid)`<div class="cw__abil"><div class="cw__abil-name">${abv}</div>
				<div class="cw__abil-score">${total}</div><div class="cw__abil-mod">${CW.fmtMod(mod)}</div>
				<div class="cw__abil-sub">save ${CW.fmtMod(st.saveMod(abv))}${saveProf ? " ●" : ""} ${advDisBadge(st.saveAdvDis(abv))}</div></div>`;
		});

		// skills
		const secS = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		const hpMeta = st.halfProfMeta();
		const legend = [st.expertiseSlots() ? "★ expertise" : "", "● proficient", hpMeta ? `◐ half (${hpMeta.name})` : ""].filter(Boolean).join(", ");
		ee(secS)`<h4>Skills <span class="ve-muted ve-small">(${legend.qq()})</span></h4>`;
		const skillWrp = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(secS);
		const MARK = {expertise: "★", full: "●", half: "◐", none: "○"};
		CW.skills().sort().forEach(sk => {
			ee(skillWrp)`<div style="break-inside:avoid">${MARK[st.skillProfType(sk)]} ${CW.skillName(sk)} <span class="ve-muted">(${CW.skillAbil(sk)})</span> <b>${CW.fmtMod(st.skillMod(sk))}</b> ${advDisBadge(st.skillAdvDis(sk))}</div>`;
		});

		// conditional advantages / disadvantages (from race/class/feats/background + armor)
		const notes = st.advantageNotes();
		const eff = st.armorEffects();
		if (notes.length || eff.nonProf || eff.stealthDis || eff.strReqUnmet) {
			const secAd = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secAd)`<h4>Advantages &amp; Disadvantages</h4>`;
			if (eff.nonProf) ee(secAd)`<div><span class="cw__advdis cw__advdis--dis">DIS</span> Str/Dex checks, saves &amp; attacks — wearing armor/shield you're not proficient with.</div>`;
			if (eff.stealthDis) ee(secAd)`<div><span class="cw__advdis cw__advdis--dis">DIS</span> Stealth checks — ${eff.stealthDis.qq()}.</div>`;
			if (eff.strReqUnmet) ee(secAd)`<div class="ve-muted ve-small">Speed −10 ft. — ${eff.strReqUnmet.armor.qq()} requires Str ${eff.strReqUnmet.req}.</div>`;
			notes.forEach(n => ee(secAd)`<div><span class="cw__advdis cw__advdis--${n.type}">${n.type === "adv" ? "ADV" : "DIS"}</span> ${n.text.qq()} <span class="ve-muted ve-small">(${n.sourceTag ? renderInline(n.sourceTag) : `${n.source}`.qq()})</span></div>`);
		}

		// proficiencies & languages
		const awt = st.armorWeaponToolProfs();
		const secP = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
		const tools = st.chosenTools();
		ee(secP)`<h4>Proficiencies & Languages</h4>
			<div><b>Armor:</b> ${renderInline(awt.armor.join(", ") || "—")}</div>
			<div><b>Weapons:</b> ${renderInline(awt.weapons.join(", ") || "—")}</div>
			${tools.length ? `<div><b>Tools:</b> ${tools.map(t => `${t}`.includes("{@") ? renderInline(t) : `${t}`.qq()).join(", ")}</div>` : ""}
			<div><b>Languages:</b> ${st.chosenLanguages().map(l => `${l}`.qq()).join(", ") || "—"}</div>
			${st.senses().length ? `<div><b>Senses:</b> ${st.senses().join(", ")}</div>` : ""}`;

		// inventory
		if (st.inventory.length) {
			const secInv = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secInv)`<h4>Inventory</h4>`;
			const ul = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(secInv);
			st.inventory.forEach(row => {
				const nameHtml = row.uid ? renderInline(`{@item ${row.name}|${row.uid.split("|")[1]}}`) : `${row.name}`.qq();
				ee(ul)`<div style="break-inside:avoid">${nameHtml}${row.qty > 1 ? ` ×${row.qty}` : ""}</div>`;
			});
		}

		// feats
		const featList = st.featsTaken();
		if (featList.length) {
			const secFe = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secFe)`<h4>Feats</h4>`;
			featList.forEach(({level, className, featUid}) => {
				const feat = this._data.feats.find(f => CW.uid(f) === featUid);
				if (!feat) return;
				const tag = st.isMulticlassed() ? `${className} L${level}` : `L${level}`;
				ee`<details style="margin:2px 0"><summary><b>${feat.name.qq()}</b> <span class="ve-muted ve-small">(${tag.qq()})</span></summary><div class="ve-pl-3">${renderEntries(feat.entries)}</div></details>`.appendTo(secFe);
			});
		}

		// spellcasting (per caster source)
		const spellSources = st.spellSources();
		if (spellSources.length) {
			const secSp = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			const spellSpans = (uids) => (uids || []).map(u => { const i = `${u}`.lastIndexOf("|"); return i < 0 ? `${u}`.qq() : spellSpan(`${u}`.slice(0, i), `${u}`.slice(i + 1)); }).join(", ");
			const slots = st.spellSlots(); const pact = st.pactSlots();
			ee(secSp)`<h4>Spellcasting</h4>
				<div><b>Spell Slots:</b> ${this._fmtSlots(slots)}${pact ? ` &nbsp; <b>Pact Magic:</b> ${this._fmtSlots(pact)}` : ""}</div>`;
			spellSources.forEach(src => {
				const bucket = st.spellChoices[src.uid] || {cantrips: [], leveled: []};
				const atk = st.spellAtkBonusFor(src);
				ee(secSp)`<div class="ve-mt-1"><b>${src.name.qq()}</b> <span class="ve-muted ve-small">— ${CW.ABIL_FULL[src.ability] || "—"}, DC ${st.spellSaveDcFor(src) ?? "—"}, atk ${atk == null ? "—" : CW.fmtMod(atk)}</span></div>
					<div class="ve-pl-3"><b>Cantrips:</b> ${spellSpans(bucket.cantrips) || "—"}</div>
					<div class="ve-pl-3"><b>${src.preparedSpells ? "Prepared" : "Known"}:</b> ${spellSpans(bucket.leveled) || "—"}</div>`;
			});
		}

		// racial (innate) spellcasting
		const rsi = st.hasRacialSpells() ? st.racialSpellsInfo() : null;
		if (rsi && (rsi.knownFixed.length || rsi.innate.length || rsi.knownChoose.length)) {
			const secR = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			const chosenRacial = rsi.knownChoose.flatMap(g => st.raceSpellChoices[g.key] || []);
			const knownSpans = [
				...rsi.knownFixed.map(sp => spellSpan(sp.name, sp.source)),
				...chosenRacial.map(n => { const sp = st._spellByName(n); return sp ? spellSpan(sp.name, sp.source) : `${n}`.qq(); }),
			];
			ee(secR)`<h4>${st.raceEnt.name.qq()} Innate Spellcasting</h4>
				${rsi.ability ? `<div><b>Ability:</b> ${CW.ABIL_FULL[rsi.ability]} &nbsp; <b>Save DC:</b> ${st.racialSpellSaveDc() ?? "—"}</div>` : ""}
				${knownSpans.length ? `<div><b>Known:</b> ${knownSpans.join(", ")}</div>` : ""}
				${rsi.innate.length ? `<div><b>Innate:</b> ${rsi.innate.map(i => `${spellSpan(i.sp.name, i.sp.source)} (${i.freq})`).join(", ")}</div>` : ""}`;
		}

		// features (grouped per class)
		const sections = st.featureSections();
		if (sections.length) {
			const secF = ee`<div class="cw__sheet-section"></div>`.appendTo(wrp);
			ee(secF)`<h4>Class &amp; Subclass Features</h4>`;
			sections.forEach(sec => {
				if (st.isMulticlassed()) ee(secF)`<div class="ve-bold ve-mt-2">${sec.title.qq()}</div>`;
				sec.items.forEach(f => {
					ee`<details style="margin:2px 0"><summary><b>L${f.level}:</b> ${f.name.qq()} <span class="ve-muted ve-small">(${f.kind})</span></summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`.appendTo(secF);
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
