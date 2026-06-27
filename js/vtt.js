"use strict";

/* Tabletop (VTT) — a lightweight, self-hosted virtual tabletop for the local fork.
 * Phase 1: client-side only (map + square grid + draggable HP-bar tokens + measurement +
 * initiative tracker + scene save/load + dice). Multiplayer sync is layered on in a later phase
 * via window.VttNet (see tools-local/vtt-server). All board state lives in `this.scene`. */
class VttBoard {
	static _STORE_KEY = "vtt_scene_v1";
	static _SWATCHES = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#f1c40f", "#7f8c8d", "#e84393", "#2c3e50"];
	static _SIZE_FEET = {T: 2.5, S: 5, M: 5, L: 10, H: 15, G: 20}; // 5e creature size → footprint side in FEET (cells derive from the grid's ft-per-square)
	static _UNDO_MAX = 50;
	// 5e conditions + a few common buffs, for token status markers
	static _CONDITIONS = [
		{k: "blinded", ab: "Bli", c: "#607d8b"}, {k: "charmed", ab: "Chm", c: "#e91e63"}, {k: "deafened", ab: "Dea", c: "#795548"},
		{k: "frightened", ab: "Fr", c: "#9c27b0"}, {k: "grappled", ab: "Grp", c: "#8d6e63"}, {k: "incapacitated", ab: "Inc", c: "#546e7a"},
		{k: "invisible", ab: "Inv", c: "#00bcd4"}, {k: "paralyzed", ab: "Par", c: "#3f51b5"}, {k: "petrified", ab: "Pet", c: "#9e9e9e"},
		{k: "poisoned", ab: "Poi", c: "#4caf50"}, {k: "prone", ab: "Prn", c: "#ff9800"}, {k: "restrained", ab: "Res", c: "#6d4c41"},
		{k: "stunned", ab: "Stn", c: "#fbc02d"}, {k: "unconscious", ab: "Unc", c: "#212121"}, {k: "concentration", ab: "Conc", c: "#2196f3"},
		{k: "blessed", ab: "Bls", c: "#ffd54a"}, {k: "hasted", ab: "Hst", c: "#ff7043"}, {k: "raging", ab: "Rage", c: "#d32f2f"},
	];

	constructor (root) {
		this._root = root;
		this._scene = this._defaultScene();
		this._selId = null;
		this._uid = 0;
		this._els = {}; // cached DOM
		this._tokEls = new Map(); // tokenId → element
		this._undo = []; // scene snapshots for Ctrl+Z
		this._drawColor = "#ffd54a";
		this._drawWidth = 4;
		this._fogBrush = 2; // brush radius in cells
	}

	_setMode (mode, on) {
		const m = on ? mode : null;
		this._measureMode = m === "measure"; this._drawMode = m === "draw"; this._fogMode = m === "fog";
		this._btnMeasure?.classList.toggle("active", this._measureMode);
		this._btnDraw?.classList.toggle("active", this._drawMode);
		this._btnFog?.classList.toggle("active", this._fogMode);
		this._els.board.classList.toggle("vtt-board--measuring", this._measureMode);
		this._els.board.classList.toggle("vtt-board--drawing", this._drawMode);
		this._els.board.classList.toggle("vtt-board--fog", this._fogMode);
	}

	_defaultScene () {
		return {
			map: null, // {src, w, h}
			grid: {cell: 70, feet: 5, show: true, snap: true, color: "rgba(255,255,255,.16)", offsetX: 0, offsetY: 0},
			view: {x: 40, y: 40, scale: 1},
			tokens: [],
			aoes: [], // [{id, type:circle|cone|line|cube, x, y, size(ft), rot(deg), color}]
			drawings: [], // [{color, width, pts:[[x,y],…]}] freehand annotations
			fog: {on: false, base: "covered", cells: []}, // cell-based fog; cells = exception keys "c,r" to the base state
			turn: {order: [], ix: -1, round: 1}, // initiative order = token ids
		};
	}

	/* ============================ init / DOM ============================ */
	init () {
		this._root.innerHTML = "";
		this._load(); // load saved scene BEFORE building the UI so initial control values match
		this._root.appendChild(this._buildBoard());
		this._root.appendChild(this._buildSidebar());
		this._renderAll();
		this._bindBoard();
		window.addEventListener("resize", () => this._applyView());
		// expose for the (later) network layer + debugging
		globalThis.dbg_vtt = this;
	}

