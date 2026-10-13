// Binary wire protocol shared by the browser client and the Node server.
// Every message is an ArrayBuffer: [u8 type][payload...], little-endian.
//
// Client -> server: JOIN, INPUT (60/s), CMD (buy/team), PING
// Server -> client: WELCOME, ROSTER, SNAPSHOT (20/s, per-client), EVENTS (per tick), PONG
//
// Note on security: binary encoding keeps packets small, but it is not what stops cheating.
// The server is authoritative — clients only send inputs, and the server validates everything.

export const C2S = { JOIN: 1, INPUT: 2, CMD: 3, PING: 4, LIST: 5, CREATE: 6 };
export const S2C = { WELCOME: 0x81, SNAPSHOT: 0x82, EVENTS: 0x83, ROSTER: 0x84, PONG: 0x85, KICK: 0x86, ROOMS: 0x87, ROOM: 0x88 };
export const DIFFS = ['easy', 'normal', 'hard'];
export const MAP_LIST = ['dust', 'outpost', 'dust2'];
const mapCode = (id) => Math.max(0, MAP_LIST.indexOf(id));
export const CMD = { BUY: 1, TEAM: 2 };

export const WEAPON_IDS = ['knife', 'glock', 'usp', 'deagle', 'mp5', 'ak47', 'm4a1', 'awp', 'c4', 'hegrenade', 'flashbang', 'smokegrenade',
  'p228', 'fiveseven', 'm3', 'xm1014', 'tmp', 'mac10', 'ump45', 'p90', 'galil', 'famas', 'sg552', 'aug', 'scout', 'g3sg1', 'sg550', 'm249'];
export const NADE_TYPES = ['he', 'flash', 'smoke'];
export const weaponCode = (id) => (id ? WEAPON_IDS.indexOf(id) + 1 : 0);
export const weaponName = (code) => (code ? WEAPON_IDS[code - 1] : null);
export const BUY_ITEMS = ['deagle', 'mp5', 'ak47', 'm4a1', 'awp', 'kevlar', 'helmet', 'defuse', 'hegrenade', 'flashbang', 'smokegrenade',
  'p228', 'fiveseven', 'm3', 'xm1014', 'tmp', 'mac10', 'ump45', 'p90', 'galil', 'famas', 'sg552', 'aug', 'scout', 'g3sg1', 'sg550', 'm249',
  'glock', 'usp', 'ammo1', 'ammo2'];
export const SOUNDS = ['step', 'land', 'dry', 'draw', 'zoom', 'reload', 'pickup', 'buy', 'plantTick', 'beep', 'throw', 'bounce'];
export const PHASES = ['freeze', 'live', 'post', 'over', 'warmup'];
export const BOMB_STATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
export const REGIONS = ['head', 'chest', 'stomach', 'legs'];
export const REASONS = ['elim', 'bomb', 'defuse', 'time'];
export const MELEE = ['air', 'wall', 'flesh'];
export const EV = {
  SHOT: 1, IMPACT: 2, BLOOD: 3, HURT: 4, HITMARK: 5, HELMET: 6, KILL: 7, EXPLOSION: 8, SOUND: 9,
  ANNOUNCE: 10, NOTIFY: 11, SAY: 12, ROUND_START: 13, ROUND_END: 14, MATCH_END: 15, MELEE: 16,
  NADE: 17, FLASHED: 18,
};

// Held buttons and one-frame edges in INPUT.
export const HELD = { KeyW: 0, KeyA: 1, KeyS: 2, KeyD: 3, KeyC: 4, ShiftLeft: 5, fire: 6, KeyE: 7 };
export const EDGE = { Space: 0, KeyR: 1, KeyG: 2, KeyQ: 3, Digit1: 4, Digit2: 5, Digit3: 6, fire2: 7, fire: 8, wheelUp: 9, wheelDown: 10, KeyE: 11, Digit4: 12 };

