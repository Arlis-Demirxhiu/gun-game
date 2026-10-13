// Authoritative game room: one GameCore plus the connected clients.
// Handles joins/leaves, input queues, event routing, visibility culling and lag compensation.

import { GameCore } from '../src/core.js';
import { Player } from '../src/player.js';
import * as P from '../src/net/protocol.js';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
const SNAPSHOT_EVERY = 3; // 20 snapshots/s
const MAX_REWIND = 0.3; // seconds of lag compensation

export class Room {
  constructor({ code = '', teamSize = 5, bots = 9, diff = 'normal', map = 'dust' } = {}) {
    this.code = code;
    this.map = map;
    this.teamSize = teamSize;
    this.maxBots = bots;
    this.diff = diff;
    this.core = new GameCore({ diff, teamSize, maxBots: bots, mapId: map });
    this.clients = new Set();
    this.history = [];
    this.tickN = 0;
    this.overT = 0;
    this.lastShot = new Map();
    this.seenBy = { T: new Map(), CT: new Map() };
    this.core.on((type, d) => this.route(type, d));
    this.core.lagComp = (shooter, fn) => this.rewind(shooter, fn);
  }

  info() {
    return {
      code: this.code, teamSize: this.teamSize, bots: this.maxBots, diff: this.diff, map: this.map,
      humans: this.core.players.length, playing: this.core.state === 'playing',
      humansT: this.core.players.filter((p) => p.team === 'T').length,
      humansCT: this.core.players.filter((p) => p.team === 'CT').length,
    };
  }

  isFull() { return this.core.players.length >= this.teamSize * 2; }

  clientOf(actor) {
    return actor && actor.isPlayer ? actor.client : null;
  }

  // ----- membership -----

