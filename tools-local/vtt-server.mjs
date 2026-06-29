// Zero-dependency WebSocket relay for the Tabletop (VTT) multiplayer mode.
// Run alongside the static server:  npm run vtt   (or:  node tools-local/vtt-server.mjs)
// The DM hosts a room (gets a 4-char code); players open the same vtt.html and join by code.
// The server is a dumb relay + last-scene store: whoever pushes a scene/ping, everyone else in
// the room receives it. No deps (raw RFC6455), so nothing to install and nothing to clobber on sync.

import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";

const PORT = process.env.VTT_PORT ? +process.env.VTT_PORT : 5055;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const rooms = new Map(); // code -> { scene, clients:Set<socket> }

const genCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return rooms.has(s) ? genCode() : s; };

/* ---------------- RFC6455 framing ---------------- */
function decodeFrame (buf) {
	if (buf.length < 2) return null;
	const b1 = buf[1];
	const fin = (buf[0] & 0x80) !== 0;
	const opcode = buf[0] & 0x0f;
	const masked = (b1 & 0x80) !== 0;
	let len = b1 & 0x7f; let off = 2;
	if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
	else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
	let mask;
	if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
	if (buf.length < off + len) return null;
	let payload = Buffer.from(buf.subarray(off, off + len));
	if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
	return {fin, opcode, payload, rest: buf.subarray(off + len)};
}
function encodeFrame (data, opcode = 0x1) {
	const payload = typeof data === "string" ? Buffer.from(data, "utf8") : data;
	const len = payload.length; let header;
	if (len < 126) header = Buffer.from([0x80 | opcode, len]);
	else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
	else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
	return Buffer.concat([header, payload]);
}
const send = (socket, obj) => { try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* dead socket */ } };
const broadcastPeers = (code) => { const room = rooms.get(code); if (!room) return; for (const c of room.clients) send(c, {t: "peers", n: room.clients.size}); };

function leaveRoom (socket) {
	const code = socket._room; if (!code) return; const room = rooms.get(code); if (!room) return;
	room.clients.delete(socket); socket._room = null;
	if (!room.clients.size) rooms.delete(code); else broadcastPeers(code);
}

function handleMessage (socket, txt) {
	let m; try { m = JSON.parse(txt); } catch (e) { return; }
	switch (m.t) {
		case "host": { const code = genCode(); rooms.set(code, {scene: null, clients: new Set([socket])}); socket._room = code; send(socket, {t: "hosted", room: code}); break; }
		case "join": {
			const code = `${m.room || ""}`.toUpperCase().trim(); const room = rooms.get(code);
			if (!room) { send(socket, {t: "err", msg: `Room "${code}" not found — is the DM hosting?`}); break; }
			room.clients.add(socket); socket._room = code;
			send(socket, {t: "joined", room: code, scene: room.scene});
			broadcastPeers(code); break;
		}
		case "scene": { const room = rooms.get(socket._room); if (!room) break; room.scene = m.scene; for (const c of room.clients) if (c !== socket) send(c, {t: "scene", scene: m.scene}); break; }
		case "ping": { const room = rooms.get(socket._room); if (!room) break; for (const c of room.clients) if (c !== socket) send(c, {t: "ping", x: m.x, y: m.y}); break; }
		case "handout": { const room = rooms.get(socket._room); if (!room) break; for (const c of room.clients) if (c !== socket) send(c, {t: "handout", handout: m.handout}); break; }
	}
}

/* ---------------- server ---------------- */
const server = http.createServer((req, res) => {
	res.writeHead(200, {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"});
	res.end(`Tabletop VTT relay — ${rooms.size} room(s) active.`);
});

server.on("upgrade", (req, socket) => {
	const key = req.headers["sec-websocket-key"];
	if (!key) return socket.destroy();
	const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	socket._room = null; socket._txt = ""; let buf = Buffer.alloc(0);
	socket.on("data", (chunk) => {
		buf = Buffer.concat([buf, chunk]); let f;
		while ((f = decodeFrame(buf))) {
			buf = Buffer.from(f.rest);
			if (f.opcode === 0x8) { leaveRoom(socket); socket.end(); return; }
			else if (f.opcode === 0x9) socket.write(encodeFrame(f.payload, 0xA)); // ping -> pong
			else if (f.opcode === 0x1 || f.opcode === 0x0) { socket._txt += f.payload.toString("utf8"); if (f.fin) { const t = socket._txt; socket._txt = ""; handleMessage(socket, t); } }
		}
	});
	socket.on("error", () => leaveRoom(socket));
	socket.on("close", () => leaveRoom(socket));
});

server.listen(PORT, () => {
	const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
	console.log(`\n🎲 Tabletop VTT relay listening on port ${PORT}`);
	console.log(`   Players on your network join the game at:`);
	(ips.length ? ips : ["localhost"]).forEach(ip => console.log(`     http://${ip}:5050/vtt.html   (share a room code from the Multiplayer panel)`));
	console.log(`   (Keep this running while you play. Ctrl+C to stop.)\n`);
});
