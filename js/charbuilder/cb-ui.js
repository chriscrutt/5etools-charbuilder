import {CW, SIDEKICK_META, EFFECT_DEFS} from "../charbuilder.js";

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
	if (ad.net === "both") return `<span class="cb__advdis cb__advdis--none" title="Advantage (${ad.adv.join(", ").qq()}) and disadvantage (${ad.dis.join(", ").qq()}) cancel — roll a straight d20">ADV+DIS</span>`;
	const srcs = (ad.net === "adv" ? ad.adv : ad.dis).join(", ");
	return `<span class="cb__advdis cb__advdis--${ad.net}" title="${srcs.qq()}">${ad.net === "adv" ? "ADV" : "DIS"}</span>`;
};

// common tool proficiencies offered to an Expert sidekick (humanoid / weapon-wielding)
const SIDEKICK_TOOL_OPTIONS = [
	"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools", "Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies", "Potter's Tools", "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools",
	"Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools",
	"Dice Set", "Dragonchess Set", "Playing Card Set", "Three-Dragon Ante Set",
	"Bagpipes", "Drum", "Dulcimer", "Flute", "Lute", "Lyre", "Horn", "Pan Flute", "Shawm", "Viol",
	"Land Vehicles", "Water Vehicles",
];

// standard conditions for the play-mode condition tracker (Exhaustion is tracked separately with levels)
const CONDITIONS = ["Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];
// cumulative exhaustion effects (2014 rules), indexed by level
const EXHAUSTION_EFFECTS = ["", "Disadvantage on ability checks", "Speed halved", "Disadvantage on attack rolls and saving throws", "Hit point maximum halved", "Speed reduced to 0", "Death"];
// common buffs/debuffs offered as quick-add suggestions for the effects tracker (free text is also allowed)
const PLAY_EFFECTS = [
	"Rage", "Reckless Attack", "Bardic Inspiration", "Bless", "Bane", "Guidance", "Resistance", "Aid", "Heroism", "Enhance Ability",
	"Haste", "Slow", "Hex", "Hunter's Mark", "Hexblade's Curse", "Faerie Fire", "Divine Favor", "Hold Person", "Shield", "Barkskin", "Longstrider",
	"Shield of Faith", "Mage Armor", "Mirror Image", "Blur", "Enlarge/Reduce", "Sanctuary", "Spirit Guardians",
	"Protection from Evil and Good", "Death Ward", "Freedom of Movement", "Stoneskin", "Foresight",
];

export class CharBuilderUi {
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

	_save () { this._fnSave?.(); this._pUpdateCurrentSnapshot(); }

	// keep a lightweight snapshot of the CURRENT character in shared storage so the Tabletop's
	// "Import Character" works even before you explicitly save to the roster
	_pUpdateCurrentSnapshot () {
		clearTimeout(this._snapT);
		this._snapT = setTimeout(async () => {
			try {
				const st = this._state;
				const hasContent = (st.classList?.().length > 0) || !!(st.name && st.name.trim());
				if (!hasContent) { await StorageUtil.pRemove(CharBuilderUi._CURRENT_KEY); return; }
				await StorageUtil.pSet(CharBuilderUi._CURRENT_KEY, {summary: this._rosterSummary(), rosterId: this._rosterId || null, savedAt: Date.now()});
			} catch (e) { /* storage unavailable */ }
		}, 350);
	}

	/* ---------- My Characters: a roster of saved characters shared with the Tabletop (VTT) ---------- */
	async _pGetRoster () { try { return (await StorageUtil.pGet(CharBuilderUi._ROSTER_KEY)) || []; } catch (e) { return []; } }
	async _pSetRoster (list) { try { await StorageUtil.pSet(CharBuilderUi._ROSTER_KEY, list); } catch (e) {} }
	// denormalised snapshot the VTT can turn into a token without loading the rules engine
	_rosterSummary () {
		const st = this._state;
		try {
			const classLabel = st.classList().map(c => `${c.cls.name}${c.subclassEnt ? ` (${c.subclassEnt.name})` : ""} ${c.level}`).join(" / ");
			return {name: st.name || "Unnamed", level: st.totalLevel || 1, race: st.raceEnt?.name || "", classLabel: classLabel || "—", maxHp: st.playMaxHp(), ac: st.playAc(), sizeAbv: (st.raceEnt?.size && st.raceEnt.size[0]) || "M"};
		} catch (e) { return {name: st.name || "Unnamed", level: st.totalLevel || 1, race: "", classLabel: "—", maxHp: null, ac: null, sizeAbv: "M"}; }
	}
	async _pSaveToRoster () {
		const list = await this._pGetRoster();
		const json = this._state.toJson(); const summary = this._rosterSummary();
		let entry = this._rosterId ? list.find(x => x.id === this._rosterId) : null;
		if (entry) { entry.json = json; entry.summary = summary; entry.savedAt = Date.now(); }
		else { const id = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`; list.push({id, json, summary, savedAt: Date.now()}); this._rosterId = id; }
		await this._pSetRoster(list);
		JqueryUtil.doToast({type: "success", content: `“${`${this._state.name || "Character"}`.qq()}” saved to My Characters — import it from the Tabletop’s “Add Monster → Import Character”.`});
	}
	async _pDeleteFromRoster (id) { const list = (await this._pGetRoster()).filter(x => x.id !== id); await this._pSetRoster(list); if (this._rosterId === id) this._rosterId = null; }
	async _pOpenRoster () {
		const {eleModalInner, doClose} = UiUtil.getShowModal({title: "My Characters", isUncappedHeight: true});
		const wrp = ee`<div class="ve-flex-col" style="gap:8px;min-width:min(560px,86vw)"></div>`.appendTo(eleModalInner);
		const render = async () => {
			wrp.innerHTML = "";
			const bar = ee`<div class="ve-flex" style="gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid rgba(127,127,127,.25);padding-bottom:8px"></div>`.appendTo(wrp);
			ee(bar)`<button class="ve-btn ve-btn-primary ve-btn-sm">${this._rosterId ? "Update saved character" : "＋ Save current character"}</button>`.onn("click", async () => { await this._pSaveToRoster(); await render(); });
			if (this._rosterId) ee(bar)`<button class="ve-btn ve-btn-default ve-btn-sm" title="Save the current build as a separate, additional character">Save as new</button>`.onn("click", async () => { this._rosterId = null; await this._pSaveToRoster(); await render(); });
			ee(bar)`<span class="ve-muted ve-small">Saved characters appear on the Tabletop’s “Import Character” too.</span>`;
			const list = await this._pGetRoster();
			if (!list.length) { ee(wrp)`<div class="ve-muted ve-small ve-py-2">No saved characters yet — build one, then “Save current character.”</div>`; return; }
			list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
			list.forEach(entry => {
				const s = entry.summary || {};
				const isCur = entry.id === this._rosterId;
				const row = ee`<div class="ve-flex" style="gap:8px;align-items:center;border:1px solid ${isCur ? "#4caf50" : "rgba(127,127,127,.25)"};border-radius:6px;padding:6px 9px"></div>`.appendTo(wrp);
				ee(row)`<div class="ve-flex-col" style="flex:1 1 auto;min-width:0">
					<div class="ve-bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${`${s.name || "Unnamed"}`.qq()}${isCur ? ` <span class="ve-muted ve-small">(loaded)</span>` : ""}</div>
					<div class="ve-muted ve-small">${`${[s.race, s.classLabel].filter(Boolean).join(" ") || "—"}`.qq()} • HP ${s.maxHp ?? "?"} • AC ${s.ac ?? "?"}</div>
				</div>`;
				ee(row)`<button class="ve-btn ve-btn-default ve-btn-xs" title="Open this character in the builder">Load</button>`.onn("click", () => { this._rosterId = entry.id; this._state.fromJson(entry.json); this._save(); this._ixStep = 0; this.render(); doClose(); });
				ee(row)`<button class="ve-btn ve-btn-default ve-btn-xs" title="Download as a file"><span class="glyphicon glyphicon-download-alt"></span></button>`.onn("click", () => DataUtil.userDownload(`${s.name || "character"}`, entry.json, {fileType: "charbuilder"}));
				ee(row)`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Delete"><span class="glyphicon glyphicon-trash"></span></button>`.onn("click", async () => { if (!await InputUiUtil.pGetUserBoolean({title: "Delete character", htmlDescription: `Remove “${`${s.name || "Unnamed"}`.qq()}” from your saved characters?`})) return; await this._pDeleteFromRoster(entry.id); await render(); });
			});
		};
		await render();
	}

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
		this._pUpdateCurrentSnapshot(); // refresh the VTT-importable snapshot (debounced) on load + every change
		const scrollTop = this._eleRoot.scrollTop || 0;
		this._eleRoot.empty();
		const steps = this._steps();
		if (this._ixStep >= steps.length) this._ixStep = steps.length - 1;

		const wrp = ee`<div class="cb__wrp ve-p-2"></div>`.appendTo(this._eleRoot);

		const isSidekick = this._state.mode === "sidekick";

		// Toolbar
		const inpName = ee`<input class="ve-form-control" style="max-width:280px" placeholder="${isSidekick ? "Sidekick name (optional)" : "Character name"}" value="${((isSidekick ? this._state.sidekick.name : this._state.name) || "").qq()}">`
			.onn("change", () => { if (isSidekick) this._state.sidekick.name = inpName.val(); else this._state.name = inpName.val(); this._save(); });
		// mode toggle: Character vs Sidekick
		const mkMode = (m, label, title) => ee`<button class="ve-btn ve-btn-sm ${this._state.mode === m ? "ve-btn-primary active" : "ve-btn-default"}" title="${title}">${label}</button>`
			.onn("click", () => { if (this._state.mode === m) return; this._state.mode = m; this._showSources = false; this._playMode = false; this.render(); this._save(); });
		const modeToggle = ee`<div class="ve-btn-group">${mkMode("pc", "Character", "Build a player character")}${mkMode("sidekick", "Sidekick", "Build a sidekick from a CR ½-or-lower (or unknown-CR) creature (Tasha's)")}</div>`;
		const btnSources = ee`<button class="ve-btn ve-btn-default ve-btn-sm ${this._showSources ? "active" : ""}" title="Choose which books/sources appear in the builder"><span class="glyphicon glyphicon-book"></span> Sources</button>`
			.onn("click", () => { this._showSources = !this._showSources; this._playMode = false; this.render(); });
		const btnPlay = ee`<button class="ve-btn ${this._playMode ? "ve-btn-primary active" : "ve-btn-success"} ve-btn-sm" title="Play this character — track HP, spell slots, and roll d20 checks"><span class="glyphicon glyphicon-${this._playMode ? "edit" : "play"}"></span> ${this._playMode ? "Edit Build" : "Play"}</button>`
			.onn("click", () => { this._playMode = !this._playMode; this._showSources = false; this.render(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:8px;flex-wrap:wrap">
			${inpName}
			${modeToggle}
			${btnSources}
			${btnPlay}
			${this._getToolbarButtons()}
		</div>`;

		// Sources panel (replaces the stepper/body while open)
		if (this._showSources) { this._renderSourcesPanel(ee`<div class="cb__step-body"></div>`.appendTo(wrp)); if (scrollTop) this._eleRoot.scrollTop = scrollTop; return; }

		// Play mode (replaces the stepper/body while active) — PC or sidekick
		if (this._playMode) { const body = ee`<div class="cb__step-body"></div>`.appendTo(wrp); if (isSidekick) this._renderSidekickPlayMode(body); else this._renderPlayMode(body); if (scrollTop) this._eleRoot.scrollTop = scrollTop; return; }

		// Sidekick builder (creature-first) replaces the PC stepper/body
		if (isSidekick) { this._renderSidekickBuilder(wrp); if (scrollTop) this._eleRoot.scrollTop = scrollTop; return; }

		// validation issues (prerequisites no longer met after a change), grouped by step
		const issues = this._state.validationIssues();
		const issuesByStep = {};
		issues.forEach(i => (issuesByStep[i.step] = issuesByStep[i.step] || []).push(i));

		// Stepper
		const eleSteps = ee`<div class="cb__steps no-print"></div>`.appendTo(wrp);
		steps.forEach((st, ix) => {
			const isActive = ix === this._ixStep;
			const stepIssues = issuesByStep[st.id] || [];
			const warn = stepIssues.length && !isActive;
			const title = stepIssues.length ? stepIssues.map(i => i.message).join("\n") : "";
			const btn = ee`<div class="cb__step ${isActive ? "cb__step--active" : ""} ${warn ? "cb__step--warn" : st.done() && !isActive ? "cb__step--done" : ""}" title="${`${title}`.qq()}"><span class="cb__step-num">${ix + 1}</span>${st.label}</div>`
				.onn("click", () => { this._ixStep = ix; this.render(); });
			btn.appendTo(eleSteps);
		});

		// Body
		const eleBody = ee`<div class="cb__step-body"></div>`.appendTo(wrp);
		const curStepId = steps[this._ixStep].id;
		// show this step's issues (and, on Review, every issue) as a banner above the body
		const bannerIssues = curStepId === "review" ? issues : (issuesByStep[curStepId] || []);
		if (bannerIssues.length) this._renderIssuesBanner(eleBody, bannerIssues, curStepId === "review");
		steps[this._ixStep].render(eleBody);

		// Footer nav
		const btnBack = ee`<button class="ve-btn ve-btn-default">‹ Back</button>`
			.onn("click", () => { if (this._ixStep > 0) { this._ixStep--; this.render(); } });
		if (this._ixStep === 0) btnBack.attr("disabled", "true");
		const isLast = this._ixStep === steps.length - 1;
		const btnNext = ee`<button class="ve-btn ve-btn-primary" title="${isLast ? "Save this character to My Characters — it's then ready to import into the Tabletop" : ""}">${isLast ? "✓ Save Character" : "Next ›"}</button>`
			.onn("click", async () => { if (!isLast) { this._ixStep++; this.render(); } else { await this._pSaveToRoster(); this.render(); } });
		ee(wrp)`<div class="cb__footer no-print">${btnBack}${btnNext}</div>`;

		if (scrollTop) this._eleRoot.scrollTop = scrollTop;
	}

	// banner listing prerequisite/compatibility problems for the current step (or all, on Review)
	_renderIssuesBanner (wrp, issues, showStep) {
		const hasErr = issues.some(i => i.severity === "error");
		const box = ee`<div class="ve-mb-3" style="border:1px solid ${hasErr ? "#c0392b" : "#d9822b"};background:${hasErr ? "rgba(192,57,43,.10)" : "rgba(217,130,43,.10)"};border-radius:6px;padding:8px 10px"></div>`.appendTo(wrp);
		ee(box)`<div class="ve-bold ve-mb-1"><span class="glyphicon glyphicon-warning-sign" style="color:${hasErr ? "#c0392b" : "#d9822b"}"></span> ${issues.length} compatibility issue${issues.length > 1 ? "s" : ""} — a change left ${issues.length > 1 ? "some choices" : "a choice"} invalid:</div>`;
		const list = ee`<ul style="margin:0 0 0 18px;padding:0"></ul>`.appendTo(box);
		issues.forEach(i => ee(list)`<li class="ve-small" style="margin:1px 0">${i.message.qq()}${showStep ? ` <span class="ve-muted">[${`${i.step}`.qq()}]</span>` : ""}</li>`);
	}

	_getToolbarButtons () {
		const btnSave = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Saved automatically; click to confirm"><span class="glyphicon glyphicon-floppy-disk"></span> Saved</button>`
			.onn("click", () => { this._save(); JqueryUtil.doToast({type: "success", content: "Character saved to this browser."}); });
		const btnExport = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-download-alt"></span> Export</button>`
			.onn("click", () => DataUtil.userDownload(`${this._state.name || "character"}`, this._state.toJson(), {fileType: "charbuilder"}));
		const btnImport = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-upload"></span> Import</button>`
			.onn("click", async () => {
				const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: ["charbuilder", "charwizard"]}); // accept exports made under the old "charwizard" name
				DataUtil.doHandleFileLoadErrorsGeneric(errors);
				if (!jsons?.length) return;
				this._rosterId = null; // imported file is a fresh character, not (yet) a saved roster entry
					this._state.fromJson(jsons[0]); this._save(); this._ixStep = 0; this.render();
			});
		const btnPrint = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-print"></span> Print</button>`
			.onn("click", () => { this._ixStep = this._steps().length - 1; this.render(); setTimeout(() => window.print(), 100); });
		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-sm"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", async () => {
				if (!await InputUiUtil.pGetUserBoolean({title: "Reset Character", htmlDescription: "Clear all choices and start over?"})) return;
				this._rosterId = null; this._state.reset(); this._save(); this._ixStep = 0; this.render();
			});
		return ee`<div class="ve-btn-group no-print">${btnSave}${ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Save and switch between multiple characters"><span class="glyphicon glyphicon-list"></span> My Characters</button>`.onn("click", () => this._pOpenRoster())}${btnExport}${btnImport}${btnPrint}${btnReset}</div>`;
	}

	// non-FR campaign settings excluded by the "Forgotten Realms + neutral" preset
	static _ROSTER_KEY = "charbuilder_roster"; // shared (non-page-scoped) StorageUtil key — read by the Tabletop (VTT) too
	static _CURRENT_KEY = "charbuilder_current"; // snapshot of the live character so the VTT can import it without an explicit save

	static _NON_FR_SOURCES = new Set([
		"GGR", "GRR", // Ravnica
		"MOT", // Theros
		"ERLW", "EFA", "WGE", // Eberron
		"SCC", "STRX", // Strixhaven
		"AAG", "BAM", "LoX", "SjA", // Spelljammer
		"EGW", "CRCotN", "TDCSR", "EGW_ToR", "EGW_DD", "EGW_FS", "EGW_US", // Exandria / Critical Role
		"DSotDQ", // Dragonlance
		"WBtW", // Witchlight (Domains of Delight)
		"VRGR", "RHW", "CoS", "CRcotn", // Ravenloft / Barovia
		"PSA", "PSD", "PSI", "PSK", "PSX", "PSZ", "LFL", "MGELF", "KKW", // Magic: the Gathering planes
		"MPP", "OoW", "ToFW", "SatO", // Planescape / Sigil
		"HftT", "AitFR", "AitFR-ISF", "AitFR-THP", "AitFR-AVT", "AitFR-DN", "AitFR-FCD", "WttHC", "RMBRE", // crossovers / parody / misc
		"AI", "OGA", "TTP", "LR", "ABH",
	]);

	_renderSourcesPanel (wrp) {
		const st = this._state;
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:8px;flex-wrap:wrap"><h4 class="ve-mt-0 ve-mb-0">Content Sources</h4>${ee`<button class="ve-btn ve-btn-primary ve-btn-sm">‹ Done</button>`.onn("click", () => { this._showSources = false; this.render(); })}</div>`;
		ee(wrp)`<p class="ve-muted ve-small">Hide books you don't use. This filters every list in the builder (races, classes, backgrounds, feats, spells, items). Your choice persists across characters.</p>`;

		const sources = st.allSources();
		const setHidden = (codes, hide) => { const set = new Set(st.hiddenSources); codes.forEach(c => hide ? set.add(c) : set.delete(c)); st.hiddenSources = [...set]; this._save(); this.render(); };

		// legacy toggle
		const legacyCb = ee`<label class="ve-flex-v-center" style="gap:6px;cursor:pointer"><input type="checkbox" ${st.hideLegacy ? "checked" : ""}> <b>Hide superseded (legacy) content</b> <span class="ve-muted ve-small">— books folded into a newer 2014 book (Volo's &amp; Mordenkainen's → Monsters of the Multiverse; Elemental Evil), plus any entity a newer 2014 source reprinted. 2024 reprints (e.g. PHB → 2024 PHB) are NOT hidden.</span></label>`;
		legacyCb.querySelector("input").addEventListener("change", (e) => { st.hideLegacy = e.target.checked; this._save(); this.render(); });
		ee(wrp)`<div class="ve-mb-2">${legacyCb}</div>`;

		// presets
		const allCodes = sources.map(s => s.source);
		const presets = ee`<div class="ve-flex-v-center ve-mb-3" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(wrp);
		ee(presets)`<span class="ve-muted ve-small">Quick:</span>`;
		ee`<button class="ve-btn ve-btn-default ve-btn-xs">Show all</button>`.onn("click", () => setHidden(allCodes, false)).appendTo(presets);
		ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Hide homebrew, partnered, and Unearthed Arcana">Official only</button>`.onn("click", () => { st.hiddenSources = sources.filter(s => s.group !== 0).map(s => s.source); this._save(); this.render(); }).appendTo(presets);
		ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Core + Forgotten Realms + setting-neutral supplements; hide other campaign settings">Forgotten Realms + neutral</button>`
			.onn("click", () => { const hide = sources.filter(s => s.group !== 0 || CharBuilderUi._NON_FR_SOURCES.has(s.source)).map(s => s.source); st.hiddenSources = hide; st.hideLegacy = true; this._save(); this.render(); }).appendTo(presets);

		// grouped checklist
		const groupName = {0: "Core & Official", 1: "Partnered", 2: "Unearthed Arcana / Non-standard", 3: "Prerelease", 4: "Homebrew"};
		const byGroup = {}; sources.forEach(s => { (byGroup[s.group] = byGroup[s.group] || []).push(s); });
		Object.keys(byGroup).map(Number).sort((a, b) => a - b).forEach(g => {
			ee(wrp)`<div class="ve-bold ve-mt-2 ve-mb-1">${groupName[g] || `Group ${g}`}</div>`;
			const grid = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(wrp);
			byGroup[g].forEach(({source}) => {
				const shown = st._sourceAllowed(source);
				const lbl = ee`<label style="display:block;break-inside:avoid;cursor:pointer" title="${`${source}`.qq()}"><input type="checkbox" ${shown ? "checked" : ""}> ${Parser.sourceJsonToFull(source).qq()} <span class="ve-muted ve-small">(${source})</span></label>`;
				lbl.querySelector("input").addEventListener("change", (e) => setHidden([source], !e.target.checked));
				lbl.appendTo(grid);
			});
		});
	}

	/* ----- play mode rolls: route through the site's dice roller (the dismissable roll box, bottom-right) ----- */
	// roll a dice expression in the site roll box; returns a Promise<number|null> of the total
	_roll (label, toRoll) {
		try { return Renderer.dice.pRollEntry({toRoll}, {name: this._state.name || "Character", label}); }
		catch (e) { return Promise.resolve(null); }
	}
	// the active play-state object (PC or sidekick) — for exhaustion etc.
	_curPlay () { return this._state.mode === "sidekick" ? this._state.skPlay() : this._state.play; }
	// merge an exhaustion-driven disadvantage into a base {adv,dis,net} for a roll category (check | save | attack)
	_mergeExhaustion (baseAd, category) {
		const ex = this._curPlay().exhaustion || 0;
		const threshold = category === "check" ? 1 : 3; // checks: disadv at 1+; attacks/saves: disadv at 3+
		if (ex < threshold) return baseAd || null;
		const adv = [...(baseAd?.adv || [])];
		const dis = [...(baseAd?.dis || []), `Exhaustion (${ex})`];
		return {adv, dis, net: adv.length && dis.length ? "both" : adv.length ? "adv" : "dis"};
	}
	// d20 check/save/attack, honouring net advantage/disadvantage (2d20kh1 / 2d20kl1) + optional extra dice (Bless +1d4 etc.)
	_d20Roll (label, mod, ad, extraDice) {
		const adv = ad?.net === "adv"; const dis = ad?.net === "dis";
		const die = adv ? "2d20kh1" : dis ? "2d20kl1" : "1d20";
		const m = mod ? `${mod >= 0 ? "+" : ""}${mod}` : "";
		this._roll(`${label}${adv ? " (advantage)" : dis ? " (disadvantage)" : ""}`, `${die}${m}${extraDice || ""}`);
	}
	// merge exhaustion + active-effect advantage for a PC play roll (category: check | save | attack; abv = ability)
	_pcRollAd (category, abv, base) { const st = this._state; return st.effectAdv(this._mergeExhaustion(base, category), category, abv); }
	_pcRollDice (category) { const st = this._state; return category === "attack" ? st.effectAttackDice() : category === "save" ? st.effectSaveDice() : ""; }
	// weapon damage (dice string + flat bonus)
	_rollDamage (atk, dice, label) {
		if (!dice) return;
		const b = atk.dmgBonus ? `${atk.dmgBonus >= 0 ? "+" : ""}${atk.dmgBonus}` : "";
		const typ = atk.dmgType ? ` ${CW.DMG_TYPE[atk.dmgType] || atk.dmgType}` : "";
		this._roll(`${label} damage${typ}`, `${dice}${b}`);
	}

	// exhaustion level control + cumulative-effects summary (shared by PC and sidekick play)
	_renderExhaustion (sec, play) {
		const lvl = play.exhaustion || 0;
		const dec = ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${lvl <= 0 ? "disabled" : ""} title="Reduce exhaustion">−</button>`.onn("click", () => { play.exhaustion = Math.max(0, lvl - 1); this._save(); this.render(); });
		const inc = ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${lvl >= 6 ? "disabled" : ""} title="Gain a level of exhaustion">+</button>`.onn("click", () => { play.exhaustion = Math.min(6, lvl + 1); this._save(); this.render(); });
		ee(sec)`<div class="ve-flex-v-center ve-mb-1" style="gap:8px;flex-wrap:wrap"><b>Exhaustion</b> ${dec} <span style="min-width:34px;text-align:center"><b style="font-size:15px">${lvl}</b> / 6</span> ${inc} <span class="ve-muted ve-small">a long rest removes 1 level</span></div>`;
		if (lvl > 0) {
			const effects = []; for (let i = 1; i <= Math.min(lvl, 5); ++i) effects.push(`<b>${i}.</b> ${EXHAUSTION_EFFECTS[i]}`);
			ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mb-2" style="display:block;padding:6px;border-radius:4px">${lvl >= 6 ? "<b>Level 6 — the character dies.</b>" : effects.join(" &nbsp;•&nbsp; ")}</div>`;
		}
	}

	// free-form buffs/debuffs tracker (Bless, Bardic Inspiration, …) — names only, add from a list or type your own
	_renderEffects (sec, play) {
		const effects = play.effects || (play.effects = []);
		ee(sec)`<h4>Buffs &amp; Effects <span class="ve-muted ve-small">(Bless, Bardic Inspiration, Hex…)</span></h4>`;
		const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(sec);
		const effLabel = (eff) => { const sp = this._state.effectSpell(eff); return sp ? refLink(UrlUtil.PG_SPELLS, sp) : `${eff}`.qq(); };
		if (effects.length) effects.forEach((eff, ix) => ee(row)`<span class="cb__buff-chip" title="${(EFFECT_DEFS[eff]?.note || "").qq()}">${effLabel(eff)} ${ee`<span class="cb__cond-x" title="Remove">✕</span>`.onn("click", () => { effects.splice(ix, 1); this._save(); this.render(); })}</span>`);
		else ee(row)`<span class="ve-muted ve-small">None.</span>`;
		const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">+ add buff/effect…</option></select>`;
		PLAY_EFFECTS.filter(e => !effects.includes(e)).forEach(e => ee`<option value="${e.qq()}">${e.qq()}</option>`.appendTo(sel));
		ee`<option value="__custom__">Other (type your own)…</option>`.appendTo(sel);
		sel.onn("change", async () => {
			const v = sel.val(); if (!v) return;
			if (v === "__custom__") { const c = await InputUiUtil.pGetUserString({title: "Add a buff or effect"}); if (c && `${c}`.trim()) effects.push(`${c}`.trim()); }
			else effects.push(v);
			this._save(); this.render();
		});
		ee(sec)`${sel}`;
	}

	// mechanical summary of the PC's active effects (what they're doing to stats & rolls right now)
	_renderActiveEffectMods (sec) {
		const st = this._state; const eff = st.activeEffects(); if (!eff.length) return;
		ee(sec)`<h4>Active Effect Details <span class="ve-muted ve-small">(applied to your stats &amp; rolls)</span></h4>`;
		eff.forEach(({name, def}) => ee(sec)`<div class="ve-small ve-mb-1"><b>${`${name}`.qq()}:</b> ${def.note ? `${def.note}`.qq() : "tracked"}</div>`);
		const lines = [];
		const res = st.playResistances(); if (res.length) lines.push(`<b>Resistances:</b> ${res.join(", ").qq()}`);
		const riders = st.playDamageRiders(); if (riders.length) lines.push(`<b>Bonus damage:</b> ${riders.map(r => `${r}`.qq()).join("; ")}`);
		const atk = st.effectAttackDice(); if (atk) lines.push(`<b>Attack rolls:</b> ${atk.qq()}`);
		const sv = st.effectSaveDice(); if (sv) lines.push(`<b>Saving throws:</b> ${sv.qq()}`);
		if (st.playNumAttacks() > st.numAttacks()) lines.push(`<b>Attacks:</b> now ${st.playNumAttacks()} per Attack action`);
		if (lines.length) ee(sec)`<div class="ve-small ve-mt-1" style="border-top:1px solid rgba(127,127,127,.2);padding-top:4px">${lines.join(" &nbsp;•&nbsp; ")}</div>`;
	}

	// action-economy overview: Action / Bonus Action / Reaction (from attacks, spell casting times, and a feature scan)
	_renderTurnOptions (sec, opts) {
		ee(sec)`<h4>On Your Turn <span class="ve-muted ve-small">(one action + one bonus action + one reaction + movement)</span></h4>`;
		const grid = ee`<div style="display:flex;gap:16px;flex-wrap:wrap"></div>`.appendTo(sec);
		const action = (name) => renderInline(`{@action ${name}}`);
		const label = (it) => it.action ? `${action(it.action)}${it.suffix ? ` <span class="ve-muted ve-small">${it.suffix.qq()}</span>` : ""}`
			: it.spell ? refLink(UrlUtil.PG_SPELLS, it.spell)
			: it.feature ? (it.feature.feat ? refLink(UrlUtil.PG_FEATS, it.feature.feat) : it.feature.ref ? renderInline(it.feature.ref) : `${it.feature.name}`.qq())
			: it.emph ? `<b>${`${it.name}`.qq()}</b>` : `${it.name}`.qq();
		const col = (title, items, empty) => {
			const c = ee`<div style="flex:1 1 180px;min-width:160px"><div class="ve-bold ve-mb-1">${title}</div></div>`.appendTo(grid);
			if (!items.length) ee(c)`<div class="ve-muted ve-small">${empty}</div>`;
			else items.forEach(it => ee(c)`<div class="ve-small" style="padding:1px 0">• ${label(it)}</div>`);
		};
		col("Action", opts.action, "—");
		col("Bonus Action", opts.bonus, "none detected");
		col("Reaction", opts.reaction, "—");
		const std = ["Dash", "Disengage", "Dodge", "Help", "Hide", "Ready", "Search", "Use an Object"].map(action).join(", ");
		ee(sec)`<details class="ve-small ve-mt-2"><summary class="ve-muted">Standard actions anyone can take</summary><div class="ve-pl-3">${std} — plus one free object interaction. ${action("Grapple")} and ${action("Shove")} are special melee attacks.</div></details>`;
		ee(sec)`<div class="ve-muted ve-small ve-mt-1">Bonus actions &amp; reactions come from your spells (by casting time) and a scan of your feature text — double-check the exact wording.</div>`;
	}

	_renderPlayMode (wrp) {
		const st = this._state;
		if (!st.classUid) { ee(wrp)`<div class="cb__err">Build your character first (choose at least a class), then switch to Play mode to track HP, spell slots, and roll checks.</div>`; return; }

		const classLine = st.classList().map(c => `${c.cls.name}${c.subclassEnt ? ` (${c.subclassEnt.name})` : ""} ${c.level}`).join(" / ");
		const star = ee`<button class="ve-btn ve-btn-sm ${st.play.inspiration ? "ve-btn-primary" : "ve-btn-default"}" title="Toggle Inspiration">${st.play.inspiration ? "★" : "☆"} Inspiration</button>`
			.onn("click", () => { st.play.inspiration = !st.play.inspiration; this._save(); this.render(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:12px;flex-wrap:wrap">
			<div style="flex:1 1 auto"><div style="font-size:22px;font-weight:bold">${(st.name || "Unnamed Character").qq()}</div>
			<div class="ve-muted ve-small">${classLine.qq()} • Lv ${st.totalLevel}</div></div>
			${star}</div>`;

		// top stat row
		const boxes = ee`<div class="cb__sheet-grid ve-mb-3"></div>`.appendTo(wrp);
		const box = (lbl, val, onClick, title) => { const el = ee`<div class="cb__stat-box ${onClick ? "cb__stat-box--click" : ""}" ${title ? `title="${title.qq()}"` : ""}><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`; if (onClick) el.onn("click", onClick); el.appendTo(boxes); };
		const acD = st.playAc() - st.ac();
		box("Armor Class", `${st.playAc()}${acD ? ` <span class="ve-muted ve-small">(${CW.fmtMod(acD)})</span>` : ""}`);
		box("Initiative", `${CW.fmtMod(st.initiative())} ${advDisBadge(this._pcRollAd("check", "dex", st.initiativeAdvDis()))}`, () => this._d20Roll("Initiative", st.initiative(), this._pcRollAd("check", "dex", st.initiativeAdvDis())), "Click to roll initiative");
		box("Prof. Bonus", CW.fmtMod(st.profBonus));
		box("Passive Perc.", st.passiveScore("perception"));
		const ps = st.playWalkSpeed(); const baseSp = st._walkSpeed();
		box("Speed", `${ps} ft.${ps !== baseSp ? ` <span class="ve-muted ve-small">(was ${baseSp})</span>` : ""}`);
		const srcs = st.spellSources();
		if (srcs.length) { const s0 = srcs[0]; const atk = st.spellAtkBonusFor(s0); box("Spell DC", st.spellSaveDcFor(s0) ?? "—"); box("Spell Atk", atk == null ? "—" : CW.fmtMod(atk)); }

		this._renderPlayHp(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlayRests(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlaySlots(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlaySpellbook(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlayConditions(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderEffects(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp), st.play);
		this._renderActiveEffectMods(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlayAbilities(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderTurnOptions(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp), st.turnOptions());
		this._renderPlayAttacks(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderPlaySkills(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		ee(wrp)`<div class="ve-muted ve-small ve-mt-3 no-print">Rolls open in the dice tray (bottom-right); click the × there to dismiss it.</div>`;
	}

	_renderPlayHp (sec) {
		const st = this._state;
		const cur = st.playCurHp(); const max = st.playMaxHp(); const temp = st.playTempHp();
		const pct = max ? Math.round((cur / max) * 100) : 0;
		const colour = pct > 50 ? "#4caf50" : pct > 25 ? "#ff9800" : "#f44336";
		ee(sec)`<h4>Hit Points</h4>`;
		ee(sec)`<div class="ve-mb-2"><div style="position:relative;height:26px;border:1px solid rgba(127,127,127,.4);border-radius:4px;overflow:hidden;background:rgba(127,127,127,.12)">
			<div style="position:absolute;inset:0 ${100 - pct}% 0 0;background:${colour};opacity:.55"></div>
			<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:bold">${cur} / ${max}${temp ? ` (+${temp} temp)` : ""}</div>
		</div></div>`;

		const inpAmt = ee`<input class="ve-form-control" type="number" min="0" style="width:80px" placeholder="0">`;
		const amt = () => Math.max(0, parseInt(inpAmt.val(), 10) || 0);
		const btnDmg = ee`<button class="ve-btn ve-btn-danger ve-btn-sm" title="Subtract from HP (temp HP first)">− Damage</button>`.onn("click", () => { const d = amt(); st.applyDamage(d); if (d && st.play.concentration) JqueryUtil.doToast({type: "warning", content: `Concentration: make a DC ${Math.max(10, Math.floor(d / 2))} Constitution save.`}); inpAmt.val(""); this._save(); this.render(); });
		const btnHeal = ee`<button class="ve-btn ve-btn-success ve-btn-sm" title="Restore HP (up to max)">+ Heal</button>`.onn("click", () => { st.applyHealing(amt()); inpAmt.val(""); this._save(); this.render(); });
		const btnTemp = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Set temporary HP (doesn't stack — keeps the higher)">Temp HP</button>`.onn("click", () => { st.setTempHp(amt()); inpAmt.val(""); this._save(); this.render(); });
		const btnFull = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Reset to maximum HP">Full</button>`.onn("click", () => { st.applyHealing(st.playMaxHp()); st.clearTempHp(); this._save(); this.render(); });
		ee(sec)`<div class="ve-flex-v-center" style="gap:6px;flex-wrap:wrap">${inpAmt}${btnDmg}${btnHeal}${btnTemp}${btnFull}</div>`;

		// concentration
		if (st.play.concentration) {
			const row = ee`<div class="ve-flex-v-center ve-mt-2" style="gap:6px;flex-wrap:wrap"><b>Concentrating:</b> ${renderInline(`{@spell ${st.play.concentration}}`)}</div>`.appendTo(sec);
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll a Constitution save to maintain concentration">Con save ${CW.fmtMod(st.saveMod("con"))}</button>`.onn("click", () => this._d20Roll("Concentration (Con)", st.saveMod("con"), this._pcRollAd("save", "con", st.saveAdvDis("con")), st.effectSaveDice()))}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Drop concentration">Drop</button>`.onn("click", () => { st.play.concentration = null; this._save(); this.render(); })}`;
		}

		// death saves — shown when at 0 HP or any are marked
		const ds = st.play.deathSaves || (st.play.deathSaves = {success: 0, fail: 0});
		if (cur === 0 || ds.success || ds.fail) {
			ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mt-2" style="display:inline-block">${cur === 0 ? "Unconscious at 0 HP — make death saving throws." : "Dying — death saves in progress."}</div>`;
			const pip = (type, n, colour, i) => ee`<span class="cb__ds-pip" style="border:2px solid ${colour};background:${n >= i ? colour : "transparent"}" title="${type} ${i}"></span>`
				.onn("click", () => { ds[type === "Success" ? "success" : "fail"] = (n === i ? i - 1 : i); this._save(); this.render(); });
			const dsRow = ee`<div class="ve-flex-v-center ve-mt-1" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(sec);
			ee(dsRow)`<span class="ve-small">Successes</span>${[1, 2, 3].map(i => pip("Success", ds.success, "#4caf50", i))}`;
			ee(dsRow)`<span class="ve-small ve-ml-2">Failures</span>${[1, 2, 3].map(i => pip("Fail", ds.fail, "#f44336", i))}`;
			ee(dsRow)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-ml-2">🎲 Death Save</button>`.onn("click", () => this._rollDeathSave())}`;
			if (ds.success >= 3) ee(sec)`<div class="ve-muted ve-small ve-mt-1">Stable — unconscious but no longer making death saves.</div>`;
			if (ds.fail >= 3) ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mt-1" style="display:inline-block">The character has died.</div>`;
		}
	}

	// generic death-save roll on any play object (PC or sidekick)
	async _rollDeathSaveFor (play, healFn) {
		const r = await this._roll("Death save", "1d20");
		if (r == null) return;
		const ds = play.deathSaves || (play.deathSaves = {success: 0, fail: 0});
		let msg; let type = "info";
		if (r === 20) { healFn(1); play.deathSaves = {success: 0, fail: 0}; msg = "natural 20 — regain 1 HP and conscious!"; type = "success"; }
		else if (r === 1) { ds.fail = Math.min(3, ds.fail + 2); msg = "natural 1 — two failures"; type = "danger"; }
		else if (r >= 10) { ds.success = Math.min(3, ds.success + 1); msg = "success"; type = "success"; }
		else { ds.fail = Math.min(3, ds.fail + 1); msg = "failure"; type = "danger"; }
		if (play.deathSaves.success >= 3) msg += " — stabilized";
		if (play.deathSaves.fail >= 3) { msg += " — the character dies"; type = "danger"; }
		JqueryUtil.doToast({type, content: `Death save (rolled ${r}): ${msg}.`});
		this._save(); this.render();
	}
	_rollDeathSave () { const st = this._state; return this._rollDeathSaveFor(st.play, n => st.applyHealing(n)); }

	_renderPlayRests (sec) {
		const st = this._state;
		ee(sec)`<h4>Rest &amp; Hit Dice</h4>`;
		const btnShort = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Spend Hit Dice below to heal; pact slots return">Short Rest</button>`.onn("click", () => { st.shortRest(); JqueryUtil.doToast({type: "success", content: "Short rest — spend Hit Dice to heal; pact slots restored."}); this._save(); this.render(); });
		const btnLong = ee`<button class="ve-btn ve-btn-primary ve-btn-sm" title="Full HP, all spell slots, half your Hit Dice">Long Rest</button>`.onn("click", () => { st.longRest(); JqueryUtil.doToast({type: "success", content: "Long rest — HP, spell slots, and half your Hit Dice restored."}); this._save(); this.render(); });
		ee(sec)`<div class="ve-flex-v-center ve-mb-2" style="gap:6px;flex-wrap:wrap">${btnShort}${btnLong}</div>`;
		const pool = st.hitDicePool();
		Object.keys(pool).map(Number).sort((a, b) => a - b).forEach(faces => {
			const rem = st.hitDiceRemaining(faces); const total = pool[faces];
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="width:42px">d${faces}</b><span class="ve-muted ve-small" style="width:42px">${rem}/${total}</span></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem ? "" : "disabled"} title="Spend a d${faces} Hit Die: roll + Con mod to heal">Spend</button>`.onn("click", () => this._spendHitDie(faces))}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem < total ? "" : "disabled"} title="Restore a spent Hit Die">↺</button>`.onn("click", () => { st.restoreHitDie(faces); this._save(); this.render(); })}`;
			row.appendTo(sec);
		});
	}

	// generic Hit Die spend (rolls die + Con mod, heals)
	async _spendHitDieFor (faces, conMod, spendFn, healFn) {
		const heal = await this._roll(`Hit Die d${faces}`, `1d${faces}${conMod >= 0 ? "+" : ""}${conMod}`);
		if (heal == null) return;
		spendFn(); healFn(Math.max(0, heal));
		JqueryUtil.doToast({type: "success", content: `Spent a d${faces} Hit Die — healed ${Math.max(0, heal)}.`});
		this._save(); this.render();
	}
	_spendHitDie (faces) { const st = this._state; if (st.hitDiceRemaining(faces) <= 0) return; return this._spendHitDieFor(faces, st.abilityMod("con"), () => st.spendHitDie(faces), n => st.applyHealing(n)); }

	_castSpell (sp) {
		const st = this._state;
		const used = st.castSpell(sp);
		if (used == null) { JqueryUtil.doToast({type: "warning", content: `No spell slot available for ${sp.name.qq()}.`}); return; }
		if (/concentration/i.test(JSON.stringify(sp.duration || ""))) st.play.concentration = sp.name;
		JqueryUtil.doToast({type: "info", content: `Cast ${sp.name} — expended a level ${used} slot${used > sp.level ? ` (upcast from ${sp.level})` : ""}.`});
		this._save(); this.render();
	}

	// shared play-mode spell row: name + Cast (leveled) + spell-attack / save-DC / damage roll buttons (mirrors the weapon-attack row)
	_renderSpellRollRow (sec, sp, info, opts) {
		const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:6px;flex-wrap:wrap"><b style="min-width:140px">${refLink(UrlUtil.PG_SPELLS, sp)}</b></div>`;
		if (opts.cantrip) ee(row)`<span class="ve-muted ve-small" style="min-width:50px">at will</span>`;
		else ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="${opts.can ? "Cast — expend a spell slot" : "No slot available"}" ${opts.can ? "" : "disabled"}>Cast ⚡</button>`.onn("click", opts.onCast)}`;
		if (info.atk != null) ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll spell attack (d20 ${CW.fmtMod(info.atk)})">Attack ${CW.fmtMod(info.atk)}</button>`.onn("click", () => this._d20Roll(`${sp.name} attack`, info.atk, opts.attackAd, opts.attackExtra))}`;
		if (info.save) ee(row)`<span class="cb__save-dc" title="The target makes this saving throw — DC = 8 + proficiency + spell ability mod">DC ${info.save.dc} ${`${info.save.abil}`.slice(0, 3).toUpperCase()} save</span>`;
		info.damage.forEach(d => {
			const heal = d.kind === "heal";
			const lbl = heal ? `Heal ${d.dice}` : `Dmg ${d.dice}${d.type ? ` ${d.type}` : ""}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll ${heal ? "healing" : "damage"}">${lbl.qq()}</button>`.onn("click", () => this._roll(`${sp.name} ${heal ? "healing" : `damage${d.type ? ` (${d.type})` : ""}`}`, d.dice))}`;
		});
		// roll-determined damage type (Chaos Bolt): roll the die, show which type came up
		if (info.typeTable) {
			const tt = info.typeTable;
			const tip = `Roll a d${tt.faces} to determine the damage type: ${Object.keys(tt.map).map(Number).sort((a, b) => a - b).map(n => `${n}=${tt.map[n]}`).join(", ")}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="${tip.qq()}">Roll type (d${tt.faces})</button>`.onn("click", () => this._rollSpellType(sp, tt))}`;
		}
		if (info.scaleNote) ee(row)`<span class="ve-muted ve-small" title="Damage increases when cast with a higher-level slot">${info.scaleNote.qq()}</span>`;
		row.appendTo(sec);
	}

	// roll a spell's damage-type die (Chaos Bolt's d8) and report which type came up
	async _rollSpellType (sp, tt) {
		const n = await this._roll(`${sp.name} damage type (d${tt.faces})`, `1d${tt.faces}`);
		if (n == null) return;
		const type = tt.map[n] || "?";
		JqueryUtil.doToast({type: "info", content: `${sp.name}: rolled ${n} → ${type} damage`});
	}

	_renderPlaySpellbook (sec) {
		const st = this._state; const books = st.playSpellbook(); if (!books.length) return;
		const multi = st.spellSources().length > 1;
		ee(sec)`<h4>Spells <span class="ve-muted ve-small">(roll buttons for attacks &amp; damage; Cast expends a slot)</span></h4>`;
		const attackAd = this._pcRollAd("attack", null, null); const attackExtra = st.effectAttackDice();
		books.forEach(({src, cantrips, leveled}) => {
			if (multi) ee(sec)`<div class="ve-bold ve-small ve-mt-1">${src.name.qq()}</div>`;
			if (cantrips.length) {
				ee(sec)`<div class="ve-muted ve-small ve-bold ve-mt-1">Cantrips</div>`;
				cantrips.forEach(sp => this._renderSpellRollRow(sec, sp, st.spellRollInfo(sp, src), {cantrip: true, attackAd, attackExtra}));
			}
			const byLvl = {}; leveled.forEach(sp => (byLvl[sp.level] = byLvl[sp.level] || []).push(sp));
			Object.keys(byLvl).map(Number).sort((a, b) => a - b).forEach(lvl => {
				ee(sec)`<div class="ve-muted ve-small ve-bold ve-mt-1">Level ${lvl}</div>`;
				byLvl[lvl].forEach(sp => {
					let can = false; for (let L = lvl; L <= 9; ++L) if (st.playSlotsRemaining(L) > 0) { can = true; break; }
					if (!can && st.playPactRemaining() > 0 && st.playPactLevel() >= lvl) can = true;
					this._renderSpellRollRow(sec, sp, st.spellRollInfo(sp, src), {cantrip: false, can, onCast: () => this._castSpell(sp), attackAd, attackExtra});
				});
			});
		});
	}

	_renderPlayConditions (sec) {
		const st = this._state; const active = st.play.conditions || [];
		ee(sec)`<h4>Exhaustion &amp; Conditions</h4>`;
		this._renderExhaustion(sec, st.play);
		const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(sec);
		if (active.length) active.forEach(c => ee(row)`<span class="cb__cond-chip">${renderInline(`{@condition ${c}}`)} ${ee`<span class="cb__cond-x" title="Remove">✕</span>`.onn("click", () => { st.removeCondition(c); this._save(); this.render(); })}</span>`);
		else ee(row)`<span class="ve-muted ve-small">None.</span>`;
		const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">+ add condition…</option></select>`;
		CONDITIONS.filter(c => !active.includes(c)).forEach(c => ee`<option value="${c}">${c}</option>`.appendTo(sel));
		sel.onn("change", () => { if (sel.val()) { st.addCondition(sel.val()); this._save(); this.render(); } });
		ee(sec)`${sel}`;
	}

	_renderPlaySlots (sec) {
		const st = this._state;
		const slots = st.spellSlots() || {}; const pact = st.pactSlots();
		const levels = Object.keys(slots).map(Number).sort((a, b) => a - b);
		if (!levels.length && !pact) return;
		ee(sec)`<h4>Spell Slots</h4>`;
		const pip = (filled) => `<span style="display:inline-block;width:15px;height:15px;border-radius:50%;border:2px solid #2196f3;margin:0 2px;vertical-align:middle;background:${filled ? "#2196f3" : "transparent"}"></span>`;
		levels.forEach(lvl => {
			const total = st.playSlotsTotal(lvl); const rem = st.playSlotsRemaining(lvl);
			const pips = Array.from({length: total}, (_, i) => pip(i < rem)).join("");
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="width:62px">Level ${lvl}</b><div style="flex:1">${pips}</div></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Expend a slot" ${rem ? "" : "disabled"}>Use</button>`.onn("click", () => { st.expendSlot(lvl); this._save(); this.render(); })}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Restore a slot" ${rem < total ? "" : "disabled"}>↺</button>`.onn("click", () => { st.restoreSlot(lvl); this._save(); this.render(); })}`;
			ee(row)`<span class="ve-muted ve-small">${rem}/${total}</span>`;
			row.appendTo(sec);
		});
		if (pact) {
			const lvl = st.playPactLevel(); const total = st.playPactTotal(); const rem = st.playPactRemaining();
			const pips = Array.from({length: total}, (_, i) => pip(i < rem)).join("");
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="width:62px" title="Warlock Pact Magic — return on a short rest">Pact L${lvl}</b><div style="flex:1">${pips}</div></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem ? "" : "disabled"}>Use</button>`.onn("click", () => { st.expendPact(); this._save(); this.render(); })}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem < total ? "" : "disabled"}>↺</button>`.onn("click", () => { st.restorePact(); this._save(); this.render(); })}`;
			ee(row)`<span class="ve-muted ve-small">${rem}/${total}</span>`;
			row.appendTo(sec);
		}
	}

	_renderPlayAbilities (sec) {
		const st = this._state;
		ee(sec)`<h4>Ability Checks &amp; Saves <span class="ve-muted ve-small">(click a score to roll a check, or the save line for a save)</span></h4>`;
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(sec);
		CW.ABILITIES.forEach(abv => {
			const mod = st.abilityMod(abv); const save = st.saveMod(abv); const saveProf = st.saveProfs().has(abv);
			const card = ee`<div class="cb__abil" style="padding:4px"></div>`;
			ee`<div class="cb__roll" style="padding:4px 2px" title="Roll a ${CW.ABIL_FULL[abv]} check">
				<div class="cb__abil-name">${abv}</div><div class="cb__abil-score">${st.finalAbility(abv)}</div>
				<div class="cb__abil-mod">${CW.fmtMod(mod)}</div></div>`
				.onn("click", () => this._d20Roll(`${CW.ABIL_FULL[abv]} check`, mod, this._pcRollAd("check", abv, st.abilityCheckAdvDis?.(abv)))).appendTo(card);
			ee`<div class="cb__roll cb__abil-sub" style="padding:2px" title="Roll a ${CW.ABIL_FULL[abv]} save">save ${CW.fmtMod(save)}${saveProf ? " ●" : ""} ${advDisBadge(this._pcRollAd("save", abv, st.saveAdvDis(abv)))}</div>`
				.onn("click", () => this._d20Roll(`${CW.ABIL_FULL[abv]} save`, save, this._pcRollAd("save", abv, st.saveAdvDis(abv)), st.effectSaveDice())).appendTo(card);
			card.appendTo(grid);
		});
	}

	_renderPlayAttacks (sec) {
		const st = this._state;
		const wielded = st.wieldedWeapons();
		if (!wielded.length) return;
		ee(sec)`<h4>Attacks <span class="ve-muted ve-small">(click to roll)</span></h4>`;
		wielded.forEach(it => {
			const a = st.weaponAttack(it);
			const extra = st.weaponExtraDamage(it);
			const nameLbl = `${refLink(UrlUtil.PG_ITEMS, it, it.name)}${a.magic ? ` <span class="ve-muted ve-small">(${CW.fmtMod(a.magic)} magic)</span>` : ""}`;
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px;flex-wrap:wrap"><b style="min-width:120px">${nameLbl}</b></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll attack (d20 ${CW.fmtMod(a.toHit)})">Attack ${CW.fmtMod(a.toHit)}</button>`.onn("click", () => this._d20Roll(`${it.name} attack`, a.toHit, this._pcRollAd("attack", null, null), st.effectAttackDice()))}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll damage">Dmg ${st.fmtWeaponDamage(a.dmg1, a).qq()}</button>`.onn("click", () => this._rollDamage(a, a.dmg1, it.name))}`;
			if (a.dmg2) ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll two-handed (versatile) damage">2H ${st.fmtWeaponDamage(a.dmg2, a).qq()}</button>`.onn("click", () => this._rollDamage(a, a.dmg2, `${it.name} (2H)`))}`;
			// conditional/extra damage from the item's description (Flame Tongue, Mace of Disruption, …)
			extra.forEach(r => ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Extra/conditional damage from this item — applies only in the situations its description names">+${r.dice}${r.type ? ` ${r.type}` : ""}</button>`.onn("click", () => this._roll(`${it.name} extra (${r.type || "damage"})`, r.dice))}`);
			row.appendTo(sec);
			// damage breakdown
			const parts = [`${a.dmg1}${a.dmgType ? ` ${CW.DMG_TYPE[a.dmgType] || a.dmgType}` : ""}`, a.abilMod ? `${CW.fmtMod(a.abilMod)} ${a.ability}` : "", a.magicDmg ? `${CW.fmtMod(a.magicDmg)} magic` : "", a.fsDmg ? `+${a.fsDmg} style` : ""].filter(Boolean);
			ee(sec)`<div class="ve-muted ve-small ve-pl-3 ve-mb-1">${parts.join(" + ")}${extra.length ? `; <b>+${extra.map(r => `${r.dice}${r.type ? ` ${r.type}` : ""}`).join(", ")}</b> when its condition is met` : ""}</div>`;
		});
		if (st.playNumAttacks() > 1) ee(sec)`<div class="ve-muted ve-small ve-mt-1">Extra Attack: ${st.playNumAttacks()} attacks per Attack action.${st.playNumAttacks() > st.numAttacks() ? " (incl. active effects)" : ""}</div>`;
		const riders = st.playDamageRiders(); if (riders.length) ee(sec)`<div class="ve-muted ve-small ve-mt-1"><b>Active-effect damage:</b> ${riders.map(r => `${r}`.qq()).join("; ")} <span class="ve-muted">(add on a hit when applicable)</span></div>`;
	}

	_renderPlaySkills (sec) {
		const st = this._state;
		ee(sec)`<h4>Skills <span class="ve-muted ve-small">(click to roll)</span></h4>`;
		const MARK = {expertise: "★", full: "●", half: "◐", none: "○"};
		const grid = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(sec);
		CW.skills().sort().forEach(sk => {
			const mod = st.skillMod(sk);
			ee(grid)`${ee`<div class="cb__roll" style="break-inside:avoid;padding:2px 4px" title="Roll ${CW.skillName(sk)}">${MARK[st.skillProfType(sk)]} ${CW.skillName(sk)} <span class="ve-muted ve-small">(${CW.skillAbil(sk)})</span> <b>${CW.fmtMod(mod)}</b> ${advDisBadge(this._pcRollAd("check", CW.skillAbil(sk), st.skillAdvDis(sk)))}</div>`.onn("click", () => this._d20Roll(CW.skillName(sk), mod, this._pcRollAd("check", CW.skillAbil(sk), st.skillAdvDis(sk))))}`;
		});
	}

	/* ====================================================================== */
	/* Sidekick builder (creature-first)                                      */
	/* ====================================================================== */
	_sidekickSteps () {
		const st = this._state;
		return [
			{id: "creature", label: "Creature", done: () => !!st.sidekick.creatureUid, render: (el) => this._renderSidekickCreature(el)},
			{id: "class", label: "Class & Level", done: () => !!st.sidekick.classUid, render: (el) => this._renderSidekickClass(el)},
			{id: "equipment", label: "Equipment", done: () => true, render: (el) => this._renderSidekickEquipment(el)},
			{id: "review", label: "Review", done: () => true, render: (el) => this._renderSidekickReview(el)},
		];
	}

	_renderSidekickBuilder (wrp) {
		const steps = this._sidekickSteps();
		if (this._skStep == null) this._skStep = 0;
		if (this._skStep >= steps.length) this._skStep = steps.length - 1;

		ee(wrp)`<p class="ve-muted ve-small ve-mb-2 no-print">A <b>sidekick</b> (Tasha's Cauldron of Everything) starts from a creature of challenge rating ½ or lower, then gains levels in a Warrior, Expert, or Spellcaster class. The creature's stat block supplies its ability scores, AC, hit points, speed, senses, traits, and actions; the class layers on proficiency bonus, saving throws, skills, and features. Hit points per level use a Hit Die set by the creature's size.</p>`;

		const eleSteps = ee`<div class="cb__steps no-print"></div>`.appendTo(wrp);
		steps.forEach((s, ix) => {
			const isActive = ix === this._skStep;
			ee`<div class="cb__step ${isActive ? "cb__step--active" : s.done() && !isActive ? "cb__step--done" : ""}"><span class="cb__step-num">${ix + 1}</span>${s.label}</div>`
				.onn("click", () => { this._skStep = ix; this.render(); }).appendTo(eleSteps);
		});

		const eleBody = ee`<div class="cb__step-body"></div>`.appendTo(wrp);
		steps[this._skStep].render(eleBody);

		const btnBack = ee`<button class="ve-btn ve-btn-default">‹ Back</button>`.onn("click", () => { if (this._skStep > 0) { this._skStep--; this.render(); } });
		if (this._skStep === 0) btnBack.attr("disabled", "true");
		const isLast = this._skStep === steps.length - 1;
		const btnNext = ee`<button class="ve-btn ve-btn-primary" title="${isLast ? "Save this character (with its sidekick) to My Characters" : ""}">${isLast ? "✓ Save Character" : "Next ›"}</button>`
			.onn("click", async () => { if (!isLast) { this._skStep++; this.render(); } else { await this._pSaveToRoster(); this.render(); } });
		ee(wrp)`<div class="cb__footer no-print">${btnBack}${btnNext}</div>`;
	}

	_skCrText (m) { const cr = m?.cr; return cr == null ? "?" : (typeof cr === "object" ? cr.cr : cr); }

	_renderSidekickCreature (el) {
		const st = this._state;
		const creatures = st.filterVisible(this._data.bestiary);
		this._renderChooser(el, {
			subtitle: `Choose a creature (challenge rating ½ or lower) to become your sidekick — ${creatures.length} available. The creature can't normally be a construct or undead (DM's discretion).`,
			entities: creatures,
			getSel: () => st.sidekick.creatureUid,
			setSel: (uid) => { st.sidekick.creatureUid = uid; },
			renderDetail: (col, m) => {
				try { ee(col)`<table class="w-100 stats">${Renderer.monster.getCompactRenderedString(m)}</table>`; }
				catch (e) { ee(col)`<div class="ve-p-2"><b>${m.name.qq()}</b> <span class="ve-muted">(CR ${`${this._skCrText(m)}`.qq()})</span></div>`; }
			},
			// no onAfterSelect → _renderChooser updates the selection + detail in place (keeps the list's scroll position, like the race picker)
		});
	}

	_renderSidekickClass (el) {
		const st = this._state; const sk = st.sidekick;
		if (!st.sidekickCreature()) { ee(el)`<div class="cb__err">Choose a creature first (Creature step).</div>`; return; }
		const wrp = ee`<div></div>`.appendTo(el);

		ee(wrp)`<h4 class="ve-mt-0">Sidekick Class</h4>`;
		const cards = ee`<div class="ve-flex" style="gap:8px;flex-wrap:wrap"></div>`.appendTo(wrp);
		const blurb = {Expert: "5 skills + Expertise, Cunning Action, Evasion, Reliable Talent. Needs a language.", Warrior: "All armor &amp; martial weapons, Second Wind, Extra Attack, Improved Critical.", Spellcaster: "Learns spells (artificer progression: Wizard/Cleric/Bard list). Needs a language."};
		this._data.sidekickClasses.filter(c => st.isVisible(c)).forEach(cls => {
			const sel = sk.classUid === CW.uid(cls); const meta = SIDEKICK_META[cls.name];
			ee`<div style="border:1px solid ${sel ? "#006bc4" : "rgba(127,127,127,.3)"};border-radius:6px;padding:10px;cursor:pointer;flex:1 1 200px;${sel ? "background:rgba(0,107,196,.10)" : ""}">
				<b>${renderInline(`{@class ${cls.name}|${cls.source}}`)}</b>
				<div class="ve-muted ve-small ve-mt-1">${blurb[meta?.label] || ""}</div></div>`
				.onn("click", () => { sk.classUid = CW.uid(cls); sk.saveProf = null; sk.skillChoices = []; sk.expertiseChoices = []; sk.toolChoices = []; sk.asi = {}; sk.martialRole = null; sk.sharpMindSave = null; sk.empoweredSchool = null; sk.spellRole = "mage"; sk.spellChoices = {cantrips: [], leveled: []}; this._save(); this.render(); }).appendTo(cards);
		});
		if (!sk.classUid) return;
		const meta = st.sidekickMeta();

		// level
		const inpLevel = ee`<input type="number" min="1" max="20" class="ve-form-control" style="width:64px" value="${st.sidekickLevel()}">`
			.onn("change", () => { sk.level = Math.max(1, Math.min(20, parseInt(inpLevel.val(), 10) || 1)); inpLevel.val(sk.level); this._save(); this.render(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mt-3" style="gap:8px"><b>Level</b> ${inpLevel} <span class="ve-muted ve-small">proficiency +${st.sidekickProfBonus()} • hit die d${st.sidekickHitDie()} (size ${st._creatureSize()}) • HP ${st.sidekickMaxHp()}</span></div>`;

		// save proficiency
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Saving Throw Proficiency <span class="ve-muted ve-small">(choose one)</span></h4>`;
		const saveSel = ee`<select class="ve-form-control" style="width:auto"><option value="">— choose —</option></select>`;
		meta.saves.forEach(a => ee`<option value="${a}">${CW.ABIL_FULL[a]}</option>`.appendTo(saveSel));
		saveSel.val(sk.saveProf || ""); saveSel.onn("change", () => { sk.saveProf = saveSel.val() || null; this._save(); this.render(); });
		ee(wrp)`<div>${saveSel} <span class="ve-muted ve-small">(keeps any saves already in the stat block)</span></div>`;

		// skills
		const creatureSkills = new Set(Object.keys(st.sidekickCreature().skill || {}).map(s => s.toLowerCase()));
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Skill Proficiencies <span class="ve-muted ve-small">(choose ${meta.skillCount})</span></h4>`;
		if (creatureSkills.size) ee(wrp)`<div class="ve-muted ve-small ve-mb-1">Already proficient (from stat block): ${[...creatureSkills].map(s => CW.skillName(s)).join(", ").qq()}</div>`;
		const skillPool = (meta.skillFrom || CW.skills()).filter(s => !creatureSkills.has(s)).sort();
		const skCounter = ee`<span class="ve-muted ve-small">${sk.skillChoices.length}/${meta.skillCount}</span>`;
		ee(wrp)`<div class="ve-mb-1">${skCounter}</div>`;
		this._renderChipPicker(wrp, {items: skillPool, getValue: s => s, getLabel: s => `${CW.skillName(s)} <span class="ve-muted ve-small">(${CW.skillAbil(s)})</span>`, arr: sk.skillChoices, max: meta.skillCount, counterEle: skCounter});

		// expertise
		const expSlots = st.sidekickExpertiseSlots();
		if (expSlots) {
			ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Expertise <span class="ve-muted ve-small">(choose ${expSlots} — double proficiency)</span></h4>`;
			const proficient = [...st.sidekickSkillProfs()].sort();
			const expCounter = ee`<span class="ve-muted ve-small">${sk.expertiseChoices.length}/${expSlots}</span>`;
			ee(wrp)`<div class="ve-mb-1">${expCounter}</div>`;
			this._renderChipPicker(wrp, {items: proficient, getValue: s => s, getLabel: s => CW.skillName(s), arr: sk.expertiseChoices, max: expSlots, counterEle: expCounter});
		}

		// tool proficiencies (Expert, if the creature qualifies)
		const toolCount = st.sidekickToolProfCount();
		if (toolCount) {
			ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Tool Proficiencies <span class="ve-muted ve-small">(choose ${toolCount})</span></h4>`;
			const tCounter = ee`<span class="ve-muted ve-small">${sk.toolChoices.length}/${toolCount}</span>`;
			ee(wrp)`<div class="ve-mb-1">${tCounter}</div>`;
			this._renderChipPicker(wrp, {items: SIDEKICK_TOOL_OPTIONS, getValue: t => t, getLabel: t => `${t}`.qq(), arr: sk.toolChoices, max: toolCount, counterEle: tCounter, gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:180px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px"});
		}

		// ASIs (ability scores or — if the DM allows — a feat)
		const asiLevels = st.sidekickAsiLevels();
		if (asiLevels.length) { ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Ability Score Improvements <span class="ve-muted ve-small">(+2 total per level, max 20 — or take a feat)</span></h4>`; asiLevels.forEach(lv => this._renderSidekickAsi(wrp, lv)); }

		// non-spell feature choices (Warrior Martial Role, Expert Sharp Mind)
		this._renderSidekickFeatureChoices(wrp);

		// spellcasting
		if (meta.spellcaster) this._renderSidekickSpells(wrp);
	}

	_renderSidekickAsi (wrp, lv) {
		const st = this._state; const sk = st.sidekick;
		const cur = sk.asi[lv] || (sk.asi[lv] = {type: "asi", inc: {}});
		if (!cur.type) cur.type = "asi";
		const row = ee`<div class="ve-mb-2" style="border-left:2px solid rgba(127,127,127,.25);padding-left:8px"></div>`.appendTo(wrp);
		const typeSel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="asi">Ability Scores</option><option value="feat">Feat</option></select>`;
		typeSel.val(cur.type);
		typeSel.onn("change", () => { cur.type = typeSel.val(); if (cur.type === "asi") { delete cur.featUid; cur.featAbilChoose = []; } else cur.inc = {}; this._save(); this.render(); });
		ee(row)`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="min-width:60px">Level ${lv}</b>${typeSel}</div>`;
		if (cur.type === "feat") this._renderSidekickFeat(row, cur);
		else this._renderSidekickAsiSteppers(row, cur);
	}

	_renderSidekickAsiSteppers (wrp, cur) {
		const st = this._state; cur.inc = cur.inc || {};
		const spent = () => CW.ABILITIES.reduce((a, abv) => a + (cur.inc[abv] || 0), 0);
		const box = ee`<div class="ve-flex-v-center" style="gap:8px;flex-wrap:wrap"></div>`.appendTo(wrp);
		CW.ABILITIES.forEach(abv => {
			const n = cur.inc[abv] || 0;
			const dec = ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${n <= 0 ? "disabled" : ""}>−</button>`.onn("click", () => { cur.inc[abv] = Math.max(0, n - 1); this._save(); this.render(); });
			const inc = ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${(spent() >= 2 || n >= 2 || st.sidekickAbility(abv) >= 20) ? "disabled" : ""}>+</button>`.onn("click", () => { cur.inc[abv] = n + 1; this._save(); this.render(); });
			ee(box)`<span class="ve-flex-v-center" style="gap:2px"><span class="ve-small" style="width:26px">${abv.toUpperCase()}</span>${dec}<span class="ve-small" style="width:20px;text-align:center">+${n}</span>${inc}</span>`;
		});
		ee(box)`<span class="ve-muted ve-small">${2 - spent()} left</span>`;
	}

	_renderSidekickFeat (wrp, cur) {
		const st = this._state;
		const feats = st.filterVisible(this._data.feats).slice().sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:260px"><option value="">— choose a feat —</option></select>`;
		feats.forEach(f => ee`<option value="${CW.uid(f).qq()}">${f.name.qq()}${f.source !== "PHB" ? ` (${f.source})` : ""}</option>`.appendTo(sel));
		sel.val(cur.featUid || "");
		sel.onn("change", () => { cur.featUid = sel.val() || null; cur.featAbilChoose = []; this._save(); this.render(); });
		ee(wrp)`<div>${sel}</div>`;
		if (!cur.featUid) return;
		const feat = this._data.feats.find(f => CW.uid(f) === cur.featUid); if (!feat) return;
		(feat.ability || []).forEach(ab => {
			if (!ab.choose) return;
			cur.featAbilChoose = cur.featAbilChoose || [];
			const counter = ee`<span class="ve-muted ve-small">${cur.featAbilChoose.length}/${ab.choose.count || 1}</span>`;
			ee(wrp)`<div class="ve-small ve-mt-1"><b>+${ab.choose.amount || 1}</b> to ${counter}:</div>`;
			this._renderChipPicker(wrp, {items: ab.choose.from || CW.ABILITIES, getValue: a => a, getLabel: a => CW.ABIL_FULL[a] || a, arr: cur.featAbilChoose, max: ab.choose.count || 1, counterEle: counter});
		});
		if (feat.prerequisite) ee(wrp)`<div class="ve-muted ve-small ve-mt-1">Prerequisite: ${st._featPrereqText(feat).qq() || "see feat"} <span class="ve-muted">(not enforced for sidekicks — DM's call)</span></div>`;
		ee(wrp)`<details class="ve-small ve-mt-1"><summary class="ve-muted">${feat.name.qq()} details</summary><div class="ve-pl-3">${renderEntries(feat.entries)}</div></details>`;
	}

	_renderSidekickSpells (wrp) {
		const st = this._state; const sk = st.sidekick; const prog = st.sidekickSpellProgress(); if (!prog) return;
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Spellcasting <span class="ve-muted ve-small">(choose a role)</span></h4>`;
		const roleSel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"></select>`;
		[["mage", "Mage — Wizard list, Int"], ["healer", "Healer — Cleric &amp; Druid list, Wis"], ["prodigy", "Prodigy — Bard &amp; Warlock list, Cha"]].forEach(([r, lbl]) => ee`<option value="${r}">${lbl}</option>`.appendTo(roleSel));
		roleSel.val(st.sidekickSpellRole());
		roleSel.onn("change", () => { sk.spellRole = roleSel.val(); sk.spellChoices = {cantrips: [], leveled: []}; this._save(); this.render(); });
		ee(wrp)`<div class="ve-mb-2"><b>Role:</b> ${roleSel} <span class="ve-muted ve-small">${CW.ABIL_FULL[st.sidekickSpellAbility()]} • Save DC ${st.sidekickSpellSaveDc()} • attack ${CW.fmtMod(st.sidekickSpellAtk())} • slots ${this._fmtSlots(prog.slots)}</span></div>`;
		// Empowered Spells (L14): choose a school of magic
		if (st._skHasFeature("Empowered Spells")) {
			const schoolSel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— choose a school —</option></select>`;
			["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"].forEach(s => ee`<option value="${s}">${s}</option>`.appendTo(schoolSel));
			schoolSel.val(sk.empoweredSchool || "");
			schoolSel.onn("change", () => { sk.empoweredSchool = schoolSel.val() || null; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-2"><b>Empowered Spells</b> <span class="ve-muted ve-small">(L14 — add spellcasting mod to damage/healing of this school)</span>: ${schoolSel}</div>`;
		}
		if (prog.cantrips) this._renderSpellPicker(wrp, "Cantrips", st.sidekickSpellOptions(0), sk.spellChoices.cantrips, prog.cantrips);
		const maxLv = st.sidekickMaxSpellLevel(); let leveled = [];
		for (let l = 1; l <= maxLv; ++l) leveled = leveled.concat(st.sidekickSpellOptions(l));
		this._renderSpellPicker(wrp, "Spells Known", leveled, sk.spellChoices.leveled, prog.known);
	}

	// class-feature choices that aren't spells (Warrior Martial Role, Expert Sharp Mind)
	_renderSidekickFeatureChoices (wrp) {
		const st = this._state; const sk = st.sidekick;
		const names = st.sidekickFeatureNames();
		if (!names.has("Martial Role") && !names.has("Sharp Mind")) return;
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Feature Choices</h4>`;
		if (names.has("Martial Role")) {
			ee(wrp)`<div class="ve-mb-1"><b>Martial Role</b> <span class="ve-muted ve-small">(L1 — focus on offense or defense)</span>:</div>`;
			const grp = ee`<div class="ve-btn-group ve-mb-1"></div>`.appendTo(wrp);
			[["attacker", "Attacker", "+2 to all attack rolls"], ["defender", "Defender", "reaction to impose disadvantage on an attack vs. a nearby ally"]].forEach(([v, lbl, desc]) => {
				ee`<button class="ve-btn ve-btn-sm ${sk.martialRole === v ? "ve-btn-primary active" : "ve-btn-default"}" title="${desc}">${lbl}</button>`
					.onn("click", () => { sk.martialRole = v; this._save(); this.render(); }).appendTo(grp);
			});
			ee(wrp)`<div class="ve-muted ve-small ve-mb-2">${sk.martialRole === "attacker" ? "+2 to all attack rolls (applied to the stat-block attacks below)." : sk.martialRole === "defender" ? "Reaction: impose disadvantage on an attack roll against an ally within 5 ft." : "Choose a role."}</div>`;
		}
		if (names.has("Sharp Mind")) {
			ee(wrp)`<div class="ve-mb-1"><b>Sharp Mind</b> <span class="ve-muted ve-small">(L18 — gain a mental save proficiency)</span>:</div>`;
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— choose —</option></select>`;
			["int", "wis", "cha"].forEach(a => ee`<option value="${a}">${CW.ABIL_FULL[a]}</option>`.appendTo(sel));
			sel.val(sk.sharpMindSave || ""); sel.onn("change", () => { sk.sharpMindSave = sel.val() || null; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-2">${sel}</div>`;
		}
	}

	_renderSidekickReview (el) {
		const st = this._state; const m = st.sidekickCreature();
		const wrp = ee`<div class="cb__sheet"></div>`.appendTo(el);
		if (!m) { ee(wrp)`<div class="cb__err">Choose a creature to begin (Creature step).</div>`; return; }
		const cls = st.sidekickClassEnt();
		const sub = [m.name !== st.sidekickName() ? m.name : null, cls ? `${cls.name.replace(/ Sidekick$/, "")} ${st.sidekickLevel()}` : null, `CR ${this._skCrText(m)}`, Parser.sizeAbvToFull(st._creatureSize())].filter(Boolean).join(" • ");
		ee(wrp)`<div class="cb__sheet-head">
			<div><div style="font-size:24px;font-weight:bold">${st.sidekickName().qq()}</div><div class="ve-muted">${sub.qq()}</div></div>
			<div class="ve-text-right"><div><b>Proficiency Bonus</b> +${st.sidekickProfBonus()}</div><div><b>Speed</b> ${st.sidekickSpeed().qq()}</div></div>
		</div>`;

		const boxes = ee`<div class="cb__sheet-grid"></div>`.appendTo(wrp);
		const box = (l, v) => ee(boxes)`<div class="cb__stat-box"><div class="lbl">${l}</div><div class="val">${v}</div></div>`;
		box("Armor Class", st.sidekickAc() ?? "—");
		box("Hit Points", st.sidekickMaxHp() ?? "—");
		box("Hit Die", `d${st.sidekickHitDie()}`);
		box("Initiative", `${CW.fmtMod(st.sidekickAbilityMod("dex"))}${st.sidekickInitiativeAdv() ? ` <span class="cb__advdis cb__advdis--adv" title="Battle Readiness">ADV</span>` : ""}`);
		box("Passive Perception", 10 + st.sidekickSkillMod("perception"));
		if (!cls) ee(wrp)`<div class="cb__err no-print ve-mt-2">Pick a sidekick class &amp; level (Class &amp; Level step) to finish the build.</div>`;

		// combat features (Martial Role, Improved Critical, Extra Attack, Battle Readiness)
		const names = st.sidekickFeatureNames(); const combatParts = [];
		if (names.has("Martial Role")) { const role = st.sidekickMartialRole(); combatParts.push(role === "attacker" ? "<b>Attacker:</b> +2 to all attack rolls" : role === "defender" ? "<b>Defender:</b> reaction to impose disadvantage on an attack vs. a nearby ally" : `<b style="color:#d9822b">Martial Role: choose Attacker or Defender</b>`); }
		if (st.sidekickCritRange() < 20) combatParts.push(`<b>Improved Critical:</b> crits on ${st.sidekickCritRange()}–20`);
		if (st.sidekickExtraAttacks() > 1) combatParts.push(`<b>Extra Attack:</b> ${st.sidekickExtraAttacks()}× (or its Multiattack — not both)`);
		if (st.sidekickInitiativeAdv()) combatParts.push("<b>Battle Readiness:</b> advantage on initiative");
		if (combatParts.length) ee(wrp)`<div class="cb__sheet-section"><h4>Combat</h4><div>${combatParts.join(" &nbsp;•&nbsp; ")}</div></div>`;

		// abilities + saves
		const secA = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
		ee(secA)`<h4>Ability Scores &amp; Saving Throws</h4>`;
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(secA);
		CW.ABILITIES.forEach(abv => {
			ee(grid)`<div class="cb__abil"><div class="cb__abil-name">${abv}</div>
				<div class="cb__abil-score">${st.sidekickAbility(abv)}</div><div class="cb__abil-mod">${CW.fmtMod(st.sidekickAbilityMod(abv))}</div>
				<div class="cb__abil-sub">save ${CW.fmtMod(st.sidekickSaveMod(abv))}${st.sidekickSaveProfs().has(abv) ? " ●" : ""}</div></div>`;
		});

		// skills
		const secS = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
		ee(secS)`<h4>Skills <span class="ve-muted ve-small">(★ expertise, ● proficient)</span></h4>`;
		const MARK = {expertise: "★", full: "●", none: "○"};
		const skillWrp = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(secS);
		CW.skills().sort().forEach(sk => ee(skillWrp)`<div style="break-inside:avoid">${MARK[st.sidekickSkillProfType(sk)]} ${CW.skillName(sk)} <span class="ve-muted">(${CW.skillAbil(sk)})</span> <b>${CW.fmtMod(st.sidekickSkillMod(sk))}</b></div>`);

		// proficiencies granted by the sidekick class
		const profParts = [];
		if (st.sidekickArmorProfs().length) profParts.push(`<b>Armor:</b> ${st.sidekickArmorProfs().join(", ").qq()}`);
		if (st.sidekickWeaponProfs().length) profParts.push(`<b>Weapons:</b> ${st.sidekickWeaponProfs().join(", ").qq()}`);
		if (st.sidekickToolProfs().length) profParts.push(`<b>Tools:</b> ${st.sidekickToolProfs().join(", ").qq()}`);
		if (profParts.length) ee(wrp)`<div class="cb__sheet-section"><h4>Proficiencies</h4><div>${profParts.join(" &nbsp;•&nbsp; ")}</div></div>`;

		// equipped gear: wielded weapons (as attacks), worn armor/shield/items, item effects
		const skWielded = st.sidekickWieldedWeapons(); const skWorn = st.sidekickWornItems();
		const skArmorE = st.sidekickArmorEnt(); const skShieldE = st.sidekickShieldEnt();
		if (skWielded.length || skWorn.length || skArmorE || skShieldE) {
			const secE = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secE)`<h4>Equipment</h4>`;
			const eqLines = [];
			if (skArmorE) eqLines.push(`<b>Armor:</b> ${refLink(UrlUtil.PG_ITEMS, skArmorE, skArmorE.name)}`);
			if (skShieldE) eqLines.push(`<b>Shield:</b> ${refLink(UrlUtil.PG_ITEMS, skShieldE, skShieldE.name)}`);
			if (skWorn.length) eqLines.push(`<b>Worn/held:</b> ${skWorn.map(it => refLink(UrlUtil.PG_ITEMS, it, it.name)).join(", ")}`);
			if (eqLines.length) ee(secE)`<div class="ve-mb-1">${eqLines.join(" &nbsp;•&nbsp; ")}</div>`;
			if (skWielded.length) {
				ee(secE)`<div class="ve-bold ve-small ve-mt-1">Weapon Attacks <span class="ve-muted ve-small">(its ability mods + proficiency)</span></div>`;
				skWielded.forEach(it => {
					const a = st.sidekickWeaponAttack(it);
					ee(secE)`<div class="ve-mb-1">${refLink(UrlUtil.PG_ITEMS, it, it.name)} <span class="ve-muted">—</span> ${CW.fmtMod(a.toHit)} to hit, ${st.fmtWeaponDamage(a.dmg1, a).qq()}${a.dmg2 ? ` <span class="ve-muted">(${st.fmtWeaponDamage(a.dmg2, a).qq()} 2H)</span>` : ""}${a.prof ? "" : ` <span class="ve-muted ve-small">(not proficient — no PB)</span>`}</div>`;
				});
			}
			const sb = st.sidekickItemSaveBonus(); const res = st.sidekickItemResist(); const fx = [];
			if (sb) fx.push(`${CW.fmtMod(sb)} to all saves`); if (res.length) fx.push(`resist ${res.join(", ")}`);
			if (fx.length) ee(secE)`<div class="ve-muted ve-small">Item effects: ${fx.join("; ").qq()}</div>`;
		}

		// senses
		if (st.sidekickSenses()) ee(wrp)`<div class="cb__sheet-section"><h4>Senses</h4><div>${st.sidekickSenses().qq()}</div></div>`;

		// feats taken in place of an ASI
		const skFeats = st.sidekickFeats();
		if (skFeats.length) {
			const secSkF = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secSkF)`<h4>Feats</h4>`;
			skFeats.forEach(({level, feat}) => ee`<details style="margin:2px 0"><summary><b>L${level}:</b> ${refLink(UrlUtil.PG_FEATS, feat)}</summary><div class="ve-pl-3">${renderEntries(feat.entries)}</div></details>`.appendTo(secSkF));
		}

		// spellcasting
		if (st.sidekickIsCaster()) {
			const prog = st.sidekickSpellProgress();
			const spans = (arr) => (arr || []).map(u => { const i = `${u}`.lastIndexOf("|"); return i < 0 ? `${u}`.qq() : spellSpan(`${u}`.slice(0, i), `${u}`.slice(i + 1)); }).join(", ");
			const secSp = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secSp)`<h4>Spellcasting</h4>
				<div><b>${CW.ABIL_FULL[st.sidekickSpellAbility()]}</b> — Save DC ${st.sidekickSpellSaveDc()}, attack ${CW.fmtMod(st.sidekickSpellAtk())}, slots ${this._fmtSlots(prog?.slots)}</div>
				<div class="ve-pl-3"><b>Cantrips:</b> ${spans(st.sidekick.spellChoices.cantrips) || "—"}</div>
				<div class="ve-pl-3"><b>Spells:</b> ${spans(st.sidekick.spellChoices.leveled) || "—"}</div>`;
		}

		// creature's own stat-block spellcasting (Sage, Acolyte, etc.) — innate/prepared; DC & attack bumped by the PB increase, kept separate from any Spellcaster-class spellcasting
		if (m.spellcasting?.length) {
			try {
				const adjMon = {...m, spellcasting: st.sidekickAdjustEntries(m.spellcasting)};
				const traits = ["trait", "action", "bonus", "reaction"].flatMap(prop => { try { return Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), adjMon, {displayAsProp: prop}); } catch (e) { return []; } });
				if (traits.length) {
					const secSc = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
					ee(secSc)`<h4>Stat-Block Spellcasting <span class="ve-muted ve-small">(from the creature — separate from any class)</span></h4>`;
					traits.forEach(t => ee(secSc)`<div class="ve-mb-1"><b>${`${t.name}`.qq()}.</b> ${t.rendered}</div>`);
				}
			} catch (e) { /* ignore render issues */ }
		}

		// traits & actions from the stat block — attack to-hit / save DCs bumped by the proficiency-bonus increase (TCE)
		const pbDelta = st.sidekickPbDelta();
		const monBlock = (title, arr) => {
			const adj = st.sidekickAdjustEntries(arr);
			if (!adj?.length) return;
			const sec = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(sec)`<h4>${title}</h4>`;
			adj.forEach(t => ee(sec)`<div class="ve-mb-1">${renderEntries([{type: "entries", name: t.name, entries: t.entries}])}</div>`);
		};
		monBlock("Traits", m.trait);
		monBlock("Actions", m.action);
		monBlock("Bonus Actions", m.bonus);
		monBlock("Reactions", m.reaction);
		if (cls && (m.trait?.length || m.action?.length)) {
			const asiTaken = st._sidekickActiveAsi().some(([, a]) => Object.values(a?.inc || {}).some(v => v > 0));
			const atkBonus = st.sidekickAttackBonus(); const attacker = st.sidekickMartialRole() === "attacker"; const pb = st.sidekickProfBonus();
			const notes = [];
			if (atkBonus) {
				let msg;
				if (attacker && pbDelta) msg = `The to-hit numbers in the creature's actions below already include <b>+${atkBonus}</b> — that's +${pbDelta} from its higher proficiency bonus (a stat block assumes +2; at this level the sidekick's is +${pb}) plus +2 from the Attacker role. Save DCs include the +${pbDelta} proficiency part.`;
				else if (attacker) msg = `The to-hit numbers in the creature's actions below already include <b>+2</b> from the Attacker role.`;
				else msg = `The to-hit numbers and save DCs in the creature's actions below already include <b>+${pbDelta}</b> — a sidekick's proficiency bonus grows with its level (a stat block assumes +2; at this level it's +${pb}).`;
				notes.push(`${msg} You don't need to add that yourself.`);
			}
			if (asiTaken) notes.push(`<b>One thing to add by hand:</b> if you raised an ability score with an Ability Score Improvement, also add that increase to the to-hit and damage of the creature's own attacks that use it. The stat block doesn't record which ability each attack uses (a melee attack could be Strength or Dexterity), so the builder can't do it automatically. <i>Weapons you equip on the Equipment step already include it.</i>`);
			if (notes.length) ee(wrp)`<div class="ve-muted ve-small ve-mt-1">${notes.join(" ")}</div>`;
		}

		// class features
		const feats = st.sidekickFeatures();
		if (feats.length) {
			const secF = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secF)`<h4>${(cls?.name || "Class").qq()} Features</h4>`;
			feats.forEach(f => ee`<details style="margin:2px 0"><summary><b>L${f.level}:</b> ${f.name.qq()}</summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`.appendTo(secF));
		}
	}

	/* ====================================================================== */
	/* Sidekick play mode                                                     */
	/* ====================================================================== */
	_renderSidekickPlayMode (wrp) {
		const st = this._state;
		if (!st.sidekickCreature()) { ee(wrp)`<div class="cb__err">Pick a creature (and class) on the build steps first, then switch to Play mode.</div>`; return; }
		const cls = st.sidekickClassEnt(); const p = st.skPlay();
		const star = ee`<button class="ve-btn ve-btn-sm ${p.inspiration ? "ve-btn-primary" : "ve-btn-default"}" title="Toggle Inspiration">${p.inspiration ? "★" : "☆"} Inspiration</button>`
			.onn("click", () => { p.inspiration = !p.inspiration; this._save(); this.render(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:12px;flex-wrap:wrap">
			<div style="flex:1 1 auto"><div style="font-size:22px;font-weight:bold">${st.sidekickName().qq()}</div>
			<div class="ve-muted ve-small">${(cls ? `${cls.name.replace(/ Sidekick$/, "")} ${st.sidekickLevel()}` : "no class chosen").qq()} • CR ${`${this._skCrText(st.sidekickCreature())}`.qq()}</div></div>
			${star}</div>`;
		if (!cls) ee(wrp)`<div class="cb__err no-print ve-mb-2">Choose a sidekick class &amp; level on the build steps for full play features.</div>`;

		const boxes = ee`<div class="cb__sheet-grid ve-mb-3"></div>`.appendTo(wrp);
		const box = (lbl, val, onClick, title) => { const el = ee`<div class="cb__stat-box ${onClick ? "cb__stat-box--click" : ""}" ${title ? `title="${title.qq()}"` : ""}><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`; if (onClick) el.onn("click", onClick); el.appendTo(boxes); };
		box("Armor Class", st.sidekickAc() ?? "—");
		box("Initiative", `${CW.fmtMod(st.sidekickAbilityMod("dex"))} ${advDisBadge(this._mergeExhaustion(st.sidekickInitiativeAdv() ? {net: "adv", adv: ["Battle Readiness"]} : null, "check"))}`, () => this._d20Roll("Initiative", st.sidekickAbilityMod("dex"), this._mergeExhaustion(st.sidekickInitiativeAdv() ? {net: "adv", adv: ["Battle Readiness"]} : null, "check")), "Click to roll initiative");
		box("Prof. Bonus", CW.fmtMod(st.sidekickProfBonus()));
		box("Passive Perc.", 10 + st.sidekickSkillMod("perception"));
		box("Speed", `${st.sidekickSpeed()}${(p.exhaustion || 0) >= 5 ? ` <span class="cb__advdis cb__advdis--dis">→ 0</span>` : (p.exhaustion || 0) >= 2 ? ` <span class="ve-muted ve-small">(½)</span>` : ""}`);
		if (st.sidekickIsCaster()) { box("Spell DC", st.sidekickSpellSaveDc()); box("Spell Atk", CW.fmtMod(st.sidekickSpellAtk())); }

		this._renderSkPlayHp(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderSkPlayRests(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		if (st.sidekickIsCaster()) this._renderSkPlaySpells(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderSkPlayConditions(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderEffects(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp), st.skPlay());
		this._renderSkPlayAbilities(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderTurnOptions(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp), st.sidekickTurnOptions());
		this._renderSkPlayAttacks(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderSkPlaySkills(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		this._renderSkPlayFeatures(ee`<div class="cb__sheet-section"></div>`.appendTo(wrp));
		ee(wrp)`<div class="ve-muted ve-small ve-mt-3 no-print">Rolls open in the dice tray (bottom-right). Attack to-hit and damage in the stat block below are clickable.</div>`;
	}

	_renderSkPlayHp (sec) {
		const st = this._state; const p = st.skPlay();
		const cur = st.skCurHp(); const max = st.skMaxHp(); const temp = st.skTempHp();
		const pct = max ? Math.round((cur / max) * 100) : 0;
		const colour = pct > 50 ? "#4caf50" : pct > 25 ? "#ff9800" : "#f44336";
		ee(sec)`<h4>Hit Points</h4>`;
		ee(sec)`<div class="ve-mb-2"><div style="position:relative;height:26px;border:1px solid rgba(127,127,127,.4);border-radius:4px;overflow:hidden;background:rgba(127,127,127,.12)">
			<div style="position:absolute;inset:0 ${100 - pct}% 0 0;background:${colour};opacity:.55"></div>
			<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:bold">${cur} / ${max}${temp ? ` (+${temp} temp)` : ""}</div>
		</div></div>`;
		const inpAmt = ee`<input class="ve-form-control" type="number" min="0" style="width:80px" placeholder="0">`;
		const amt = () => Math.max(0, parseInt(inpAmt.val(), 10) || 0);
		const btnDmg = ee`<button class="ve-btn ve-btn-danger ve-btn-sm">− Damage</button>`.onn("click", () => { const d = amt(); st.skApplyDamage(d); if (d && p.concentration && !st._skHasFeature("Focused Casting")) JqueryUtil.doToast({type: "warning", content: `Concentration: make a DC ${Math.max(10, Math.floor(d / 2))} Constitution save.`}); inpAmt.val(""); this._save(); this.render(); });
		const btnHeal = ee`<button class="ve-btn ve-btn-success ve-btn-sm">+ Heal</button>`.onn("click", () => { st.skApplyHealing(amt()); inpAmt.val(""); this._save(); this.render(); });
		const btnTemp = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Temp HP doesn't stack — keeps the higher">Temp HP</button>`.onn("click", () => { st.skSetTempHp(amt()); inpAmt.val(""); this._save(); this.render(); });
		const btnFull = ee`<button class="ve-btn ve-btn-default ve-btn-sm">Full</button>`.onn("click", () => { st.skApplyHealing(st.skMaxHp()); st.skClearTempHp(); this._save(); this.render(); });
		ee(sec)`<div class="ve-flex-v-center" style="gap:6px;flex-wrap:wrap">${inpAmt}${btnDmg}${btnHeal}${btnTemp}${btnFull}</div>`;
		if (p.concentration) {
			const row = ee`<div class="ve-flex-v-center ve-mt-2" style="gap:6px;flex-wrap:wrap"><b>Concentrating:</b> ${renderInline(`{@spell ${p.concentration}}`)}${st._skHasFeature("Focused Casting") ? ` <span class="ve-muted ve-small">(damage can't break it)</span>` : ""}</div>`.appendTo(sec);
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs">Con save ${CW.fmtMod(st.sidekickSaveMod("con"))}</button>`.onn("click", () => this._d20Roll("Concentration (Con)", st.sidekickSaveMod("con"), this._mergeExhaustion(null, "save")))}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs">Drop</button>`.onn("click", () => { p.concentration = null; this._save(); this.render(); })}`;
		}
		const ds = p.deathSaves || (p.deathSaves = {success: 0, fail: 0});
		if (cur === 0 || ds.success || ds.fail) {
			ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mt-2" style="display:inline-block">${cur === 0 ? "Unconscious at 0 HP — make death saving throws." : "Dying — death saves in progress."}</div>`;
			const pip = (type, n, colour, i) => ee`<span class="cb__ds-pip" style="border:2px solid ${colour};background:${n >= i ? colour : "transparent"}"></span>`.onn("click", () => { ds[type === "Success" ? "success" : "fail"] = (n === i ? i - 1 : i); this._save(); this.render(); });
			const dsRow = ee`<div class="ve-flex-v-center ve-mt-1" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(sec);
			ee(dsRow)`<span class="ve-small">Successes</span>${[1, 2, 3].map(i => pip("Success", ds.success, "#4caf50", i))}`;
			ee(dsRow)`<span class="ve-small ve-ml-2">Failures</span>${[1, 2, 3].map(i => pip("Fail", ds.fail, "#f44336", i))}`;
			ee(dsRow)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-ml-2">🎲 Death Save</button>`.onn("click", () => this._rollDeathSaveFor(p, n => st.skApplyHealing(n)))}`;
			if (ds.success >= 3) ee(sec)`<div class="ve-muted ve-small ve-mt-1">Stable — unconscious.</div>`;
			if (ds.fail >= 3) ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mt-1" style="display:inline-block">The sidekick has died.</div>`;
		}
	}

	_renderSkPlayRests (sec) {
		const st = this._state;
		ee(sec)`<h4>Rest, Hit Dice &amp; Features</h4>`;
		const btnShort = ee`<button class="ve-btn ve-btn-default ve-btn-sm" title="Spend Hit Dice to heal; Second Wind returns">Short Rest</button>`.onn("click", () => { st.skShortRest(); JqueryUtil.doToast({type: "success", content: "Short rest — spend Hit Dice to heal; Second Wind restored."}); this._save(); this.render(); });
		const btnLong = ee`<button class="ve-btn ve-btn-primary ve-btn-sm" title="Full HP, spell slots, features, half Hit Dice">Long Rest</button>`.onn("click", () => { st.skLongRest(); JqueryUtil.doToast({type: "success", content: "Long rest — HP, slots, features, and half your Hit Dice restored."}); this._save(); this.render(); });
		ee(sec)`<div class="ve-flex-v-center ve-mb-2" style="gap:6px;flex-wrap:wrap">${btnShort}${btnLong}</div>`;
		const f = st.sidekickHitDie(); const rem = st.skHitDiceRemaining(f); const total = st.sidekickLevel();
		const hdRow = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="width:42px">Hit Dice</b><span class="ve-muted ve-small" style="width:64px">${rem}/${total} d${f}</span></div>`;
		ee(hdRow)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem ? "" : "disabled"} title="Roll d${f} + Con to heal">Spend</button>`.onn("click", () => this._spendHitDieFor(f, st.sidekickAbilityMod("con"), () => st.skSpendHitDie(f), n => st.skApplyHealing(n)))}`;
		ee(hdRow)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem < total ? "" : "disabled"}>↺</button>`.onn("click", () => { st.skRestoreHitDie(f); this._save(); this.render(); })}`;
		hdRow.appendTo(sec);
		st.sidekickFeatureResources().forEach(res => {
			const r = st.skFeatureRemaining(res);
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px;flex-wrap:wrap"><b style="min-width:104px">${res.name.qq()}</b><span class="ve-muted ve-small" style="width:34px">${r}/${res.max}</span></div>`;
			if (res.roll) ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${r ? "" : "disabled"} title="Roll ${res.roll} to heal">Use</button>`.onn("click", () => this._skUseSecondWind(res))}`;
			else ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${r ? "" : "disabled"} title="${res.note.qq()}">Use</button>`.onn("click", () => { st.skUseFeature(res.key); this._save(); this.render(); })}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${st.skFeatureUsed(res.key) ? "" : "disabled"}>↺</button>`.onn("click", () => { st.skRestoreFeature(res.key); this._save(); this.render(); })}`;
			ee(row)`<span class="ve-muted ve-small">${res.note.qq()} • recharges on a ${res.recharge.qq()}</span>`;
			row.appendTo(sec);
		});
	}

	async _skUseSecondWind (res) {
		const st = this._state; if (st.skFeatureRemaining(res) <= 0) return;
		const heal = await this._roll("Second Wind", res.roll); if (heal == null) return;
		st.skUseFeature(res.key); st.skApplyHealing(Math.max(0, heal));
		JqueryUtil.doToast({type: "success", content: `Second Wind — healed ${Math.max(0, heal)}.`});
		this._save(); this.render();
	}

	_renderSkPlaySpells (sec) {
		const st = this._state; const prog = st.sidekickSpellProgress(); const book = st.skSpellbook();
		ee(sec)`<h4>Spells <span class="ve-muted ve-small">(${CW.ABIL_FULL[st.sidekickSpellAbility()]} • DC ${st.sidekickSpellSaveDc()} • roll buttons for attacks &amp; damage; Cast expends a slot)</span></h4>`;
		const pip = (filled) => `<span style="display:inline-block;width:15px;height:15px;border-radius:50%;border:2px solid #2196f3;margin:0 2px;vertical-align:middle;background:${filled ? "#2196f3" : "transparent"}"></span>`;
		Object.keys(prog?.slots || {}).map(Number).sort((a, b) => a - b).forEach(lvl => {
			const total = st.skSlotsTotal(lvl); const rem = st.skSlotsRemaining(lvl);
			const pips = Array.from({length: total}, (_, i) => pip(i < rem)).join("");
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px"><b style="width:62px">Level ${lvl}</b><div style="flex:1">${pips}</div></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem ? "" : "disabled"}>Use</button>`.onn("click", () => { st.skExpendSlot(lvl); this._save(); this.render(); })}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" ${rem < total ? "" : "disabled"}>↺</button>`.onn("click", () => { st.skRestoreSlot(lvl); this._save(); this.render(); })}`;
			ee(row)`<span class="ve-muted ve-small">${rem}/${total}</span>`;
			row.appendTo(sec);
		});
		if (book && (book.cantrips.length || book.leveled.length)) {
			const attackAd = this._mergeExhaustion(null, "attack");
			if (book.cantrips.length) {
				ee(sec)`<div class="ve-muted ve-small ve-bold ve-mt-1">Cantrips</div>`;
				book.cantrips.forEach(sp => this._renderSpellRollRow(sec, sp, st.sidekickSpellRollInfo(sp), {cantrip: true, attackAd, attackExtra: ""}));
			}
			const byLvl = {}; book.leveled.forEach(sp => (byLvl[sp.level] = byLvl[sp.level] || []).push(sp));
			Object.keys(byLvl).map(Number).sort((a, b) => a - b).forEach(lvl => {
				ee(sec)`<div class="ve-muted ve-small ve-bold ve-mt-1">Level ${lvl}</div>`;
				byLvl[lvl].forEach(sp => {
					let can = false; for (let L = lvl; L <= 9; ++L) if (st.skSlotsRemaining(L) > 0) { can = true; break; }
					this._renderSpellRollRow(sec, sp, st.sidekickSpellRollInfo(sp), {cantrip: false, can, onCast: () => this._skCastSpell(sp), attackAd, attackExtra: ""});
				});
			});
		} else ee(sec)`<div class="ve-muted ve-small">No spells chosen yet — pick them on the Class &amp; Level step.</div>`;
	}

	_skCastSpell (sp) {
		const st = this._state; const used = st.skCastSpell(sp);
		if (used == null) { JqueryUtil.doToast({type: "warning", content: `No spell slot available for ${sp.name}.`}); return; }
		if (/concentration/i.test(JSON.stringify(sp.duration || ""))) st.skPlay().concentration = sp.name;
		JqueryUtil.doToast({type: "info", content: `Cast ${sp.name} — expended a level ${used} slot${used > sp.level ? ` (upcast from ${sp.level})` : ""}.`});
		this._save(); this.render();
	}

	_renderSkPlayConditions (sec) {
		const st = this._state; const p = st.skPlay(); const active = p.conditions || [];
		ee(sec)`<h4>Exhaustion &amp; Conditions</h4>`;
		this._renderExhaustion(sec, p);
		const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:6px;flex-wrap:wrap"></div>`.appendTo(sec);
		if (active.length) active.forEach(c => ee(row)`<span class="cb__cond-chip">${renderInline(`{@condition ${c}}`)} ${ee`<span class="cb__cond-x" title="Remove">✕</span>`.onn("click", () => { p.conditions = active.filter(x => x !== c); this._save(); this.render(); })}</span>`);
		else ee(row)`<span class="ve-muted ve-small">None.</span>`;
		const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">+ add condition…</option></select>`;
		CONDITIONS.filter(c => !active.includes(c)).forEach(c => ee`<option value="${c}">${c}</option>`.appendTo(sel));
		sel.onn("change", () => { if (sel.val()) { (p.conditions = p.conditions || []).push(sel.val()); this._save(); this.render(); } });
		ee(sec)`${sel}`;
	}

	_renderSkPlayAbilities (sec) {
		const st = this._state;
		ee(sec)`<h4>Ability Checks &amp; Saves <span class="ve-muted ve-small">(click to roll)</span></h4>`;
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(sec);
		CW.ABILITIES.forEach(abv => {
			const mod = st.sidekickAbilityMod(abv); const save = st.sidekickSaveMod(abv); const saveProf = st.sidekickSaveProfs().has(abv);
			const card = ee`<div class="cb__abil" style="padding:4px"></div>`;
			ee`<div class="cb__roll" style="padding:4px 2px" title="Roll a ${CW.ABIL_FULL[abv]} check"><div class="cb__abil-name">${abv}</div><div class="cb__abil-score">${st.sidekickAbility(abv)}</div><div class="cb__abil-mod">${CW.fmtMod(mod)}</div></div>`
				.onn("click", () => this._d20Roll(`${CW.ABIL_FULL[abv]} check`, mod, this._mergeExhaustion(null, "check"))).appendTo(card);
			ee`<div class="cb__roll cb__abil-sub" style="padding:2px" title="Roll a ${CW.ABIL_FULL[abv]} save"><span>save ${CW.fmtMod(save)}${saveProf ? " ●" : ""} ${advDisBadge(this._mergeExhaustion(null, "save"))}</span></div>`
				.onn("click", () => this._d20Roll(`${CW.ABIL_FULL[abv]} save`, save, this._mergeExhaustion(null, "save"))).appendTo(card);
			card.appendTo(grid);
		});
		if (st._skHasFeature("Reliable Talent")) ee(sec)`<div class="ve-muted ve-small ve-mt-1">Reliable Talent: treat a d20 of 9 or lower as 10 for any check using your full proficiency bonus.</div>`;
	}

	_renderSkPlayAttacks (sec) {
		const st = this._state; const m = st.sidekickCreature();
		const wielded = st.sidekickWieldedWeapons();
		const actions = st.sidekickAdjustEntries(m.action);
		if (!wielded.length && !actions?.length) return;
		ee(sec)`<h4>Attacks &amp; Actions <span class="ve-muted ve-small">(click a to-hit or damage to roll)</span></h4>`;
		// equipped weapons (carried gear) — rolled with the sidekick's ability mods + proficiency
		wielded.forEach(it => {
			const a = st.sidekickWeaponAttack(it); const extra = st.weaponExtraDamage(it);
			const row = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:8px;flex-wrap:wrap"><b style="min-width:120px">${refLink(UrlUtil.PG_ITEMS, it, it.name)}${a.magic ? ` <span class="ve-muted ve-small">(${CW.fmtMod(a.magic)} magic)</span>` : ""}</b></div>`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll attack (d20 ${CW.fmtMod(a.toHit)})">Attack ${CW.fmtMod(a.toHit)}</button>`.onn("click", () => this._d20Roll(`${it.name} attack`, a.toHit, this._mergeExhaustion(null, "attack")))}`;
			ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll damage">Dmg ${st.fmtWeaponDamage(a.dmg1, a).qq()}</button>`.onn("click", () => this._rollDamage(a, a.dmg1, it.name))}`;
			if (a.dmg2) ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Roll versatile (two-handed) damage">2H ${st.fmtWeaponDamage(a.dmg2, a).qq()}</button>`.onn("click", () => this._rollDamage(a, a.dmg2, `${it.name} (2H)`))}`;
			extra.forEach(r => ee(row)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Extra/conditional damage from this item">+${r.dice}${r.type ? ` ${r.type}` : ""}</button>`.onn("click", () => this._roll(`${it.name} extra (${r.type || "damage"})`, r.dice))}`);
			if (!a.prof) ee(row)`<span class="ve-muted ve-small">not proficient (no PB)</span>`;
			row.appendTo(sec);
		});
		if (wielded.length && actions?.length) ee(sec)`<div class="ve-muted ve-small ve-mt-1 ve-mb-1">Or its natural attacks:</div>`;
		actions.forEach(t => ee(sec)`<div class="ve-mb-1">${renderEntries([{type: "entries", name: t.name, entries: t.entries}])}</div>`);
		const combat = [];
		if (st.sidekickExtraAttacks() > 1) combat.push(`Extra Attack: ${st.sidekickExtraAttacks()}× (or its Multiattack)`);
		if (st.sidekickCritRange() < 20) combat.push(`crits on ${st.sidekickCritRange()}–20`);
		if (st.sidekickMartialRole() === "attacker") combat.push("Attacker: +2 to-hit (included above)");
		if (combat.length) ee(sec)`<div class="ve-muted ve-small">${combat.join(" • ").qq()}</div>`;
		if ((st.skPlay().exhaustion || 0) >= 3) ee(sec)`<div class="cb__advdis cb__advdis--dis ve-mt-1" style="display:inline-block">Exhaustion: attacks have disadvantage — CTRL-click the to-hit to roll it.</div>`;
	}

	_renderSkPlaySkills (sec) {
		const st = this._state;
		ee(sec)`<h4>Skills <span class="ve-muted ve-small">(click to roll)</span></h4>`;
		const MARK = {expertise: "★", full: "●", none: "○"};
		const grid = ee`<div style="columns:2;column-gap:24px"></div>`.appendTo(sec);
		CW.skills().sort().forEach(sk => {
			const mod = st.sidekickSkillMod(sk);
			ee(grid)`${ee`<div class="cb__roll" style="break-inside:avoid;padding:2px 4px" title="Roll ${CW.skillName(sk)}">${MARK[st.sidekickSkillProfType(sk)]} ${CW.skillName(sk)} <span class="ve-muted ve-small">(${CW.skillAbil(sk)})</span> <b>${CW.fmtMod(mod)}</b> ${advDisBadge(this._mergeExhaustion(st.skillAdvDis?.(sk), "check"))}</div>`.onn("click", () => this._d20Roll(CW.skillName(sk), mod, this._mergeExhaustion(st.skillAdvDis?.(sk), "check")))}`;
		});
	}

	_renderSkPlayFeatures (sec) {
		const st = this._state; const feats = st.sidekickFeatures().filter(f => f.name !== "Sidekick Class");
		if (!feats.length) return;
		ee(sec)`<h4>Class Features</h4>`;
		feats.forEach(f => ee`<details style="margin:2px 0"><summary><b>L${f.level}:</b> ${f.name.qq()}</summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`.appendTo(sec));
	}

	/* ----- generic chooser (list + preview) ----- */
	/**
	 * @param [opts.group] optional collapsible grouping: {id, key(ent), label(ent), parentUid(ent), isBase(ent)}.
	 * Entities sharing `key` collapse under one header; entities whose `parentUid` is in the same group
	 * (e.g. generated race "versions") fold behind a "▸ N" toggle on that parent's row.
	 * @param [opts.fnHeaderExtra] (wrp) => void, renders extra controls under the subtitle.
	 */
	_renderChooser (eleBody, {entities, getSel, setSel, renderDetail, subtitle, onAfterSelect = null, group = null, fnHeaderExtra = null}) {
		const wrp = ee`<div></div>`.appendTo(eleBody);
		if (subtitle) ee(wrp)`<p class="ve-muted ve-mb-1">${subtitle}</p>`;
		if (fnHeaderExtra) fnHeaderExtra(wrp);
		const body = ee`<div class="cb__body"></div>`.appendTo(wrp);
		const colList = ee`<div class="cb__col-list"></div>`.appendTo(body);
		const colDetail = ee`<div class="cb__col-detail"></div>`.appendTo(body);

		const inpSearch = ee`<input class="ve-form-control ve-mb-1" placeholder="Search…">`;
		colList.appendChild(inpSearch);
		const listWrp = ee`<div class="cb__pick-list"></div>`.appendTo(colList);

		const renderDetailFor = (uid) => {
			colDetail.empty();
			const ent = entities.find(e => CW.uid(e) === uid);
			if (!ent) { ee(colDetail)`<div class="ve-muted ve-p-3">Select an option from the list.</div>`; return; }
			renderDetail(colDetail, ent);
		};

		const renderRow = (ent, {label = ent.name, depth = 0, cntVersions = 0, isVersionsOpen = false, onToggleVersions = null} = {}) => {
			const uid = CW.uid(ent);
			const verToggle = cntVersions ? `<span class="cb__pick-ver" title="${isVersionsOpen ? "Hide" : "Show"} ${cntVersions} version${cntVersions === 1 ? "" : "s"} with a choice already made (e.g. a dragon color)">${isVersionsOpen ? "▾" : "▸"} ${cntVersions}</span>` : "";
			const row = ee`<div class="cb__pick ${depth ? `cb__pick--d${depth}` : ""} ${getSel() === uid ? "cb__pick--sel" : ""}"><span>${label}</span><span class="ve-flex-v-center" style="gap:6px">${verToggle}<span class="cb__pick-src" title="${Parser.sourceJsonToFull(ent.source).qq()}">${ent.source}</span></span></div>`
				.onn("click", (evt) => {
					if (onToggleVersions && evt.target.closest(".cb__pick-ver")) { onToggleVersions(); return; }
					setSel(uid);
					this._save();
					if (onAfterSelect) { onAfterSelect(); return; }
					[...listWrp.children].forEach(c => c.classList.remove("cb__pick--sel"));
					row.classList.add("cb__pick--sel");
					renderDetailFor(uid);
				});
			row.appendTo(listWrp);
		};

		const matches = (e, t) => e.name.toLowerCase().includes(t) || `${e.source}`.toLowerCase().includes(t) || (group ? group.label(e).toLowerCase().includes(t) : false);

		// expand/collapse state survives re-renders; first time, open wherever the current selection is
		const openState = group ? ((this._chooserOpen ||= {})[group.id] ||= {groups: new Set(), parents: new Set(), isInit: false}) : null;
		if (openState && !openState.isInit) {
			const sel = entities.find(e => CW.uid(e) === getSel());
			if (sel) { openState.groups.add(group.key(sel)); const p = group.parentUid(sel); if (p) openState.parents.add(p); }
			openState.isInit = true;
		}
		const toggle = (set, k) => { set.has(k) ? set.delete(k) : set.add(k); renderList(inpSearch.val()); };

		const renderGrouped = (t) => {
			const byKey = new Map();
			entities.forEach(e => { const k = group.key(e); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); });
			const selUid = getSel();
			[...byKey.keys()].sort(SortUtil.ascSortLower).forEach(key => {
				const members = byKey.get(key);
				if (members.length === 1) { if (!t || key.toLowerCase().includes(t) || matches(members[0], t)) renderRow(members[0]); return; }

				const uids = new Set(members.map(e => CW.uid(e)));
				const parentOf = (e) => { const p = group.parentUid(e); return p && uids.has(p) ? p : null; };
				const children = new Map();
				members.forEach(e => { const p = parentOf(e); if (p) { if (!children.has(p)) children.set(p, []); children.get(p).push(e); } });
				const tops = members.filter(e => !parentOf(e))
					.sort((a, b) => (group.isBase(b) - group.isBase(a)) || SortUtil.ascSortLower(group.label(a), group.label(b)) || SortUtil.ascSortLower(a.source, b.source));

				const isGroupHit = !!t && key.toLowerCase().includes(t);
				const isHit = (e) => !t || isGroupHit || matches(e, t);
				const visTops = tops.filter(e => isHit(e) || (children.get(CW.uid(e)) || []).some(isHit));
				if (!visTops.length) return;

				const renderTop = (e, {depth, label}) => {
					const uid = CW.uid(e);
					const kids = (children.get(uid) || []).sort((a, b) => SortUtil.ascSortLower(group.label(a), group.label(b)));
					const isKidHit = !!t && !isGroupHit && kids.some(k => matches(k, t));
					const isVersionsOpen = openState.parents.has(uid) || isKidHit;
					renderRow(e, {label, depth, cntVersions: kids.length, isVersionsOpen, onToggleVersions: () => toggle(openState.parents, uid)});
					if (isVersionsOpen) kids.filter(k => !isKidHit || matches(k, t)).forEach(k => renderRow(k, {label: group.label(k), depth: depth + 1}));
				};

				// one race plus its versions: no header, just the row and its "▸ N" toggle
				if (tops.length === 1) return renderTop(tops[0], {depth: 0, label: tops[0].name});

				const isOpen = !!t || openState.groups.has(key);
				const hasSel = members.some(e => CW.uid(e) === selUid);
				ee`<div class="cb__pick-group ${hasSel ? "cb__pick-group--has-sel" : ""}" title="${isOpen ? "Collapse" : "Expand"} ${key.qq()}"><span>${isOpen ? "▾" : "▸"} ${key}</span><span class="cb__pick-count">${tops.length}</span></div>`
					.onn("click", () => toggle(openState.groups, key))
					.appendTo(listWrp);
				if (!isOpen) return;

				visTops.forEach(e => renderTop(e, {depth: 1, label: group.label(e)}));
			});
		};

		const renderList = (term) => {
			listWrp.empty();
			const t = (term || "").toLowerCase().trim();
			if (group) return renderGrouped(t);
			entities
				.filter(e => !t || matches(e, t))
				.forEach(ent => renderRow(ent));
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
			const chip = ee`<label class="cb__chip ${lock ? "cb__chip--locked" : ""}" style="cursor:${lock ? "not-allowed" : "pointer"}" title="${(lock || (getTitle ? getTitle(item) : "")).qq()}">${getLabel(item)}${lock ? " ✓" : ""} <input type="checkbox" ${isChosen ? "checked" : ""}></label>`;
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
		const st = this._state;
		this._renderChooser(el, {
			subtitle: `Choose your character's ${this._raceWord().toLowerCase()}. Ability bonuses, speed, size, and traits come from here.`,
			fnHeaderExtra: (wrp) => {
				const cb = ee`<input type="checkbox" ${st.hideLegacy ? "checked" : ""}>`.onn("change", () => { st.hideLegacy = cb.checked; this._save(); this.render(); });
				ee(wrp)`<label class="ve-small ve-flex-v-center ve-mb-1" style="gap:6px;font-weight:normal" title="Hides options superseded by a later 2014-era printing, e.g. Volo's and Mordenkainen's races reprinted in Monsters of the Multiverse. Applies to every list in the builder (same as Sources → Hide legacy).">${cb} Hide older printings (reprinted in a later 2014 book)</label>`;
			},
			group: {
				id: "race",
				// "Dragonborn (Gem)|FTD" is a top-level race, not a subrace; strip the parenthetical so it groups with the other dragonborn
				key: (e) => (e._baseName || (e._versionBase_isVersion && e._versionBase_name) || e.name).replace(/\s*\(.*\)\s*$/, ""),
				// 5etools generates "versions" with a choice baked in (Dragonborn (Black), Half-Elf variant feature picks); fold them under their base
				parentUid: (e) => e._versionBase_isVersion && e._versionBase_name ? `${e._versionBase_name}|${e._versionBase_source || e.source}` : null,
				label: (e) => {
					if (e._isBaseRace) return "Base race";
					if (e._versionBase_isVersion) return ((e.name.match(/\(([^)]*)\)\s*$/) || [])[1] ?? e.name).split(";").pop().trim();
					return e._subraceName || ((e.name.match(/\(([^)]*)\)\s*$/) || [])[1] ?? e.name);
				},
				isBase: (e) => !!e._isBaseRace,
			},
			entities: this._state.filterVisible(this._data.races),
			getSel: () => this._state.raceUid,
			setSel: (uid) => { this._state.raceUid = uid; this._state.raceAbilOption = 0; this._state.raceAbilChoices = []; this._state.raceAbilWeighted = []; this._state.raceResistChoice = null; this._state.sizeChoice = null; this._state.raceFeat = {featUid: null, featAbilChoose: []}; this._state.raceSpellChoices = {}; this._state.raceSpellAbility = null; this._state.raceSpellGroup = 0; this._state.clearProfChoicesForSource("race"); },
			renderDetail: (col, ent) => {
				let html;
				try { html = Renderer.race.getCompactRenderedString(ent); } catch (e) { html = renderEntries(ent.entries); }
				const tbl = ee`<table class="w-100 stats">${html}</table>`.appendTo(col);
				// wire up the height/weight roll buttons (handlers aren't bound by the render itself)
				try { Renderer.race.bindListenersHeightAndWeight(ent, tbl); } catch (e) { /* no height/weight table */ }
			},
		});
	}

	/* ----- Step: Class (multiclass-aware) ----- */
	_renderStepClass (el) {
		const st = this._state;
		const wrp = ee`<div></div>`.appendTo(el);
		const chosen = st.classList();

		// changing an existing class (keeps the level) -> dedicated chooser
		if (this._changeClassIx != null && st.classes[this._changeClassIx]?.uid) { this._renderChangeClass(wrp, this._changeClassIx); return; }
		this._changeClassIx = null;

		// no class yet -> full chooser for the first (primary) class
		if (!chosen.length) {
			this._renderChooser(wrp, {
				subtitle: "Choose your class. Hit dice, saving throws, proficiencies, features, and (if any) spellcasting come from your first class.",
				entities: this._state.filterVisible(this._data.classData.classes),
				getSel: () => st.classes[0]?.uid || null,
				setSel: (uid) => this._setPrimaryClass(uid),
				renderDetail: (col, cls) => this._renderClassDetail(col, cls, {level: st.classes[0]?.level || 1, subclassUid: null}),
				onAfterSelect: () => this.render(),
			});
			return;
		}

		ee(wrp)`<h4 class="ve-mt-0">Classes <span class="ve-muted ve-small">— total level ${st.totalLevel}, proficiency +${st.profBonus}</span></h4>`;
		if (st.totalLevel > 20) ee(wrp)`<div class="cb__err ve-small ve-mb-2"><span class="glyphicon glyphicon-warning-sign"></span> Total level ${st.totalLevel} exceeds the maximum of 20.</div>`;
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
		const wasPrimary = ix === 0;
		st.classes.splice(ix, 1);
		if (!st.classes.length) st.classes = [{uid: null, level: 1, subclassUid: null}];
		if (uid) { delete st.spellChoices[uid]; Object.keys(st.asiChoices).forEach(k => { if (k.startsWith(`${uid}@`)) delete st.asiChoices[k]; }); st.clearProfChoicesForSource(uid); }
		// the primary class drives saves/skills/expertise (kept under "class") — reset those when it changes
		if (wasPrimary) { st.classSkillChoices = []; st.expertiseChoices = []; st.clearProfChoicesForSource("class"); }
		this._changeClassIx = null;
		this._save(); this.render();
	}

	// swap class at `ix` to a new class, keeping the level (subclass + that class's choices reset)
	_changeClass (ix, uid) {
		const st = this._state;
		const old = st.classes[ix]?.uid;
		this._changeClassIx = null;
		if (!uid || old === uid) return; // unchanged — onAfterSelect re-renders
		const level = st.classes[ix]?.level || 1;
		st.classes[ix] = {uid, level, subclassUid: null};
		if (old) { delete st.spellChoices[old]; Object.keys(st.asiChoices).forEach(k => { if (k.startsWith(`${old}@`)) delete st.asiChoices[k]; }); st.clearProfChoicesForSource(old); }
		if (ix === 0) { st.classSkillChoices = []; st.expertiseChoices = []; st.clearProfChoicesForSource("class"); }
		this._save();
	}

	_renderChangeClass (wrp, ix) {
		const st = this._state;
		const row = st.classes[ix]; const curUid = row.uid;
		const taken = new Set(st.classes.map(c => c.uid).filter(Boolean));
		let entities = this._state.filterVisible(this._data.classData.classes).filter(cls => CW.uid(cls) === curUid || !taken.has(CW.uid(cls)));
		if (ix > 0) entities = entities.filter(cls => CW.uid(cls) === curUid || st.canMulticlassInto(cls)); // primary has no MC requirement
		const cancel = ee`<button class="ve-btn ve-btn-default ve-btn-sm">‹ Cancel</button>`.onn("click", () => { this._changeClassIx = null; this.render(); });
		ee(wrp)`<div class="ve-flex-v-center ve-mb-2" style="gap:10px"><h4 class="ve-mt-0 ve-mb-0">Change ${ix === 0 ? "class" : "this class"}</h4>${cancel}</div>`;
		this._renderChooser(wrp, {
			subtitle: `Pick a replacement class — your level (${row.level}) is kept; subclass and this class's spell/proficiency choices reset.${ix > 0 ? " Only classes you meet the multiclass ability-score requirements for are shown." : ""}`,
			entities,
			getSel: () => curUid,
			setSel: (uid) => this._changeClass(ix, uid),
			renderDetail: (col, cls) => this._renderClassDetail(col, cls, {level: row.level, subclassUid: null, mc: ix > 0}),
			onAfterSelect: () => this.render(),
		});
	}

	// one row in the class list: name, level, subclass, remove, collapsible detail
	_renderClassRow (wrp, row, ix) {
		const st = this._state;
		const cls = this._data.classData.classes.find(c => CW.uid(c) === row.uid);
		if (!cls) return;
		const card = ee`<div class="cb__class-row" style="border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:10px;margin-bottom:10px"></div>`.appendTo(wrp);
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

		ee(head)`<div class="ve-btn-group" style="margin-left:auto">
			${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Change this class (keeps the level)"><span class="glyphicon glyphicon-refresh"></span> Change</button>`.onn("click", () => { this._changeClassIx = ix; this.render(); })}
			${ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="${st.classes.length > 1 ? "Remove this class" : "Remove class — returns to class selection"}"><span class="glyphicon glyphicon-remove"></span></button>`.onn("click", () => this._removeClass(ix))}
		</div>`;

		// multiclass ability-score requirement (secondary classes only)
		if (ix > 0) {
			const req = st.multiclassRequirement(cls);
			if (req.reqText) ee(card)`<div class="ve-small ve-mt-1 ${req.ok ? "ve-muted" : "cb__err"}">Multiclass requirement: ${req.reqText.qq()}${req.ok ? " ✓" : ` — not met`}</div>`;
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
		const available = this._data.classData.classes.filter(cls => !taken.has(CW.uid(cls)) && st.isVisible(cls));
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
		this._renderFeaturesFull(col, cls.classFeatures || [], level, {subclassFeatures: subEnt?.subclassFeatures});

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
	/** @param [opts.subclassFeatures] the chosen subclass's features: class features that grant one ("Path Feature") then name and include it */
	_renderFeaturesFull (col, featuresByLevel, curLevel, {subclassFeatures = null} = {}) {
		const flatten = (byLevel) => {
			const out = [];
			(byLevel || []).forEach((lvArr, ix) => {
				(lvArr || []).forEach(f => { if (f?.name && !f.isClassFeatureVariant) out.push({...f, _lvl: f.level || (ix + 1)}); });
			});
			return out.sort((a, b) => a._lvl - b._lvl);
		};
		const all = flatten(featuresByLevel);
		const subAll = subclassFeatures ? flatten(subclassFeatures) : [];
		const maxLv = all.length ? Math.max(...all.map(f => f._lvl)) : 20;
		const renderInto = (target, f) => {
			const granted = f.gainSubclassFeature ? subAll.filter(sf => sf._lvl === f._lvl) : [];
			const grantedNames = granted.length ? ` <span class="ve-muted">→ ${granted.map(sf => sf.name.qq()).join(", ")}</span>` : "";
			const grantedBody = granted.map(sf => `<div class="ve-mt-1"><b>${sf.name.qq()}</b>${renderEntries(sf.entries)}</div>`).join("");
			ee`<details style="margin:2px 0"><summary><b>L${f._lvl}:</b> ${f.name.qq()}${grantedNames}</summary><div class="ve-pl-3 ve-small ve-mt-1">${renderEntries(f.entries)}${grantedBody}</div></details>`.appendTo(target);
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
		let html = `<table class="w-100 ve-small cb__class-tbl"><thead><tr><th>Level</th><th>Prof</th><th>Features</th>${cols.map(c => `<th>${renderInline(c.lbl)}</th>`).join("")}</tr></thead><tbody>`;
		for (let lv = 1; lv <= 20; ++lv) {
			const feats = (cls.classFeatures[lv - 1] || []).filter(f => f?.name && !f.isClassFeatureVariant).map(f => f.name.qq()).join(", ") || "—";
			html += `<tr><td>${Parser.getOrdinalForm(lv)}</td><td>${CW.fmtMod(CW.profBonus(lv))}</td><td class="cb__class-tbl-feat">${feats}</td>`;
			cols.forEach(c => { html += `<td>${cell(c.rows?.[lv - 1]?.[c.ci])}</td>`; });
			html += `</tr>`;
		}
		return `${html}</tbody></table>`;
	}

	/* ----- Step: Background ----- */
	_renderStepBackground (el) {
		const entities = this._state.filterVisible(this._data.backgrounds);
		const names = new Set(entities.map(e => e.name));
		// Backgrounds carry no base/variant fields; group on the naming conventions instead:
		// "Variant Criminal (Spy)" → Criminal, "Baldur's Gate Criminal" → Criminal, "Revelry Pirate (Sailor)" → Sailor.
		const bgGroup = (e) => {
			let m = /^Variant (.+?) \((.+)\)$/.exec(e.name);
			if (m) return {key: m[1], label: `Variant: ${m[2]}`};
			m = /^Baldur's Gate (.+)$/.exec(e.name);
			if (m) return {key: m[1], label: "Baldur's Gate"};
			m = /^(.+?) \((.+)\)$/.exec(e.name);
			if (m && names.has(m[2])) return {key: m[2], label: m[1]};
			return {key: e.name, label: e.name, isBase: true};
		};
		this._renderChooser(el, {
			subtitle: "Choose a background. It grants skill proficiencies, languages/tools, and starting equipment.",
			group: {
				id: "background",
				key: (e) => bgGroup(e).key,
				label: (e) => bgGroup(e).label,
				parentUid: () => null,
				isBase: (e) => !!bgGroup(e).isBase,
			},
			entities,
			getSel: () => this._state.backgroundUid,
			setSel: (uid) => { this._state.backgroundUid = uid; this._state.bgAbilOption = 0; this._state.bgAbilChoices = []; this._state.bgAbilWeighted = []; this._state.bgFeat = {featUid: null, featAbilChoose: []}; this._state.clearProfChoicesForSource("bg"); },
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

		// 2b) racial feat (Variant Human, Custom Lineage, …)
		this._renderRaceFeat(wrp);

		// 2c) background ability bonuses + feat (2024 / Eberron / FRHoF backgrounds)
		if (st.bgAbilityOptions().length || st.backgroundFixedFeats().length || st.backgroundFeatChoice()) {
			ee(wrp)`<hr class="hr-2 ve-mt-3">`;
			this._renderBackgroundAbility(wrp);
		}

		// 3) ASIs & feats (merged here so the totals above reflect them)
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4 class="ve-mt-0">Ability Score Improvements &amp; Feats</h4>`;
		if (st.asiSlots().length) this._renderStepAsi(wrp);
		else ee(wrp)`<div class="ve-muted ve-small">${st.classUid ? `No Ability Score Improvements available yet (each class's first is usually at its level 4).` : "Choose a class first."}</div>`;
	}

	/* ----- Racial feat (level-1 feat from Variant Human / Custom Lineage) ----- */
	_renderRaceFeat (wrp) {
		const st = this._state;
		if (!st.raceFeatCount()) return;
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4 class="ve-mt-0">Racial Feat <span class="ve-muted ve-small">(${st.raceEnt?.name?.qq() || ""})</span></h4>`;
		const rf = st.raceFeat;
		const feats = this._state.filterVisible(this._data.feats).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:340px"><option value="">— choose a feat —</option></select>`;
		let hidden = 0;
		feats.forEach(f => {
			const uid = CW.uid(f);
			const takenElsewhere = st.featsTaken().some(t => t.featUid === uid && t.key !== "race");
			if (!st.meetsFeatPrereq(f) && rf.featUid !== uid) { hidden++; return; }
			ee`<option value="${uid.qq()}" ${takenElsewhere ? "disabled" : ""}>${f.name} (${f.source})${takenElsewhere ? " — taken" : ""}</option>`.appendTo(sel);
		});
		sel.val(rf.featUid || "");
		sel.onn("change", () => { rf.featUid = sel.val() || null; this._resetFeatChoiceArrays(rf); this._save(); this.render(); });
		ee(wrp)`<label class="ve-flex-v-center" style="gap:6px">Feat ${sel}</label>${hidden ? `<span class="ve-muted ve-small ve-ml-2">(${hidden} hidden — prerequisites not met)</span>` : ""}`;
		if (!rf.featUid) return;
		const feat = this._data.feats.find(f => CW.uid(f) === rf.featUid);
		if (!feat) return;
		if (feat.prerequisite) { let pre = ""; try { pre = Renderer.utils.prerequisite.getHtml(feat.prerequisite) || ""; } catch (e) { pre = ""; } if (pre) ee(wrp)`<div class="ve-small ve-muted ve-mt-1">Prerequisite: ${pre}</div>`; }
		this._renderFeatChoices(wrp, feat, rf);
	}

	/* ----- Racial ability bonuses (fixed / choose / weighted; multi-option) ----- */
	_renderRacialAbility (wrp) {
		const st = this._state;
		const opts = st.raceAbilityOptions();
		if (!opts.length) {
			if (st.raceUid) ee(wrp)`<div class="ve-mb-2 ve-muted ve-small">This ${this._raceWord().toLowerCase()} grants no ability score increases${this._data.styleHint === "one" ? " — under 2024 rules, ability bonuses come from your background." : "."}</div>`;
			return;
		}
		this._renderAbilityBonusChooser(wrp, {title: "Racial Ability Bonuses", entName: st.raceEnt.name, options: opts, optKey: "raceAbilOption", choicesKey: "raceAbilChoices", weightedKey: "raceAbilWeighted"});
	}

	// generic ability-bonus chooser used by race + background (fixed / weighted / simple-choose, multi-option)
	_renderAbilityBonusChooser (wrp, {title, entName, options, optKey, choicesKey, weightedKey}) {
		const st = this._state;
		if (!options.length) return;
		const box = ee`<div class="ve-mb-3"></div>`.appendTo(wrp);
		ee(box)`<div class="ve-mb-1"><b>${title}</b> <span class="ve-muted ve-small">(${`${entName}`.qq()})</span></div>`;
		if (options.length > 1) {
			ee(box)`<div class="ve-muted ve-small ve-mb-1">Choose one option:</div>`;
			const optRow = ee`<div class="ve-btn-group ve-mb-2"></div>`.appendTo(box);
			options.forEach((opt, i) => {
				const active = (st[optKey] || 0) === i;
				ee`<button class="ve-btn ve-btn-xs ${active ? "ve-btn-primary" : "ve-btn-default"}">${String.fromCharCode(97 + i)}) ${this._abilOptionLabel(opt).qq()}</button>`
					.onn("click", () => { st[optKey] = i; st[choicesKey] = []; st[weightedKey] = []; this._save(); this.render(); })
					.appendTo(optRow);
			});
		}
		const ab = options[Math.min(st[optKey] || 0, options.length - 1)] || null;
		if (!ab) return;
		const fixed = Object.entries(ab).filter(([k, v]) => CW.ABILITIES.includes(k) && typeof v === "number");
		if (fixed.length) ee(box)`<div class="ve-mb-1"><b>Fixed:</b> ${fixed.map(([k, v]) => `${CW.fmtMod(v)} ${CW.ABIL_FULL[k]}`).join(", ")}</div>`;
		const ch = ab.choose;
		if (ch?.weighted) this._renderAbilityWeighted(box, ch.weighted, weightedKey);
		else if (ch) {
			const from = ch.from || CW.ABILITIES; const count = ch.count || 1; const amount = ch.amount || 1;
			const counter = ee`<span class="ve-muted">${st[choicesKey].length}/${count}</span>`;
			ee(box)`<div class="ve-mb-1">Choose ${count} different (+${amount} each) (${counter}):</div>`;
			this._renderChipPicker(box, {items: from, getValue: a => a, getLabel: a => CW.ABIL_FULL[a] || a, arr: st[choicesKey], max: count, counterEle: counter});
		}
	}

	_abilOptionLabel (opt) {
		if (opt.choose?.weighted) return (opt.choose.weighted.weights || []).map(w => `+${w}`).join(" / ");
		if (opt.choose) return `choose ${opt.choose.count || 1} (+${opt.choose.amount || 1})`;
		const fixed = Object.entries(opt).filter(([k]) => CW.ABILITIES.includes(k)).map(([k, v]) => `${CW.fmtMod(v)} ${k.toUpperCase()}`);
		return fixed.join(", ") || "—";
	}

	_renderAbilityWeighted (box, weighted, weightedKey) {
		const st = this._state;
		const weights = weighted.weights || [];
		let from = (weighted.from || CW.ABILITIES).filter(a => CW.ABILITIES.includes(a));
		if (!from.length) from = CW.ABILITIES;
		st[weightedKey] = st[weightedKey] || [];
		st[weightedKey].length = weights.length;
		ee(box)`<div class="ve-muted ve-small ve-mb-1">Assign each bonus to a different ability:</div>`;
		const row = ee`<div class="ve-flex-v-center" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(box);
		weights.forEach((w, i) => {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— ability —</option></select>`;
			from.forEach(abv => {
				const usedElsewhere = st[weightedKey].some((a, j) => j !== i && a === abv);
				ee`<option value="${abv}" ${usedElsewhere ? "disabled" : ""}>${CW.ABIL_FULL[abv]}</option>`.appendTo(sel);
			});
			sel.val(st[weightedKey][i] || "");
			sel.onn("change", () => { st[weightedKey][i] = sel.val(); this._save(); this.render(); });
			ee(row)`<label class="ve-flex-v-center" style="gap:4px"><b>+${w} to</b> ${sel}</label>`;
		});
	}

	// Background ability bonuses (2024 / Eberron / FRHoF backgrounds) + a background feat picker
	_renderBackgroundAbility (wrp) {
		const st = this._state;
		const opts = st.bgAbilityOptions();
		if (opts.length) this._renderAbilityBonusChooser(wrp, {title: "Background Ability Bonuses", entName: st.backgroundEnt.name, options: opts, optKey: "bgAbilOption", choicesKey: "bgAbilChoices", weightedKey: "bgAbilWeighted"});
		this._renderBackgroundFeat(wrp);
	}

	_renderBackgroundFeat (wrp) {
		const st = this._state;
		const fixed = st.backgroundFixedFeats();
		const choice = st.backgroundFeatChoice();
		if (!fixed.length && !choice) return;
		ee(wrp)`<div class="ve-mb-1 ve-mt-2"><b>Background Feat</b> <span class="ve-muted ve-small">(${st.backgroundEnt.name.qq()})</span></div>`;
		fixed.forEach(f => {
			ee`<details class="ve-mt-1"><summary><b>${f.name.qq()}</b> <span class="ve-muted ve-small">(granted)</span></summary><div class="ve-pl-3 ve-small">${renderEntries(f.entries)}</div></details>`.appendTo(wrp);
		});
		if (choice && choice.category) {
			// a category we can't populate from the feat list (e.g. Dark Gifts) — point to the background instead
			ee(wrp)`<div class="ve-muted ve-small ve-mt-1">Also choose ${choice.count} option from this background (see its feature text above).</div>`;
		} else if (choice) {
			const rf = st.bgFeat;
			const feats = this._state.filterVisible(this._data.feats).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
			const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:340px"><option value="">— choose a feat —</option></select>`;
			let hidden = 0;
			feats.forEach(f => {
				const uid = CW.uid(f);
				const takenElsewhere = st.featsTaken().some(t => t.featUid === uid && t.key !== "bg");
				if (!st.meetsFeatPrereq(f) && rf.featUid !== uid) { hidden++; return; }
				ee`<option value="${uid.qq()}" ${takenElsewhere ? "disabled" : ""}>${f.name} (${f.source})${takenElsewhere ? " — taken" : ""}</option>`.appendTo(sel);
			});
			sel.val(rf.featUid || "");
			sel.onn("change", () => { rf.featUid = sel.val() || null; this._resetFeatChoiceArrays(rf); this._save(); this.render(); });
			ee(wrp)`<label class="ve-flex-v-center ve-mt-1" style="gap:6px">Feat ${sel}</label>${hidden ? `<span class="ve-muted ve-small ve-ml-2">(${hidden} hidden — prerequisites not met)</span>` : ""}`;
			const feat = rf.featUid ? this._data.feats.find(f => CW.uid(f) === rf.featUid) : null;
			if (feat) this._renderFeatChoices(wrp, feat, rf);
		}
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
		const bg = st.backgroundBonuses()[abv];
		const asi = st.asiBonuses()[abv];
		const clsf = st.classFeatureAbilityBonuses()[abv];
		const total = base == null ? null : st.finalAbility(abv);
		const mod = total == null ? null : CW.mod(total);
		const itemBonus = st._itemAbilityBonus(abv);
		const computed = (base || 0) + racial + bg + asi + clsf + itemBonus;
		const itemSet = st._itemAbilitySet(abv);
		const parts = [];
		if (base != null) parts.push(`base ${base}`);
		if (racial) parts.push(`${CW.fmtMod(racial)} race`);
		if (bg) parts.push(`${CW.fmtMod(bg)} background`);
		if (asi) parts.push(`${CW.fmtMod(asi)} ASI`);
		if (clsf) parts.push(`${CW.fmtMod(clsf)} class`);
		if (itemBonus) parts.push(`${CW.fmtMod(itemBonus)} item`);
		if (base != null && itemSet != null && itemSet > computed) parts.push(`set ${itemSet} (item)`);
		return ee`<div class="cb__abil">
			<div class="cb__abil-name">${abv}</div>
			${inner}
			<div class="cb__abil-score">${total == null ? "—" : total}</div>
			<div class="cb__abil-mod">${mod == null ? "" : CW.fmtMod(mod)}</div>
			<div class="cb__abil-sub">${base == null ? "" : parts.join(" ")}</div>
		</div>`;
	}

	_renderPointBuy (wrp) {
		const st = this._state;
		const info = ee`<div class="ve-mb-2"></div>`.appendTo(wrp);
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(wrp);
		const update = () => { const spent = st.pointBuySpent(); info.html(`<b>Points:</b> ${spent} / ${CW.POINT_BUY_BUDGET} spent &nbsp; <span class="ve-muted">(scores 8–15)</span>${spent > CW.POINT_BUY_BUDGET ? ` <span class="cb__err">over budget!</span>` : ""}`); };
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
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(wrp);
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
		const grid = ee`<div class="cb__abil-grid"></div>`.appendTo(wrp);
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
		const feats = this._state.filterVisible(this._data.feats).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
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
		if (over.length) ee(body)`<div class="cb__err ve-small">Note: ${over.map(a => a.toUpperCase()).join(", ")} now exceeds 20 (ASIs normally cap at 20).</div>`;
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
		sel.onn("change", () => { ch.featUid = sel.val() || null; this._resetFeatChoiceArrays(ch); this._save(); this.render(); });
		ee(body)`<label class="ve-flex-v-center" style="gap:6px">Feat ${sel}</label>${hiddenForPrereq ? `<span class="ve-muted ve-small ve-ml-2">(${hiddenForPrereq} hidden — prerequisites not met)</span>` : ""}`;
		if (!ch.featUid) return;
		const feat = this._data.feats.find(f => CW.uid(f) === ch.featUid);
		if (!feat) return;
		if (feat.prerequisite) {
			let preHtml = ""; try { preHtml = Renderer.utils.prerequisite.getHtml(feat.prerequisite) || ""; } catch (e) { preHtml = ""; }
			if (preHtml) ee(body)`<div class="ve-small ve-muted ve-mt-1">Prerequisite: ${preHtml}</div>`;
		}
		this._renderFeatChoices(body, feat, ch);
	}

	_resetFeatChoiceArrays (o) { ["featAbilChoose", "featSkillChoose", "featToolChoose", "featLangChoose", "featSaveChoose", "featWeaponChoose", "featExpertiseChoose"].forEach(k => { o[k] = []; }); o.featSpellGroup = 0; o.featSpellChoose = {}; }

	// shared picker for a feat's choices (ability / save / skill / tool / language / weapon / expertise) + its description
	_renderFeatChoices (wrp, feat, choice) {
		const st = this._state;
		const chip = (arr, cnt, items, getValue, getLabel, label) => {
			const counter = ee`<span class="ve-muted">${arr.length}/${cnt}</span>`;
			ee(wrp)`<div class="ve-mt-1 ve-small">${label} (${counter}):</div>`;
			this._renderChipPicker(wrp, {items, getValue, getLabel, arr, max: cnt, counterEle: counter, gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:170px;overflow:auto"});
		};
		(feat.ability || []).forEach(ab => {
			if (!ab.choose) { const fixed = Object.entries(ab).filter(([k]) => CW.ABILITIES.includes(k)).map(([k, v]) => `${CW.fmtMod(v)} ${k.toUpperCase()}`); if (fixed.length) ee(wrp)`<div class="ve-small ve-mt-1"><b>Grants:</b> ${fixed.join(", ")}</div>`; return; }
			choice.featAbilChoose = choice.featAbilChoose || [];
			chip(choice.featAbilChoose, ab.choose.count || 1, ab.choose.from, a => a, a => CW.ABIL_FULL[a], `<b>+${ab.choose.amount || 1}</b> to`);
		});
		(feat.savingThrowProficiencies || []).forEach(g => { if (!g.choose) return; choice.featSaveChoose = choice.featSaveChoose || []; chip(choice.featSaveChoose, g.choose.count || 1, g.choose.from, a => a, a => CW.ABIL_FULL[a], "<b>Save proficiency</b> — choose"); });
		(feat.skillProficiencies || []).forEach(g => { if (!g.choose) return; choice.featSkillChoose = choice.featSkillChoose || []; chip(choice.featSkillChoose, g.choose.count || 1, g.choose.from, s => s, s => CW.skillName(s), "<b>Skill proficiency</b> — choose"); });
		(feat.toolProficiencies || []).forEach(g => { if (typeof g !== "object") return; choice.featToolChoose = choice.featToolChoose || []; let n = 0; let opts = null; if (g.choose?.from) { n = g.choose.count || 1; opts = g.choose.from.map(t => `${t}`); } else if (g.anyArtisansTool) { n = g.anyArtisansTool; opts = st._toolOptions("AT"); } else if (g.anyMusicalInstrument) { n = g.anyMusicalInstrument; opts = st._toolOptions("INS"); } else if (g.any || g.anyTool) { n = g.any || g.anyTool; opts = st._toolOptions("ANY"); } if (n) chip(choice.featToolChoose, n, opts, t => t, t => `${t}`.toTitleCase(), "<b>Tool proficiency</b> — choose"); });
		(feat.languageProficiencies || []).forEach(g => { if (typeof g !== "object") return; choice.featLangChoose = choice.featLangChoose || []; const LALL = Parser.LANGUAGES_ALL || []; let n = 0; let opts = null; if (g.any || g.anyStandard) { n = g.any || g.anyStandard; opts = LALL; } else if (g.choose?.from) { n = g.choose.count || 1; opts = g.choose.from.map(l => `${l}`.toTitleCase()); } if (n) chip(choice.featLangChoose, n, opts, l => l, l => `${l}`.toTitleCase(), "<b>Language</b> — choose"); });
		(feat.weaponProficiencies || []).forEach(g => { if (!g.choose) return; choice.featWeaponChoose = choice.featWeaponChoose || []; const cat = /martial/.test(g.choose.fromFilter || "") ? "martial" : (/simple/.test(g.choose.fromFilter || "") ? "simple" : null); const opts = g.choose.from ? g.choose.from.map(w => `${w}`.split("|")[0]) : st.weaponOptions({category: cat}); chip(choice.featWeaponChoose, g.choose.count || 1, opts, w => w, w => `${w}`.toTitleCase(), "<b>Weapon proficiency</b> — choose"); });
		(feat.expertise || []).forEach(g => { const n = g.anyProficientSkill || g.choose?.count || 0; if (!n) return; choice.featExpertiseChoose = choice.featExpertiseChoose || []; const prof = [...st.skillProfs()].filter(s => CW.skillAbil(s)).sort(); if (prof.length) chip(choice.featExpertiseChoose, n, prof, s => s, s => CW.skillName(s), "<b>Expertise</b> — choose a proficient skill"); else ee(wrp)`<div class="ve-muted ve-small">Expertise: choose your skill proficiencies first.</div>`; });
		this._renderFeatSpells(wrp, feat, choice);
		ee`<div class="ve-mt-2 ve-small">${renderEntries(feat.entries)}</div>`.appendTo(wrp);
	}

	// feat-granted spells (Magic Initiate variant + cantrips/spell picks, Fey Touched, etc.)
	_renderFeatSpells (wrp, feat, choice) {
		const st = this._state;
		const info = st.featSpellsInfo(feat, choice); if (!info) return;
		const dc = st.featSpellSaveDc(info.ability);
		ee(wrp)`<div class="ve-mt-2 ve-small"><b>Spells</b>${info.ability ? ` <span class="ve-muted">(${CW.ABIL_FULL[info.ability] || info.ability}${dc != null ? `, save DC ${dc}` : ""})</span>` : ""}</div>`;
		if (info.groups.length > 1) {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"></select>`;
			info.groups.forEach((g, i) => ee`<option value="${i}">${st.racialSpellGroupLabel(g).qq()}</option>`.appendTo(sel));
			sel.val(`${info.groupIx}`);
			sel.onn("change", () => { choice.featSpellGroup = parseInt(sel.val(), 10) || 0; choice.featSpellChoose = {}; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-1 ve-small"><b>Choose a spell list:</b> ${sel}</div>`;
		}
		if (info.knownFixed.length) ee(wrp)`<div class="ve-small">Learns: ${info.knownFixed.map(sp => refLink(UrlUtil.PG_SPELLS, sp)).join(", ")}</div>`;
		if (info.innate.length) ee(wrp)`<div class="ve-small">Innate: ${info.innate.map(i => `${refLink(UrlUtil.PG_SPELLS, i.sp)} <span class="ve-muted ve-small">(${i.freq.qq()})</span>`).join(", ")}</div>`;
		choice.featSpellChoose = choice.featSpellChoose || {};
		info.knownChoose.forEach(g => {
			if (!choice.featSpellChoose[g.key]) choice.featSpellChoose[g.key] = [];
			const arr = choice.featSpellChoose[g.key];
			const seen = new Set();
			const opts = st.racialSpellOptions(g.filter).filter(sp => { if (seen.has(sp.name)) return false; seen.add(sp.name); return true; }).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
			const counter = ee`<span class="ve-muted ve-small">${arr.length}/${g.count}</span>`;
			ee(wrp)`<div class="ve-mt-1 ve-small"><b>Choose ${g.count} spell${g.count > 1 ? "s" : ""}</b>${g.freq ? ` <span class="ve-muted">(${g.freq.qq()})</span>` : ""} (${counter}):</div>`;
			this._renderChipPicker(wrp, {items: opts, getValue: sp => sp.name, getLabel: sp => `${sp.level ? `<span class="ve-muted ve-small">${sp.level}</span> ` : "✦ "}${refLink(UrlUtil.PG_SPELLS, sp)}`, arr, max: g.count, counterEle: counter, gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:170px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px"});
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

		// Fighting Style (Fighter/Paladin/Ranger/Bard)
		this._renderFightingStyle(wrp);

		// Racial damage-resistance choice (e.g. Dragonborn base)
		const resOpts = st.raceResistOptions();
		if (resOpts) {
			ee(wrp)`<h4 class="ve-mt-3">Damage Resistance <span class="ve-muted ve-small">(${st.raceEnt?.name?.qq() || "Race"})</span></h4>`;
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"><option value="">— choose a damage type —</option></select>`;
			resOpts.forEach(d => ee`<option value="${`${d}`.qq()}">${`${d}`.toTitleCase()}</option>`.appendTo(sel));
			sel.val(st.raceResistChoice || "");
			sel.onn("change", () => { st.raceResistChoice = sel.val() || null; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-2">Resistance to ${sel}</div>`;
		}

		// Size choice (Small or Medium)
		const sizeOpts = st.sizeOptions();
		if (sizeOpts) {
			ee(wrp)`<h4 class="ve-mt-3">Size</h4>`;
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"></select>`;
			sizeOpts.forEach(s => ee`<option value="${`${s}`.qq()}">${Parser.sizeAbvToFull(s).qq()}</option>`.appendTo(sel));
			sel.val(st.sizeAbv());
			sel.onn("change", () => { st.sizeChoice = sel.val() || null; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-2">${sel} <span class="ve-muted ve-small">(this ${this._raceWord().toLowerCase()} can be Small or Medium)</span></div>`;
		}

		// Defense / armor — you can only wear armor/shields you own (equip from the Inventory below)
		ee(wrp)`<h4>Defense (Armor Class)</h4>`;
		const invArmors = st.inventoryArmors();
		const invShields = st.inventoryShields();
		const acBonusTxt = (a) => { const b = st._bonusAcNum(a); return `${(a.ac || 0) + b}${b ? ` (+${b})` : ""}`; };
		const defWrp = ee`<div class="ve-flex-v-center ve-mb-1" style="gap:12px;flex-wrap:wrap"></div>`.appendTo(wrp);
		const armorSel = ee`<select class="ve-form-control ve-input-xs" style="max-width:280px"><option value="">No armor (unarmored)</option></select>`;
		invArmors.forEach(a => { ee`<option value="${CW.uid(a).qq()}">${a.name} — AC ${acBonusTxt(a)} (${`${a.type || ""}`.split("|")[0]})</option>`.appendTo(armorSel); });
		armorSel.val(st.armorEnt() ? st.armorUid : "");
		armorSel.onn("change", () => { st.armorUid = armorSel.val() || null; this._save(); this.render(); });
		if (!invArmors.length) armorSel.attr("disabled", "true");
		const shieldSel = ee`<select class="ve-form-control ve-input-xs" style="max-width:240px"><option value="">No shield</option></select>`;
		invShields.forEach(a => { ee`<option value="${CW.uid(a).qq()}">${a.name} — +${acBonusTxt(a)} AC</option>`.appendTo(shieldSel); });
		shieldSel.val(st.shieldEnt() ? st.shieldUid : "");
		shieldSel.onn("change", () => { st.shieldUid = shieldSel.val() || null; this._save(); this.render(); });
		if (!invShields.length) shieldSel.attr("disabled", "true");
		ee(defWrp)`<label class="ve-flex-v-center" style="gap:6px">Armor ${armorSel}</label><label class="ve-flex-v-center" style="gap:6px">Shield ${shieldSel}</label>`;
		ee(wrp)`<div class="ve-mb-1"><b>Armor Class: ${st.ac()}</b> <span class="ve-muted ve-small">— ${st.acBreakdown().how.qq()}</span></div>`;
		if (!invArmors.length && !invShields.length) ee(wrp)`<div class="ve-muted ve-small ve-mb-2">Add armor or a shield to your inventory below to equip it.</div>`;
		st.armorProficiencyWarnings().forEach(w => ee(wrp)`<div class="cb__err ve-small ve-mb-1"><span class="glyphicon glyphicon-warning-sign"></span> ${w.qq()}</div>`);
		[st.armorEnt(), st.shieldEnt()].filter(Boolean).forEach(it => { if (st.requiresAttunement(it) && !st.isAttuned(CW.uid(it))) ee(wrp)`<div class="ve-muted ve-small ve-mb-1"><span class="glyphicon glyphicon-flash"></span> ${it.name.qq()} requires attunement — its magic bonus isn't applied until you Attune it in the Inventory below.</div>`; });

		// Equipment choices (a)/(b)
		ee(wrp)`<h4>Starting Equipment <span class="ve-muted ve-small">(choose options, then add to inventory)</span></h4>`;
		const eqWrp = ee`<div></div>`.appendTo(wrp);
		this._renderEquipment(eqWrp);

		// Inventory
		this._renderInventory(wrp);
	}

	/* ----- Inventory ----- */
	// PC inventory — builds the holder config and defers to the shared renderer
	_renderInventory (wrp) {
		const st = this._state;
		this._renderInventoryShared(wrp, {
			title: "Inventory",
			attuneMax: () => st.attuneMax(), attunedCount: () => st.attunedCount(), isAttuned: (u) => st.isAttuned(u), setAttuned: (u, o) => st.setAttuned(u, o), canAttuneMore: () => st.canAttuneMore(),
			inv: () => st.inventory, add: (o) => st.addToInventory(o), remove: (ix) => st.removeFromInventory(ix),
			getArmorUid: () => st.armorUid, setArmorUid: (v) => { st.armorUid = v; },
			getShieldUid: () => st.shieldUid, setShieldUid: (v) => { st.shieldUid = v; },
			clear: () => { st.inventory = []; st.armorUid = null; st.shieldUid = null; st.attunedUids = []; }, startingEquip: () => st.addStartingEquipmentToInventory(),
		});
	}

	// shared inventory section (PC + sidekick) — H is a holder config abstracting the storage & attunement
	_renderInventoryShared (wrp, H) {
		const st = this._state;
		const attuneMax = H.attuneMax(); const atCap = H.attunedCount() >= attuneMax;
		ee(wrp)`<h4 class="ve-mt-3">${(H.title || "Inventory").qq()} <span class="ve-muted ve-small">— Attunement ${H.attunedCount()}/${attuneMax}${atCap ? " (full)" : ""}</span></h4>`;
		const ctrl = ee`<div class="ve-flex-v-center ve-mb-2" style="gap:8px;flex-wrap:wrap"></div>`.appendTo(wrp);
		if (H.startingEquip) ee(ctrl)`${ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Resolve your chosen class + background starting gear into items">＋ Add starting equipment</button>`.onn("click", () => { H.startingEquip(); this._save(); this.render(); })}`;
		ee(ctrl)`${ee`<button class="ve-btn ve-btn-danger ve-btn-xs">Clear</button>`.onn("click", () => { H.clear(); this._save(); this.render(); })}`;

		// search-add (results flow inline below the input)
		const searchWrp = ee`<div style="max-width:320px"></div>`.appendTo(wrp);
		const search = ee`<input class="ve-form-control ve-input-xs" placeholder="Search items to add…">`.appendTo(searchWrp);
		const results = ee`<div class="cb__pick-list" style="max-height:200px;display:none"></div>`.appendTo(searchWrp);
		const listWrp = ee`<div class="ve-mt-2"></div>`.appendTo(wrp);
		const renderList = () => this._renderInvList(listWrp, H);
		search.onn("input", () => {
			const t = search.val().toLowerCase().trim();
			results.empty();
			if (t.length < 2) { results.style.display = "none"; return; }
			const rank = (n) => n === t ? 0 : n.startsWith(t) ? 1 : 2; // exact, then prefix, then contains
			const matches = (this._data.items || [])
				.filter(it => it.name.toLowerCase().includes(t) && st.isVisible(it) && !st._isGenericVariantTemplate(it)) // hide "pick a base" templates; their concrete variants remain
				.sort((a, b) => (rank(a.name.toLowerCase()) - rank(b.name.toLowerCase())) || SortUtil.ascSortLower(a.name, b.name))
				.slice(0, 25);
			results.style.display = matches.length ? "block" : "none";
			matches.forEach(it => {
				ee`<div class="cb__pick"><span>${it.name}</span><span class="cb__pick-src">${it.source}</span></div>`
					.onn("click", () => { H.add({uid: CW.uid(it), name: it.name, qty: 1}); this._save(); search.val(""); results.empty(); results.style.display = "none"; renderList(); })
					.appendTo(results);
			});
		});

		renderList();
	}

	_renderInvList (listWrp, H) {
		const st = this._state;
		listWrp.empty();
		const inv = H.inv();
		if (!inv.length) { ee(listWrp)`<p class="ve-muted ve-small">No items yet — ${H.startingEquip ? "add your starting equipment or " : ""}search above.</p>`; return; }
		const tbl = ee`<table class="w-100"><tbody></tbody></table>`.appendTo(listWrp);
		const tb = tbl.querySelector("tbody");
		inv.forEach((row, ix) => {
			const tr = ee`<tr style="border-bottom:1px solid rgba(127,127,127,.15)"></tr>`.appendTo(tb);
			const nameCell = ee`<td class="ve-py-1"></td>`.appendTo(tr);
			if (row.choiceCategory && !row.uid) {
				// unresolved "choose a weapon" slot -> dropdown of matching weapons (PC starting equipment)
				const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:220px"><option value="">— choose ${`a ${row.name}`.replace(" (choose)", "").qq()} —</option></select>`;
				st.weaponOptions(row.choiceCategory).forEach(n => ee`<option>${n.qq()}</option>`.appendTo(sel));
				sel.onn("change", () => {
					const name = sel.val(); if (!name) return;
					const it = st._resolveItem(name, "");
					row.uid = it ? CW.uid(it) : null; row.name = it ? it.name : name; delete row.choiceCategory;
					this._save(); this._renderInvList(listWrp, H);
				});
				nameCell.appendChild(sel);
			} else {
				ee(nameCell)`${row.uid ? renderInline(`{@item ${row.name}|${row.uid.split("|")[1]}}`) : `${row.name}`.qq()}`;
			}
			// equip control: "Wear"/"Equip" for armor & shields, "Wield" for weapons
			const armorEnt = row.uid ? (this._data.armors || []).find(a => CW.uid(a) === row.uid) : null;
			const itemEnt = row.uid ? st._itemByUid(row.uid) : null;
			const wearCell = ee`<td class="ve-py-1 ve-text-center"></td>`.appendTo(tr);
			if (armorEnt) {
				const isShieldItem = `${armorEnt.type || ""}`.split("|")[0] === "S";
				const worn = isShieldItem ? H.getShieldUid() === row.uid : H.getArmorUid() === row.uid;
				ee`<button class="ve-btn ve-btn-xs ${worn ? "ve-btn-success" : "ve-btn-default"}">${worn ? "Worn ✓" : (isShieldItem ? "Equip" : "Wear")}</button>`
					.onn("click", () => {
						if (isShieldItem) H.setShieldUid(worn ? null : row.uid);
						else H.setArmorUid(worn ? null : row.uid);
						this._save(); this.render();
					})
					.appendTo(wearCell);
			} else if (st.isWeapon(itemEnt)) {
				const wielded = !!row.equipped;
				ee`<button class="ve-btn ve-btn-xs ${wielded ? "ve-btn-success" : "ve-btn-default"}" title="Show this weapon's attack & damage on the sheet">${wielded ? "Wielded ✓" : "Wield"}</button>`
					.onn("click", () => { row.equipped = !row.equipped; this._save(); this.render(); })
					.appendTo(wearCell);
			} else if (st.isWearable(itemEnt) || st.isHoldable(itemEnt)) {
				const worn = !!row.equipped;
				const label = st.isHoldable(itemEnt) ? (worn ? "Held ✓" : "Hold") : (worn ? "Worn ✓" : "Wear");
				ee`<button class="ve-btn ve-btn-xs ${worn ? "ve-btn-success" : "ve-btn-default"}" title="Equip this item so its effects apply">${label}</button>`
					.onn("click", () => { row.equipped = !row.equipped; this._save(); this.render(); })
					.appendTo(wearCell);
			}
			// attune control for items that require attunement (max 3)
			if (itemEnt && st.requiresAttunement(itemEnt) && row.uid) {
				const attuned = H.isAttuned(row.uid);
				const blocked = !attuned && !H.canAttuneMore();
				const cond = st.attuneCondition(itemEnt);
				const title = attuned ? "Click to break attunement" : blocked ? `Attunement slots full (max ${H.attuneMax()})` : `Attune to this item${cond ? ` (requires attunement ${cond})` : ""}`;
				ee(wearCell)`${ee`<button class="ve-btn ve-btn-xs ve-ml-1 ${attuned ? "ve-btn-info" : "ve-btn-default"}" ${blocked ? "disabled" : ""} title="${title.qq()}"><span class="glyphicon glyphicon-flash"></span> ${attuned ? "Attuned ✓" : "Attune"}</button>`
					.onn("click", () => { if (blocked) return; H.setAttuned(row.uid, !attuned); this._save(); this.render(); })}`;
			}
			// qty − : just decrement (no derived change) — but if it hits 0 the item is removed, which CAN change AC/effects/attunement, so do a full re-render then
			const dec = ee`<button class="ve-btn ve-btn-default ve-btn-xs">−</button>`.onn("click", () => { if (row.qty > 1) { row.qty--; this._save(); this._renderInvList(listWrp, H); } else { H.remove(ix); this._save(); this.render(); } });
			const inc = ee`<button class="ve-btn ve-btn-default ve-btn-xs">+</button>`.onn("click", () => { row.qty++; this._save(); this._renderInvList(listWrp, H); });
			ee(tr)`<td class="ve-py-1 ve-text-center" style="white-space:nowrap">${dec} <b>${row.qty}</b> ${inc}</td>`;
			// removing a worn/wielded/attuned item must refresh the whole sheet so its AC/effect/attack contributions drop, not just the list
			const rm = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" title="Remove"><span class="glyphicon glyphicon-remove"></span></button>`.onn("click", () => { H.remove(ix); this._save(); this.render(); });
			ee(tr)`<td class="ve-py-1 ve-text-right">${rm}</td>`;
		});
	}

	// Sidekick step: Equipment
	_renderSidekickEquipment (el) {
		const st = this._state;
		if (!st.sidekick.creatureUid) { ee(el)`<p class="ve-muted">Pick a creature first.</p>`; return; }
		const wrp = ee`<div class="cb__sheet"></div>`.appendTo(el);
		ee(wrp)`<p class="ve-muted ve-small">Give your sidekick weapons, armor, shields, and magic items. Wielded weapons appear as attacks; worn armor &amp; a shield set the AC (replacing the stat block's); worn/attuned rings &amp; wondrous items apply their bonuses.</p>`;
		// proficiency reminder
		const profs = [...st.sidekickArmorProfs(), ...st.sidekickWeaponProfs()];
		ee(wrp)`<p class="ve-small"><b>Proficient with:</b> ${(profs.length ? profs.join(", ") : "none from its class — it can still use gear, but non-proficient attacks don't add its proficiency bonus").qq()}</p>`;
		// current AC summary
		ee(wrp)`<p class="ve-small ve-muted">Current AC: <b>${st.sidekickAc()}</b> <span class="ve-muted">(${st.sidekickAcFromText().qq()})</span></p>`;
		this._renderSidekickInventory(wrp);
	}

	// sidekick equipment — same UI, sidekick storage
	_renderSidekickInventory (wrp) {
		const st = this._state;
		this._renderInventoryShared(wrp, {
			title: "Equipment",
			attuneMax: () => st.sidekickAttuneMax(), attunedCount: () => st.sidekickAttunedCount(), isAttuned: (u) => st.sidekickIsAttuned(u), setAttuned: (u, o) => st.sidekickSetAttuned(u, o), canAttuneMore: () => st.sidekickCanAttuneMore(),
			inv: () => st._skInv(), add: (o) => st.skAddToInventory(o), remove: (ix) => st.skRemoveFromInventory(ix),
			getArmorUid: () => st.sidekick.armorUid, setArmorUid: (v) => { st.sidekick.armorUid = v; },
			getShieldUid: () => st.sidekick.shieldUid, setShieldUid: (v) => { st.sidekick.shieldUid = v; },
			clear: () => { st.sidekick.inventory = []; st.sidekick.armorUid = null; st.sidekick.shieldUid = null; st.sidekick.attunedUids = []; }, startingEquip: null,
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
					const radio = ee`<label class="ve-flex-v-center" style="gap:6px;cursor:pointer"><input type="radio" name="cb-eq-${ix}" ${chosen ? "checked" : ""}> <span>${renderInline(opt)}</span></label>`;
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

	/* ----- Fighting Style ----- */
	_renderFightingStyle (wrp) {
		const st = this._state;
		const slots = st.fightingStyleSlots(); if (!slots) return;
		const opts = st.fightingStyleOptions();
		st.fightingStyles = st.fightingStyles.filter(uid => opts.some(o => CW.uid(o) === uid)); // drop stale picks
		ee(wrp)`<h4 class="ve-mt-3">Fighting Style</h4>`;
		const counter = ee`<span class="ve-muted">${st.fightingStyles.length}/${slots}</span>`;
		ee(wrp)`<p class="ve-muted">Choose ${slots} fighting style${slots > 1 ? "s" : ""} (${counter}). <span class="ve-small">Defense, Archery, and Dueling are applied to your AC/attacks automatically.</span></p>`;
		this._renderChipPicker(wrp, {items: opts, getValue: o => CW.uid(o), getLabel: o => `${o.name}`.qq(), arr: st.fightingStyles, max: slots, counterEle: counter});
		st.chosenFightingStyles().forEach(o => ee(wrp)`<details class="ve-mt-1"><summary><b>${o.name.qq()}</b></summary><div class="ve-pl-3 ve-small">${renderEntries(o.entries)}</div></details>`);
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
		if (g.type === "skill") { st.fixedSkillProfs().forEach(s => out.add(s)); st.classSkillChoices.forEach(s => out.add(s)); otherChoices("skill"); } else if (g.type === "language") { st.fixedLanguages().forEach(l => out.add(l)); otherChoices("language"); } else if (g.type === "weapon") { otherChoices("weapon"); } else { st.fixedTools().forEach(t => out.add(t)); otherChoices("tool"); }
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
			// always-prepared subclass spells (domain/oath/circle) — free, don't count against the limit
			const prepared = st.subclassPreparedSpells(src);
			if (prepared.length) ee(wrp)`<div class="ve-mb-2"><b>Always prepared <span class="ve-muted ve-small">(${(src.subclassEnt?.name || "subclass").qq()})</span>:</b> ${prepared.map(p => refLink(UrlUtil.PG_SPELLS, p.sp)).join(", ")}</div>`;
			// subclass bonus known cantrips/spells + innate + free choices (Light domain cantrip, Lore Bard secrets)
			this._renderSubclassBonusSpells(wrp, src);
			const bucket = st.spellChoicesFor(src.uid);
			const all = st.spellListForSource(src);
			const cantrips = dedupe(all.filter(s => s.level === 0).sort((a, b) => SortUtil.ascSortLower(a.name, b.name)));
			const maxLv = st.maxSpellLevelForSource(src);
			const leveled = dedupe(all.filter(s => s.level >= 1 && s.level <= maxLv).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)));
			const nCantrips = st.cantripsKnownFor(src);
			if (nCantrips) this._renderSpellPicker(wrp, `Cantrips`, cantrips, bucket.cantrips, nCantrips);
			this._renderSpellPicker(wrp, src.preparedSpells ? `Prepared spells` : `Spells known`, leveled, bucket.leveled, st.leveledSpellsKnownFor(src));
		});

		// Warlock Mystic Arcanum (one 6th-9th level spell each at L11/13/15/17)
		const arcanumLevels = st.mysticArcanumLevels();
		if (arcanumLevels.length) {
			ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>Mystic Arcanum</h4><p class="ve-muted ve-small">Choose one Warlock spell of each level below; you can cast each once per long rest (no spell slot).</p>`;
			arcanumLevels.forEach(spLvl => {
				const sel = ee`<select class="ve-form-control ve-input-xs" style="max-width:280px"><option value="">— choose a level ${spLvl} spell —</option></select>`;
				st.mysticArcanumOptions(spLvl).forEach(sp => ee`<option value="${CW.uid(sp).qq()}">${sp.name.qq()}</option>`.appendTo(sel));
				sel.val(st.mysticArcanum[spLvl] || "");
				sel.onn("change", () => { if (sel.val()) st.mysticArcanum[spLvl] = sel.val(); else delete st.mysticArcanum[spLvl]; this._save(); this.render(); });
				ee(wrp)`<div class="ve-mb-1"><b>${Parser.spLevelToFull(spLvl)}-level:</b> ${sel}</div>`;
			});
		}

		if (st.hasRacialSpells()) this._renderRacialSpells(wrp);
		this._renderBackgroundSpells(wrp);
		if (!sources.length && !st.hasRacialSpells()) ee(wrp)`<p class="ve-muted">No spellcasting.</p>`;
	}

	// shared chip picker for a parsed {choose} spell group, storing picks in `store[g.key]`
	_renderSpellChooseGroup (wrp, g, store, labelSuffix) {
		const st = this._state;
		if (!store[g.key]) store[g.key] = [];
		const arr = store[g.key];
		const seen = new Set();
		const opts = st.racialSpellOptions(g.filter).filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }).sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
		const counter = ee`<span class="ve-muted ve-small">${arr.length}/${g.count}</span>`;
		ee(wrp)`<div class="ve-mt-1"><b>Choose ${g.count} spell${g.count > 1 ? "s" : ""}</b>${labelSuffix ? ` <span class="ve-muted ve-small">${labelSuffix.qq()}</span>` : ""} (${counter}):</div>`;
		this._renderChipPicker(wrp, {items: opts, getValue: sp => sp.name, getLabel: sp => `${sp.level ? `<span class="ve-muted ve-small">${sp.level}</span> ` : "✦ "}${refLink(UrlUtil.PG_SPELLS, sp)}`, arr, max: g.count, counterEle: counter, gridStyle: "display:flex;flex-wrap:wrap;gap:4px;max-height:200px;overflow:auto;border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px"});
	}

	_renderSubclassBonusSpells (wrp, src) {
		const st = this._state; const info = st.subclassSpellInfo(src); if (!info) return;
		const scName = src.subclassEnt?.name || "subclass";
		const sl = (sp) => refLink(UrlUtil.PG_SPELLS, sp);
		if (info.knownFixed.length) ee(wrp)`<div class="ve-mb-1"><b>Bonus spells <span class="ve-muted ve-small">(${scName.qq()})</span>:</b> ${info.knownFixed.map(sl).join(", ")}</div>`;
		if (info.innate.length) ee(wrp)`<div class="ve-mb-1"><b>Innate <span class="ve-muted ve-small">(${scName.qq()})</span>:</b> ${info.innate.map(i => `${sl(i.sp)} <span class="ve-muted ve-small">(${i.freq})</span>`).join(", ")}</div>`;
		info.knownChoose.forEach(g => this._renderSpellChooseGroup(wrp, g, st.subclassSpellChoices, `(${scName})`));
	}

	_renderBackgroundSpells (wrp) {
		const st = this._state; const info = st.backgroundSpellsInfo(); if (!info) return;
		if (!(info.knownFixed.length || info.innate.length || info.knownChoose.length || info.expanded.length)) return;
		const sl = (sp) => refLink(UrlUtil.PG_SPELLS, sp);
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>${st.backgroundEnt.name.qq()} — Background Spells</h4>`;
		if (info.ability) ee(wrp)`<div class="ve-mb-1"><b>Spellcasting ability:</b> ${CW.ABIL_FULL[info.ability] || info.ability}</div>`;
		if (info.knownFixed.length) ee(wrp)`<div class="ve-mb-1"><b>Known:</b> ${info.knownFixed.map(sl).join(", ")}</div>`;
		if (info.innate.length) ee(wrp)`<div class="ve-mb-1"><b>Innate:</b> ${info.innate.map(i => `${sl(i.sp)} <span class="ve-muted ve-small">(${i.freq})</span>`).join(", ")}</div>`;
		if (info.expanded.length) ee(wrp)`<div class="ve-mb-1"><b>Added to your spell list:</b> ${info.expanded.map(e => sl(e.sp)).join(", ")} <span class="ve-muted ve-small">(those you can cast appear in the pickers above)</span></div>`;
		info.knownChoose.forEach(g => this._renderSpellChooseGroup(wrp, g, st.bgSpellChoices, `(${st.backgroundEnt.name})`));
	}

	_renderRacialSpells (wrp) {
		const st = this._state;
		const info = st.racialSpellsInfo(); if (!info) return;
		ee(wrp)`<hr class="hr-2 ve-mt-3"><h4>${st.raceEnt.name.qq()} — Innate Spellcasting</h4>`;
		// variant chooser when the race offers alternative spell sets (Astral Elf cantrip, Tiefling/Elf legacy)
		const groups = st.racialSpellGroups();
		if (groups.length > 1) {
			const sel = ee`<select class="ve-form-control ve-input-xs" style="width:auto"></select>`;
			groups.forEach((g, i) => ee`<option value="${i}">${st.racialSpellGroupLabel(g).qq()}</option>`.appendTo(sel));
			sel.val(`${st.racialSpellGroupIx()}`);
			sel.onn("change", () => { st.raceSpellGroup = parseInt(sel.val(), 10) || 0; this._save(); this.render(); });
			ee(wrp)`<div class="ve-mb-1"><b>Choose one:</b> ${sel}</div>`;
		}
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

		const box = ee`<div style="border:1px solid rgba(127,127,127,.2);padding:6px;border-radius:4px"></div>`.appendTo(wrp);
		const search = spells.length > 14 ? ee`<input class="ve-form-control ve-input-xs ve-mb-1" placeholder="Filter by name…" style="max-width:240px">`.appendTo(box) : null;
		const scroll = ee`<div style="max-height:260px;overflow:auto"></div>`.appendTo(box);

		// group spells by level so a long prepared/known list is scannable
		const byLvl = new Map();
		spells.forEach(sp => { const k = sp.level || 0; if (!byLvl.has(k)) byLvl.set(k, []); byLvl.get(k).push(sp); });
		const multiLevel = byLvl.size > 1;
		const records = []; // {sp, chip, input, head}
		[...byLvl.keys()].sort((a, b) => a - b).forEach(lvl => {
			const head = multiLevel ? ee`<div class="ve-muted ve-small ve-bold ve-mt-1">${lvl ? `Level ${lvl}` : "Cantrips"}</div>`.appendTo(scroll) : null;
			const grid = ee`<div style="display:flex;flex-wrap:wrap;gap:4px"></div>`.appendTo(scroll);
			byLvl.get(lvl).forEach(sp => {
				const val = CW.uid(sp);
				const chip = ee`<label class="cb__chip" style="cursor:pointer" title="${`${Parser.spLevelToFull(sp.level)} ${Parser.spSchoolAbvToFull(sp.school)}`.qq()}">${refLink(UrlUtil.PG_SPELLS, sp)} <input type="checkbox" ${chosenArr.includes(val) ? "checked" : ""}></label>`;
				const input = chip.querySelector("input");
				input.addEventListener("change", () => {
					if (input.checked) { if (chosenArr.length < max) chosenArr.push(val); else input.checked = false; } else { const i = chosenArr.indexOf(val); if (i >= 0) chosenArr.splice(i, 1); }
					this._save(); refresh();
				});
				chip.appendTo(grid);
				records.push({sp, chip, input, head});
			});
		});

		const refresh = () => { const atMax = chosenArr.length >= max; records.forEach(r => { r.input.disabled = !r.input.checked && atMax; }); counter.txt(`${chosenArr.length}/${max}`); };
		refresh();

		if (search) search.onn("input", () => {
			const q = search.val().toLowerCase().trim();
			const headHas = new Map();
			records.forEach(r => { const show = !q || r.sp.name.toLowerCase().includes(q); r.chip.style.display = show ? "" : "none"; if (show && r.head) headHas.set(r.head, true); });
			new Set(records.map(r => r.head).filter(Boolean)).forEach(h => { h.style.display = headHas.get(h) ? "" : "none"; });
		});
	}

	/* ----- Step: Review (character sheet) ----- */
	_renderStepReview (el) {
		const st = this._state;
		const missing = [];
		if (!st.raceUid) missing.push(this._raceWord().toLowerCase());
		if (!st.classUid) missing.push("class");
		if (!st.backgroundUid) missing.push("background");
		const wrp = ee`<div class="cb__sheet"></div>`.appendTo(el);
		if (missing.length) ee(wrp)`<div class="cb__err no-print">Still missing: ${missing.join(", ")}. The sheet below fills in as you complete steps.</div>`;

		const race = st.raceEnt; const cls = st.classEnt; const bg = st.backgroundEnt;
		const subtitle = [race?.name, bg?.name].filter(Boolean).join(" • ");
		const classLine = st.classList().map(c => `${c.cls.name}${c.subclassEnt ? ` (${c.subclassEnt.name})` : ""} ${c.level}`).join(" / ");

		ee(wrp)`<div class="cb__sheet-head">
			<div><div style="font-size:24px;font-weight:bold">${(st.name || "Unnamed Character").qq()}</div>
			<div class="ve-muted">${[classLine, subtitle].filter(Boolean).join(" — ").qq()}</div></div>
			<div class="ve-text-right"><div><b>Proficiency Bonus</b> ${CW.fmtMod(st.profBonus)}</div>
			<div><b>Size</b> ${st.size()} &nbsp; <b>Speed</b> ${st.speedString()}</div>
			${st.creatureType() ? `<div><b>Type</b> ${st.creatureType().qq()}</div>` : ""}</div>
		</div>`;

		// core stat boxes
		const hp = st.maxHp();
		const boxes = ee`<div class="cb__sheet-grid"></div>`.appendTo(wrp);
		const box = (lbl, val) => ee(boxes)`<div class="cb__stat-box"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
		box("Armor Class", cls ? st.ac() : "—");
		box("Hit Points", hp ?? "—");
		box("Hit Dice", st.classList().length ? st.hitDiceString() : "—");
		ee(boxes)`<div class="cb__stat-box"><div class="lbl">Initiative</div><div class="val">${CW.fmtMod(st.initiative())} ${advDisBadge(st.initiativeAdvDis())}</div></div>`;
		box("Passive Perception", st.passiveScore("perception"));
		box("Passive Investigation", st.passiveScore("investigation"));
		box("Passive Insight", st.passiveScore("insight"));

		// abilities + saves
		const secA = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
		ee(secA)`<h4>Ability Scores & Saving Throws</h4>`;
		const abilGrid = ee`<div class="cb__abil-grid"></div>`.appendTo(secA);
		CW.ABILITIES.forEach(abv => {
			const total = st.finalAbility(abv); const mod = st.abilityMod(abv);
			const saveProf = st.saveProfs().has(abv);
			ee(abilGrid)`<div class="cb__abil"><div class="cb__abil-name">${abv}</div>
				<div class="cb__abil-score">${total}</div><div class="cb__abil-mod">${CW.fmtMod(mod)}</div>
				<div class="cb__abil-sub">save ${CW.fmtMod(st.saveMod(abv))}${saveProf ? " ●" : ""} ${advDisBadge(st.saveAdvDis(abv))}</div></div>`;
		});
		const saveNotes = [st._featureSaveBonus() ? `Aura of Protection (${CW.fmtMod(st._featureSaveBonus())} to all saves)` : "", st._hasAllSaveProficiency() ? "proficient in all saving throws" : ""].filter(Boolean);
		if (saveNotes.length) ee(secA)`<div class="ve-muted ve-small ve-mt-1">${saveNotes.join("; ").qq()} (included above).</div>`;

		// attacks (wielded weapons) — build the whole table in one pass so the <tr>/<td> parse in table context
		const wielded = st.wieldedWeapons();
		if (wielded.length) {
			const secAtk = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secAtk)`<h4>Attacks</h4>`;
			const rowsHtml = wielded.map(it => {
				const a = st.weaponAttack(it);
				const dmg = `${st.fmtWeaponDamage(a.dmg1, a)}${a.dmg2 ? ` <span class="ve-muted">(${st.fmtWeaponDamage(a.dmg2, a)} 2H)</span>` : ""}`;
				const notes = [a.ranged && a.range ? `range ${a.range}` : "", a.critThreshold ? `crit ${a.critThreshold}–20` : "", ...a.properties].filter(Boolean).join(", ");
				const noProf = a.prof ? "" : ` <span class="cb__advdis cb__advdis--dis" title="Not proficient — proficiency bonus not added">no prof</span>`;
				return `<tr style="border-top:1px solid rgba(127,127,127,.15)"><td class="ve-py-1">${refLink(UrlUtil.PG_ITEMS, it, it.name)} <span class="ve-muted ve-small">(${a.ability})</span>${noProf}</td><td class="ve-py-1 ve-text-center"><b>${CW.fmtMod(a.toHit)}</b></td><td class="ve-py-1">${dmg}</td><td class="ve-py-1 ve-muted ve-small">${notes.qq()}</td></tr>`;
			}).join("");
			ee(secAtk)`<table class="w-100 ve-small cb__atk-tbl"><thead><tr><th class="ve-text-left">Weapon</th><th class="ve-text-center">Attack</th><th class="ve-text-left">Damage</th><th class="ve-text-left">Notes</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
			if (st.numAttacks() > 1) ee(secAtk)`<div class="ve-small ve-mt-1"><b>Extra Attack:</b> you can attack ${st.numAttacks()} times when you take the Attack action.</div>`;
			ee(secAtk)`<div class="ve-muted ve-small ve-mt-1">Attack bonus = ability mod (Str, or Dex for finesse/ranged) + proficiency (if proficient) + magic. Wield weapons from your Inventory on the Skills &amp; Gear step.</div>`;
		}
		const fstyles = st.chosenFightingStyles();
		if (fstyles.length) { const secFs = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp); ee(secFs)`<h4>Fighting Style</h4><div>${fstyles.map(o => `${o.name}`.qq()).join(", ")}</div>`; }

		// skills
		const secS = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
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
			const secAd = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secAd)`<h4>Advantages &amp; Disadvantages</h4>`;
			if (eff.nonProf) ee(secAd)`<div><span class="cb__advdis cb__advdis--dis">DIS</span> Str/Dex checks, saves &amp; attacks — wearing armor/shield you're not proficient with.</div>`;
			if (eff.stealthDis) ee(secAd)`<div><span class="cb__advdis cb__advdis--dis">DIS</span> Stealth checks — ${eff.stealthDis.qq()}.</div>`;
			if (eff.strReqUnmet) ee(secAd)`<div class="ve-muted ve-small">Speed −10 ft. — ${eff.strReqUnmet.armor.qq()} requires Str ${eff.strReqUnmet.req}.</div>`;
			notes.forEach(n => ee(secAd)`<div><span class="cb__advdis cb__advdis--${n.type}">${n.type === "adv" ? "ADV" : "DIS"}</span> ${n.text.qq()} <span class="ve-muted ve-small">(${n.sourceTag ? renderInline(n.sourceTag) : `${n.source}`.qq()})</span></div>`);
		}

		// proficiencies & languages
		const awt = st.armorWeaponToolProfs();
		const secP = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
		const tools = st.chosenTools();
		ee(secP)`<h4>Proficiencies & Languages</h4>
			<div><b>Armor:</b> ${renderInline(awt.armor.join(", ") || "—")}</div>
			<div><b>Weapons:</b> ${renderInline(awt.weapons.join(", ") || "—")}</div>
			${tools.length ? `<div><b>Tools:</b> ${tools.map(t => `${t}`.includes("{@") ? renderInline(t) : `${t}`.qq()).join(", ")}</div>` : ""}
			<div><b>Languages:</b> ${st.chosenLanguages().map(l => `${l}`.qq()).join(", ") || "—"}</div>
			${st.senses().length ? `<div><b>Senses:</b> ${st.senses().join(", ")}</div>` : ""}`;

		// magic item effects (from worn armor + equipped shield + wielded weapons)
		const eqfx = st.equippedItemEffects();
		const itemLink = (name, source) => refLink(UrlUtil.PG_ITEMS, {name, source}, name);
		// defenses (race + items): resistances / immunities / vulnerabilities / condition immunities
		const def = st.defenses();
		const capList = (arr) => arr.map(x => `${x}`.toTitleCase()).join(", ");
		if (def.resist.length || def.immune.length || def.vulnerable.length || def.conditionImmune.length) {
			const secDef = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secDef)`<h4>Defenses</h4>`;
			if (def.resist.length) ee(secDef)`<div><b>Damage Resistance:</b> ${capList(def.resist).qq()}</div>`;
			if (def.immune.length) ee(secDef)`<div><b>Damage Immunity:</b> ${capList(def.immune).qq()}</div>`;
			if (def.vulnerable.length) ee(secDef)`<div><b>Damage Vulnerability:</b> ${capList(def.vulnerable).qq()}</div>`;
			if (def.conditionImmune.length) ee(secDef)`<div><b>Condition Immunity:</b> ${capList(def.conditionImmune).qq()}</div>`;
		}

		if (eqfx.saveBonus || eqfx.spellAtk || eqfx.spellDc || eqfx.abilitySet.length || eqfx.focus.length || eqfx.attuned.length || eqfx.needAttune.length || eqfx.spells.length || eqfx.speed.length) {
			const secMi = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secMi)`<h4>Magic Item Effects <span class="ve-muted ve-small">(equipped gear: armor, shield, weapons, rings &amp; wondrous)</span></h4>`;
			const itemRefs = (arr) => arr.map(r => itemLink(r.name, r.source)).join(", ");
			eqfx.abilitySet.forEach(s => ee(secMi)`<div><b>${CW.ABIL_FULL[s.abil]} set to ${s.value}</b> <span class="ve-muted ve-small">(${itemLink(s.item, s.source)})</span></div>`);
			if (eqfx.saveBonus) ee(secMi)`<div><b>Saving Throws:</b> ${CW.fmtMod(eqfx.saveBonus)} to all saves (included above)</div>`;
			if (eqfx.spellAtk || eqfx.spellDc) ee(secMi)`<div><b>Spellcasting:</b> ${[eqfx.spellAtk ? `${CW.fmtMod(eqfx.spellAtk)} spell attack` : "", eqfx.spellDc ? `${CW.fmtMod(eqfx.spellDc)} spell save DC` : ""].filter(Boolean).join(", ")} (included above)</div>`;
			if (eqfx.focus.length) ee(secMi)`<div><b>Spellcasting Focus:</b> ${itemRefs(eqfx.focus)}</div>`;
			if (eqfx.speed.length) ee(secMi)`<div><b>Speed:</b> modified by ${itemRefs(eqfx.speed)} <span class="ve-muted ve-small">(see item text)</span></div>`;
			eqfx.spells.forEach(grp => {
				const parts = grp.entries.map(e => `${e.sp ? spellSpan(e.sp.name, e.sp.source) : `${e.name}`.qq()}${e.note ? ` <span class="ve-muted ve-small">(${e.note.qq()})</span>` : ""}`);
				ee(secMi)`<div><b>${itemLink(grp.item, grp.source)} grants:</b> ${parts.join(", ")}</div>`;
			});
			if (eqfx.attuned.length) ee(secMi)`<div class="ve-muted ve-small"><span class="glyphicon glyphicon-flash"></span> Attuned (${st.attunedCount()}/${st.attuneMax()}): ${itemRefs(eqfx.attuned)}</div>`;
			eqfx.needAttune.forEach(r => ee(secMi)`<div class="cb__err ve-small"><span class="glyphicon glyphicon-warning-sign"></span> ${itemLink(r.name, r.source)} is equipped but not attuned — its magic benefits are inactive.</div>`);
		}

		// inventory
		if (st.inventory.length) {
			const secInv = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
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
			const secFe = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secFe)`<h4>Feats</h4>`;
			featList.forEach(({level, className, featUid}) => {
				const feat = this._data.feats.find(f => CW.uid(f) === featUid);
				if (!feat) return;
				const tag = className === "Race" ? "Race" : (st.isMulticlassed() ? `${className} L${level}` : `L${level}`);
				ee`<details style="margin:2px 0"><summary><b>${feat.name.qq()}</b> <span class="ve-muted ve-small">(${tag.qq()})</span></summary><div class="ve-pl-3">${renderEntries(feat.entries)}</div></details>`.appendTo(secFe);
			});
		}

		// spellcasting (per caster source)
		const spellSources = st.spellSources();
		if (spellSources.length) {
			const secSp = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			const spellSpans = (uids) => (uids || []).map(u => { const i = `${u}`.lastIndexOf("|"); return i < 0 ? `${u}`.qq() : spellSpan(`${u}`.slice(0, i), `${u}`.slice(i + 1)); }).join(", ");
			const slots = st.spellSlots(); const pact = st.pactSlots();
			ee(secSp)`<h4>Spellcasting</h4>
				<div><b>Spell Slots:</b> ${this._fmtSlots(slots)}${pact ? ` &nbsp; <b>Pact Magic:</b> ${this._fmtSlots(pact)}` : ""}</div>`;
			spellSources.forEach(src => {
				const bucket = st.spellChoices[src.uid] || {cantrips: [], leveled: []};
				const atk = st.spellAtkBonusFor(src);
				const prepared = st.subclassPreparedSpells(src);
				ee(secSp)`<div class="ve-mt-1"><b>${src.name.qq()}</b> <span class="ve-muted ve-small">— ${CW.ABIL_FULL[src.ability] || "—"}, DC ${st.spellSaveDcFor(src) ?? "—"}, atk ${atk == null ? "—" : CW.fmtMod(atk)}</span></div>
					<div class="ve-pl-3"><b>Cantrips:</b> ${spellSpans(bucket.cantrips) || "—"}</div>
					<div class="ve-pl-3"><b>${src.preparedSpells ? "Prepared" : "Known"}:</b> ${spellSpans(bucket.leveled) || "—"}</div>
					${prepared.length ? `<div class="ve-pl-3"><b>Always prepared:</b> ${prepared.map(p => spellSpan(p.sp.name, p.sp.source)).join(", ")}</div>` : ""}`;
			});
			const arcanum = st.mysticArcanumLevels().map(l => st.mysticArcanum[l]).filter(Boolean);
			if (arcanum.length) ee(secSp)`<div class="ve-mt-1"><b>Mystic Arcanum:</b> ${spellSpans(arcanum)}</div>`;
		}

		// subclass-granted bonus spells (domain cantrips, Lore secrets, Totem rituals) — covers non-caster subclasses too
		const scSpellInfos = st.classSubclassSpellInfos().map(o => {
			const chosen = o.info.knownChoose.flatMap(g => (st.subclassSpellChoices[g.key] || []).map(n => st._spellByName(n)).filter(Boolean));
			return {...o, chosen, show: o.info.knownFixed.length || o.info.innate.length || chosen.length};
		}).filter(o => o.show);
		if (scSpellInfos.length) {
			const secScS = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secScS)`<h4>Subclass Spells</h4>`;
			scSpellInfos.forEach(o => {
				const known = [...o.info.knownFixed, ...o.chosen].map(sp => spellSpan(sp.name, sp.source));
				ee(secScS)`<div class="ve-mt-1"><b>${o.subclass.name.qq()}</b> <span class="ve-muted ve-small">(${o.cls.name.qq()})</span></div>
					${known.length ? `<div class="ve-pl-3"><b>Bonus spells:</b> ${known.join(", ")}</div>` : ""}
					${o.info.innate.length ? `<div class="ve-pl-3"><b>Innate:</b> ${o.info.innate.map(i => `${spellSpan(i.sp.name, i.sp.source)} <span class="ve-muted ve-small">(${i.freq.qq()})</span>`).join(", ")}</div>` : ""}`;
			});
		}

		// background-granted spells (Ravnica guilds, Strixhaven)
		const bgsi = st.backgroundSpellsInfo();
		if (bgsi && (bgsi.knownFixed.length || bgsi.innate.length || bgsi.expanded.length || bgsi.knownChoose.length)) {
			const secBgS = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			const chosen = bgsi.knownChoose.flatMap(g => (st.bgSpellChoices[g.key] || []).map(n => st._spellByName(n)).filter(Boolean));
			const known = [...bgsi.knownFixed, ...chosen].map(sp => spellSpan(sp.name, sp.source));
			ee(secBgS)`<h4>${st.backgroundEnt.name.qq()} Background Spells</h4>
				${bgsi.ability ? `<div><b>Ability:</b> ${CW.ABIL_FULL[bgsi.ability] || bgsi.ability}</div>` : ""}
				${known.length ? `<div><b>Known:</b> ${known.join(", ")}</div>` : ""}
				${bgsi.innate.length ? `<div><b>Innate:</b> ${bgsi.innate.map(i => `${spellSpan(i.sp.name, i.sp.source)} (${i.freq.qq()})`).join(", ")}</div>` : ""}
				${bgsi.expanded.length ? `<div><b>Added to your spell list:</b> ${bgsi.expanded.map(e => spellSpan(e.sp.name, e.sp.source)).join(", ")}</div>` : ""}`;
		}

		// racial (innate) spellcasting
		const rsi = st.hasRacialSpells() ? st.racialSpellsInfo() : null;
		if (rsi && (rsi.knownFixed.length || rsi.innate.length || rsi.knownChoose.length || rsi.prepared.length || rsi.expanded.length)) {
			const secR = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			const chosenRacial = rsi.knownChoose.flatMap(g => st.raceSpellChoices[g.key] || []);
			const knownSpans = [
				...rsi.knownFixed.map(sp => spellSpan(sp.name, sp.source)),
				...chosenRacial.map(n => { const sp = st._spellByName(n); return sp ? spellSpan(sp.name, sp.source) : `${n}`.qq(); }),
			];
			ee(secR)`<h4>${st.raceEnt.name.qq()} Innate Spellcasting</h4>
				${rsi.ability ? `<div><b>Ability:</b> ${CW.ABIL_FULL[rsi.ability]} &nbsp; <b>Save DC:</b> ${st.racialSpellSaveDc() ?? "—"}</div>` : ""}
				${knownSpans.length ? `<div><b>Known:</b> ${knownSpans.join(", ")}</div>` : ""}
				${rsi.innate.length ? `<div><b>Innate:</b> ${rsi.innate.map(i => `${spellSpan(i.sp.name, i.sp.source)} (${i.freq})`).join(", ")}</div>` : ""}
				${rsi.prepared.length ? `<div><b>Always prepared:</b> ${rsi.prepared.map(p => spellSpan(p.sp.name, p.sp.source)).join(", ")}</div>` : ""}
				${rsi.expanded.length ? `<div><b>Added to your spell list:</b> ${rsi.expanded.map(e => spellSpan(e.sp.name, e.sp.source)).join(", ")}</div>` : ""}`;
		}

		// feat-granted spells (Magic Initiate, Fey Touched, …)
		const featSp = st.featSpellSources();
		if (featSp.length) {
			const secFS = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secFS)`<h4>Feat Spells</h4>`;
			featSp.forEach(({feat, choice, info}) => {
				const chosen = info.knownChoose.flatMap(g => (choice.featSpellChoose?.[g.key] || []).map(n => st._spellByName(n)).filter(Boolean));
				const known = [...info.knownFixed, ...chosen].map(sp => spellSpan(sp.name, sp.source));
				const dc = st.featSpellSaveDc(info.ability);
				ee(secFS)`<div class="ve-mt-1"><b>${feat.name.qq()}</b>${info.ability ? ` <span class="ve-muted ve-small">— ${CW.ABIL_FULL[info.ability] || info.ability}${dc != null ? `, DC ${dc}` : ""}</span>` : ""}</div>
					${known.length ? `<div class="ve-pl-3"><b>Spells:</b> ${known.join(", ")}</div>` : ""}
					${info.prepared.length ? `<div class="ve-pl-3"><b>Always prepared:</b> ${info.prepared.map(p => spellSpan(p.sp.name, p.sp.source)).join(", ")}</div>` : ""}
					${info.innate.length ? `<div class="ve-pl-3"><b>Innate:</b> ${info.innate.map(i => `${spellSpan(i.sp.name, i.sp.source)} <span class="ve-muted ve-small">(${i.freq.qq()})</span>`).join(", ")}</div>` : ""}
					${info.expanded.length ? `<div class="ve-pl-3"><b>Added to your spell list:</b> ${info.expanded.map(e => spellSpan(e.sp.name, e.sp.source)).join(", ")}</div>` : ""}`;
			});
		}

		// features (grouped per class)
		const sections = st.featureSections();
		if (sections.length) {
			const secF = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secF)`<h4>Class &amp; Subclass Features</h4>`;
			sections.forEach(sec => {
				if (st.isMulticlassed()) ee(secF)`<div class="ve-bold ve-mt-2">${sec.title.qq()}</div>`;
				sec.items.forEach(f => {
					ee`<details style="margin:2px 0"><summary><b>L${f.level}:</b> ${f.name.qq()} <span class="ve-muted ve-small">(${f.kind})</span></summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`.appendTo(secF);
				});
			});
		}

		// background feature(s) — the named "Feature: …" entries
		const bgFeatures = (bg?.entries || []).filter(e => e && e.name && e.type === "entries");
		if (bgFeatures.length) {
			const secBg = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secBg)`<h4>${bg.name.qq()} Feature${bgFeatures.length > 1 ? "s" : ""}</h4>`;
			bgFeatures.forEach(f => ee`<details style="margin:2px 0"><summary><b>${`${f.name}`.replace(/^Feature:\s*/, "").qq()}</b></summary><div class="ve-pl-3">${renderEntries(f.entries)}</div></details>`.appendTo(secBg));
		}

		// race traits
		if (race?.entries?.length) {
			const secR = ee`<div class="cb__sheet-section"></div>`.appendTo(wrp);
			ee(secR)`<h4>${race.name} Traits</h4><div>${renderEntries(race.entries)}</div>`;
		}
	}
}