  join(c, name, pref) {
    const humans = (team) => this.core.players.filter((p) => p.team === team).length;
    let team = pref === 'T' || pref === 'CT' ? pref : humans('T') <= humans('CT') ? 'T' : 'CT';
    if (humans(team) >= this.teamSize) team = team === 'T' ? 'CT' : 'T';
    if (humans(team) >= this.teamSize) return false;
    const clean = (name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';
    const taken = new Set(this.core.actors.map((a) => a.name));
    let finalName = clean;
    for (let i = 2; taken.has(finalName); i++) finalName = `${clean.slice(0, 13)}(${i})`;
    const p = new Player(this.core, team, finalName);
    p.client = c;
    c.player = p;
    this.clients.add(c);
    this.core.addActor(p);
    this.core.balanceBots();
    c.send(P.encodeWelcome(p.id, TICK_RATE));
    c.send(P.encodeRoom(this.info()));
    this.broadcastRoster();
    this.broadcastEvent([P.EV.NOTIFY, { dur: 3, text: `${finalName} joined the ${team === 'T' ? 'Terrorists' : 'Counter-Terrorists'}` }]);
    console.log(`[${this.code}] + ${finalName} (${team}) — ${this.clients.size} player(s)`);
    return true;
  }

  leave(c) {
    if (!this.clients.delete(c)) return;
    const p = c.player;
    if (p) {
      this.core.removeActor(p);
      this.core.balanceBots();
      this.broadcastEvent([P.EV.NOTIFY, { dur: 3, text: `${p.name} left the game` }]);
      console.log(`[${this.code}] - ${p.name} — ${this.clients.size} player(s)`);
    }
    this.broadcastRoster();
  }

  switchTeam(c, team) {
    const p = c.player;
    if (!p) return;
    const res = this.core.changeTeam(p, team);
    if (res === 'full') this.queue(c, [P.EV.NOTIFY, { dur: 2.5, text: 'That team is full' }]);
    if (res !== 'ok') return;
    this.broadcastRoster();
    this.broadcastEvent([P.EV.NOTIFY, { dur: 3, text: `${p.name} joined the ${team === 'T' ? 'Terrorists' : 'Counter-Terrorists'}` }]);
  }

  // ----- networking out -----

  send(c, buf) { if (c.ws.readyState === 1) c.ws.send(buf); }
  broadcastRoster() {
    for (const c of this.clients) this.send(c, P.encodeRoster(this.core.actors, c.player?.id));
    this.rosterDirty = false;
  }
  queue(c, ev) { if (c) c.events.push(ev); }
  broadcastEvent(ev, except = null) { for (const c of this.clients) if (c !== except) c.events.push(ev); }

  // Translate simulation events into network events and decide who receives them.
  route(type, d) {
    const id = (a) => (a ? a.id : 0);
    const E = P.EV;
    switch (type) {
      case 'vm': return; // first-person animation: predicted by the owning client only
      case 'shot':
        this.lastShot.set(d.src.id, this.core.time);
        return this.broadcastEvent([E.SHOT, { src: id(d.src), weapon: P.weaponCode(d.def.id), from: d.from, to: d.to, tracer: d.tracer }], this.clientOf(d.src));
      case 'melee':
        return this.broadcastEvent([E.MELEE, { src: id(d.src), result: d.result, pos: d.pos }], this.clientOf(d.src));
      case 'sound': {
        const ev = [E.SOUND, { name: d.name, src: id(d.src), pos: d.pos, arg: d.arg }];
        if (d.to) return d.pred ? undefined : this.queue(this.clientOf(d.to), ev);
        for (const c of this.clients) {
          if (d.src && c === this.clientOf(d.src)) continue; // the owner predicted it
          if (d.name === 'step' && d.pos && c.player && c.player.pos.distanceTo(d.pos) > 35) continue;
          c.events.push(ev);
        }
        return;
      }
      case 'impact': return this.broadcastEvent([E.IMPACT, { pos: d.pos, normal: d.normal, noHole: d.noHole }]);
      case 'blood': return this.broadcastEvent([E.BLOOD, { pos: d.pos, dir: d.dir }]);
      case 'helmet': return this.broadcastEvent([E.HELMET, { pos: d.pos }]);
      case 'explosion': return this.broadcastEvent([E.EXPLOSION, { pos: d.pos }]);
      case 'nade': return this.broadcastEvent([E.NADE, { type: d.type, pos: d.pos }]);
      case 'flashed': return this.queue(this.clientOf(d.to), [E.FLASHED, { amount: d.amount }]);
      case 'hurt':
        return this.queue(this.clientOf(d.to), [E.HURT, { from: id(d.from), weapon: P.weaponCode(d.def.id), region: d.region, hp: d.hp, armor: d.armor, dist: d.dist }]);
      case 'hitmark': return this.queue(this.clientOf(d.to), [E.HITMARK, { head: d.head }]);
      case 'kill':
        return this.broadcastEvent([E.KILL, { killer: id(d.killer), victim: id(d.victim), weapon: P.weaponCode(d.def.id), hs: d.hs, pos: d.pos }]);
      case 'announce': return this.broadcastEvent([E.ANNOUNCE, d]);
      case 'notify': return this.queue(this.clientOf(d.to), [E.NOTIFY, { dur: d.dur, text: d.text }]);
      case 'say': return this.broadcastEvent([E.SAY, d]);
      case 'roundStart': this.rosterDirty = true; return this.broadcastEvent([E.ROUND_START, d]);
      case 'roundEnd': return this.broadcastEvent([E.ROUND_END, d]);
      case 'matchEnd': return this.broadcastEvent([E.MATCH_END, d]);
      default: return undefined;
    }
  }

  // ----- lag compensation -----

  recordHistory() {
    this.history.push({ t: this.core.time, s: this.core.actors.map((a) => [a, a.pos.x, a.pos.y, a.pos.z, a.crouchAmt]) });
    while (this.history.length > TICK_RATE * 0.5) this.history.shift();
  }

  rewind(shooter, fn) {
    const c = this.clientOf(shooter);
    if (!c || !Number.isFinite(c.viewTime) || this.history.length < 2) return fn();
    const t = Math.max(this.core.time - MAX_REWIND, Math.min(this.core.time, c.viewTime));
    let i = this.history.length - 1;
    while (i > 0 && this.history[i - 1].t > t) i--;
    const b = this.history[i], a = this.history[Math.max(0, i - 1)];
    const k = b.t === a.t ? 1 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const lookup = new Map(a.s.map((e) => [e[0], e]));
    const saved = [];
    for (const eb of b.s) {
      const actor = eb[0];
      if (actor === shooter || !this.core.actors.includes(actor)) continue;
      const ea = lookup.get(actor) || eb;
      saved.push([actor, actor.pos.clone(), actor.crouchAmt]);
      actor.pos.set(ea[1] + (eb[1] - ea[1]) * k, ea[2] + (eb[2] - ea[2]) * k, ea[3] + (eb[3] - ea[3]) * k);
      actor.crouchAmt = ea[4] + (eb[4] - ea[4]) * k;
    }
    try {
      return fn();
    } finally {
      for (const [actor, pos, crouch] of saved) { actor.pos.copy(pos); actor.crouchAmt = crouch; }
    }
  }

  // ----- visibility (anti-wallhack) -----

  updateVisibility() {
    const core = this.core;
    for (const team of ['T', 'CT']) {
      const viewers = core.actors.filter((a) => a.team === team && a.alive);
      const seen = this.seenBy[team];
      for (const e of core.actors) {
        if (e.team === team || !e.alive) continue;
        let vis = false;
        for (const v of viewers) {
          if (v.pos.distanceTo(e.pos) < 7) { vis = true; break; }
          const eye = v.eye();
          const side = { x: Math.cos(v.yaw) * 0.6, z: -Math.sin(v.yaw) * 0.6 };
          const eyes = [eye, eye.clone().add({ x: side.x, y: 0, z: side.z }), eye.clone().add({ x: -side.x, y: 0, z: -side.z })];
          const targets = [e.headPos(), e.chestPos(), e.pos.clone().setY(e.pos.y + 0.4)];
          if (eyes.some((o) => targets.some((t) => core.canSee(o, t)))) { vis = true; break; }
        }
        if (vis) seen.set(e.id, core.time);
      }
    }
  }

  visibleTo(team, a) {
    if (a.team === team || !a.alive) return true;
    const t = this.seenBy[team].get(a.id);
    return t !== undefined && this.core.time - t < 0.5;
  }

  snapshotFor(c) {
    const core = this.core, me = c.player, b = core.bomb;
    const actors = [];
    for (const a of core.actors) {
      if (a === me || !this.visibleTo(me.team, a)) continue;
      const mate = a.team === me.team;
      let flags = 0;
      if (a.alive) flags |= P.AF.ALIVE;
      if (a.hasBomb && mate) flags |= P.AF.BOMB;
      if (a.task) flags |= P.AF.TASK;
      if (a.helmet) flags |= P.AF.HELMET;
      if (core.time - (this.lastShot.get(a.id) ?? -9) < 0.25) flags |= P.AF.FIRING;
      actors.push({
        id: a.id, flags, pos: a.pos, yaw: a.isBot ? a.aimYaw : a.yaw, pitch: a.isBot ? a.aimPitch : a.pitch,
        vx: a.vel.x, vz: a.vel.z, crouch: a.crouchAmt, health: Math.max(0, Math.ceil(a.health)), armor: Math.round(a.armor),
        weapon: P.weaponCode(a.weapon.def.id), money: mate ? a.money : 0,
      });
    }
    const showBomb = b.state === 'planted' || b.state === 'dropped' || me.team === 'T';
    const task = me.task ? (me.task.type === 'plant' ? 1 : 2) : 0;
    return P.encodeSnapshot({
      tick: this.tickN, time: core.time, phase: core.state === 'over' ? 'over' : core.phase, phaseT: core.phaseT, roundT: core.roundT,
      round: core.round, score: core.score, buyLeft: core.buyTimeLeft(),
      bomb: {
        state: b.state, carrierId: me.team === 'T' && b.carrier ? b.carrier.id : 0, pos: showBomb ? b.pos : { x: 0, y: 0, z: 0 },
        timer: b.timer, defuserId: b.defuser ? b.defuser.id : 0,
      },
      actors,
      scores: core.actors.map((a) => ({ id: a.id, kills: a.kills, deaths: a.deaths, alive: a.alive })),
      items: core.items.map((it) => ({ id: it.id, weapon: P.weaponCode(it.w.def.id), x: it.x, y: it.y, z: it.z, rot: it.rot })),
      nades: core.nades.slice(0, 40).map((n) => ({ id: n.id, type: P.NADE_TYPES[['hegrenade', 'flashbang', 'smokegrenade'].indexOf(n.type)], pos: n.pos })),
      smokes: core.smokes.map((m) => ({ id: m.id, pos: m.pos, radius: core.smokeRadius(m) })),
      you: {
        seq: c.lastSeq, pos: me.pos, vel: me.vel, onGround: me.onGround, crouch: me.crouchAmt, slot: me.slot,
        inv: [1, 2, 3].map((s) => {
          const w = me.inv[s];
          return w ? { weapon: P.weaponCode(w.def.id), mag: w.mag, reserve: w.reserve } : { weapon: 0, mag: 0, reserve: 0 };
        }),
        task, taskFrac: me.task ? Math.min(1, me.task.t / me.task.dur) : 0, reloading: me.reloading,
        money: me.money, health: Math.max(0, Math.ceil(me.health)), armor: Math.round(me.armor),
        helmet: me.helmet, kit: me.hasKit, hasBomb: me.hasBomb, alive: me.alive,
        nades: me.nades, nadeSel: me.nadeSel,
      },
    });
  }

  // ----- simulation -----

  nextInput(c) {
    if (c.inputs.length > 8) c.inputs.splice(0, c.inputs.length - 2); // badly behind: catch up
    const m = c.inputs.shift();
    if (m) { c.lastInput = m; return m; }
    // No input this tick: repeat held buttons and aim, but never repeat one-shot edges.
    return c.lastInput ? { ...c.lastInput, edges: 0 } : null;
  }

  tick() {
    const core = this.core;
    if (this.clients.size === 0) return;
    core.step(DT, (dt) => {
      for (const c of this.clients) {
        const m = this.nextInput(c);
        if (!m || !c.player) continue;
        c.viewTime = m.viewTime;
        c.player.update(dt, P.inputToPlayer(m));
        c.lastSeq = m.seq;
      }
    });
    this.recordHistory();
    if (core.state === 'over') {
      this.overT += DT;
      if (this.overT > 10) { this.overT = 0; core.startMatch(); }
    }
    this.tickN++;
    if (this.rosterDirty) this.broadcastRoster();
    if (this.tickN % SNAPSHOT_EVERY === 0) {
      this.updateVisibility();
      for (const c of this.clients) if (c.player) this.send(c, this.snapshotFor(c));
    }
    for (const c of this.clients) {
      if (!c.events.length) continue;
      while (c.events.length) this.send(c, P.encodeEvents(c.events.splice(0, 200)));
    }
  }

  handle(c, buf) {
    let m;
    try { m = P.decodeClient(buf); } catch { c.strikes++; if (c.strikes > 20) c.ws.close(1008, 'protocol error'); return; }
    switch (m.type) {
      case P.C2S.INPUT:
        if (!c.player || m.seq <= c.lastQueuedSeq) return;
        c.lastQueuedSeq = m.seq;
        if (c.inputs.length < 30) c.inputs.push(m);
        return;
      case P.C2S.CMD:
        if (!c.player) return;
        if (m.cmd === P.CMD.BUY && P.BUY_ITEMS[m.arg]) this.core.buyItem(c.player, P.BUY_ITEMS[m.arg]);
        if (m.cmd === P.CMD.TEAM) this.switchTeam(c, m.arg === 1 ? 'T' : 'CT');
        return;
      case P.C2S.PING:
        this.send(c, P.encodePong(m.t));
        return;
      default:
    }
  }
}
