import * as THREE from 'three';
import { Actor } from '../actor.js';
import { Player } from '../player.js';
import { WEAPONS, newWeapon } from '../weapons.js';
import * as P from './protocol.js';

// Online mode. The server is the authority; this file:
//   - sends your inputs 60 times a second (never positions, hits or money)
//   - predicts your own movement locally and reconciles it with server snapshots
//   - interpolates everyone else 100 ms in the past for smooth motion
//   - turns server events back into the same events the offline game produces

const TICK = 1 / 60;
const INTERP_DELAY = 0.1;
const C4_DEF = { id: 'c4', name: 'C4' };
const defOf = (code) => WEAPONS[P.weaponName(code)] || (P.weaponName(code) === 'c4' ? C4_DEF : WEAPONS.knife);
const vec = (p) => new THREE.Vector3(p.x, p.y, p.z);

// Another player or a server bot, as seen by this client.
class RemoteActor extends Actor {
  constructor(world, id, team, name, isBot) {
    super(world, team, name);
    this.id = id;
    this.isBot = isBot;
    this.isRemote = true;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.weaponCode = 1;
    this.flags = 0;
    this.buf = [];
    this.netVisible = false;
    this.lastShotT = -9;
    this.body = world.makeBody(team);
    this.body.root.visible = false;
    this.alive = false;
  }

  get weapon() { return { def: defOf(this.weaponCode), mag: 0, reserve: 0 }; }

  push(s, t) {
    this.buf.push({ t, x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz, crouch: s.crouch });
    while (this.buf.length > 30) this.buf.shift();
  }

  // Interpolate between buffered snapshots at `t` (server time).
  sample(t) {
    const b = this.buf;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const k = s1.t === s0.t ? 1 : Math.max(0, Math.min(1, (t - s0.t) / (s1.t - s0.t)));
    this.pos.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
    let dy = s1.yaw - s0.yaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.aimYaw = this.yaw = s0.yaw + dy * k;
    this.aimPitch = this.pitch = s0.pitch + (s1.pitch - s0.pitch) * k;
    this.vel.set(s0.vx + (s1.vx - s0.vx) * k, 0, s0.vz + (s1.vz - s0.vz) * k);
    this.crouchAmt = s0.crouch + (s1.crouch - s0.crouch) * k;
  }

  animate(dt, now) {
    const b = this.body;
    if (b.gunId !== this.weapon.def.id && this.alive) b.setGun(this.weapon.def.id);
    b.root.position.copy(this.pos);
    b.root.rotation.set(0, this.aimYaw, 0);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const y = this.aimYaw;
    b.update(dt, {
      speed: hs,
      strafe: hs > 0.5 ? (this.vel.x * Math.cos(y) - this.vel.z * Math.sin(y)) / hs : 0,
      back: hs > 0.5 && (-this.vel.x * Math.sin(y) - this.vel.z * Math.cos(y)) / hs < -0.5,
      pitch: this.aimPitch, task: !!(this.flags & P.AF.TASK), crouch: this.crouchAmt,
      combat: now - this.lastShotT < 1.5, firing: !!(this.flags & P.AF.FIRING),
    });
  }

  setAlive(alive) {
    if (alive === this.alive) return;
    this.alive = alive;
    if (alive) { this.body.reset(); this.body.setGun(this.weapon.def.id); } else this.body.die();
  }
}

// Mirror of the server's world that the HUD, camera and local prediction read from.
class RemoteWorld {
  constructor(client) {
    this.client = client;
    this.actors = [];
    this.byId = new Map();
    this.player = null;
    this.bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), timer: 0, defuser: null };
    this.phase = 'freeze';
    this.phaseT = 0;
    this.roundT = 0;
    this.score = { T: 0, CT: 0 };
    this.round = 0;
    this.items = [];
    this.nades = [];
    this.smokes = [];
    this.time = 0;
    this.buyLeft = 0;
  }

  get map() { return this.client.map; }
  makeBody(team) { return this.client.addBody(team); }
  emit(type, d) { this.client.onEvent(type, d); }
  canBuy(p) { return !!p && p.alive && this.phase !== 'post' && this.phase !== 'over' && this.buyLeft > 0 && this.map.inBuyZone(p.pos.x, p.pos.z, p.team); }
  buyTimeLeft() { return this.buyLeft; }

  // Local prediction hooks — visuals only; the server decides what actually happened.
  fireBullet(shooter, origin, dir) {
    const wall = this.map.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 300);
    let maxT = wall ? wall.t : 300;
    for (const a of this.actors) {
      if (a === shooter || !a.alive || !a.netVisible) continue;
      const h = a.hitTest(origin, dir, maxT);
      if (h) maxT = h.t;
    }
    return { end: origin.clone().addScaledVector(dir, maxT), hitActor: null };
  }
  meleeHit(attacker, eye, dir, def) {
    return this.map.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range) ? 'wall' : 'air';
  }
  dropActive() {}
  throwNade() {}
  plantBomb() {}
  defuseBomb() {}
  noise() {}
}

