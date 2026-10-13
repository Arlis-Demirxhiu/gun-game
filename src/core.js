import * as THREE from 'three';
import { createMap } from './map.js';
import { Bot, DIFFICULTY } from './bot.js';
import { WEAPONS, EQUIPMENT, AMMO, WEAPON_INFO, newWeapon } from './weapons.js';
import { REGION_MUL } from './actor.js';

// The game simulation: rounds, economy, bomb, items, combat and bots.
// No rendering, audio or DOM — it reports what happened through `emit(type, data)`.
// Offline, the browser runs it directly; online, the server runs it and is the only authority.

export const FREEZE_TIME = 4, ROUND_TIME = 115, BUY_TIME = 25, POST_TIME = 5, BOMB_TIME = 40, WIN_ROUNDS = 8;
export const TEAM_SIZE = 5;
const T_NAMES = ['Ivan', 'Boris', 'Yuri', 'Rafael', 'Hector', 'Omar', 'Karim', 'Dmitri', 'Anton'];
const CT_NAMES = ['Albert', 'Brett', 'Cliffe', 'Duke', 'Elliot', 'Frank', 'Gordon', 'Hank', 'Ike'];
const C4_DEF = { id: 'c4', name: 'C4', pen: 1 };

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const v1 = new THREE.Vector3();

// Stand-in body for headless bots (server): keeps the transform, renders nothing.
class NullBody {
  constructor() { this.root = new THREE.Object3D(); this.gun = null; }
  setGun() {}
  update() {}
  flinch() {}
  die() {}
  reset() {}
}