const enc = new TextEncoder(), dec = new TextDecoder();
const POS = 64; // position quantization: 1/64 m (~1.6 cm)
const TAU = Math.PI * 2;

export class Writer {
  constructor(size = 256) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.o = 0;
  }
  ensure(n) {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb;
    this.dv = new DataView(nb);
  }
  u8(v) { this.ensure(1); this.dv.setUint8(this.o, v); this.o += 1; return this; }
  i8(v) { this.ensure(1); this.dv.setInt8(this.o, Math.max(-127, Math.min(127, Math.round(v)))); this.o += 1; return this; }
  u16(v) { this.ensure(2); this.dv.setUint16(this.o, v, true); this.o += 2; return this; }
  i16(v) { this.ensure(2); this.dv.setInt16(this.o, Math.max(-32767, Math.min(32767, Math.round(v))), true); this.o += 2; return this; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; return this; }
  f32(v) { this.ensure(4); this.dv.setFloat32(this.o, v, true); this.o += 4; return this; }
  f64(v) { this.ensure(8); this.dv.setFloat64(this.o, v, true); this.o += 8; return this; }
  str(s) {
    const b = enc.encode(String(s)).slice(0, 255);
    this.u8(b.length);
    this.ensure(b.length);
    new Uint8Array(this.buf, this.o, b.length).set(b);
    this.o += b.length;
    return this;
  }
  pos(p) { return this.i16(p.x * POS).i16(p.y * POS).i16(p.z * POS); }
  vec(p) { return this.f32(p.x).f32(p.y).f32(p.z); }
  dir(p) { return this.i8(p.x * 127).i8(p.y * 127).i8(p.z * 127); }
  angle(a) { return this.u16(Math.round((((a % TAU) + TAU) % TAU) / TAU * 65535)); }
  done() { return this.buf.slice(0, this.o); }
}

export class Reader {
  constructor(buf) {
    this.dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    this.o = 0;
  }
  get left() { return this.dv.byteLength - this.o; }
  need(n) { if (this.o + n > this.dv.byteLength) throw new RangeError('truncated message'); }
  u8() { this.need(1); return this.dv.getUint8(this.o++); }
  i8() { this.need(1); return this.dv.getInt8(this.o++); }
  u16() { this.need(2); const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  str() {
    const n = this.u8();
    this.need(n);
    const s = dec.decode(new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.o, n));
    this.o += n;
    return s;
  }
  pos() { return { x: this.i16() / POS, y: this.i16() / POS, z: this.i16() / POS }; }
  vec() { return { x: this.f32(), y: this.f32(), z: this.f32() }; }
  dir() { return { x: this.i8() / 127, y: this.i8() / 127, z: this.i8() / 127 }; }
  angle() { return (this.u16() / 65535) * TAU; }
}

// ---------- client -> server ----------

const teamCode = (team) => (team === 'T' ? 1 : team === 'CT' ? 2 : 0);

export function encodeJoin(name, team, code) {
  return new Writer(48).u8(C2S.JOIN).u8(teamCode(team)).str(name.slice(0, 16)).str((code || '').toUpperCase().slice(0, 8)).done();
}

export function encodeCreate(name, team, teamSize, bots, diff, map) {
  return new Writer(48).u8(C2S.CREATE).u8(teamCode(team)).str(name.slice(0, 16)).u8(teamSize).u8(bots).u8(Math.max(0, DIFFS.indexOf(diff))).u8(mapCode(map)).done();
}

export function encodeList() {
  return new Writer(2).u8(C2S.LIST).done();
}

// inp: { seq, viewTime, held:Set, edges:Set, yaw, pitch }
export function encodeInput(inp) {
  let held = 0, edges = 0;
  for (const k of inp.held) if (k in HELD) held |= 1 << HELD[k];
  for (const k of inp.edges) if (k in EDGE) edges |= 1 << EDGE[k];
  return new Writer(24).u8(C2S.INPUT).u32(inp.seq).f32(inp.viewTime).u16(held).u16(edges).f32(inp.yaw).f32(inp.pitch).done();
}