export class NetClient {
  // Opens a connection to the server's lobby. Then call list(), create() or join().
  constructor(client, url) {
    this.client = client;
    this.url = url;
    this.world = new RemoteWorld(client);
    this.myId = 0;
    this.room = null;
    this.joined = false;
    this.seq = 0;
    this.pending = [];
    this.acc = 0;
    this.edges = new Set();
    this.timeOffset = null;
    this.ping = 0;
    this.connected = false;
    this.closed = false;
    this.smooth = new THREE.Vector3();
    this.prevEye = new THREE.Vector3();
    this.curEye = new THREE.Vector3();
    this.onStatus = () => {};
    this.onRooms = () => {};
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise((resolve) => {
      this.ws.onopen = () => {
        this.connected = true;
        this.pingTimer = setInterval(() => this.send(P.encodePing(performance.now())), 1000);
        resolve(true);
      };
      this.ws.onclose = () => {
        clearInterval(this.pingTimer);
        resolve(false);
        if (!this.closed) this.onStatus('closed', this.kickReason || (this.connected ? 'Disconnected from server' : 'Could not connect to server'));
        this.closed = true;
      };
    });
    this.ws.onmessage = (e) => {
      try { this.handle(P.decodeServer(e.data)); } catch (err) { console.warn('bad server message', err); }
    };
    this.ws.onerror = () => {};
  }

  list() { this.send(P.encodeList()); }
  create(name, team, teamSize, bots, diff, map) { this.send(P.encodeCreate(name, team, teamSize, bots, diff, map)); }
  join(name, team, code) { this.send(P.encodeJoin(name, team, code)); }

  send(buf) { if (this.ws.readyState === 1) this.ws.send(buf); }
  close() { this.closed = true; this.ws.close(); }
  switchTeam(team) {
    this.teamSwitchAt = performance.now();
    this.send(P.encodeCmd(P.CMD.TEAM, team === 'T' ? 1 : 2));
  }
  buy(id) { const i = P.BUY_ITEMS.indexOf(id); if (i >= 0) this.send(P.encodeCmd(P.CMD.BUY, i)); }

  serverNow() { return this.timeOffset === null ? 0 : performance.now() / 1000 + this.timeOffset; }
  renderTime() { return this.serverNow() - INTERP_DELAY; }

  // ---------- incoming ----------

  handle(m) {
    switch (m.type) {
      case P.S2C.WELCOME: this.myId = m.id; break;
      case P.S2C.ROSTER: this.applyRoster(m.list); break;
      case P.S2C.SNAPSHOT: this.applySnapshot(m); break;
      case P.S2C.EVENTS: for (const [code, d] of m.events) this.applyEvent(code, d); break;
      case P.S2C.PONG: this.ping = Math.round(performance.now() - m.t); break;
      case P.S2C.KICK:
        // Before joining, a "kick" is just a lobby error (room full / not found); the socket stays open.
        if (this.joined) this.kickReason = m.reason;
        else this.onStatus('error', m.reason);
        break;
      case P.S2C.ROOMS: this.onRooms(m.rooms); break;
      case P.S2C.ROOM:
        this.room = m;
        this.client.setMap(m.map); // load the room's map before the first snapshot
        break;
      default:
    }
  }