	_buildBoard () {
		const board = el("div", {class: "vtt-board", id: "vtt-board"});
		this._els.board = board;
		const world = el("div", {class: "vtt-world"});
		this._els.world = world;
		const imgMap = el("img", {class: "vtt-map", alt: "", draggable: false}); this._els.imgMap = imgMap; imgMap.style.display = "none";
		const cvGrid = el("canvas", {class: "vtt-grid"}); this._els.cvGrid = cvGrid;
		const svgAoe = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svgAoe.setAttribute("class", "vtt-aoe"); this._els.svgAoe = svgAoe; // AoE templates, below tokens
		const cvDraw = el("canvas", {class: "vtt-draw"}); this._els.cvDraw = cvDraw; // freehand annotations
		const tokens = el("div", {class: "vtt-tokens"}); this._els.tokens = tokens;
		const cvFog = el("canvas", {class: "vtt-fog"}); this._els.cvFog = cvFog; // fog of war, above tokens
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "vtt-overlay"); this._els.svg = svg;
		world.append(imgMap, cvGrid, svgAoe, cvDraw, tokens, cvFog, svg);
		board.append(world, this._buildToolbar(), el("div", {class: "vtt-zoomread", id: "vtt-zoomread"}));
		this._els.zoomread = board.querySelector("#vtt-zoomread");
		return board;
	}

	_buildToolbar () {
		const bar = el("div", {class: "vtt-toolbar no-print"});
		const btn = (txt, title, fn) => { const b = el("button", {class: "ve-btn ve-btn-xs ve-btn-default", title}, txt); b.onclick = fn; return b; };
		this._btnMeasure = btn("📏 Measure", "Toggle measure mode (or hold Alt and drag)", () => { this._setMode("measure", !this._measureMode); });
		this._btnDraw = btn("✎ Draw", "Toggle freehand drawing", () => { this._setMode("draw", !this._drawMode); });
		this._btnFog = btn("🌫 Fog", "Toggle fog of war painting (drag reveals, Shift-drag hides)", () => { const on = !this._fogMode; if (on) { this._scene.fog.on = true; this._renderFog(); } this._setMode("fog", on); this._renderFogPanel?.(); });
		bar.append(
			btn("＋ Token", "Add a token at the view center", () => this._addTokenInteractive()),
			btn("○ Circle", "Add a circular AoE (e.g. Fireball 20 ft)", () => this._addAoe("circle")),
			btn("◁ Cone", "Add a cone AoE (e.g. Burning Hands 15 ft)", () => this._addAoe("cone")),
			btn("▬ Line", "Add a line AoE (e.g. Lightning Bolt 100 ft)", () => this._addAoe("line")),
			btn("▢ Cube", "Add a square/cube AoE", () => this._addAoe("cube")),
			this._btnMeasure,
			this._btnDraw,
			this._btnFog,
			btn("↶ Undo", "Undo the last change (Ctrl+Z)", () => this._doUndo()),
			btn("⟳ Reset View", "Recenter & reset zoom", () => { this._scene.view = {x: 40, y: 40, scale: 1}; this._applyView(); this._save(); }),
			btn("⤢ Fit Map", "Zoom to fit the map", () => this._fitMap()),
		);
		return bar;
	}

	_buildSidebar () {
		const sb = el("div", {class: "vtt-sidebar no-print"});
		const scroll = el("div", {class: "vtt-sidebar__scroll"});
		scroll.append(
			this._secMap(),
			this._secMonsters(),
			this._secSelected(),
			this._secAoe(),
			this._secInitiative(),
			this._secDraw(),
			this._secFog(),
			this._secDice(),
			this._secLibrary(),
			this._secScene(),
		);
		sb.appendChild(scroll);
		return sb;
	}

	/* ---------- sidebar: Map & Grid ---------- */
	_secMap () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Map & Grid"));
		const inpUrl = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Map image URL or img/… path"});
		const inpFile = el("input", {type: "file", accept: "image/*", style: "display:none"});
		const btnLoad = el("button", {class: "ve-btn ve-btn-xs ve-btn-primary"}, "Load");
		const btnFile = el("button", {class: "ve-btn ve-btn-xs ve-btn-default", title: "Load a local image file"}, "File…");
		const btnClear = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Clear");
		btnLoad.onclick = () => { if (inpUrl.value.trim()) this._setMap(inpUrl.value.trim()); };
		btnFile.onclick = () => inpFile.click();
		inpFile.onchange = () => { const f = inpFile.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => this._setMap(r.result); r.readAsDataURL(f); };
		btnClear.onclick = () => { this._scene.map = null; this._renderMap(); this._save(); };
		const btnSite = el("button", {class: "ve-btn ve-btn-xs ve-btn-primary", title: "Browse maps from the 5etools adventures & books"}, "🗺 Site Maps");
		btnSite.onclick = () => this._openMapBrowser();
		sec.append(el("div", {class: "vtt-row"}, btnSite), el("div", {class: "vtt-row"}, inpUrl), el("div", {class: "vtt-row"}, btnLoad, btnFile, btnClear, inpFile));

		// grid controls
		const g = this._scene.grid;
		const cell = el("input", {type: "number", class: "ve-form-control ve-input-xs", min: "10", max: "400", value: g.cell, style: "width:64px"});
		const feet = el("input", {type: "number", class: "ve-form-control ve-input-xs", min: "1", max: "100", value: g.feet, style: "width:54px"});
		const show = el("input", {type: "checkbox"}); show.checked = g.show;
		const snap = el("input", {type: "checkbox"}); snap.checked = g.snap;
		const offX = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: g.offsetX || 0, style: "width:54px", title: "Grid X offset (align to a map's printed grid)"});
		const offY = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: g.offsetY || 0, style: "width:54px", title: "Grid Y offset"});
		// keep refs so _syncMapInputs() can refresh them after a scene swap (undo/load/import). Handlers below read this._scene.grid LIVE (never a captured stale object).
		this._els.gridCell = cell; this._els.gridFeet = feet; this._els.gridShow = show; this._els.gridSnap = snap; this._els.gridOffX = offX; this._els.gridOffY = offY;
		cell.oninput = () => { this._scene.grid.cell = Math.max(4, +cell.value || 70); this._renderGrid(); this._renderTokens(); this._renderAoes(); this._save(); };
		feet.oninput = () => { this._scene.grid.feet = Math.max(1, +feet.value || 5); this._renderTokens(); this._renderAoes(); this._save(); }; // feet changes token sizes (ft-based) & AoE px
		show.onchange = () => { this._scene.grid.show = show.checked; this._renderGrid(); this._save(); };
		snap.onchange = () => { this._scene.grid.snap = snap.checked; this._save(); };
		offX.oninput = () => { this._scene.grid.offsetX = +offX.value || 0; this._renderGrid(); this._save(); };
		offY.oninput = () => { this._scene.grid.offsetY = +offY.value || 0; this._renderGrid(); this._save(); };
		sec.append(
			el("div", {class: "vtt-row"}, lbl("Cell px"), cell, lbl("= ft"), feet),
			el("div", {class: "vtt-row"}, lbl("Offset"), offX, offY, wrapCb(snap, "Snap")),
			el("div", {class: "vtt-row"}, wrapCb(show, "Show grid")),
		);
		return sec;
	}

	/* ---------- sidebar: Add Monster (from the bestiary) ---------- */
	_secMonsters () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Add Monster"));
		const search = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Search the bestiary…"});
		const status = el("div", {class: "vtt-mini"}, "Type to search (loads the bestiary once).");
		const results = el("div", {class: "vtt-mon-results", style: "max-height:240px;overflow:auto;display:none"});
		const rollHp = el("input", {type: "checkbox"});
		const rollInit = el("input", {type: "checkbox"}); rollInit.checked = true;
		let loaded = false, monsters = [];
		const renderResults = () => {
			const q = search.value.toLowerCase().trim(); results.innerHTML = "";
			if (!loaded || q.length < 2) { results.style.display = "none"; return; }
			const rank = (n) => n === q ? 0 : n.startsWith(q) ? 1 : 2;
			const matches = monsters.filter(m => m.name.toLowerCase().includes(q)).sort((a, b) => (rank(a.name.toLowerCase()) - rank(b.name.toLowerCase())) || SortUtil.ascSortLower(a.name, b.name)).slice(0, 40);
			results.style.display = matches.length ? "block" : "none";
			matches.forEach(m => {
				const row = el("div", {class: "vtt-mon-row"});
				row.append(el("span", {class: "vtt-mon-row__name"}, m.name), el("span", {class: "vtt-mon-row__meta"}, `CR ${Parser.monCrToFull ? Parser.monCrToFull(m.cr) : (m.cr?.cr ?? m.cr ?? "?")} · ${m.source}`));
				row.onclick = () => { this._addMonsterToken(m, {rollHp: rollHp.checked, rollInit: rollInit.checked}); };
				results.appendChild(row);
			});
		};
		const doLoad = async () => {
			if (loaded || this._monLoading) return; this._monLoading = true; status.textContent = "Loading bestiary…";
			try { monsters = await this._loadBestiary(); loaded = true; status.textContent = `${monsters.length} creatures — click to drop a token.`; } catch (e) { status.textContent = "Bestiary failed to load."; console.error(e); }
			this._monLoading = false; renderResults();
		};
		search.onfocus = doLoad; search.oninput = () => { doLoad(); renderResults(); };
		sec.append(el("div", {class: "vtt-row"}, search), status, el("div", {class: "vtt-row"}, wrapCb(rollHp, "Roll HP"), wrapCb(rollInit, "Roll initiative")), results);
		return sec;
	}

	async _loadBestiary () {
		await ExcludeUtil.pInitialise().catch(() => {});
		const all = await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY);
		const hb = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY];
		return all.filter(m => !m._isCopy && !ExcludeUtil.isExcluded(hb(m), "monster", m.source)).sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}

	_avgFromFormula (f) { const m = /(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(`${f || ""}`); if (!m) return null; const mod = m[3] ? +m[3].replace(/\s/g, "") : 0; return Math.max(1, Math.floor(+m[1] * (+m[2] + 1) / 2 + mod)); }
	_rollFormula (f, fallback) { const m = /(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(`${f || ""}`); if (!m) return fallback; const mod = m[3] ? +m[3].replace(/\s/g, "") : 0; let t = mod; for (let i = 0; i < +m[1]; i++) t += 1 + Math.floor(Math.random() * +m[2]); return Math.max(1, t); }

	_addMonsterToken (mon, opts = {}) {
		const sizeAbv = Array.isArray(mon.size) ? mon.size[0] : mon.size;
		const ft = VttBoard._SIZE_FEET[sizeAbv] || 5;
		const avg = mon.hp?.average ?? this._avgFromFormula(mon.hp?.formula) ?? 10;
		const hp = opts.rollHp ? this._rollFormula(mon.hp?.formula, avg) : avg;
		const dexMod = Math.floor((((mon.dex ?? 10)) - 10) / 2);
		const init = opts.rollInit ? 1 + Math.floor(Math.random() * 20) + dexMod : null;
		let img = null; try { if (Renderer.monster.hasToken(mon)) img = Renderer.monster.getTokenUrl(mon); } catch (e) { /* no token */ }
		this._addToken({name: mon.name, ft, hp, maxHp: hp, init, img, color: "#8a4b3b", square: ft >= 15});
	}

	/* ---------- sidebar: Selected token ---------- */
	_secSelected () {
		const sec = el("div", {class: "vtt-sec vtt-selpanel", id: "vtt-selpanel"});
		this._els.selPanel = sec;
		this._renderSelPanel();
		return sec;
	}

	_renderSelPanel () {
		const sec = this._els.selPanel; if (!sec) return;
		sec.innerHTML = "";
		sec.appendChild(el("h4", {}, "Selected Token"));
		const t = this._tokenById(this._selId);
		if (!t) { sec.appendChild(el("div", {class: "vtt-mini"}, "Click a token to edit it. Drag to move; Delete key removes it.")); return; }
		const mk = (label, inp) => el("div", {class: "vtt-row"}, lbl(label), inp);
		const name = el("input", {type: "text", class: "ve-form-control ve-input-xs", value: t.name || ""});
		name.oninput = () => { t.name = name.value; this._renderToken(t); this._renderInitiative(); this._save(); this._netPush(); };
		const hp = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: t.hp ?? "", style: "width:64px"});
		const maxhp = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: t.maxHp ?? "", style: "width:64px"});
		hp.oninput = () => { t.hp = hp.value === "" ? null : +hp.value; this._renderToken(t); this._renderInitiative(); this._save(); this._netPush(); };
		maxhp.oninput = () => { t.maxHp = maxhp.value === "" ? null : +maxhp.value; this._renderToken(t); this._renderInitiative(); this._save(); this._netPush(); };
		const init = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: t.init ?? "", style: "width:64px"});
		init.oninput = () => { t.init = init.value === "" ? null : +init.value; this._renderToken(t); this._renderInitiative(); this._save(); this._netPush(); };
		const size = el("select", {class: "ve-form-control ve-input-xs", style: "width:auto"});
		[["2.5", "Tiny (2.5 ft)"], ["5", "Medium (5 ft)"], ["10", "Large (10 ft)"], ["15", "Huge (15 ft)"], ["20", "Gargantuan (20 ft)"]].forEach(([v, txt]) => { const o = el("option", {value: v}, txt); if (+v === this._tokFt(t)) o.selected = true; size.appendChild(o); });
		size.onchange = () => { t.ft = +size.value; this._snapToken(t); this._renderToken(t); this._save(); this._netPush(); };
		const img = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Token image URL (optional)", value: t.img || ""});
		img.oninput = () => { t.img = img.value.trim() || null; this._renderToken(t); this._save(); this._netPush(); };
		const square = el("input", {type: "checkbox"}); square.checked = !!t.square;
		square.onchange = () => { t.square = square.checked; this._renderToken(t); this._save(); this._netPush(); };

		// color swatches
		const sw = el("div", {class: "vtt-swatches"});
		VttBoard._SWATCHES.forEach(c => { const s = el("div", {class: "vtt-swatch" + (c === t.color ? " vtt-swatch--sel" : ""), style: `background:${c}`}); s.onclick = () => { t.color = c; this._renderToken(t); this._renderSelPanel(); this._renderInitiative(); this._save(); this._netPush(); }; sw.appendChild(s); });

		// quick damage / heal
		const dmgAmt = el("input", {type: "number", class: "ve-form-control ve-input-xs", placeholder: "amt"});
		const bDmg = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "Damage");
		const bHeal = el("button", {class: "ve-btn ve-btn-xs ve-btn-success"}, "Heal");
		const doDmg = () => { if (dmgAmt.value !== "") { this._applyDamage(t, dmgAmt.value); dmgAmt.value = ""; } };
		const doHeal = () => { if (dmgAmt.value !== "") { this._applyHeal(t, dmgAmt.value); dmgAmt.value = ""; } };
		bDmg.onclick = doDmg; bHeal.onclick = doHeal; dmgAmt.onkeydown = (ev) => { if (ev.key === "Enter") doDmg(); };
		// temp HP
		const temp = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: t.temp || 0, style: "width:64px"});
		temp.oninput = () => { t.temp = Math.max(0, +temp.value || 0); this._renderToken(t); this._save(); this._netPush(); };
		// conditions
		const condGrid = el("div", {class: "vtt-cond-grid"});
		VttBoard._CONDITIONS.forEach(cd => { const on = (t.conditions || []).includes(cd.k); const chip = el("div", {class: "vtt-cond-chip" + (on ? " vtt-cond-chip--on" : ""), title: cd.k}, cd.ab); if (on) chip.style.background = cd.c; chip.onclick = () => this._toggleCondition(t, cd.k); condGrid.appendChild(chip); });
		// duplicate / lock / delete
		const dup = el("button", {class: "ve-btn ve-btn-xs ve-btn-default", title: "Ctrl+D"}, "⧉ Duplicate");
		dup.onclick = () => this._duplicateToken(t);
		const lock = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, t.locked ? "🔓 Unlock" : "🔒 Lock");
		lock.onclick = () => this._toggleLock(t);
		const del = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "Delete");
		del.onclick = () => this._removeToken(t.id);

		sec.append(
			mk("Name", name),
			el("div", {class: "vtt-row vtt-dmg-row"}, dmgAmt, bDmg, bHeal),
			mk("HP", hp), mk("Max HP", maxhp), mk("Temp", temp), mk("Init", init),
			mk("Size", size),
			mk("Image", img),
			el("div", {class: "vtt-row"}, wrapCb(square, "Square token")),
			el("div", {class: "vtt-row"}, sw),
			el("div", {class: "vtt-mini ve-mt-1"}, "Conditions"), condGrid,
			el("div", {class: "vtt-row ve-mt-1"}, dup, lock, del),
		);
	}

	/* ---------- sidebar: Selected AoE ---------- */
	_secAoe () { const sec = el("div", {class: "vtt-sec vtt-selpanel", id: "vtt-aoepanel"}); sec.style.display = "none"; this._els.aoePanel = sec; return sec; }

	/* ---------- sidebar: Initiative ---------- */
	_secInitiative () {
		const sec = el("div", {class: "vtt-sec"});
		const h = el("h4", {}, "Initiative");
		const btnRoll = el("button", {class: "ve-btn ve-btn-xxs ve-btn-default", title: "Roll d20 initiative for every token without one"}, "Roll");
		btnRoll.onclick = () => this._rollInitiativeAll();
		h.appendChild(btnRoll);
		sec.appendChild(h);
		const list = el("div", {id: "vtt-init-list"}); this._els.initList = list;
		sec.appendChild(list);
		const ctrl = el("div", {class: "vtt-row ve-mt-1"});
		const prev = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "‹ Prev");
		const next = el("button", {class: "ve-btn ve-btn-xs ve-btn-primary"}, "Next ›");
		const roundLbl = el("span", {class: "vtt-mini", id: "vtt-round"});
		this._els.roundLbl = roundLbl;
		prev.onclick = () => this._advanceTurn(-1);
		next.onclick = () => this._advanceTurn(1);
		ctrl.append(prev, next, roundLbl);
		sec.appendChild(ctrl);
		return sec;
	}

	/* ---------- sidebar: Drawing ---------- */
	_secDraw () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Drawing & Pings"));
		const colors = ["#ffd54a", "#ff5252", "#69f0ae", "#40c4ff", "#ffffff", "#111111"];
		const sw = el("div", {class: "vtt-swatches"});
		colors.forEach(c => { const s = el("div", {class: "vtt-swatch" + (c === this._drawColor ? " vtt-swatch--sel" : ""), style: `background:${c}`}); s.onclick = () => { this._drawColor = c; [...sw.children].forEach(x => x.classList.remove("vtt-swatch--sel")); s.classList.add("vtt-swatch--sel"); }; sw.appendChild(s); });
		const width = el("input", {type: "range", min: "1", max: "20", value: this._drawWidth, style: "width:110px"});
		width.oninput = () => { this._drawWidth = +width.value; };
		const clear = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "Clear drawings");
		clear.onclick = () => { if (this._scene.drawings.length) { this._pushUndo(); this._scene.drawings = []; this._renderDrawings(); this._save(); this._netPush(); } };
		sec.append(el("div", {class: "vtt-mini"}, "Toggle ✎ Draw then drag. Double-click empty map to ping a spot."), el("div", {class: "vtt-row"}, sw), el("div", {class: "vtt-row"}, lbl("Width"), width), el("div", {class: "vtt-row"}, clear));
		return sec;
	}

	/* ---------- sidebar: Fog of war ---------- */
	_secFog () { const sec = el("div", {class: "vtt-sec", id: "vtt-fogpanel"}); this._els.fogPanel = sec; this._renderFogPanel(); return sec; }
	_renderFogPanel () {
		const sec = this._els.fogPanel; if (!sec) return; sec.innerHTML = ""; const f = this._scene.fog;
		sec.appendChild(el("h4", {}, "Fog of War"));
		const on = el("input", {type: "checkbox"}); on.checked = !!f.on;
		on.onchange = () => { this._pushUndo(); f.on = on.checked; this._renderFog(); this._save(); this._netPush(); };
		const brush = el("input", {type: "range", min: "0", max: "6", value: this._fogBrush, style: "width:100px"});
		brush.oninput = () => { this._fogBrush = +brush.value; };
		const reveal = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Reveal all");
		const cover = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Cover all");
		reveal.onclick = () => { this._pushUndo(); f.base = "revealed"; f.cells = []; this._renderFog(); this._save(); this._netPush(); };
		cover.onclick = () => { this._pushUndo(); f.base = "covered"; f.cells = []; this._renderFog(); this._save(); this._netPush(); };
		sec.append(
			el("div", {class: "vtt-row"}, wrapCb(on, "Fog enabled"), el("span", {class: "vtt-mini"}, f.on && this._fogMode ? "(painting)" : "")),
			el("div", {class: "vtt-mini"}, "Click 🌫 Fog, then drag to reveal · Shift-drag to hide."),
			el("div", {class: "vtt-row"}, lbl("Brush"), brush),
			el("div", {class: "vtt-row"}, reveal, cover),
		);
	}

	/* ---------- sidebar: Dice ---------- */
	_secDice () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Dice"));
		const tray = el("div", {class: "vtt-dice-tray"});
		["d4", "d6", "d8", "d10", "d12", "d20", "d100"].forEach(d => { const b = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, d); b.onclick = () => this._roll(`1${d}`); tray.appendChild(b); });
		sec.appendChild(tray);
		const inp = el("input", {type: "text", class: "ve-form-control ve-input-xs ve-mt-1", placeholder: "e.g. 2d6+3, then Enter"});
		inp.onkeydown = (e) => { if (e.key === "Enter" && inp.value.trim()) { this._roll(inp.value.trim()); inp.select(); } };
		sec.appendChild(inp);
		return sec;
	}

	/* ---------- sidebar: Library (saved encounters + token presets) ---------- */
	static _LS_ENC = "vtt_encounters_v1";
	static _LS_TOK = "vtt_tokenlib_v1";
	_lsGet (k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
	_lsSet (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

	_secLibrary () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Library"));
		// encounters
		sec.appendChild(el("div", {class: "vtt-mini ve-bold"}, "Saved encounters"));
		const name = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Encounter name"});
		const save = el("button", {class: "ve-btn ve-btn-xs ve-btn-primary"}, "Save");
		save.onclick = () => { const n = name.value.trim() || `Encounter ${new Date().toLocaleString()}`; this._saveEncounter(n); name.value = ""; this._renderLibrary(); toast(`Saved "${n.qq ? n.qq() : n}".`, "success"); };
		name.onkeydown = (e) => { if (e.key === "Enter") save.onclick(); };
		const encList = el("div", {id: "vtt-enc-list"}); this._els.encList = encList;
		sec.append(el("div", {class: "vtt-row"}, name, save), encList);
		// token presets
		sec.appendChild(el("div", {class: "vtt-mini ve-bold ve-mt-2"}, "Token presets"));
		const tpSave = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Save selected token");
		tpSave.onclick = () => { const t = this._tokenById(this._selId); if (!t) return toast("Select a token first.", "info"); const n = prompt("Preset name:", t.name || "Token"); if (n == null) return; this._saveTokenPreset((n.trim() || t.name || "Token"), t); this._renderLibrary(); };
		const tpList = el("div", {id: "vtt-tp-list", class: "vtt-tp-list"}); this._els.tpList = tpList;
		sec.append(el("div", {class: "vtt-row"}, tpSave), tpList);
		this._renderLibrary();
		return sec;
	}

	_saveEncounter (n) { const arr = this._lsGet(VttBoard._LS_ENC).filter(e => e.name !== n); arr.push({name: n, ts: Date.now(), scene: JSON.parse(JSON.stringify(this._scene))}); this._lsSet(VttBoard._LS_ENC, arr); }
	_loadEncounter (n) {
		const e = this._lsGet(VttBoard._LS_ENC).find(x => x.name === n); if (!e) return;
		this._pushUndo();
		this._scene = {...this._defaultScene(), ...e.scene}; this._selId = null; this._selAoeId = null;
		this._tokEls.forEach(el => el.remove()); this._tokEls.clear(); this._aoeEls?.forEach(g => g.remove()); this._aoeEls?.clear();
		this._renderAll(); this._save(); this._netPush(); toast(`Loaded "${n}".`, "info");
	}
	_deleteEncounter (n) { this._lsSet(VttBoard._LS_ENC, this._lsGet(VttBoard._LS_ENC).filter(x => x.name !== n)); this._renderLibrary(); }
	_saveTokenPreset (n, t) { const arr = this._lsGet(VttBoard._LS_TOK).filter(p => p.name !== n); const {id, x, y, init, ...rest} = t; arr.push({name: n, token: rest}); this._lsSet(VttBoard._LS_TOK, arr); }
	_deleteTokenPreset (n) { this._lsSet(VttBoard._LS_TOK, this._lsGet(VttBoard._LS_TOK).filter(p => p.name !== n)); this._renderLibrary(); }
	_dropPreset (p) { const tok = (typeof structuredClone === "function") ? structuredClone(p.token) : JSON.parse(JSON.stringify(p.token)); delete tok.id; this._addToken(tok); }

	_renderLibrary () {
		if (!this._els.encList) return;
		const enc = this._lsGet(VttBoard._LS_ENC).sort((a, b) => b.ts - a.ts);
		this._els.encList.innerHTML = "";
		if (!enc.length) this._els.encList.appendChild(el("div", {class: "vtt-mini"}, "None saved yet."));
		enc.forEach(e => { const row = el("div", {class: "vtt-lib-row"}); const load = el("button", {class: "ve-btn ve-btn-xxs ve-btn-default"}, "Load"); load.onclick = () => this._loadEncounter(e.name); const del = el("button", {class: "ve-btn ve-btn-xxs ve-btn-danger"}, "✕"); del.onclick = () => { if (confirm(`Delete encounter "${e.name}"?`)) this._deleteEncounter(e.name); }; row.append(el("span", {class: "vtt-lib-row__name", title: e.name}, e.name), load, del); this._els.encList.appendChild(row); });
		const tp = this._lsGet(VttBoard._LS_TOK);
		this._els.tpList.innerHTML = "";
		if (!tp.length) this._els.tpList.appendChild(el("div", {class: "vtt-mini"}, "Save tokens (e.g. your PCs) to drop them again later."));
		tp.forEach(p => { const chip = el("div", {class: "vtt-tp-chip", title: "Click to drop on the board"}); chip.style.background = p.token.color || "#888"; if (p.token.img) { const im = el("img", {src: p.token.img, class: "vtt-tp-chip__img"}); im.onerror = () => im.remove(); chip.appendChild(im); } chip.append(el("span", {class: "vtt-tp-chip__name"}, p.name)); const x = el("span", {class: "vtt-tp-x", title: "Delete preset"}, "✕"); x.onclick = (ev) => { ev.stopPropagation(); this._deleteTokenPreset(p.name); }; chip.appendChild(x); chip.onclick = () => this._dropPreset(p); this._els.tpList.appendChild(chip); });
	}

	/* ---------- sidebar: Scene save/load ---------- */
	_secScene () {
		const sec = el("div", {class: "vtt-sec"});
		sec.appendChild(el("h4", {}, "Scene"));
		const exp = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Export");
		const imp = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "Import");
		const neu = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "New");
		const file = el("input", {type: "file", accept: "application/json,.json", style: "display:none"});
		exp.onclick = () => downloadJson("vtt-scene.json", this._scene);
		imp.onclick = () => file.click();
		file.onchange = () => { const f = file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { this._scene = {...this._defaultScene(), ...JSON.parse(r.result)}; this._selId = null; this._renderAll(); this._save(); } catch (e) { toast("Invalid scene file.", "danger"); } }; r.readAsText(f); };
		neu.onclick = () => { if (!confirm("Clear the whole scene (map + tokens)?")) return; this._scene = this._defaultScene(); this._selId = null; this._renderAll(); this._save(); };
		sec.append(el("div", {class: "vtt-row"}, exp, imp, neu, file), el("div", {class: "vtt-mini"}, "Auto-saves to this browser. Export to share a scene file."));
		return sec;
	}

	/* ============================ rendering ============================ */
	_renderAll () { this._renderMap(); this._renderGrid(); this._renderAoes(); this._renderDrawings(); this._renderTokens(); this._renderFog(); this._renderInitiative(); this._renderSelPanel(); this._renderAoePanel(); this._renderFogPanel(); this._syncMapInputs(); this._applyView(); }
	// refresh the Map & Grid inputs from the live scene (after undo / load encounter / import swaps this._scene)
	_syncMapInputs () { const g = this._scene.grid; const E = this._els; if (E.gridCell) E.gridCell.value = g.cell; if (E.gridFeet) E.gridFeet.value = g.feet; if (E.gridShow) E.gridShow.checked = !!g.show; if (E.gridSnap) E.gridSnap.checked = !!g.snap; if (E.gridOffX) E.gridOffX.value = g.offsetX || 0; if (E.gridOffY) E.gridOffY.value = g.offsetY || 0; }

	_worldSize () {
		const m = this._scene.map; const cell = this._scene.grid.cell;
		const w = m ? m.w : 50 * cell; const h = m ? m.h : 50 * cell;
		return {w: Math.max(w, 20 * cell), h: Math.max(h, 20 * cell)};
	}

	_renderMap () {
		const m = this._scene.map; const img = this._els.imgMap;
		if (!m) { img.style.display = "none"; this._renderGrid(); return; }
		img.src = m.src; img.style.display = ""; img.style.width = `${m.w}px`; img.style.height = `${m.h}px`;
		this._renderGrid();
	}

	_renderGrid () {
		const {w, h} = this._worldSize(); const g = this._scene.grid; const cv = this._els.cvGrid;
		cv.width = w; cv.height = h; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
		const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, w, h);
		// size the SVG overlay + AoE layer to match
		for (const s of [this._els.svg, this._els.svgAoe]) { s.setAttribute("width", w); s.setAttribute("height", h); s.setAttribute("viewBox", `0 0 ${w} ${h}`); }
		this._els.tokens.style.width = `${w}px`; this._els.tokens.style.height = `${h}px`;
		this._renderDrawings();
		if (!g.show) return;
		ctx.strokeStyle = g.color; ctx.lineWidth = 1;
		ctx.beginPath();
		const ox = (((g.offsetX || 0) % g.cell) + g.cell) % g.cell, oy = (((g.offsetY || 0) % g.cell) + g.cell) % g.cell;
		for (let x = ox; x <= w; x += g.cell) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
		for (let y = oy; y <= h; y += g.cell) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
		ctx.stroke();
	}

	_renderTokens () { this._scene.tokens.forEach(t => this._renderToken(t)); this._cleanupTokenEls(); }
	// a token's footprint side in FEET (migrating old cell-based tokens: 1 cell ≈ 5 ft), and that in pixels for the current grid
	_tokFt (t) { return t.ft != null ? t.ft : (t.w || 1) * 5; }
	_tokenSidePx (t) { return this._tokFt(t) / this._scene.grid.feet * this._scene.grid.cell; }

	_renderToken (t) {
		let e = this._tokEls.get(t.id);
		if (!e) {
			e = el("div", {class: "vtt-token"});
			e.dataset.id = t.id;
			this._tokEls.set(t.id, e);
			this._els.tokens.appendChild(e);
			this._bindToken(e, t);
		}
		const px = this._tokenSidePx(t);
		e.style.left = `${t.x}px`; e.style.top = `${t.y}px`; e.style.width = `${px}px`; e.style.height = `${px}px`;
		e.style.background = t.color || "#888";
		e.classList.toggle("vtt-token--square", !!t.square);
		e.classList.toggle("vtt-token--sel", t.id === this._selId);
		e.classList.toggle("vtt-token--active", this._activeTokenId() === t.id);
		e.classList.toggle("vtt-token--dead", this._isDead(t));
		e.classList.toggle("vtt-token--bloodied", this._isBloodied(t));
		e.innerHTML = "";
		if (t.img) { const im = el("img", {class: "vtt-token__img", src: t.img, draggable: false}); im.onerror = () => { im.remove(); if (!e.querySelector(".vtt-token__initletter")) e.insertBefore(el("div", {class: "vtt-token__initletter"}, (t.name || "?").slice(0, 2)), e.firstChild); }; e.appendChild(im); }
		else e.appendChild(el("div", {class: "vtt-token__initletter"}, (t.name || "?").slice(0, 2)));
		if (t.name) e.appendChild(el("div", {class: "vtt-token__name"}, t.name));
		if (t.maxHp) {
			const wrap = el("div", {class: "vtt-token__hpwrap" + (t.temp > 0 ? " vtt-token__hpwrap--temp" : "")});
			const bar = el("div", {class: "vtt-token__hpbar"}); const frac = Math.max(0, Math.min(1, (t.hp ?? t.maxHp) / t.maxHp));
			bar.style.width = `${frac * 100}%`; bar.style.background = frac > 0.5 ? "#4caf50" : frac > 0.25 ? "#ff9800" : "#f44336";
			wrap.appendChild(bar); e.appendChild(wrap);
		}
		if (t.init != null) e.appendChild(el("div", {class: "vtt-token__init-badge"}, `${t.init}`));
		if (t.locked) e.appendChild(el("div", {class: "vtt-token__lock", title: "Locked"}, "🔒"));
		if (t.conditions?.length) { const cw = el("div", {class: "vtt-token__conds"}); t.conditions.forEach(k => { const cd = VttBoard._CONDITIONS.find(c => c.k === k); const d = el("div", {class: "vtt-cond-dot", title: k}, cd ? cd.ab : k.slice(0, 3)); d.style.background = cd ? cd.c : "#666"; cw.appendChild(d); }); e.appendChild(cw); }
		const ix = this._scene.tokens.indexOf(t); e.style.zIndex = `${10 + (ix < 0 ? 0 : ix)}`;
	}

	_cleanupTokenEls () { const ids = new Set(this._scene.tokens.map(t => t.id)); for (const [id, e] of this._tokEls) { if (!ids.has(id)) { e.remove(); this._tokEls.delete(id); } } }

	_renderInitiative () {
		const list = this._els.initList; if (!list) return;
		list.innerHTML = "";
		const ordered = [...this._scene.tokens].filter(t => t.init != null).sort((a, b) => b.init - a.init || (a.name || "").localeCompare(b.name || ""));
		this._scene.turn.order = ordered.map(t => t.id);
		if (!ordered.length) { list.appendChild(el("div", {class: "vtt-mini"}, "No initiative yet. Set Init on tokens or click Roll.")); }
		const activeId = this._activeTokenId();
		ordered.forEach(t => {
			const dead = this._isDead(t);
			const row = el("div", {class: "vtt-init-row" + (t.id === activeId ? " vtt-init-row--active" : "")});
			const conds = el("div", {class: "vtt-init-row__conds"});
			(t.conditions || []).forEach(k => { const cd = VttBoard._CONDITIONS.find(c => c.k === k); const d = el("div", {class: "vtt-cond-dot", title: k}, cd ? cd.ab : k.slice(0, 3)); d.style.background = cd ? cd.c : "#666"; conds.appendChild(d); });
			row.append(
				el("div", {class: "vtt-init-row__swatch", style: `background:${t.color || "#888"}`}),
				el("div", {class: "vtt-init-row__name", style: dead ? "text-decoration:line-through;opacity:.6" : ""}, `${dead ? "☠ " : ""}${t.name || "(token)"}`),
				conds,
				el("div", {class: "vtt-init-row__hp"}, t.maxHp ? `${t.hp ?? t.maxHp}/${t.maxHp}${t.temp ? ` +${t.temp}` : ""}` : ""),
				el("div", {class: "vtt-init-row__init"}, `${t.init}`),
			);
			row.onclick = () => { this._select(t.id); this._centerOn(t); };
			list.appendChild(row);
		});
		if (this._els.roundLbl) this._els.roundLbl.textContent = ordered.length ? `Round ${this._scene.turn.round}` : "";
	}

	/* ============================ pan / zoom ============================ */
	_applyView () {
		const v = this._scene.view;
		this._els.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
		if (this._els.zoomread) this._els.zoomread.textContent = `${Math.round(v.scale * 100)}%`;
	}

	_screenToWorld (sx, sy) { const r = this._els.board.getBoundingClientRect(); const v = this._scene.view; return {x: (sx - r.left - v.x) / v.scale, y: (sy - r.top - v.y) / v.scale}; }

	_bindBoard () {
		const board = this._els.board;
		board.addEventListener("dragstart", (e) => e.preventDefault()); // stop the browser's native image drag-and-drop when panning over the map/tokens
		// pan with left-drag on empty space; Alt-drag (or measure mode) = ruler
		board.addEventListener("pointerdown", (e) => {
			if (e.target.closest(".vtt-token") || e.target.closest(".vtt-toolbar") || e.target.closest(".vtt-aoe-g")) return;
			if (e.button === 2) return;
			if (this._fogMode) return this._startFog(e);
			if (this._drawMode) return this._startDraw(e);
			if (this._measureMode || e.altKey) return this._startMeasure(e);
			this._panning = {sx: e.clientX, sy: e.clientY, ox: this._scene.view.x, oy: this._scene.view.y};
			board.classList.add("vtt-board--panning"); board.setPointerCapture(e.pointerId);
		});
		board.addEventListener("pointermove", (e) => {
			if (this._fogging) return this._moveFog(e);
			if (this._drawing) return this._moveDraw(e);
			if (this._measuring) return this._moveMeasure(e);
			if (!this._panning) return;
			this._scene.view.x = this._panning.ox + (e.clientX - this._panning.sx);
			this._scene.view.y = this._panning.oy + (e.clientY - this._panning.sy);
			this._applyView();
		});
		const endPan = (e) => { if (this._fogging) return this._endFog(); if (this._drawing) return this._endDraw(); if (this._measuring) return this._endMeasure(); if (this._panning) { this._panning = null; board.classList.remove("vtt-board--panning"); this._save(); } };
		board.addEventListener("pointerup", endPan);
		board.addEventListener("pointercancel", endPan);
		// double-click empty board → ping a spot (attention marker)
		board.addEventListener("dblclick", (e) => { if (e.target.closest(".vtt-token") || e.target.closest(".vtt-aoe-g") || e.target.closest(".vtt-toolbar")) return; const wp = this._screenToWorld(e.clientX, e.clientY); this._ping(wp.x, wp.y); });
		// zoom to cursor
		board.addEventListener("wheel", (e) => {
			e.preventDefault();
			const v = this._scene.view; const r = board.getBoundingClientRect();
			const mx = e.clientX - r.left, my = e.clientY - r.top;
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			const ns = Math.max(0.15, Math.min(5, v.scale * factor));
			const k = ns / v.scale;
			v.x = mx - (mx - v.x) * k; v.y = my - (my - v.y) * k; v.scale = ns;
			this._applyView(); this._saveThrottled();
		}, {passive: false});
		// deselect on empty click
		board.addEventListener("click", (e) => { if (!e.target.closest(".vtt-token") && !e.target.closest(".vtt-toolbar") && !e.target.closest(".vtt-aoe-g")) { this._select(null); this._selectAoe(null); } });
		// keyboard
		document.addEventListener("keydown", (e) => {
			const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !inField) { e.preventDefault(); return this._doUndo(); }
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && this._selId && !inField) { e.preventDefault(); const t = this._tokenById(this._selId); if (t) this._duplicateToken(t); return; }
			if (inField) return;
			if (e.key === "Escape") { this._closeContextMenu(); this._selectAoe(null); }
			if (e.key === "Delete" || e.key === "Backspace") { if (this._selAoeId) { e.preventDefault(); this._removeAoe(this._selAoeId); } else if (this._selId) { e.preventDefault(); this._removeToken(this._selId); } }
		});
	}

	/* ============================ token interaction ============================ */
	_bindToken (e, t) {
		e.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); this._select(t.id); this._showContextMenu(ev.clientX, ev.clientY, t); });
		e.addEventListener("pointerdown", (ev) => {
			if (ev.button === 2) return; // right-click → context menu
			ev.stopPropagation();
			this._select(t.id);
			if (t.locked) return; // locked tokens don't drag
			const start = this._screenToWorld(ev.clientX, ev.clientY);
			this._drag = {id: t.id, dx: start.x - t.x, dy: start.y - t.y, moved: false};
			e.classList.add("vtt-token--dragging"); e.setPointerCapture(ev.pointerId);
		});
		e.addEventListener("pointermove", (ev) => {
			if (!this._drag || this._drag.id !== t.id) return;
			if (!this._drag.moved) this._pushUndo(); // snapshot once, at the start of a real move
			const w = this._screenToWorld(ev.clientX, ev.clientY);
			t.x = w.x - this._drag.dx; t.y = w.y - this._drag.dy; this._drag.moved = true;
			e.style.left = `${t.x}px`; e.style.top = `${t.y}px`;
			this._netPushThrottled();
		});
		const end = (ev) => {
			if (!this._drag || this._drag.id !== t.id) return;
			e.classList.remove("vtt-token--dragging");
			if (this._drag.moved) { this._snapToken(t); this._renderToken(t); this._save(); this._netPush(); }
			this._drag = null;
		};
		e.addEventListener("pointerup", end);
		e.addEventListener("pointercancel", end);
		e.addEventListener("dblclick", (ev) => { ev.stopPropagation(); this._select(t.id); this._els.selPanel.scrollIntoView({block: "nearest"}); });
	}

	/* ---------- right-click context menu ---------- */
	_showContextMenu (sx, sy, t) {
		this._closeContextMenu();
		const menu = el("div", {class: "vtt-ctx"});
		const item = (label, fn, {danger = false, sub = ""} = {}) => { const it = el("div", {class: "vtt-ctx__item" + (danger ? " vtt-ctx__item--danger" : "")}); it.append(el("span", {}, label), sub ? el("span", {class: "vtt-ctx__sub"}, sub) : el("span")); it.onclick = () => { this._closeContextMenu(); fn(); }; menu.appendChild(it); return it; };
		const sep = () => menu.appendChild(el("div", {class: "vtt-ctx__sep"}));
		item("💥 Damage…", () => { const n = prompt(`Damage ${t.name || "token"}:`, "0"); if (n != null) this._applyDamage(t, n); }, {sub: "right-panel too"});
		item("➕ Heal…", () => { const n = prompt(`Heal ${t.name || "token"}:`, "0"); if (n != null) this._applyHeal(t, n); });
		item("🛡 Temp HP…", () => { const n = prompt(`Temp HP for ${t.name || "token"}:`, `${t.temp || 0}`); if (n != null) this._setTemp(t, n); });
		sep();
		item("⧉ Duplicate", () => this._duplicateToken(t), {sub: "Ctrl+D"});
		item(t.locked ? "🔓 Unlock" : "🔒 Lock", () => this._toggleLock(t));
		item("⬆ Bring to front", () => this._bringToFront(t));
		item("⬇ Send to back", () => this._sendToBack(t));
		sep();
		item("🗑 Delete", () => this._removeToken(t.id), {danger: true, sub: "Del"});
		document.body.appendChild(menu);
		// keep on-screen
		const r = menu.getBoundingClientRect();
		menu.style.left = `${Math.min(sx, window.innerWidth - r.width - 6)}px`;
		menu.style.top = `${Math.min(sy, window.innerHeight - r.height - 6)}px`;
		this._ctxMenu = menu;
		const onDocDown = (ev) => { if (!menu.contains(ev.target)) this._closeContextMenu(); }; // close only on OUTSIDE click (item clicks close themselves)
		setTimeout(() => document.addEventListener("pointerdown", onDocDown), 0);
		this._ctxCloser = () => document.removeEventListener("pointerdown", onDocDown);
	}
	_closeContextMenu () { this._ctxCloser?.(); this._ctxCloser = null; if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; } }

	_snapToken (t) { if (!this._scene.grid.snap) return; const g = this._scene.grid, c = g.cell, ox = g.offsetX || 0, oy = g.offsetY || 0; t.x = Math.round((t.x - ox) / c) * c + ox; t.y = Math.round((t.y - oy) / c) * c + oy; }

	/* ============================ AoE templates ============================ */
	static _AOE_DEFAULTS = {circle: {size: 20}, cone: {size: 15}, line: {size: 100, width: 5}, cube: {size: 15}}; // 5e defaults (ft)
	_ftToPx (ft) { return ft / this._scene.grid.feet * this._scene.grid.cell; }

	_addAoe (type) {
		this._pushUndo();
		const r = this._els.board.getBoundingClientRect();
		const center = this._screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
		const def = VttBoard._AOE_DEFAULTS[type] || {size: 15};
		const a = {id: `a${Date.now().toString(36)}${this._uid++}`, type, x: center.x, y: center.y, size: def.size, width: def.width || 5, rot: 0, color: "#e6394633"};
		this._scene.aoes.push(a); this._renderAoe(a); this._selectAoe(a.id); this._save(); this._netPush();
		return a;
	}
	_removeAoe (id) { this._pushUndo(); this._scene.aoes = this._scene.aoes.filter(a => a.id !== id); const g = this._aoeEls?.get(id); if (g) { g.remove(); this._aoeEls.delete(id); } if (this._selAoeId === id) this._selectAoe(null); this._save(); this._netPush(); }
	_aoeById (id) { return this._scene.aoes.find(a => a.id === id); }

	_renderAoes () { this._aoeEls = this._aoeEls || new Map(); (this._scene.aoes || []).forEach(a => this._renderAoe(a)); const ids = new Set((this._scene.aoes || []).map(a => a.id)); for (const [id, g] of this._aoeEls) { if (!ids.has(id)) { g.remove(); this._aoeEls.delete(id); } } }

	// local-coords shape geometry (origin at 0,0, pointing +x)
	_aoeShapePoints (a) {
		const L = this._ftToPx(a.size);
		switch (a.type) {
			case "circle": return {tag: "circle", attrs: {cx: 0, cy: 0, r: L}, reach: L};
			case "cube": { const s = L; return {tag: "rect", attrs: {x: -s / 2, y: -s / 2, width: s, height: s}, reach: s / 2}; }
			case "cone": return {tag: "polygon", attrs: {points: `0,0 ${L},${-L / 2} ${L},${L / 2}`}, reach: L};
			case "line": { const w = this._ftToPx(a.width || 5); return {tag: "polygon", attrs: {points: `0,${-w / 2} ${L},${-w / 2} ${L},${w / 2} 0,${w / 2}`}, reach: L}; }
			default: return {tag: "circle", attrs: {cx: 0, cy: 0, r: L}, reach: L};
		}
	}

	_renderAoe (a) {
		let g = this._aoeEls.get(a.id);
		if (!g) { g = svgEl("g", {class: "vtt-aoe-g"}); this._aoeEls.set(a.id, g); this._els.svgAoe.appendChild(g); this._bindAoe(g, a); }
		g.setAttribute("transform", `translate(${a.x} ${a.y}) rotate(${a.rot})`);
		g.innerHTML = "";
		const shp = this._aoeShapePoints(a);
		const fill = a.color || "#e6394633";
		const stroke = (a.color || "#e63946").slice(0, 7);
		const sh = svgEl(shp.tag, {...shp.attrs, fill, stroke, "stroke-width": this._selAoeId === a.id ? 3 : 2, "stroke-dasharray": this._selAoeId === a.id ? "6 4" : "none", class: "vtt-aoe-shape"});
		g.appendChild(sh);
		// rotation handle (cone/line/cube)
		if (a.type !== "circle") {
			const hd = shp.reach + 16;
			g.appendChild(svgEl("line", {x1: 0, y1: 0, x2: hd, y2: 0, stroke: stroke, "stroke-width": 1, "stroke-dasharray": "3 3", "pointer-events": "none"}));
			const handle = svgEl("circle", {cx: hd, cy: 0, r: 7, fill: stroke, class: "vtt-aoe-handle"});
			handle.dataset.role = "rot"; g.appendChild(handle);
		}
		// size label
		const lab = svgEl("text", {x: 0, y: -shp.reach - 6, fill: "#fff", "font-size": 13, "text-anchor": "middle", "paint-order": "stroke", stroke: "#000", "stroke-width": 3, "pointer-events": "none", transform: `rotate(${-a.rot})`});
		lab.textContent = a.type === "line" ? `${a.size} ft line` : a.type === "circle" ? `${a.size} ft radius` : `${a.size} ft`;
		g.appendChild(lab);
	}

	_bindAoe (g, a) {
		g.addEventListener("pointerdown", (ev) => {
			ev.stopPropagation(); this._selectAoe(a.id);
			const isRot = ev.target.dataset?.role === "rot";
			const start = this._screenToWorld(ev.clientX, ev.clientY);
			this._aoeDrag = {id: a.id, rot: isRot, dx: start.x - a.x, dy: start.y - a.y, moved: false};
			g.setPointerCapture(ev.pointerId);
		});
		g.addEventListener("pointermove", (ev) => {
			if (!this._aoeDrag || this._aoeDrag.id !== a.id) return;
			if (!this._aoeDrag.moved) { this._pushUndo(); this._aoeDrag.moved = true; }
			const w = this._screenToWorld(ev.clientX, ev.clientY);
			if (this._aoeDrag.rot) { a.rot = Math.round(Math.atan2(w.y - a.y, w.x - a.x) * 180 / Math.PI); }
			else { a.x = w.x - this._aoeDrag.dx; a.y = w.y - this._aoeDrag.dy; }
			this._renderAoe(a); this._netPushThrottled();
		});
		const end = () => { if (this._aoeDrag?.id === a.id) { if (this._aoeDrag.moved) { this._save(); this._netPush(); } this._aoeDrag = null; } };
		g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
	}

	_selectAoe (id) { this._selAoeId = id; if (id) this._select(null); (this._scene.aoes || []).forEach(a => this._renderAoe(a)); this._renderAoePanel(); }

	_renderAoePanel () {
		const sec = this._els.aoePanel; if (!sec) return;
		sec.innerHTML = ""; sec.appendChild(el("h4", {}, "Selected AoE"));
		const a = this._aoeById(this._selAoeId);
		if (!a) { sec.style.display = "none"; return; }
		sec.style.display = "";
		const mk = (label, inp) => el("div", {class: "vtt-row"}, lbl(label), inp);
		const size = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: a.size, min: "1", style: "width:64px"});
		size.oninput = () => { a.size = Math.max(1, +size.value || 5); this._renderAoe(a); this._save(); this._netPush(); };
		const rot = el("input", {type: "number", class: "ve-form-control ve-input-xs", value: a.rot, style: "width:64px"});
		rot.oninput = () => { a.rot = +rot.value || 0; this._renderAoe(a); this._save(); this._netPush(); };
		const colors = ["#e63946", "#2a9d8f", "#457b9d", "#9b5de5", "#f4a261", "#ffd54a"];
		const sw = el("div", {class: "vtt-swatches"});
		colors.forEach(c => { const on = (a.color || "").startsWith(c); const s = el("div", {class: "vtt-swatch" + (on ? " vtt-swatch--sel" : ""), style: `background:${c}`}); s.onclick = () => { a.color = c + "33"; this._renderAoe(a); this._renderAoePanel(); this._save(); this._netPush(); }; sw.appendChild(s); });
		const del = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "Delete AoE");
		del.onclick = () => this._removeAoe(a.id);
		sec.append(el("div", {class: "vtt-mini"}, `${a.type} • drag to move${a.type !== "circle" ? ", drag the dot to rotate" : ""}`), mk(a.type === "line" ? "Length ft" : a.type === "circle" ? "Radius ft" : "Size ft", size), a.type === "circle" ? el("span") : mk("Rotation°", rot), el("div", {class: "vtt-row"}, sw), el("div", {class: "vtt-row"}, del));
	}

	/* ============================ drawing & pings ============================ */
	_renderDrawings () {
		const cv = this._els.cvDraw; if (!cv) return; const {w, h} = this._worldSize();
		if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
		const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, w, h); ctx.lineCap = "round"; ctx.lineJoin = "round";
		(this._scene.drawings || []).forEach(d => { if (!d.pts?.length) return; ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(d.pts[0][0], d.pts[0][1]); if (d.pts.length === 1) ctx.lineTo(d.pts[0][0] + 0.1, d.pts[0][1]); for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i][0], d.pts[i][1]); ctx.stroke(); });
	}
	_startDraw (e) { this._pushUndo(); const wp = this._screenToWorld(e.clientX, e.clientY); this._curStroke = {color: this._drawColor, width: this._drawWidth, pts: [[wp.x, wp.y]]}; this._scene.drawings.push(this._curStroke); this._drawing = true; this._els.board.setPointerCapture(e.pointerId); }
	_moveDraw (e) { if (!this._curStroke) return; const wp = this._screenToWorld(e.clientX, e.clientY); this._curStroke.pts.push([wp.x, wp.y]); this._renderDrawings(); this._netPushThrottled(); }
	_endDraw () { this._drawing = false; if (this._curStroke) { if (this._curStroke.pts.length < 2) this._scene.drawings.pop(); this._curStroke = null; this._save(); this._netPush(); } }

	_ping (x, y) {
		const svg = this._els.svg;
		const g = svgEl("g", {});
		[0, 0.18].forEach(delay => {
			const c = svgEl("circle", {cx: x, cy: y, r: 6, fill: "none", stroke: "#ffd54a", "stroke-width": 4});
			c.appendChild(svgEl("animate", {attributeName: "r", from: 6, to: 64, dur: "0.85s", begin: `${delay}s`, fill: "freeze"}));
			c.appendChild(svgEl("animate", {attributeName: "opacity", from: 1, to: 0, dur: "0.85s", begin: `${delay}s`, fill: "freeze"}));
			g.appendChild(c);
		});
		svg.appendChild(g); setTimeout(() => g.remove(), 1300);
		this._netPing?.(x, y);
	}

	/* ============================ fog of war ============================ */
	_renderFog () {
		const cv = this._els.cvFog; if (!cv) return; const {w, h} = this._worldSize();
		if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
		const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, w, h);
		const f = this._scene.fog; if (!f?.on) return;
		const c = this._scene.grid.cell;
		ctx.fillStyle = this._fogMode ? "rgba(8,10,16,.5)" : "rgba(8,10,16,.62)"; // DM sees through dimly; lighter while painting
		if (f.base === "covered") {
			ctx.fillRect(0, 0, w, h); // everything fogged…
			(f.cells || []).forEach(k => { const [cc, cr] = k.split(",").map(Number); ctx.clearRect(cc * c, cr * c, c, c); }); // …except revealed cells
		} else {
			(f.cells || []).forEach(k => { const [cc, cr] = k.split(",").map(Number); ctx.fillRect(cc * c, cr * c, c, c); }); // base revealed: only fog the exception cells
		}
	}
	_fogPaintAt (sx, sy, hide) {
		const wp = this._screenToWorld(sx, sy); const c = this._scene.grid.cell;
		const cc = Math.floor(wp.x / c), cr = Math.floor(wp.y / c); const rad = this._fogBrush;
		const set = new Set(this._scene.fog.cells); const reveal = !hide;
		for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
			const key = `${cc + dc},${cr + dr}`;
			// exceptions flip the base: covered base → exceptions are revealed; revealed base → exceptions are hidden
			const addException = this._scene.fog.base === "covered" ? reveal : hide;
			if (addException) set.add(key); else set.delete(key);
		}
		this._scene.fog.cells = [...set]; this._renderFog();
	}
	_startFog (e) { this._pushUndo(); this._fogging = true; this._fogHide = e.shiftKey; this._els.board.setPointerCapture(e.pointerId); this._fogPaintAt(e.clientX, e.clientY, this._fogHide); }
	_moveFog (e) { if (this._fogging) { this._fogPaintAt(e.clientX, e.clientY, this._fogHide); this._netPushThrottled(); } }
	_endFog () { if (this._fogging) { this._fogging = false; this._save(); this._netPush(); } }

	/* ============================ measurement ============================ */
	_startMeasure (e) { const w = this._screenToWorld(e.clientX, e.clientY); this._measuring = {x0: w.x, y0: w.y}; this._els.board.setPointerCapture(e.pointerId); }
	_moveMeasure (e) {
		const w = this._screenToWorld(e.clientX, e.clientY); const m = this._measuring; const c = this._scene.grid.cell;
		const cellsX = Math.abs(w.x - m.x0) / c, cellsY = Math.abs(w.y - m.y0) / c;
		const feet = Math.round(Math.max(cellsX, cellsY)) * this._scene.grid.feet; // 5e: diagonals count as 5 ft
		const svg = this._els.svg; svg.innerHTML = "";
		svg.appendChild(svgEl("line", {x1: m.x0, y1: m.y0, x2: w.x, y2: w.y, stroke: "#ffd54a", "stroke-width": 3, "stroke-dasharray": "8 6"}));
		svg.appendChild(svgEl("circle", {cx: w.x, cy: w.y, r: 5, fill: "#ffd54a"}));
		const tx = svgEl("text", {x: (m.x0 + w.x) / 2, y: (m.y0 + w.y) / 2 - 8, fill: "#fff", "font-size": 18, "font-weight": "bold", "text-anchor": "middle", "paint-order": "stroke", stroke: "#000", "stroke-width": 4}); tx.textContent = `${feet} ft`;
		svg.appendChild(tx);
	}
	_endMeasure () { this._measuring = null; setTimeout(() => { this._els.svg.innerHTML = ""; }, 900); }

	/* ============================ tokens CRUD ============================ */
	_addToken (props = {}) {
		const c = this._scene.grid.cell; const v = this._scene.view; const r = this._els.board.getBoundingClientRect();
		// place at the center of the current view, snapped
		const center = this._screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
		this._pushUndo();
		const t = Object.assign({
			id: `t${Date.now().toString(36)}${this._uid++}`,
			x: Math.round(center.x / c) * c, y: Math.round(center.y / c) * c,
			ft: 5, name: "", color: VttBoard._SWATCHES[this._scene.tokens.length % VttBoard._SWATCHES.length],
			img: null, hp: null, maxHp: null, temp: 0, init: null, square: false, conditions: [], locked: false,
		}, props);
		this._scene.tokens.push(t); this._renderToken(t); this._select(t.id); this._renderInitiative(); this._save(); this._netPush();
		return t;
	}

	_addTokenInteractive () {
		const name = prompt("Token name (optional):", "") ?? "";
		const t = this._addToken({name: name.trim()});
		this._els.selPanel.scrollIntoView({block: "nearest"});
		return t;
	}

	_removeToken (id) {
		this._pushUndo();
		this._scene.tokens = this._scene.tokens.filter(t => t.id !== id);
		const e = this._tokEls.get(id); if (e) { e.remove(); this._tokEls.delete(id); }
		if (this._selId === id) this._select(null);
		this._renderInitiative(); this._save(); this._netPush();
	}

	// spawn a copy one cell down-right, auto-numbering the name (Goblin → Goblin 2, 3…)
	_duplicateToken (t) {
		this._pushUndo();
		const c = this._scene.grid.cell;
		const base = (t.name || "").replace(/\s+\d+$/, "").trim();
		let n = 2; if (base) { const used = this._scene.tokens.map(x => x.name); while (used.includes(`${base} ${n}`)) n++; }
		const copy = {...structuredClone(t), id: `t${Date.now().toString(36)}${this._uid++}`, x: t.x + c, y: t.y + c, name: base ? `${base} ${n}` : t.name, init: null};
		this._scene.tokens.push(copy); this._renderToken(copy); this._select(copy.id); this._renderInitiative(); this._save(); this._netPush();
		return copy;
	}

	_isDead (t) { return t.maxHp != null && (t.hp ?? t.maxHp) <= 0; }
	_isBloodied (t) { return t.maxHp != null && (t.hp ?? t.maxHp) > 0 && (t.hp ?? t.maxHp) <= t.maxHp / 2; }

	// apply damage: temp HP soaks first; floats a number over the token
	_applyDamage (t, amt) {
		amt = Math.abs(+amt || 0); if (!amt) return; this._pushUndo();
		let rem = amt;
		if (t.temp > 0) { const soak = Math.min(t.temp, rem); t.temp -= soak; rem -= soak; }
		if (t.hp == null) t.hp = t.maxHp ?? 0;
		t.hp = Math.max(t.maxHp != null ? -t.maxHp : -999, t.hp - rem);
		this._floatNum(t, `-${amt}`, "#ff5252"); this._afterTokenStat(t);
	}
	_applyHeal (t, amt) {
		amt = Math.abs(+amt || 0); if (!amt) return; this._pushUndo();
		if (t.hp == null) t.hp = 0;
		t.hp = t.maxHp != null ? Math.min(t.maxHp, t.hp + amt) : t.hp + amt;
		this._floatNum(t, `+${amt}`, "#69f0ae"); this._afterTokenStat(t);
	}
	_setTemp (t, amt) { this._pushUndo(); t.temp = Math.max(0, +amt || 0); this._afterTokenStat(t); }
	_afterTokenStat (t) { this._renderToken(t); this._renderInitiative(); this._renderSelPanel(); this._save(); this._netPush(); }

	_floatNum (t, txt, color) {
		const e = this._tokEls.get(t.id); if (!e) return;
		const f = el("div", {class: "vtt-floatnum"}, txt); f.style.color = color;
		f.style.left = "50%"; f.style.top = "0";
		e.appendChild(f); setTimeout(() => f.remove(), 1000);
	}

	_toggleCondition (t, k) {
		this._pushUndo();
		t.conditions = t.conditions || [];
		const i = t.conditions.indexOf(k);
		if (i >= 0) t.conditions.splice(i, 1); else t.conditions.push(k);
		this._renderToken(t); this._renderInitiative(); this._renderSelPanel(); this._save(); this._netPush();
	}

	_toggleLock (t) { this._pushUndo(); t.locked = !t.locked; this._renderToken(t); this._renderSelPanel(); this._save(); this._netPush(); }
	_bringToFront (t) { this._pushUndo(); this._scene.tokens = this._scene.tokens.filter(x => x.id !== t.id).concat(t); this._renderTokensZ(); this._save(); this._netPush(); }
	_sendToBack (t) { this._pushUndo(); this._scene.tokens = [t, ...this._scene.tokens.filter(x => x.id !== t.id)]; this._renderTokensZ(); this._save(); this._netPush(); }
	_renderTokensZ () { this._scene.tokens.forEach((t, i) => { const e = this._tokEls.get(t.id); if (e) e.style.zIndex = `${10 + i}`; }); }

	/* ---------- undo ---------- */
	_pushUndo () { try { this._undo.push(JSON.stringify(this._scene)); if (this._undo.length > VttBoard._UNDO_MAX) this._undo.shift(); } catch (e) {} }
	_doUndo () { const snap = this._undo.pop(); if (!snap) return toast("Nothing to undo.", "info"); try { this._scene = JSON.parse(snap); this._selId = null; this._selAoeId = null; this._tokEls.forEach(e => e.remove()); this._tokEls.clear(); this._aoeEls?.forEach(g => g.remove()); this._aoeEls?.clear(); this._renderAll(); this._save(); this._netPush(); } catch (e) {} }

	_select (id) { this._selId = id; if (id && this._selAoeId) { this._selAoeId = null; (this._scene.aoes || []).forEach(a => this._renderAoe(a)); this._renderAoePanel(); } this._scene.tokens.forEach(t => { const e = this._tokEls.get(t.id); if (e) e.classList.toggle("vtt-token--sel", t.id === id); }); this._renderSelPanel(); }

	_tokenById (id) { return this._scene.tokens.find(t => t.id === id); }

	_centerOn (t) { const r = this._els.board.getBoundingClientRect(); const v = this._scene.view; const px = this._tokenSidePx(t); v.x = r.width / 2 - (t.x + px / 2) * v.scale; v.y = r.height / 2 - (t.y + px / 2) * v.scale; this._applyView(); this._save(); }

	/* ============================ initiative / turns ============================ */
	_activeTokenId () { const o = this._scene.turn.order; const ix = this._scene.turn.ix; return ix >= 0 && ix < o.length ? o[ix] : null; }
	_rollInitiativeAll () { this._scene.tokens.forEach(t => { if (t.init == null) t.init = 1 + Math.floor(Math.random() * 20); }); this._scene.turn.ix = -1; this._scene.turn.round = 1; this._renderTokens(); this._renderInitiative(); this._save(); this._netPush(); }
	_advanceTurn (dir) {
		const o = this._scene.turn.order; if (!o.length) return;
		let ix = this._scene.turn.ix + dir;
		if (ix >= o.length) { ix = 0; this._scene.turn.round++; }
		else if (ix < 0) { ix = o.length - 1; this._scene.turn.round = Math.max(1, this._scene.turn.round - 1); }
		this._scene.turn.ix = ix;
		this._renderTokens(); this._renderInitiative();
		const t = this._tokenById(this._activeTokenId()); if (t) this._centerOn(t);
		this._save(); this._netPush();
	}

	_fitMap () {
		const m = this._scene.map; if (!m) return; const r = this._els.board.getBoundingClientRect(); const v = this._scene.view;
		v.scale = Math.min(r.width / m.w, r.height / m.h) * 0.96;
		v.x = (r.width - m.w * v.scale) / 2; v.y = (r.height - m.h * v.scale) / 2;
		this._applyView(); this._save();
	}

	_setMap (src) {
		const im = new Image();
		im.onload = () => { this._scene.map = {src, w: im.naturalWidth, h: im.naturalHeight}; this._renderMap(); this._fitMap(); this._save(); this._netPush(); };
		im.onerror = () => toast("Couldn't load that image.", "danger");
		im.src = src;
	}

	/* ---------- browse maps from the 5etools adventures/books ---------- */
	async _openMapBrowser () {
		const backdrop = el("div", {class: "vtt-modal-backdrop"});
		const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
		const onKey = (e) => { if (e.key === "Escape") close(); };
		backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
		document.addEventListener("keydown", onKey);
		const btnX = el("button", {class: "ve-btn ve-btn-xs ve-btn-default"}, "✕"); btnX.onclick = close;
		const search = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Filter maps…", style: "max-width:240px"});
		const advSel = el("select", {class: "ve-form-control ve-input-xs", style: "max-width:280px"});
		const status = el("span", {class: "vtt-mini"}, "Loading map index…");
		const body = el("div", {class: "vtt-modal__body"});
		const modal = el("div", {class: "vtt-modal"},
			el("div", {class: "vtt-modal__head"}, el("h3", {}, "Load a map from the site"), btnX),
			el("div", {class: "vtt-modal__controls"}, search, advSel, status),
			body,
		);
		backdrop.appendChild(modal); document.body.appendChild(backdrop); search.focus();

		let maps = [];
		try { const data = await DataUtil.loadJSON(`${Renderer.get().baseUrl}data/generated/gendata-maps.json`); maps = this._flattenMaps(data); }
		catch (e) { status.textContent = "Couldn't load the map index."; console.error(e); return; }
		status.textContent = `${maps.length} maps`;
		const advs = [...new Set(maps.map(m => m.advName))].sort();
		advSel.appendChild(el("option", {value: ""}, `All (${advs.length} books)`));
		advs.forEach(a => advSel.appendChild(el("option", {value: a}, a)));

		const render = () => {
			const q = search.value.toLowerCase().trim(); const adv = advSel.value;
			const list = maps.filter(m => (!adv || m.advName === adv) && (!q || m.title.toLowerCase().includes(q) || m.advName.toLowerCase().includes(q))).slice(0, 400);
			body.innerHTML = "";
			if (!list.length) { body.appendChild(el("div", {class: "vtt-mini"}, "No maps match.")); return; }
			list.forEach(m => {
				const card = el("div", {class: "vtt-map-card", title: `${m.title} — ${m.advName}`});
				const thumb = el("img", {class: "vtt-map-card__img", loading: "lazy", src: Renderer.get().getMediaUrl("img", m.path)});
				thumb.onerror = () => thumb.replaceWith(el("div", {class: "vtt-map-card__noimg"}, "(no local preview)"));
				card.append(thumb, el("div", {class: "vtt-map-card__title"}, `${m.player ? "🧑 " : ""}${m.title}`), el("div", {class: "vtt-map-card__adv"}, `${m.advName} · ${m.width || "?"}×${m.height || "?"}`));
				card.onclick = () => { this._applyMapWithGrid(m); close(); };
				body.appendChild(card);
			});
		};
		search.oninput = render; advSel.onchange = render; render();
	}

	_flattenMaps (data) {
		const out = [];
		for (const key of Object.keys(data || {})) {
			const adv = data[key]; if (!adv || (adv.source && !SourceUtil.isClassicSource(adv.source))) continue; // 2014-only
			(adv.chapters || []).forEach(ch => (ch.images || []).forEach(im => {
				if (!["map", "mapPlayer"].includes(im.imageType)) return; const path = im.href?.path; if (!path) return;
				out.push({advName: adv.name || key, source: adv.source, title: im.title || ch.name || "Map", path, width: im.width, height: im.height, grid: im.grid, player: im.imageType === "mapPlayer"});
			}));
		}
		return out.sort((a, b) => a.advName.localeCompare(b.advName) || a.title.localeCompare(b.title));
	}

	// load a site map and, when it has a square printed grid, match the VTT grid to it (cell size + offset)
	_applyMapWithGrid (m) {
		this._pushUndo();
		this._setMap(Renderer.get().getMediaUrl("img", m.path));
		const g = m.grid;
		if (g && g.size && !/hex/i.test(g.type || "") && !/mile|yard/i.test(g.units || "")) {
			this._scene.grid.cell = Math.max(4, Math.round(g.size));
			this._scene.grid.offsetX = g.offsetX || 0; this._scene.grid.offsetY = g.offsetY || 0;
			if (typeof g.distance === "number" && g.distance > 0) this._scene.grid.feet = g.distance; // the map's real ft-per-square from 5etools' data (else keep the standard 5)
			this._syncMapInputs(); // refresh cell/feet/offset fields from the live grid
			this._renderGrid(); this._renderTokens(); this._save();
			toast(`Loaded "${m.title}" — matched its grid (${this._scene.grid.cell}px = ${this._scene.grid.feet} ft squares).`, "success");
		} else toast(`Loaded "${m.title}".`, "info");
	}

	/* ============================ dice ============================ */
	_roll (expr) {
		try {
			if (globalThis.Renderer?.dice?.pRollEntry) { Renderer.dice.pRollEntry({toRoll: expr}, {name: "Tabletop", label: expr}); return; }
		} catch (e) { /* fall through */ }
		// fallback: parse "NdM+K" and toast
		const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i.exec(expr.replace(/\s+/g, ""));
		if (!m) return toast(`Couldn't parse "${expr}".`, "warning");
		const n = +(m[1] || 1), faces = +m[2], mod = m[3] ? +m[3].replace(/\s/g, "") : 0;
		let total = mod; const rolls = []; for (let i = 0; i < n; i++) { const r = 1 + Math.floor(Math.random() * faces); rolls.push(r); total += r; }
		toast(`${expr}: <b>${total}</b> (${rolls.join(", ")}${mod ? ` ${mod >= 0 ? "+" : ""}${mod}` : ""})`, "info");
	}

	/* ============================ persistence ============================ */
	_save () { try { localStorage.setItem(VttBoard._STORE_KEY, JSON.stringify(this._scene)); } catch (e) { /* quota */ } }
	_saveThrottled () { clearTimeout(this._saveT); this._saveT = setTimeout(() => this._save(), 250); }
	_load () { try { const raw = localStorage.getItem(VttBoard._STORE_KEY); if (raw) this._scene = {...this._defaultScene(), ...JSON.parse(raw)}; } catch (e) { /* ignore */ } }

	/* ============================ network hooks (Phase 2) ============================ */
	_netPush () { if (globalThis.VttNet?.pushScene) try { globalThis.VttNet.pushScene(this._scene); } catch (e) {} }
	_netPushThrottled () { if (!globalThis.VttNet?.pushScene) return; clearTimeout(this._netT); this._netT = setTimeout(() => this._netPush(), 60); }
	applyRemoteScene (scene) { this._scene = {...this._defaultScene(), ...scene}; this._renderAll(); this._save(); } // called by the net layer
}