export function encodeCmd(cmd, arg) {
  return new Writer(4).u8(C2S.CMD).u8(cmd).u8(arg).done();
}

export function encodePing(t) {
  return new Writer(10).u8(C2S.PING).f64(t).done();
}

// Turns a decoded INPUT into the object Player.update expects.
export function inputToPlayer(m) {
  const keys = {}, pressed = new Set();
  for (const [k, bit] of Object.entries(HELD)) if (m.held & (1 << bit)) keys[k] = true;
  for (const [k, bit] of Object.entries(EDGE)) if (m.edges & (1 << bit)) pressed.add(k);
  return {
    keys, pressed,
    fire: !!keys.fire, firePressed: pressed.has('fire'), fire2Pressed: pressed.has('fire2'),
    wheel: pressed.has('wheelDown') ? 1 : pressed.has('wheelUp') ? -1 : 0,
    yaw: m.yaw, pitch: m.pitch,
  };
}

export function decodeClient(buf) {
  const r = new Reader(buf);
  const type = r.u8();
  switch (type) {
    case C2S.JOIN: return { type, team: ['auto', 'T', 'CT'][r.u8()] || 'auto', name: r.str(), code: r.str() };
    case C2S.CREATE: return { type, team: ['auto', 'T', 'CT'][r.u8()] || 'auto', name: r.str(), teamSize: r.u8(), bots: r.u8(), diff: DIFFS[r.u8()] || 'normal', map: MAP_LIST[r.left ? r.u8() : 0] || 'dust' };
    case C2S.LIST: return { type };
    case C2S.INPUT: {
      const m = { type, seq: r.u32(), viewTime: r.f32(), held: r.u16(), edges: r.u16(), yaw: r.f32(), pitch: r.f32() };
      if (!Number.isFinite(m.yaw) || !Number.isFinite(m.pitch) || !Number.isFinite(m.viewTime)) throw new RangeError('bad input');
      return m;
    }
    case C2S.CMD: return { type, cmd: r.u8(), arg: r.u8() };
    case C2S.PING: return { type, t: r.f64() };
    default: throw new RangeError('unknown message ' + type);
  }
}

// ---------- server -> client ----------

export function encodeWelcome(id, tickRate) {
  return new Writer(8).u8(S2C.WELCOME).u8(id).u16(tickRate).done();
}

export function encodeRoster(actors, youId) {
  const w = new Writer(256).u8(S2C.ROSTER).u8(actors.length);
  for (const a of actors) w.u8(a.id).u8(a.team === 'T' ? 0 : 1).u8((a.isBot ? 1 : 0) | (a.id === youId ? 2 : 0)).str(a.name);
  return w.done();
}

export function encodePong(t) {
  return new Writer(10).u8(S2C.PONG).f64(t).done();
}

export function encodeKick(reason) {
  return new Writer(64).u8(S2C.KICK).str(reason).done();
}

// rooms: [{ code, teamSize, bots, humans, diff, playing, map, humansT, humansCT }]
export function encodeRooms(rooms) {
  const w = new Writer(256).u8(S2C.ROOMS).u8(Math.min(255, rooms.length));
  for (const r of rooms.slice(0, 255)) w.str(r.code).u8(r.teamSize).u8(r.bots).u8(r.humans).u8(DIFFS.indexOf(r.diff)).u8(r.playing ? 1 : 0).u8(mapCode(r.map)).u8(r.humansT).u8(r.humansCT);
  return w.done();
}

export function encodeRoom(r) {
  return new Writer(32).u8(S2C.ROOM).str(r.code).u8(r.teamSize).u8(r.bots).u8(DIFFS.indexOf(r.diff)).u8(mapCode(r.map)).done();
}