  applyRoster(list) {
    const w = this.world;
    const ids = new Set(list.map((e) => e.id));
    for (const a of [...w.actors]) {
      if (ids.has(a.id)) continue;
      if (a.body) this.client.removeBody(a.body);
      w.actors = w.actors.filter((x) => x !== a);
      w.byId.delete(a.id);
    }
    for (const e of list) {
      let a = w.byId.get(e.id);
      if (e.you) {
        if (!w.player) {
          a = new Player(w, e.team, e.name);
          a.id = e.id;
          a.alive = false;
          a.deathT = 99;
          a.resetLoadout();
          w.player = a;
          w.actors.push(a);
          w.byId.set(a.id, a);
          this.joined = true;
          this.onStatus('joined');
        }
        w.player.name = e.name;
        w.player.team = e.team;
        continue;
      }
      if (a && a.team !== e.team) {
        this.client.removeBody(a.body);
        w.actors = w.actors.filter((x) => x !== a);
        a = null;
      }
      if (!a) {
        a = new RemoteActor(w, e.id, e.team, e.name, e.isBot);
        w.actors.push(a);
        w.byId.set(e.id, a);
      }
      a.name = e.name;
    }
  }

  applySnapshot(s) {
    const w = this.world;
    const now = performance.now() / 1000;
    const offset = s.time - now;
    // Track the server clock; drift slowly, jump if way off.
    if (this.timeOffset === null || Math.abs(offset - this.timeOffset) > 0.5) this.timeOffset = offset;
    else this.timeOffset += (offset - this.timeOffset) * 0.05;

    w.phase = s.phase;
    w.phaseT = s.phaseT;
    w.roundT = s.roundT;
    w.round = s.round;
    w.score = s.score;
    w.buyLeft = s.buyLeft;
    const b = w.bomb;
    b.state = s.bomb.state;
    b.pos.set(s.bomb.pos.x, s.bomb.pos.y, s.bomb.pos.z);
    b.timer = s.bomb.timer;
    b.carrier = w.byId.get(s.bomb.carrierId) || null;
    b.defuser = w.byId.get(s.bomb.defuserId) || null;
    w.items = s.items;
    w.nades = s.nades;
    w.smokes = s.smokes;

    const present = new Set();
    for (const e of s.actors) {
      const a = w.byId.get(e.id);
      if (!a || a === w.player) continue;
      present.add(a);
      if (!a.netVisible) a.buf.length = 0; // reappearing: don't interpolate from a stale spot
      a.netVisible = true;
      a.flags = e.flags;
      a.push(e, s.time);
      a.setAlive(!!(e.flags & P.AF.ALIVE));
      a.hasBomb = !!(e.flags & P.AF.BOMB);
      a.helmet = !!(e.flags & P.AF.HELMET);
      a.task = e.flags & P.AF.TASK ? {} : null;
      a.health = e.health;
      a.armor = e.armor;
      a.weaponCode = e.weapon;
      a.money = e.money;
    }
    for (const a of w.actors) {
      if (a === w.player || present.has(a)) continue;
      a.netVisible = false; // the server isn't telling us where this enemy is
    }
    for (const sc of s.scores) {
      const a = w.byId.get(sc.id);
      if (!a) continue;
      a.kills = sc.kills;
      a.deaths = sc.deaths;
      if (a !== w.player && !present.has(a)) a.setAlive(sc.alive);
    }
    if (s.you && w.player) this.reconcile(s.you);
  }

