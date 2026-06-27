"use strict";

/* Client networking for the Tabletop (VTT). Talks to tools-local/vtt-server.mjs over a WebSocket.
 * The board calls VttNet.pushScene()/ping() via its _netPush/_netPing hooks; incoming scenes are
 * applied with board.applyRemoteScene(). DM hosts a room; players join by code. */
globalThis.VttNet = {
	_ws: null, _board: null, room: null, role: null, peers: 1, _suppress: false, _cb: null,

	port () { const u = new URL(location.href); return u.searchParams.get("vttport") || "5055"; },
	url () { return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname || "localhost"}:${this.port()}`; },
	connected () { return this._ws && this._ws.readyState === 1; },

	_connect (board, onOpen) {
		this._board = board;
		let ws; try { ws = new WebSocket(this.url()); } catch (e) { this._fail("Couldn't open a connection."); return; }
		this._ws = ws;
		ws.onopen = () => onOpen();
		ws.onmessage = (e) => this._onMessage(e.data);
		ws.onclose = () => { this.room = null; this.role = null; this._ws = null; board._netStatus?.(); };
		ws.onerror = () => this._fail(`Can't reach the VTT server at ${this.url()} — start it with “npm run vtt”.`);
	},
	_fail (msg) { this._board?._netError?.(msg); },
	_send (o) { try { this._ws.send(JSON.stringify(o)); } catch (e) {} },

	host (board, cb) { this._cb = cb; this.role = "dm"; this._connect(board, () => this._send({t: "host"})); },
	join (board, code, cb) { this._cb = cb; this.role = "player"; this._connect(board, () => this._send({t: "join", room: `${code}`.toUpperCase().trim(), role: "player"})); },
	leave () { try { this._ws?.close(); } catch (e) {} this._ws = null; this.room = null; this.role = null; this._board?._netStatus?.(); },

	// called by the board on local edits (board._netPush -> VttNet.pushScene)
	pushScene (scene) { if (this.connected() && this.room && !this._suppress) this._send({t: "scene", scene}); },
	ping (x, y) { if (this.connected() && this.room) this._send({t: "ping", x, y}); },

	_onMessage (data) {
		let m; try { m = JSON.parse(data); } catch (e) { return; }
		const board = this._board;
		switch (m.t) {
			case "hosted": this.room = m.room; this.role = "dm"; board._role = "dm"; this._cb?.({room: m.room, role: "dm"}); board._netStatus?.(); break;
			case "joined": {
				this.room = m.room; this.role = "player"; board._role = "player";
				if (m.scene) { this._suppress = true; board.applyRemoteScene(m.scene); this._suppress = false; }
				this._cb?.({room: m.room, role: "player"}); board._netStatus?.(); break;
			}
			case "scene": this._suppress = true; board.applyRemoteScene(m.scene); this._suppress = false; break;
			case "ping": board._ping(m.x, m.y, true); break;
			case "peers": this.peers = m.n; board._netStatus?.(); break;
			case "err": this._fail(m.msg); break;
		}
	},
};