// s: { tick, time, phase, phaseT, roundT, round, score, buyLeft, bomb, actors:[...], scores:[...], items:[...], you }
export function encodeSnapshot(s) {
  const w = new Writer(1024).u8(S2C.SNAPSHOT).u32(s.tick).f32(s.time);
  w.u8(PHASES.indexOf(s.phase)).f32(s.phaseT).f32(s.roundT).u8(s.round).u8(s.score.T).u8(s.score.CT).f32(s.buyLeft);
  const b = s.bomb;
  w.u8(BOMB_STATES.indexOf(b.state)).u8(b.carrierId || 0).pos(b.pos).f32(b.timer).u8(b.defuserId || 0);
  w.u8(s.actors.length);
  for (const a of s.actors) {
    w.u8(a.id).u8(a.flags).pos(a.pos).angle(a.yaw).i16(a.pitch * 10000).i16(a.vx * 100).i16(a.vz * 100);
    w.u8(Math.round(a.crouch * 255)).u8(a.health).u8(a.armor).u8(a.weapon).u16(a.money);
  }
  w.u8(s.scores.length);
  for (const a of s.scores) w.u8(a.id).u8(a.kills).u8(a.deaths).u8(a.alive ? 1 : 0);
  w.u8(s.items.length);
  for (const it of s.items) w.u16(it.id).u8(it.weapon).pos(it).u8(Math.round((it.rot / TAU) * 255) & 255);
  w.u8(s.nades.length);
  for (const n of s.nades) w.u16(n.id).u8(NADE_TYPES.indexOf(n.type)).pos(n.pos);
  w.u8(s.smokes.length);
  for (const m of s.smokes) w.u16(m.id).pos(m.pos).f32(m.radius);
  const y = s.you;
  w.u8(y ? 1 : 0);
  if (y) {
    w.u32(y.seq).vec(y.pos).vec(y.vel).u8(y.onGround ? 1 : 0).f32(y.crouch).u8(y.slot);
    for (const inv of y.inv) w.u8(inv.weapon).u8(inv.mag).u8(Math.min(255, inv.reserve));
    w.u8(y.task).u8(Math.round(y.taskFrac * 255)).u8(y.reloading ? 1 : 0);
    w.u16(y.money).u8(y.health).u8(y.armor).u8((y.helmet ? 1 : 0) | (y.kit ? 2 : 0) | (y.hasBomb ? 4 : 0) | (y.alive ? 8 : 0));
    w.u8(y.nades.hegrenade).u8(y.nades.flashbang).u8(y.nades.smokegrenade).u8(weaponCode(y.nadeSel));
  }
  return w.done();
}

function decodeSnapshot(r) {
  const s = { tick: r.u32(), time: r.f32() };
  s.phase = PHASES[r.u8()] || 'live';
  s.phaseT = r.f32();
  s.roundT = r.f32();
  s.round = r.u8();
  s.score = { T: r.u8(), CT: r.u8() };
  s.buyLeft = r.f32();
  s.bomb = { state: BOMB_STATES[r.u8()] || 'none', carrierId: r.u8(), pos: r.pos(), timer: r.f32(), defuserId: r.u8() };
  s.actors = [];
  for (let n = r.u8(); n > 0; n--) {
    s.actors.push({
      id: r.u8(), flags: r.u8(), pos: r.pos(), yaw: r.angle(), pitch: r.i16() / 10000, vx: r.i16() / 100, vz: r.i16() / 100,
      crouch: r.u8() / 255, health: r.u8(), armor: r.u8(), weapon: r.u8(), money: r.u16(),
    });
  }
  s.scores = [];
  for (let n = r.u8(); n > 0; n--) s.scores.push({ id: r.u8(), kills: r.u8(), deaths: r.u8(), alive: !!r.u8() });
  s.items = [];
  for (let n = r.u8(); n > 0; n--) {
    const id = r.u16(), weapon = r.u8(), p = r.pos();
    s.items.push({ id, weapon, ...p, rot: (r.u8() / 255) * TAU });
  }
  s.nades = [];
  for (let n = r.u8(); n > 0; n--) s.nades.push({ id: r.u16(), type: NADE_TYPES[r.u8()], pos: r.pos() });
  s.smokes = [];
  for (let n = r.u8(); n > 0; n--) s.smokes.push({ id: r.u16(), pos: r.pos(), radius: r.f32() });
  if (r.u8()) {
    const y = { seq: r.u32(), pos: r.vec(), vel: r.vec(), onGround: !!r.u8(), crouch: r.f32(), slot: r.u8(), inv: [] };
    for (let i = 0; i < 3; i++) y.inv.push({ weapon: r.u8(), mag: r.u8(), reserve: r.u8() });
    y.task = r.u8();
    y.taskFrac = r.u8() / 255;
    y.reloading = !!r.u8();
    y.money = r.u16();
    y.health = r.u8();
    y.armor = r.u8();
    const f = r.u8();
    Object.assign(y, { helmet: !!(f & 1), kit: !!(f & 2), hasBomb: !!(f & 4), alive: !!(f & 8) });
    y.nades = { hegrenade: r.u8(), flashbang: r.u8(), smokegrenade: r.u8() };
    y.nadeSel = weaponName(r.u8());
    s.you = y;
  }
  return s;
}