  reconcile(y) {
    const p = this.world.player;
    this.pending = this.pending.filter((i) => i.seq > y.seq);
    p.money = y.money;
    p.health = y.health;
    p.armor = y.armor;
    p.helmet = y.helmet;
    p.hasKit = y.kit;
    p.hasBomb = y.hasBomb;

    if (!y.alive && p.alive) {
      p.alive = false;
      // A team switch just takes you out of the round: go straight to spectating, no death cam.
      p.deathT = performance.now() - (this.teamSwitchAt || -1e9) < 2000 ? 99 : 0;
      p.task = null;
      p.scope = 0;
    } else if (y.alive && !p.alive) {
      // Respawned for a new round.
      p.alive = true;
      p.deathT = 0;
      p.task = null;
      p.scope = 0;
      p.reloading = false;
      p.punchP = p.punchY = 0;
      p.pos.set(y.pos.x, y.pos.y, y.pos.z);
      p.vel.set(0, 0, 0);
      this.pending.length = 0;
      this.smooth.set(0, 0, 0);
      this.snapEye = true;
      this.respawned = true;
    }

    // Inventory: server is the source of truth; ammo is adjusted by shots still in flight.
    let switched = false;
    for (let s = 1; s <= 3; s++) {
      const inv = y.inv[s - 1];
      const name = P.weaponName(inv.weapon);
      const cur = p.inv[s];
      if (!name) {
        if (cur) p.inv[s] = null;
        continue;
      }
      if (!cur || cur.def.id !== name) {
        p.inv[s] = newWeapon(name);
        p.inv[s].mag = inv.mag;
        p.inv[s].reserve = inv.reserve;
        if (y.slot === s && p.alive) { p.switchTo(s, true); switched = true; }
        continue;
      }
      const inFlight = this.pending.reduce((n, i) => n + (i.slot === s ? i.shots : 0), 0);
      cur.mag = Math.max(0, inv.mag - inFlight);
      if (!p.reloading) cur.reserve = inv.reserve;
    }
    // Grenades: server counts minus throws it hasn't processed yet.
    if (y.nades) {
      for (const t of Object.keys(y.nades)) {
        const inFlight = this.pending.reduce((n, i) => n + i.throws.filter((x) => x === t).length, 0);
        p.nades[t] = Math.max(0, y.nades[t] - inFlight);
      }
      if (!p.nades[p.nadeSel]) p.nadeSel = y.nadeSel;
      const wasSlot = p.slot;
      p.syncNades();
      if (p.slot !== wasSlot && p.alive) { p.slot = wasSlot; p.switchTo(p.bestSlot(), true); switched = true; }
    }
    if (!p.inv[p.slot] && !switched) p.switchTo(p.bestSlot(), true);
    if (this.respawned) {
      // New round: take the server's slot and show the weapon.
      this.respawned = false;
      if (p.inv[y.slot]) p.slot = y.slot;
      p.deployT = 0;
      this.client.onEvent('vm', { to: p, op: 'set' });
    }
    if (!p.alive) return;

    // Movement: rewind to the server's state and replay unacknowledged inputs.
    const before = p.pos.clone();
    p.pos.set(y.pos.x, y.pos.y, y.pos.z);
    p.vel.set(y.vel.x, y.vel.y, y.vel.z);
    p.onGround = y.onGround;
    p.crouchAmt = y.crouch;
    const frozen = p.isFrozen();
    for (const i of this.pending) p.simulate(TICK, i.pinp, frozen, false);
    const err = before.sub(p.pos);
    // Re-base the cached eye positions on the corrected state; show the error as a fading offset.
    this.prevEye.sub(err);
    this.curEye.sub(err);
    if (err.length() > 2) this.smooth.set(0, 0, 0);
    else this.smooth.add(err);
  }

  applyEvent(code, d) {
    const w = this.world, E = P.EV, me = w.player;
    const actor = (id) => w.byId.get(id) || null;
    const emit = (type, data) => this.client.onEvent(type, data);
    switch (code) {
      case E.SHOT: {
        const src = actor(d.src);
        if (src) src.lastShotT = performance.now() / 1000;
        return emit('shot', { src, def: defOf(d.weapon), from: vec(d.from), to: vec(d.to), tracer: d.tracer });
      }
      case E.MELEE: return emit('melee', { src: actor(d.src), result: d.result, pos: vec(d.pos) });
      case E.IMPACT: return emit('impact', { pos: vec(d.pos), normal: vec(d.normal).normalize(), noHole: d.noHole });
      case E.BLOOD: return emit('blood', { pos: vec(d.pos), dir: vec(d.dir) });
      case E.HURT:
        if (me) me.punchP += (1.2 * Math.PI) / 180;
        return emit('hurt', { to: me, from: actor(d.from), def: defOf(d.weapon), region: d.region, hp: d.hp, armor: d.armor, dist: d.from ? d.dist : null });
      case E.HITMARK: return emit('hitmark', { to: me, head: d.head });
      case E.HELMET: return emit('helmet', { pos: vec(d.pos) });
      case E.KILL: {
        const victim = actor(d.victim);
        if (victim && victim !== me) victim.setAlive?.(false);
        return emit('kill', { killer: actor(d.killer), victim, def: defOf(d.weapon), hs: d.hs, pos: vec(d.pos) });
      }
      case E.EXPLOSION: return emit('explosion', { pos: vec(d.pos) });
      case E.NADE: return emit('nade', { type: d.type, pos: vec(d.pos) });
      case E.FLASHED: return emit('flashed', { to: me, amount: d.amount });
      case E.SOUND: return emit('sound', { name: d.name, src: actor(d.src), pos: d.pos ? vec(d.pos) : null, arg: d.arg, to: d.src ? null : d.pos ? null : me });
      case E.ANNOUNCE: return emit('announce', d);
      case E.NOTIFY: return emit('notify', { to: me, text: d.text, dur: d.dur });
      case E.SAY: return emit('say', d);
      case E.ROUND_START: return emit('roundStart', d);
      case E.ROUND_END: return emit('roundEnd', d);
      case E.MATCH_END: return emit('matchEnd', d);
      default:
    }
  }

