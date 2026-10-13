// Dust Strike multiplayer server.
//   - Serves the game files over HTTP and accepts WebSocket connections on /ws (same port).
//   - Hosts any number of rooms (1v1 … 5v5, chosen bot count), each joined with a 4-letter code.
//   - Each room runs the authoritative simulation (src/core.js) at 60 ticks/s.
//   - Clients only send inputs; positions, hits, damage, money and the bomb are decided here.
//   - Each client receives only the enemies its team can actually see (anti-wallhack).
//   - Shots are lag-compensated: targets are rewound to what the shooter saw.
//
// Usage: npm install && npm start   (PORT=8080 by default)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, DT } from './room.js';
import * as P from '../src/net/protocol.js';
import { MAP_IDS, preloadMap } from '../src/map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 20;

// Maps built from 3D models are parsed and indexed once at startup.
for (const id of MAP_IDS) {
  await preloadMap(id, async (file) => {
    const b = fs.readFileSync(path.join(ROOT, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  });
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8',
};
const PUBLIC = ['index.html', 'style.css', 'src/', 'assets/'];

const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const CDN = 'https://unpkg.com/three@0.160.0/';

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch { res.writeHead(400).end(); return; }
  if (rel === '') rel = 'index.html';
  // Serve Three.js from node_modules so LAN games work without internet access.
  if (rel === 'index.html') {
    fs.readFile(path.join(ROOT, 'index.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(500).end(); return; }
      const body = html.split(CDN).join('/vendor/three/');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
    return;
  }
  if (rel.startsWith('vendor/three/')) {
    const file = path.resolve(THREE_DIR, rel.slice('vendor/three/'.length));
    if (!file.startsWith(THREE_DIR + path.sep) || !/\.js$/.test(file)) { res.writeHead(404).end('Not found'); return; }
    return sendFile(req, res, file);
  }
  const file = path.resolve(ROOT, rel);
  const allowed = file.startsWith(ROOT + path.sep) && PUBLIC.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p))) && !rel.split('/').some((s) => s.startsWith('.'));
  if (!allowed) { res.writeHead(404).end('Not found'); return; }
  sendFile(req, res, file);
}

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}

// ---------- lobby: rooms ----------

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(code)) return code;
  }
}

function createRoom({ teamSize, bots, diff, map }) {
  const size = Math.max(1, Math.min(5, teamSize | 0));
  const room = new Room({ code: newCode(), teamSize: size, bots: Math.max(0, Math.min(size * 2 - 1, bots | 0)), diff, map });
  rooms.set(room.code, room);
  console.log(`room ${room.code} created: ${room.map}, ${size}v${size}, up to ${room.maxBots} bot(s), ${room.diff}`);
  return room;
}

function roomList() {
  return [...rooms.values()].filter((r) => !r.isFull()).map((r) => r.info());
}

function joinRoom(c, room, name, team) {
  if (!room) { c.send(P.encodeKick('Room not found — check the code')); return; }
  if (room.isFull() || !room.join(c, name, team)) { c.send(P.encodeKick('That room is full')); return; }
  c.room = room;
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  room.leave(c);
  c.room = null;
  if (room.clients.size === 0) {
    rooms.delete(room.code);
    console.log(`room ${room.code} closed (empty)`);
  }
}

// Messages from a client that hasn't joined a room yet.
function lobbyHandle(c, buf) {
  let m;
  try { m = P.decodeClient(buf); } catch { return; }
  if (m.type === P.C2S.LIST) c.send(P.encodeRooms(roomList()));
  else if (m.type === P.C2S.PING) c.send(P.encodePong(m.t));
  else if (m.type === P.C2S.CREATE) {
    if (rooms.size >= MAX_ROOMS) { c.send(P.encodeKick('The server has too many rooms right now')); return; }
    joinRoom(c, createRoom(m), m.name, m.team);
  } else if (m.type === P.C2S.JOIN) {
    joinRoom(c, rooms.get(m.code.toUpperCase()), m.name, m.team);
  }
}

// ---------- boot ----------

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  ws.binaryType = 'arraybuffer';
  const c = { ws, room: null, player: null, inputs: [], lastInput: null, lastSeq: 0, lastQueuedSeq: 0, viewTime: NaN, events: [], strikes: 0, send: (b) => ws.readyState === 1 && ws.send(b) };
  let budget = 200; // messages per second, refilled every second
  const refill = setInterval(() => { budget = 200; }, 1000);
  ws.on('message', (data, isBinary) => {
    if (!isBinary || --budget < 0) return;
    if (c.room) c.room.handle(c, data); else lobbyHandle(c, data);
  });
  ws.on('close', () => { clearInterval(refill); leaveRoom(c); });
  ws.on('error', () => {});
  console.log(`connection from ${req.socket.remoteAddress}`);
});

let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + (now - last) / 1000, 0.25);
  last = now;
  while (acc >= DT) {
    for (const room of rooms.values()) room.tick();
    acc -= DT;
  }
}, 4);

server.listen(PORT, () => {
  console.log(`Dust Strike server on http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
  console.log('Friends on your network can join via http://<your-ip>:' + PORT);
});