// Actor flags in snapshots.
export const AF = { ALIVE: 1, BOMB: 2, TASK: 4, HELMET: 8, FIRING: 16 };

// ev: list of [code, data] where data uses numeric ids (already mapped by the server).
export function encodeEvents(list) {
  const w = new Writer(256).u8(S2C.EVENTS).u8(Math.min(255, list.length));
  for (const [code, d] of list.slice(0, 255)) {
    w.u8(code);
    switch (code) {
      case EV.SHOT: w.u8(d.src).u8(d.weapon).vec(d.from).vec(d.to).u8(d.tracer ? 1 : 0); break;
      case EV.IMPACT: w.vec(d.pos).dir(d.normal).u8(d.noHole ? 1 : 0); break;
      case EV.BLOOD: w.vec(d.pos).dir(d.dir); break;
      case EV.HURT: w.u8(d.from).u8(d.weapon).u8(REGIONS.indexOf(d.region)).u8(Math.min(255, d.hp)).u8(Math.min(255, Math.round(d.armor))).u16(Math.round((d.dist ?? 0) * 10)); break;
      case EV.HITMARK: w.u8(d.head ? 1 : 0); break;
      case EV.HELMET: w.vec(d.pos); break;
      case EV.KILL: w.u8(d.killer).u8(d.victim).u8(d.weapon).u8(d.hs ? 1 : 0).vec(d.pos); break;
      case EV.EXPLOSION: w.vec(d.pos); break;
      case EV.SOUND: w.u8(SOUNDS.indexOf(d.name)).u8(d.src || 0).u8(d.pos ? 1 : 0); if (d.pos) w.vec(d.pos); w.f32(d.arg || 0); break;
      case EV.ANNOUNCE: w.u8({ T: 1, CT: 2 }[d.cls] || 0).f32(d.dur).str(d.text).str(d.sub || ''); break;
      case EV.NOTIFY: w.f32(d.dur).str(d.text); break;
      case EV.SAY: w.str(d.text); break;
      case EV.ROUND_START: w.u8(d.round); break;
      case EV.ROUND_END: w.u8(d.winner === 'T' ? 0 : 1).u8(REASONS.indexOf(d.reason)); break;
      case EV.MATCH_END: w.u8(d.winner === 'T' ? 0 : 1).u8(d.score.T).u8(d.score.CT); break;
      case EV.MELEE: w.u8(d.src).u8(MELEE.indexOf(d.result)).vec(d.pos); break;
      case EV.NADE: w.u8(NADE_TYPES.indexOf(d.type)).vec(d.pos); break;
      case EV.FLASHED: w.u8(Math.round(Math.min(1, d.amount) * 255)); break;
      default: throw new Error('unknown event ' + code);
    }
  }
  return w.done();
}