  // ---------- outgoing / per frame ----------

  // Called every rendered frame with the raw input state; edges are buffered until the next tick.
  collect(inp, uiOwnsDigits) {
    for (const k of ['Space', 'KeyR', 'KeyG', 'KeyQ', 'KeyE']) if (inp.pressed.has(k)) this.edges.add(k);
    if (!uiOwnsDigits) for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) if (inp.pressed.has(k)) this.edges.add(k);
    if (inp.firePressed) this.edges.add('fire');
    if (inp.fire2Pressed) this.edges.add('fire2');
    if (inp.wheel > 0) this.edges.add('wheelDown');
    if (inp.wheel < 0) this.edges.add('wheelUp');
  }

  update(dt, inp, paused) {
    const w = this.world, p = w.player;
    // Countdown timers between snapshots.
    if (w.phase === 'freeze' || w.phase === 'post') w.phaseT -= dt;
    else if (w.phase === 'live' && w.bomb.state !== 'planted') w.roundT -= dt;
    if (w.bomb.state === 'planted') w.bomb.timer -= dt;
    w.buyLeft = Math.max(0, w.buyLeft - dt);

    if (p) {
      this.acc = Math.min(this.acc + dt, 0.25);
      while (this.acc >= TICK) {
        this.acc -= TICK;
        this.tick(inp, paused);
      }
      this.smooth.multiplyScalar(Math.exp(-dt * 12));
    }
    const rt = this.renderTime();
    const now = performance.now() / 1000;
    for (const a of w.actors) {
      if (a === p) continue;
      if (a.netVisible) a.sample(rt);
      a.animate(dt, now);
    }
  }

  tick(inp, paused) {
    const w = this.world, p = w.player;
    const held = new Set();
    if (!paused) {
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ShiftLeft', 'KeyE']) if (inp.keys[k]) held.add(k);
      if (inp.keys.ControlLeft) held.add('KeyC');
      if (inp.keys.ShiftRight) held.add('ShiftLeft');
      if (inp.fire) held.add('fire');
    }
    const edges = paused ? new Set() : this.edges;
    this.edges = new Set();
    const pinp = P.inputToPlayer({ held: 0, edges: 0, yaw: p.yaw, pitch: p.pitch });
    for (const k of held) pinp.keys[k] = true;
    for (const k of edges) pinp.pressed.add(k);
    pinp.fire = held.has('fire');
    pinp.firePressed = edges.has('fire');
    pinp.fire2Pressed = edges.has('fire2');
    pinp.wheel = edges.has('wheelDown') ? 1 : edges.has('wheelUp') ? -1 : 0;

    this.seq++;
    w.time += TICK;
    this.prevEye.copy(this.curEye);
    const shotsBefore = p.firedShots || 0;
    const slot = p.slot;
    p.update(TICK, pinp);
    p.eye(this.curEye);
    if (this.snapEye) { this.prevEye.copy(this.curEye); this.snapEye = false; }
    this.pending.push({ seq: this.seq, pinp, slot, shots: (p.firedShots || 0) - shotsBefore, throws: (p.thrown || []).splice(0) });
    if (this.pending.length > 180) this.pending.shift();
    this.send(P.encodeInput({ seq: this.seq, viewTime: this.renderTime(), held, edges, yaw: p.yaw, pitch: p.pitch }));
  }

  // Camera position: interpolated between fixed ticks, plus decaying reconciliation error.
  eye(out) {
    const k = this.acc / TICK;
    return out.lerpVectors(this.prevEye, this.curEye, Math.min(1, k)).add(this.smooth);
  }
}