/* ---------------- tiny DOM helpers ---------------- */
function el (tag, props = {}, ...children) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else if (k in e && k !== "list") { try { e[k] = v; } catch { e.setAttribute(k, v); } } else e.setAttribute(k, v); }
	for (const c of children.flat()) { if (c == null) continue; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
	return e;
}
function svgEl (tag, props) { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(props)) e.setAttribute(k, v); return e; }
function lbl (txt) { return el("span", {class: "vtt-mini"}, txt); }
function wrapCb (cb, txt) { const l = el("label", {style: "display:flex;align-items:center;gap:5px;cursor:pointer"}); l.append(cb, el("span", {class: "vtt-mini"}, txt)); return l; }
function downloadJson (name, obj) { const a = el("a", {href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, "\t")], {type: "application/json"})), download: name}); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function toast (content, type = "info") { if (globalThis.JqueryUtil?.doToast) JqueryUtil.doToast({content, type}); else console.log(content.replace(/<[^>]+>/g, "")); }

window.addEventListener("load", () => {
	const root = document.getElementById("vtt-root");
	if (!root) return;
	try { new VttBoard(root).init(); } catch (e) { root.innerHTML = `<div class="cb__err" style="padding:1em">Tabletop failed to start: ${e.message}<br><pre>${e.stack || ""}</pre></div>`; console.error(e); }
});
