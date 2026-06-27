"use strict";

/* Tabletop (VTT) — a lightweight, self-hosted virtual tabletop for the local fork.
 * Phase 1: client-side only (map + square grid + draggable HP-bar tokens + measurement +
 * initiative tracker + scene save/load + dice). Multiplayer sync is layered on in a later phase
 * via window.VttNet (see tools-local/vtt-server). All board state lives in `this.scene`. */
class VttBoard {
	static _STORE_KEY = "vtt_scene_v1";
	static _SWATCHES = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#f1c40f", "#7f8c8d", "#e84393", "#2c3e50"];
	static _SIZE_CELLS = {T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4}; // 5e creature size → token footprint in cells

	constructor (root) {
		this._root = root;
		this._scene = this._defaultScene();
		this._selId = null;
		this._uid = 0;
		this._els = {}; // cached DOM
		this._tokEls = new Map(); // tokenId → element
	}

	_defaultScene () {
		return {
			map: null, // {src, w, h}
			grid: {cell: 70, feet: 5, show: true, snap: true, color: "rgba(255,255,255,.16)"},
			view: {x: 40, y: 40, scale: 1},
			tokens: [],
			turn: {order: [], ix: -1, round: 1}, // initiative order = token ids
		};
	}

	/* ============================ init / DOM ============================ */
	init () {
		this._root.innerHTML = "";
		this._root.appendChild(this._buildBoard());
		this._root.appendChild(this._buildSidebar());
		this._load();
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
		const imgMap = el("img", {class: "vtt-map", alt: "", draggable: "false"}); this._els.imgMap = imgMap; imgMap.style.display = "none";
		const cvGrid = el("canvas", {class: "vtt-grid"}); this._els.cvGrid = cvGrid;
		const tokens = el("div", {class: "vtt-tokens"}); this._els.tokens = tokens;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "vtt-overlay"); this._els.svg = svg;
		world.append(imgMap, cvGrid, tokens, svg);
		board.append(world, this._buildToolbar(), el("div", {class: "vtt-zoomread", id: "vtt-zoomread"}));
		this._els.zoomread = board.querySelector("#vtt-zoomread");
		return board;
	}

	_buildToolbar () {
		const bar = el("div", {class: "vtt-toolbar no-print"});
		const btn = (txt, title, fn) => { const b = el("button", {class: "ve-btn ve-btn-xs ve-btn-default", title}, txt); b.onclick = fn; return b; };
		this._btnMeasure = btn("📏 Measure", "Toggle measure mode (or hold Alt and drag)", () => { this._measureMode = !this._measureMode; this._btnMeasure.classList.toggle("active", this._measureMode); this._els.board.classList.toggle("vtt-board--measuring", this._measureMode); });
		bar.append(
			btn("＋ Token", "Add a token at the view center", () => this._addTokenInteractive()),
			this._btnMeasure,
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
			this._secSelected(),
			this._secInitiative(),
			this._secDice(),
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
		sec.append(el("div", {class: "vtt-row"}, inpUrl), el("div", {class: "vtt-row"}, btnLoad, btnFile, btnClear, inpFile));

		// grid controls
		const g = this._scene.grid;
		const cell = el("input", {type: "number", class: "ve-form-control ve-input-xs", min: "10", max: "400", value: g.cell, style: "width:64px"});
		const feet = el("input", {type: "number", class: "ve-form-control ve-input-xs", min: "1", max: "100", value: g.feet, style: "width:54px"});
		const show = el("input", {type: "checkbox"}); show.checked = g.show;
		const snap = el("input", {type: "checkbox"}); snap.checked = g.snap;
		cell.oninput = () => { g.cell = Math.max(10, +cell.value || 70); this._renderGrid(); this._renderTokens(); this._save(); };
		feet.oninput = () => { g.feet = Math.max(1, +feet.value || 5); this._save(); };
		show.onchange = () => { g.show = show.checked; this._renderGrid(); this._save(); };
		snap.onchange = () => { g.snap = snap.checked; this._save(); };
		sec.append(
			el("div", {class: "vtt-row"}, lbl("Cell px"), cell, lbl("= ft"), feet),
			el("div", {class: "vtt-row"}, wrapCb(show, "Show grid"), wrapCb(snap, "Snap")),
		);
		return sec;
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
		[["0.5", "Tiny (½)"], ["1", "Med (1)"], ["2", "Large (2)"], ["3", "Huge (3)"], ["4", "Gargantuan (4)"]].forEach(([v, txt]) => { const o = el("option", {value: v}, txt); if (+v === t.w) o.selected = true; size.appendChild(o); });
		size.onchange = () => { t.w = t.h = +size.value; this._snapToken(t); this._renderToken(t); this._save(); this._netPush(); };
		const img = el("input", {type: "text", class: "ve-form-control ve-input-xs", placeholder: "Token image URL (optional)", value: t.img || ""});
		img.oninput = () => { t.img = img.value.trim() || null; this._renderToken(t); this._save(); this._netPush(); };
		const square = el("input", {type: "checkbox"}); square.checked = !!t.square;
		square.onchange = () => { t.square = square.checked; this._renderToken(t); this._save(); this._netPush(); };

		// color swatches
		const sw = el("div", {class: "vtt-swatches"});
		VttBoard._SWATCHES.forEach(c => { const s = el("div", {class: "vtt-swatch" + (c === t.color ? " vtt-swatch--sel" : ""), style: `background:${c}`}); s.onclick = () => { t.color = c; this._renderToken(t); this._renderSelPanel(); this._renderInitiative(); this._save(); this._netPush(); }; sw.appendChild(s); });

		const del = el("button", {class: "ve-btn ve-btn-xs ve-btn-danger"}, "Delete token");
		del.onclick = () => this._removeToken(t.id);
		sec.append(
			mk("Name", name),
			mk("HP", hp), mk("Max HP", maxhp), mk("Init", init),
			mk("Size", size),
			mk("Image", img),
			el("div", {class: "vtt-row"}, wrapCb(square, "Square token")),
			el("div", {class: "vtt-row"}, sw),
			el("div", {class: "vtt-row"}, del),
		);
	}

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
	_renderAll () { this._renderMap(); this._renderGrid(); this._renderTokens(); this._renderInitiative(); this._renderSelPanel(); this._applyView(); }

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
		// size the SVG overlay to match
		this._els.svg.setAttribute("width", w); this._els.svg.setAttribute("height", h); this._els.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
		this._els.tokens.style.width = `${w}px`; this._els.tokens.style.height = `${h}px`;
		if (!g.show) return;
		ctx.strokeStyle = g.color; ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0; x <= w; x += g.cell) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
		for (let y = 0; y <= h; y += g.cell) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
		ctx.stroke();
	}

	_renderTokens () { this._scene.tokens.forEach(t => this._renderToken(t)); this._cleanupTokenEls(); }

	_renderToken (t) {
		let e = this._tokEls.get(t.id);
		if (!e) {
			e = el("div", {class: "vtt-token"});
			e.dataset.id = t.id;
			this._tokEls.set(t.id, e);
			this._els.tokens.appendChild(e);
			this._bindToken(e, t);
		}
		const px = t.w * this._scene.grid.cell;
		e.style.left = `${t.x}px`; e.style.top = `${t.y}px`; e.style.width = `${px}px`; e.style.height = `${px}px`;
		e.style.background = t.color || "#888";
		e.classList.toggle("vtt-token--square", !!t.square);
		e.classList.toggle("vtt-token--sel", t.id === this._selId);
		e.classList.toggle("vtt-token--active", this._activeTokenId() === t.id);
		e.innerHTML = "";
		if (t.img) { const im = el("img", {class: "vtt-token__img", src: t.img, draggable: "false"}); e.appendChild(im); }
		else e.appendChild(el("div", {class: "vtt-token__initletter"}, (t.name || "?").slice(0, 2)));
		if (t.name) e.appendChild(el("div", {class: "vtt-token__name"}, t.name));
		if (t.maxHp) { const wrap = el("div", {class: "vtt-token__hpwrap"}); const bar = el("div", {class: "vtt-token__hpbar"}); const frac = Math.max(0, Math.min(1, (t.hp ?? t.maxHp) / t.maxHp)); bar.style.width = `${frac * 100}%`; bar.style.background = frac > 0.5 ? "#4caf50" : frac > 0.25 ? "#ff9800" : "#f44336"; wrap.appendChild(bar); e.appendChild(wrap); }
		if (t.init != null) e.appendChild(el("div", {class: "vtt-token__init-badge"}, `${t.init}`));
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
			const row = el("div", {class: "vtt-init-row" + (t.id === activeId ? " vtt-init-row--active" : "")});
			row.append(
				el("div", {class: "vtt-init-row__swatch", style: `background:${t.color || "#888"}`}),
				el("div", {class: "vtt-init-row__name"}, t.name || "(token)"),
				el("div", {class: "vtt-init-row__hp"}, t.maxHp ? `${t.hp ?? t.maxHp}/${t.maxHp}` : ""),
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
		// pan with left-drag on empty space; Alt-drag (or measure mode) = ruler
		board.addEventListener("pointerdown", (e) => {
			if (e.target.closest(".vtt-token") || e.target.closest(".vtt-toolbar")) return;
			if (this._measureMode || e.altKey) return this._startMeasure(e);
			this._panning = {sx: e.clientX, sy: e.clientY, ox: this._scene.view.x, oy: this._scene.view.y};
			board.classList.add("vtt-board--panning"); board.setPointerCapture(e.pointerId);
		});
		board.addEventListener("pointermove", (e) => {
			if (this._measuring) return this._moveMeasure(e);
			if (!this._panning) return;
			this._scene.view.x = this._panning.ox + (e.clientX - this._panning.sx);
			this._scene.view.y = this._panning.oy + (e.clientY - this._panning.sy);
			this._applyView();
		});
		const endPan = (e) => { if (this._measuring) return this._endMeasure(); if (this._panning) { this._panning = null; board.classList.remove("vtt-board--panning"); this._save(); } };
		board.addEventListener("pointerup", endPan);
		board.addEventListener("pointercancel", endPan);
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
		board.addEventListener("click", (e) => { if (!e.target.closest(".vtt-token") && !e.target.closest(".vtt-toolbar")) this._select(null); });
		// keyboard
		document.addEventListener("keydown", (e) => {
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
			if ((e.key === "Delete" || e.key === "Backspace") && this._selId) { e.preventDefault(); this._removeToken(this._selId); }
		});
	}

	/* ============================ token interaction ============================ */
	_bindToken (e, t) {
		e.addEventListener("pointerdown", (ev) => {
			ev.stopPropagation();
			this._select(t.id);
			const start = this._screenToWorld(ev.clientX, ev.clientY);
			this._drag = {id: t.id, dx: start.x - t.x, dy: start.y - t.y, moved: false};
			e.classList.add("vtt-token--dragging"); e.setPointerCapture(ev.pointerId);
		});
		e.addEventListener("pointermove", (ev) => {
			if (!this._drag || this._drag.id !== t.id) return;
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

	_snapToken (t) { if (!this._scene.grid.snap) return; const c = this._scene.grid.cell; t.x = Math.round(t.x / c) * c; t.y = Math.round(t.y / c) * c; }

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
		const t = Object.assign({
			id: `t${Date.now().toString(36)}${this._uid++}`,
			x: Math.round(center.x / c) * c, y: Math.round(center.y / c) * c,
			w: 1, h: 1, name: "", color: VttBoard._SWATCHES[this._scene.tokens.length % VttBoard._SWATCHES.length],
			img: null, hp: null, maxHp: null, init: null, square: false,
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
		this._scene.tokens = this._scene.tokens.filter(t => t.id !== id);
		const e = this._tokEls.get(id); if (e) { e.remove(); this._tokEls.delete(id); }
		if (this._selId === id) this._select(null);
		this._renderInitiative(); this._save(); this._netPush();
	}

	_select (id) { this._selId = id; this._scene.tokens.forEach(t => { const e = this._tokEls.get(t.id); if (e) e.classList.toggle("vtt-token--sel", t.id === id); }); this._renderSelPanel(); }

	_tokenById (id) { return this._scene.tokens.find(t => t.id === id); }

	_centerOn (t) { const r = this._els.board.getBoundingClientRect(); const v = this._scene.view; const px = t.w * this._scene.grid.cell; v.x = r.width / 2 - (t.x + px / 2) * v.scale; v.y = r.height / 2 - (t.y + px / 2) * v.scale; this._applyView(); this._save(); }

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