export class GameCore {
  // teamSize: players per side (1-5). maxBots: how many of the empty slots bots may fill.
  // mapId picks the map; teamSize defaults to the map's recommended size.
  constructor({ makeBody, removeBody, diff = 'normal', mapId = 'dust', teamSize = 0, maxBots = Infinity } = {}) {
    this.map = createMap(mapId);
    this.teamSize = Math.max(1, Math.min(TEAM_SIZE, teamSize | 0 || this.map.def.teamSize));
    this.maxBots = Math.max(0, maxBots);
    this.makeBody = makeBody || (() => new NullBody());
    this.removeBody = removeBody || (() => {});
    this.diff = DIFFICULTY[diff] || DIFFICULTY.normal;
    this.listeners = [];
    this.state = 'idle';
    this.time = 0;
    this.actors = [];
    this.bots = [];
    this.players = [];
    this.items = [];
    this.nades = []; // grenades in flight
    this.smokes = []; // active smoke clouds
    this.nextNadeId = 1;
    this.nextId = 1;
    this.nextItemId = 1;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.phase = 'freeze';
    this.phaseT = 0;
    this.roundT = ROUND_TIME;
    this.roundStart = 0;
    this.bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), site: null, timer: 0, beepT: 0, defuser: null, wasPlanted: false };
    // Server hook for lag compensation: wraps hit tests so targets are rewound to what the shooter saw.
    this.lagComp = (shooter, fn) => fn();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  // ---------- roster ----------

  allocId() {
    const used = new Set(this.actors.map((a) => a.id));
    while (used.has(this.nextId) || this.nextId === 0) this.nextId = (this.nextId % 250) + 1;
    return this.nextId++;
  }

  addActor(a) {
    a.id = this.allocId();
    this.actors.push(a);
    if (a.isBot) this.bots.push(a); else this.players.push(a);
    if (this.state === 'playing') {
      // Joined mid-round: sit out until the next round starts.
      a.alive = false;
      a.needsReset = true;
      a.resetLoadout();
      a.deathT = 99;
      const sp = this.map.spawnPoints(a.team)[0];
      a.pos.set(sp.x, this.map.groundAt(sp.x, sp.z, 0.4, sp.y), sp.z);
    } else if (this.state === 'waiting') this.spawnWarmup(a);
    return a;
  }

  removeActor(a) {
    if (a.hasBomb) this.dropBomb(a);
    if (this.bomb.defuser === a) this.bomb.defuser = null;
    this.actors = this.actors.filter((x) => x !== a);
    this.bots = this.bots.filter((x) => x !== a);
    this.players = this.players.filter((x) => x !== a);
    if (a.isBot) a.remove();
    for (const b of this.bots) if (b.target === a) b.target = null;
  }

  addBot(team) {
    const used = new Set(this.actors.map((a) => a.name));
    const pool = shuffle([...(team === 'T' ? T_NAMES : CT_NAMES)]);
    const name = pool.find((n) => !used.has(n)) || `Bot${this.nextId}`;
    return this.addActor(new Bot(this, team, name));
  }

  // Fill empty slots with bots, up to maxBots in total, keeping the sides as even as possible.
  // Humans always have priority: a bot leaves when a player needs its slot.
  balanceBots() {
    const humans = (t) => this.players.filter((p) => p.team === t).length;
    const free = { T: Math.max(0, this.teamSize - humans('T')), CT: Math.max(0, this.teamSize - humans('CT')) };
    let budget = Math.min(this.maxBots, free.T + free.CT);
    const want = { T: 0, CT: 0 };
    while (budget > 0) {
      // Give the next bot to the side with fewer members (humans + bots so far).
      const sizeT = this.teamSize - free.T + want.T, sizeCT = this.teamSize - free.CT + want.CT;
      const team = want.T >= free.T ? 'CT' : want.CT >= free.CT ? 'T' : sizeT <= sizeCT ? 'T' : 'CT';
      want[team]++;
      budget--;
    }
    for (const team of ['T', 'CT']) {
      const bots = () => this.bots.filter((b) => b.team === team);
      while (bots().length < want[team]) this.addBot(team);
      while (bots().length > want[team]) this.removeActor([...bots()].sort((a, b) => a.alive - b.alive)[0]);
    }
    this.updateReadiness();
  }

  // A match needs someone on both sides; otherwise the room waits in warmup.
  teamsReady() {
    return this.actors.some((a) => a.team === 'T') && this.actors.some((a) => a.team === 'CT');
  }

  updateReadiness() {
    if (!this.actors.length) return;
    const ready = this.teamsReady();
    if (ready && (this.state === 'idle' || this.state === 'waiting')) this.startMatch();
    else if (!ready && this.state !== 'waiting') this.enterWarmup();
  }

  enterWarmup() {
    this.state = 'waiting';
    this.phase = 'warmup';
    this.clearItems();
    Object.assign(this.bomb, { state: 'none', carrier: null, defuser: null });
    for (const a of this.actors) this.spawnWarmup(a);
    this.emit('announce', { text: 'Waiting for players…', sub: 'The match starts when both teams have someone', dur: 4 });
  }

  spawnWarmup(a) {
    a.resetLoadout();
    a.needsReset = false;
    a.hasBomb = false;
    a.alive = true;
    a.health = 100;
    const sp = this.map.spawnPoints(a.team)[0];
    a.spawn(sp.x, sp.z, a.team === 'T' ? 0 : Math.PI);
    a.pos.y = this.map.groundAt(sp.x, sp.z, 0.4, sp.y);
  }

  // ---------- match & rounds ----------

  startMatch() {
    this.clearItems();
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.state = 'playing';
    for (const a of this.actors) {
      a.kills = 0;
      a.deaths = 0;
      a.money = 80000;
      a.needsReset = true;
    }
    this.startRound();
  }

  startRound() {
    this.round++;
    this.phase = 'freeze';
    this.phaseT = FREEZE_TIME;
    this.roundT = ROUND_TIME;
    this.roundStart = this.time;
    this.buyExpired = false;
    this.clearItems();
    const b = this.bomb;
    Object.assign(b, { state: 'none', carrier: null, site: null, timer: 0, defuser: null, wasPlanted: false, wasDropped: false });
    for (const a of this.actors) a.hasBomb = false;

    const spawns = { T: this.map.spawnPoints('T'), CT: this.map.spawnPoints('CT') };
    const { x: cx, z: cz } = this.map.center;
    for (const a of this.actors) {
      if (!a.alive || a.needsReset) a.resetLoadout();
      a.needsReset = false;
      a.refillAmmo();
      a.alive = true;
      a.health = 100;
      const s = spawns[a.team].pop() || this.map.spawnPoints(a.team)[0];
      a.spawn(s.x, s.z, Math.atan2(-(cx - s.x), -(cz - s.z)) + (Math.random() - 0.5) * 0.4);
      a.pos.y = this.map.groundAt(s.x, s.z, 0.4, s.y); // spawns can be on raised floors
    }
    const ts = this.actors.filter((a) => a.team === 'T');
    if (ts.length) this.giveBomb(ts[(Math.random() * ts.length) | 0]);

    const tSite = Math.random() < 0.5 ? 'A' : 'B';
    const ctSites = shuffle(['A', 'B', 'A', 'B', Math.random() < 0.5 ? 'A' : 'B']);
    let ci = 0;
    for (const bot of this.bots) {
      bot.plan(bot.team === 'T' ? tSite : ctSites[ci++ % ctSites.length]);
      bot.buy();
    }
    this.emit('roundStart', { round: this.round });
    this.emit('announce', { text: `Round ${this.round}`, dur: 2 });
    for (const p of this.players) {
      if (p.hasBomb) this.emit('notify', { to: p, text: 'You have the C4! Hold E inside bombsite A or B to plant it.', dur: 6 });
      else this.emit('notify', { to: p, text: 'Press B to open the buy menu', dur: 4 });
    }
  }

  endRound(winner, reason) {
    if (this.phase === 'post') return;
    this.phase = 'post';
    this.phaseT = POST_TIME;
    this.score[winner]++;
    const loser = winner === 'T' ? 'CT' : 'T';
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 5);
    const winMoney = reason === 'bomb' || reason === 'defuse' ? 3500 : 3250;
    const lossMoney = 1400 + 500 * (this.lossStreak[loser] - 1);
    for (const a of this.actors) {
      a.money += a.team === winner ? winMoney : lossMoney;
      if (a.team === 'T' && loser === 'T' && this.bomb.wasPlanted) a.money += 800;
      a.money = Math.min(16000, a.money);
      if (a.task) a.cancelTask?.();
    }
    const msg = winner === 'T' ? 'Terrorists Win!' : 'Counter-Terrorists Win!';
    const sub = { bomb: 'Target Successfully Bombed!', defuse: 'The bomb has been defused!', time: 'Target has been saved!' }[reason];
    this.emit('roundEnd', { winner, reason });
    this.emit('announce', { text: msg, sub, dur: POST_TIME - 0.5, cls: winner });
    this.emit('say', { text: reason === 'defuse' ? 'Bomb has been defused. Counter-Terrorists win.' : winner === 'T' ? 'Terrorists win.' : 'Counter-Terrorists win.' });
  }

  updatePhase(dt) {
    if (this.phase === 'freeze') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.emit('say', { text: Math.random() < 0.5 ? 'Go, go, go!' : "Let's move out!" });
      }
    } else if (this.phase === 'live') {
      if (this.bomb.state !== 'planted') this.roundT -= dt;
    } else if (this.phase === 'post') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.score.T >= WIN_ROUNDS || this.score.CT >= WIN_ROUNDS) {
          this.state = 'over';
          this.phase = 'over';
          this.emit('matchEnd', { winner: this.score.T >= WIN_ROUNDS ? 'T' : 'CT', score: { ...this.score } });
        } else this.startRound();
      }
    }
    if (!this.buyExpired && this.time - this.roundStart > BUY_TIME) {
      this.buyExpired = true;
      if (this.phase === 'live') for (const p of this.players) if (p.alive) this.emit('notify', { to: p, text: 'Buy time has expired', dur: 2 });
    }
  }

  checkRoundEnd() {
    if (this.phase !== 'live') return;
    let aliveT = 0, aliveCT = 0;
    for (const a of this.actors) if (a.alive) a.team === 'T' ? aliveT++ : aliveCT++;
    if (this.bomb.state === 'planted') {
      if (aliveCT === 0) this.endRound('T', 'elim');
    } else if (aliveT === 0) this.endRound('CT', 'elim');
    else if (aliveCT === 0) this.endRound('T', 'elim');
    else if (this.roundT <= 0) this.endRound('CT', 'time');
  }

  // One fixed simulation step. `updateHumans(dt)` advances player-controlled actors.
  step(dt, updateHumans) {
    this.time += dt;
    if (this.state === 'waiting') { updateHumans(dt); return; } // warmup: walk around, no rounds
    if (this.state !== 'playing') return;
    this.updatePhase(dt);
    if (this.state !== 'playing') return;
    updateHumans(dt);
    for (const b of this.bots) b.update(dt);
    this.updateBomb(dt);
    this.updateNades(dt);
    this.updateItems();
    this.checkRoundEnd();
  }

  // ---------- bomb ----------

  giveBomb(a) {
    const b = this.bomb;
    b.state = 'carried';
    b.carrier = a;
    a.hasBomb = true;
    if (a.isBot) a.viaDone = a.viaDone || b.wasDropped;
  }

  dropBomb(a) {
    const b = this.bomb;
    a.hasBomb = false;
    b.state = 'dropped';
    b.carrier = null;
    b.wasDropped = true;
    b.pos.set(a.pos.x, this.map.groundAt(a.pos.x, a.pos.z, 0.05, a.pos.y), a.pos.z);
    for (const p of this.players) if (p.team === a.team) this.emit('notify', { to: p, text: 'The bomb has been dropped!', dur: 3 });
  }

  plantBomb(a) {
    const b = this.bomb;
    a.hasBomb = false;
    b.state = 'planted';
    b.carrier = null;
    b.wasPlanted = true;
    b.pos.set(a.pos.x, a.pos.y, a.pos.z);
    b.site = this.map.siteAt(a.pos.x, a.pos.z) || 'A';
    b.timer = BOMB_TIME;
    b.beepT = 0;
    b.defuser = null;
    a.money = Math.min(16000, a.money + 300);
    this.emit('announce', { text: 'The bomb has been planted!', dur: 3, cls: 'T' });
    this.emit('say', { text: 'Bomb has been planted.' });
    for (const bot of this.bots) { bot.goalType = null; bot.path = []; }
  }

  defuseBomb(a) {
    const b = this.bomb;
    if (b.state !== 'planted') return;
    b.state = 'defused';
    b.defuser = null;
    a.money = Math.min(16000, a.money + 300);
    this.endRound('CT', 'defuse');
  }

  explode() {
    const b = this.bomb;
    b.state = 'exploded';
    this.emit('explosion', { pos: b.pos.clone() });
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(b.pos);
      if (d < 32) this.damage(a, null, C4_DEF, 600 * Math.pow(1 - d / 32, 2), 'chest');
    }
    this.endRound('T', 'bomb');
  }

  updateBomb(dt) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      for (const a of this.actors) {
        if (a.alive && a.team === 'T' && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 1.1 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
          this.giveBomb(a);
          if (a.isPlayer) {
            this.emit('notify', { to: a, text: 'You picked up the bomb!', dur: 3 });
            this.emit('sound', { name: 'pickup', to: a });
          }
          break;
        }
      }
    }
    if (b.state === 'planted' && this.phase === 'live') {
      b.timer -= dt;
      b.beepT -= dt;
      if (b.beepT <= 0) {
        b.beepT = Math.max(0.12, Math.min(1.4, (b.timer / BOMB_TIME) * 1.4));
        this.emit('sound', { name: 'beep', pos: b.pos.clone() });
      }
      if (b.timer <= 0) this.explode();
    }
  }

  // ---------- items ----------

  spawnItem(w, pos, dropper = null, yaw = null) {
    let x = pos.x, z = pos.z;
    if (yaw !== null) {
      const tx = x - Math.sin(yaw) * 1.2, tz = z - Math.cos(yaw) * 1.2;
      if (!this.map.collides(tx, pos.y + 0.1, tz, 0.25)) { x = tx; z = tz; }
    }
    const y = this.map.groundAt(x, z, 0.05, pos.y);
    this.items.push({ id: this.nextItemId++ % 65000 || 1, w, x, y, z, rot: Math.random() * Math.PI * 2, dropper, t: this.time });
    if (this.items.length > 24) this.items.shift();
  }

  clearItems() {
    this.items = [];
    this.nades = [];
    this.smokes = [];
  }

  dropActive(a) {
    const w = a.weapon;
    if (w.def.melee) return;
    a.inv[a.slot] = null;
    this.spawnItem(w, a.pos, a, a.yaw);
    a.switchTo(a.bestSlot(), true);
  }

  updateItems() {
    for (const it of [...this.items]) {
      for (const a of this.actors) {
        if (!a.alive) continue;
        if (a.isBot && it.w.def.slot !== 1) continue;
        if (it.dropper === a && this.time - it.t < 1.5) continue;
        if (a.inv[it.w.def.slot]) continue;
        if (Math.hypot(a.pos.x - it.x, a.pos.z - it.z) > 1.1 || Math.abs(a.pos.y - it.y) > 1.3) continue;
        a.inv[it.w.def.slot] = it.w;
        this.items = this.items.filter((x) => x !== it);
        if (a.isPlayer) {
          this.emit('sound', { name: 'pickup', to: a });
          if (it.w.def.slot < a.slot) a.switchTo(it.w.def.slot);
        } else a.switchTo(a.bestSlot());
        break;
      }
    }
  }

  // ---------- buying ----------

  buyTimeLeft() { return Math.max(0, BUY_TIME - (this.time - this.roundStart)); }

  canBuy(p) {
    return !!p && p.alive && this.phase !== 'post' && this.phase !== 'over' && this.buyTimeLeft() > 0 &&
      this.map.inBuyZone(p.pos.x, p.pos.z, p.team);
  }

  buyItem(p, id) {
    const W = WEAPONS[id], item = W || EQUIPMENT[id];
    const say = (text) => this.emit('notify', { to: p, text, dur: 1.5 });
    if (id === 'ammo1' || id === 'ammo2') return this.buyAmmo(p, id === 'ammo1' ? 1 : 2, say);
    if (!item || !this.canBuy(p)) return;
    if (item.team && item.team !== p.team) return;
    let price = item.price;
    if (id === 'kevlar' && p.armor >= 100) return say('You already have kevlar.');
    if (id === 'helmet') {
      if (p.armor >= 100 && p.helmet) return say('You already have kevlar and a helmet.');
      if (p.armor >= 100) price = 350;
    }
    if (id === 'defuse' && p.hasKit) return say('You already have a defuse kit.');
    if (W && W.nade && p.nades[id] >= W.max) return say(W.max > 1 ? `You can't carry more than ${W.max} ${W.name}s.` : `You already have a ${W.name}.`);
    if (W && !W.nade && p.inv[W.slot] && p.inv[W.slot].def.id === id) return say(`You already have a ${W.name}.`);
    if (p.money < price) {
      this.emit('sound', { name: 'dry', to: p });
      return say('Insufficient funds!');
    }
    p.money -= price;
    if (W && W.nade) {
      p.nades[id]++;
      if (!p.nadeSel) p.nadeSel = id;
      p.syncNades();
    } else if (W) {
      const old = p.inv[W.slot];
      if (old) this.spawnItem(old, p.pos, p, p.yaw);
      p.inv[W.slot] = newWeapon(id);
      p.switchTo(W.slot, true);
    } else if (id === 'kevlar') p.armor = 100;
    else if (id === 'helmet') { p.armor = 100; p.helmet = true; }
    else if (id === 'defuse') p.hasKit = true;
    this.emit('sound', { name: 'buy', to: p });
  }

  // One box of ammo for the primary (slot 1) or secondary (slot 2) weapon.
  buyAmmo(p, slot, say) {
    if (!this.canBuy(p)) return;
    const w = p.inv[slot];
    if (!w) return say(slot === 1 ? "You don't have a primary weapon." : "You don't have a secondary weapon.");
    const pack = AMMO[WEAPON_INFO[w.def.id]?.ammo];
    if (!pack) return;
    if (w.reserve >= w.def.reserve) return say('You cannot carry any more ammo.');
    if (p.money < pack.price) {
      this.emit('sound', { name: 'dry', to: p });
      return say('Insufficient funds!');
    }
    p.money -= pack.price;
    w.reserve = Math.min(w.def.reserve, w.reserve + pack.rounds);
    this.emit('sound', { name: 'pickup', to: p });
  }

  // ---------- combat ----------

  canSee(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    if (this.smokeBlocks(from, to)) return false;
    return !this.map.raycast(from.x, from.y, from.z, dx / d, dy / d, dz / d, d - 0.05);
  }

  // ---------- grenades ----------

  smokeRadius(s) {
    const age = this.time - s.start, left = s.until - this.time;
    return s.r * Math.min(1, age / 1.2) * Math.min(1, left / 1.5);
  }

  // Does the segment a->b pass through any smoke cloud?
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      const r = this.smokeRadius(s) * 0.85;
      if (r < 0.5) continue;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((s.pos.x - a.x) * abx + (s.pos.y - a.y) * aby + (s.pos.z - a.z) * abz) / len2));
      const cx = a.x + abx * t - s.pos.x, cy = a.y + aby * t - s.pos.y, cz = a.z + abz * t - s.pos.z;
      if (cx * cx + cy * cy + cz * cz < r * r) return true;
    }
    return false;
  }

  throwNade(owner, type, origin, vel) {
    const def = WEAPONS[type];
    this.nades.push({ id: this.nextNadeId++ % 65000 || 1, type, owner, team: owner.team, pos: origin.clone(), vel: vel.clone(), fuse: def.fuse, rest: false });
    this.emit('sound', { name: 'throw', src: owner, pos: origin.clone() });
  }

  updateNades(dt) {
    for (const s of this.smokes) if (this.time > s.until) s.dead = true;
    this.smokes = this.smokes.filter((s) => !s.dead);
    for (const n of this.nades) {
      n.fuse -= dt;
      if (!n.rest) this.moveNade(n, dt);
      if (n.fuse <= 0) { n.done = true; this.detonate(n); }
    }
    this.nades = this.nades.filter((n) => !n.done);
  }

  // Ballistic flight with bounces off the height-field map.
  moveNade(n, dt) {
    n.vel.y -= 20 * dt;
    let remaining = dt;
    for (let i = 0; i < 3 && remaining > 0; i++) {
      const speed = n.vel.length();
      if (speed < 1e-4) break;
      const step = speed * remaining;
      const d = v1.copy(n.vel).divideScalar(speed);
      const hit = this.map.raycast(n.pos.x, n.pos.y, n.pos.z, d.x, d.y, d.z, step);
      if (!hit) { n.pos.addScaledVector(n.vel, remaining); break; }
      n.pos.addScaledVector(d, Math.max(0, hit.t - 0.03));
      remaining *= 1 - hit.t / step;
      // Reflect and lose energy; floors also add friction.
      const nrm = { x: hit.nx, y: hit.ny, z: hit.nz };
      const vn = n.vel.x * nrm.x + n.vel.y * nrm.y + n.vel.z * nrm.z;
      n.vel.x -= 1.45 * vn * nrm.x; n.vel.y -= 1.45 * vn * nrm.y; n.vel.z -= 1.45 * vn * nrm.z;
      n.vel.multiplyScalar(nrm.y > 0.5 ? 0.6 : 0.75);
      if (Math.abs(vn) > 2.5) this.emit('sound', { name: 'bounce', pos: n.pos.clone() });
      if (nrm.y > 0.5 && n.vel.length() < 1.2) { n.vel.set(0, 0, 0); n.rest = true; break; }
    }
    if (n.pos.y < 0.05) { n.pos.y = 0.05; if (n.vel.y < 0) n.vel.y = 0; }
  }

  detonate(n) {
    const def = WEAPONS[n.type];
    const pos = n.pos.clone();
    pos.y = Math.max(pos.y, 0.12);
    this.emit('nade', { type: def.nade, pos: pos.clone() });
    if (def.nade === 'he') {
      for (const a of this.actors) {
        if (!a.alive || (a.team === n.team && a !== n.owner)) continue; // no team damage, but you can hurt yourself
        const target = a.chestPos();
        const d = target.distanceTo(pos);
        if (d > def.radius || !this.canSeeNoSmoke(pos, target)) continue;
        this.damage(a, n.owner, def, def.dmg * Math.pow(1 - d / def.radius, 1.4), 'chest');
      }
      this.noise(pos, n.team, 40);
    } else if (def.nade === 'flash') {
      for (const a of this.actors) {
        if (!a.alive) continue;
        const eye = a.eye();
        const d = eye.distanceTo(pos);
        if (d > 30 || !this.canSeeNoSmoke(pos, eye)) continue;
        // Facing the flash blinds fully; looking away still dazzles a little.
        const yaw = a.isBot ? a.aimYaw : a.yaw, pitch = a.isBot ? a.aimPitch : a.pitch;
        const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const dot = fwd.dot(pos.clone().sub(eye).normalize());
        const facing = dot > 0.5 ? 1 : dot > 0 ? 0.65 : 0.25;
        const amount = Math.min(1, facing * (1 - Math.max(0, d - 6) / 24));
        if (amount < 0.08) continue;
        if (a.isBot) a.blindUntil = this.time + 4.5 * amount;
        else this.emit('flashed', { to: a, amount });
      }
    } else if (def.nade === 'smoke') {
      this.smokes.push({ id: n.id, pos, r: def.radius, start: this.time, until: this.time + def.duration });
    }
  }

  canSeeNoSmoke(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.map.raycast(from.x, from.y, from.z, dx / d, dy / d, dz / d, d - 0.05);
  }

  fireBullet(shooter, origin, dir, def) {
    return this.lagComp(shooter, () => {
      const range = 300;
      const wall = this.map.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
      let maxT = wall ? wall.t : range;
      let hit = null, hitActor = null;
      for (const a of this.actors) {
        if (a === shooter || !a.alive || a.team === shooter.team) continue;
        const h = a.hitTest(origin, dir, maxT);
        if (h) { maxT = h.t; hit = h; hitActor = a; }
      }
      const end = origin.clone().addScaledVector(dir, maxT);
      if (hitActor) {
        const dmg = def.dmg * REGION_MUL[hit.region] * Math.pow(def.rangeMod ?? 1, maxT / 12.7);
        this.emit('blood', { pos: end.clone(), dir: dir.clone() });
        this.damage(hitActor, shooter, def, dmg, hit.region);
      } else if (wall) {
        this.emit('impact', { pos: end.clone(), normal: v1.set(wall.nx, wall.ny, wall.nz).clone() });
      }
      return { end, hitActor };
    });
  }

  meleeHit(attacker, eye, dir, def, stab) {
    return this.lagComp(attacker, () => {
      const wall = this.map.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range);
      const maxT = wall ? wall.t : def.range;
      let best = null, bestA = null;
      const low = dir.clone();
      low.y -= 0.25;
      low.normalize();
      for (const a of this.actors) {
        if (a === attacker || !a.alive || a.team === attacker.team) continue;
        const h = a.hitTest(eye, dir, maxT) || a.hitTest(eye, low, maxT);
        if (h && (!best || h.t < best.t)) { best = h; bestA = a; }
      }
      if (bestA) {
        let dmg = stab ? def.dmg2 : def.dmg;
        const behind = Math.cos(attacker.yaw - bestA.yaw) > 0.5;
        if (behind) dmg *= stab ? 3 : 2;
        if (best.region === 'head') dmg *= 1.3;
        this.emit('blood', { pos: eye.clone().addScaledVector(dir, best.t), dir: dir.clone() });
        this.damage(bestA, attacker, def, dmg, 'chest');
        return 'flesh';
      }
      if (wall) {
        this.emit('impact', { pos: eye.clone().addScaledVector(dir, wall.t), normal: new THREE.Vector3(wall.nx, wall.ny, wall.nz), noHole: true });
        return 'wall';
      }
      return 'air';
    });
  }

  damage(victim, attacker, def, amount, region) {
    if (!victim.alive || this.state !== 'playing') return;
    const hpBefore = victim.health, armorBefore = victim.armor;
    let hp = amount;
    const armored = victim.armor > 0 && region !== 'legs' && (region !== 'head' || victim.helmet);
    if (armored) {
      let newHp = amount * (def.pen ?? 0.5);
      let armorDmg = (amount - newHp) * 0.5;
      if (armorDmg > victim.armor) {
        armorDmg = victim.armor;
        newHp = amount - armorDmg * 2;
      }
      victim.armor = Math.max(0, Math.round(victim.armor - armorDmg));
      hp = newHp;
    }
    hp = Math.max(1, Math.round(hp));
    victim.health -= hp;
    if (victim.isPlayer) {
      victim.punchP = (victim.punchP || 0) + (1.2 * Math.PI) / 180;
      this.emit('hurt', {
        to: victim, from: attacker, def, region,
        hp: Math.min(hp, Math.max(0, Math.ceil(hpBefore))), armor: armorBefore - victim.armor,
        dist: attacker ? attacker.pos.distanceTo(victim.pos) : null,
      });
    }
    if (victim.isBot) victim.onDamaged(attacker);
    if (region === 'head' && victim.helmet && victim.armor > 0) this.emit('helmet', { pos: victim.headPos() });
    if (attacker && attacker.isPlayer) this.emit('hitmark', { to: attacker, head: region === 'head' });
    if (victim.health <= 0) {
      victim.health = 0;
      this.kill(victim, attacker, def, region === 'head');
    }
  }

  kill(victim, attacker, def, hs) {
    victim.alive = false;
    victim.needsReset = true;
    victim.deaths++;
    if (attacker && attacker !== victim && attacker.team !== victim.team) {
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + 300);
    }
    this.emit('kill', { killer: attacker, victim, def, hs, pos: victim.headPos() });
    if (victim.hasBomb) this.dropBomb(victim);
    if (victim.inv[1]) this.spawnItem(victim.inv[1], victim.pos);
    if (this.bomb.defuser === victim) this.bomb.defuser = null;
    if (victim.isPlayer) {
      if (victim.task) victim.cancelTask();
      victim.scope = 0;
      victim.deathT = 0;
    }
    if (victim.isBot) victim.onDeath();
  }

  // Switch a human player's side mid-game (CS "chooseteam"): you die if alive and spawn with the new team
  // next round. Returns 'ok', 'same' or 'full'.
  changeTeam(p, team) {
    if (!['T', 'CT'].includes(team) || p.team === team) return 'same';
    if (this.players.filter((x) => x.team === team).length >= this.teamSize) return 'full';
    if (p.hasBomb) this.dropBomb(p);
    if (this.bomb.defuser === p) this.bomb.defuser = null;
    if (p.alive && this.state === 'playing') {
      // Leave the round quietly (no kill credit, no death report) and watch until the next one.
      if (p.inv[1]) this.spawnItem(p.inv[1], p.pos);
      if (p.task) p.cancelTask();
      p.alive = false;
      p.scope = 0;
      p.deathT = 99;
    }
    p.team = team;
    p.needsReset = true;
    p.resetLoadout();
    this.balanceBots();
    if (this.state === 'waiting') this.spawnWarmup(p);
    else if (this.state === 'playing') {
      this.emit('notify', { to: p, text: `You will play as a ${team === 'T' ? 'Terrorist' : 'Counter-Terrorist'} from the next round`, dur: 4 });
    }
    return 'ok';
  }

  noise(pos, team, radius) {
    for (const b of this.bots) {
      if (!b.alive || b.team === team) continue;
      if (b.pos.distanceTo(pos) < radius * this.diff.hearing) b.hear(pos);
    }
  }

  closestBot(pos, team) {
    let best = null, bd = Infinity;
    for (const b of this.bots) {
      if (!b.alive || b.team !== team) continue;
      const d = b.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