function decodeEvents(r) {
  const out = [];
  for (let n = r.u8(); n > 0; n--) {
    const code = r.u8();
    let d;
    switch (code) {
      case EV.SHOT: d = { src: r.u8(), weapon: r.u8(), from: r.vec(), to: r.vec(), tracer: !!r.u8() }; break;
      case EV.IMPACT: d = { pos: r.vec(), normal: r.dir(), noHole: !!r.u8() }; break;
      case EV.BLOOD: d = { pos: r.vec(), dir: r.dir() }; break;
      case EV.HURT: d = { from: r.u8(), weapon: r.u8(), region: REGIONS[r.u8()], hp: r.u8(), armor: r.u8(), dist: r.u16() / 10 }; break;
      case EV.HITMARK: d = { head: !!r.u8() }; break;
      case EV.HELMET: d = { pos: r.vec() }; break;
      case EV.KILL: d = { killer: r.u8(), victim: r.u8(), weapon: r.u8(), hs: !!r.u8(), pos: r.vec() }; break;
      case EV.EXPLOSION: d = { pos: r.vec() }; break;
      case EV.SOUND: { d = { name: SOUNDS[r.u8()], src: r.u8() }; if (r.u8()) d.pos = r.vec(); d.arg = r.f32(); break; }
      case EV.ANNOUNCE: d = { cls: [null, 'T', 'CT'][r.u8()], dur: r.f32(), text: r.str(), sub: r.str() }; break;
      case EV.NOTIFY: d = { dur: r.f32(), text: r.str() }; break;
      case EV.SAY: d = { text: r.str() }; break;
      case EV.ROUND_START: d = { round: r.u8() }; break;
      case EV.ROUND_END: d = { winner: r.u8() ? 'CT' : 'T', reason: REASONS[r.u8()] }; break;
      case EV.MATCH_END: d = { winner: r.u8() ? 'CT' : 'T', score: { T: r.u8(), CT: r.u8() } }; break;
      case EV.MELEE: d = { src: r.u8(), result: MELEE[r.u8()], pos: r.vec() }; break;
      case EV.NADE: d = { type: NADE_TYPES[r.u8()], pos: r.vec() }; break;
      case EV.FLASHED: d = { amount: r.u8() / 255 }; break;
      default: throw new RangeError('unknown event ' + code);
    }
    out.push([code, d]);
  }
  return out;
}

export function decodeServer(buf) {
  const r = new Reader(buf);
  const type = r.u8();
  switch (type) {
    case S2C.WELCOME: return { type, id: r.u8(), tickRate: r.u16() };
    case S2C.ROSTER: {
      const list = [];
      for (let n = r.u8(); n > 0; n--) {
        const id = r.u8(), team = r.u8() ? 'CT' : 'T', f = r.u8();
        list.push({ id, team, isBot: !!(f & 1), you: !!(f & 2), name: r.str() });
      }
      return { type, list };
    }
    case S2C.SNAPSHOT: return { type, ...decodeSnapshot(r) };
    case S2C.EVENTS: return { type, events: decodeEvents(r) };
    case S2C.PONG: return { type, t: r.f64() };
    case S2C.KICK: return { type, reason: r.str() };
    case S2C.ROOMS: {
      const rooms = [];
      for (let n = r.u8(); n > 0; n--) rooms.push({ code: r.str(), teamSize: r.u8(), bots: r.u8(), humans: r.u8(), diff: DIFFS[r.u8()], playing: !!r.u8(), map: MAP_LIST[r.u8()] || 'dust', humansT: r.u8(), humansCT: r.u8() });
      return { type, rooms };
    }
    case S2C.ROOM: return { type, code: r.str(), teamSize: r.u8(), bots: r.u8(), diff: DIFFS[r.u8()], map: MAP_LIST[r.u8()] || 'dust' };
    default: throw new RangeError('unknown message ' + type);
  }
}
