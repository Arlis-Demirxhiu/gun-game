import * as THREE from 'three';
import { Actor } from './actor.js';
import { WEAPONS, newWeapon } from './weapons.js';

const DEG = Math.PI / 180;

export const DIFFICULTY = {
  easy: { reaction: [0.55, 0.9], err: 7 * DEG, settle: 1.8, turn: 220 * DEG, head: 0.12, fov: 55 * DEG, hearing: 0.6, comp: 0.2, burst: [2, 4] },
  normal: { reaction: [0.3, 0.5], err: 4.5 * DEG, settle: 2.8, turn: 360 * DEG, head: 0.28, fov: 65 * DEG, hearing: 0.85, comp: 0.5, burst: [3, 6] },
  hard: { reaction: [0.16, 0.28], err: 2.5 * DEG, settle: 4.5, turn: 560 * DEG, head: 0.45, fov: 75 * DEG, hearing: 1, comp: 0.75, burst: [4, 9] },
};

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------- bot ----------

export class Bot extends Actor {
  constructor(game, team, name) {
    super(game, team, name);
    this.isBot = true;
    this.body = game.makeBody(team);
    this.aimYaw = 0; this.aimPitch = 0; this.desYaw = 0; this.desPitch = 0;
    this.path = []; this.pathIdx = 0; this.goal = null; this.goalType = null;
    this.target = null; this.targetVisible = false; this.lastSeen = -99; this.lastSeenPos = new THREE.Vector3();
    this.reactT = 0; this.errYaw = 0; this.errPitch = 0; this.aimHead = false;
    this.burst = 0; this.burstLen = 4; this.burstPause = 0;
    this.thinkT = Math.random() * 0.2; this.strafeDir = 0; this.strafeT = 0;
    this.stuckT = 0; this.stuckPos = new THREE.Vector3();
    this.walkPhase = 0; this.deathT = 0; this.stepT = 0;
    this.holdUntil = 0; this.watchPts = null; this.watchPt = null; this.watchSwitch = 0;
    this.alertPos = new THREE.Vector3(); this.alertT = 0; this.hurtT = -99;
    this.task = null; this.waitT = 0; this.gunId = null; this.lastShotT = -99;
  }

  get diff() { return this.game.diff; }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = this.aimYaw = this.desYaw = yaw;
    this.aimPitch = this.desPitch = 0;
    this.deathT = 0;
    this.reloading = false;
    this.spray = 0;
    this.deployT = 0;
    this.target = null;
    this.targetVisible = false;
    this.path = [];
    this.goal = null;
    this.goalType = null;
    this.task = null;
    this.alertT = 0;
    this.burstPause = 0;
    this.body.reset();
    const r = this.body.root;
    r.visible = true;
    r.rotation.set(0, yaw, 0);
    r.position.copy(this.pos);
    this.slot = this.bestSlot();
    this.refreshGun();
  }

  plan(site) {
    const map = this.game.map;
    this.site = site;
    this.via = this.team === 'T' ? pick(map.routes[site]) : null;
    this.viaDone = !this.via;
    this.waitT = this.team === 'T' ? rand(0, 3) : rand(0, 1.5);
    this.holdUntil = 0;
    this.watchPts = null;
  }

  buy() {
    const T = this.team === 'T';
    if (!this.inv[1]) {
      // Weighted pick among what this team can afford (keeping $650+ for armor when possible).
      const prefs = T
        ? [['ak47', 10], ['awp', 2], ['sg552', 2], ['galil', 3], ['m249', 0.4], ['g3sg1', 0.4], ['scout', 1], ['mac10', 2], ['ump45', 1.5], ['p90', 1.5], ['mp5', 1.5], ['m3', 0.8], ['xm1014', 0.8]]
        : [['m4a1', 10], ['awp', 2], ['aug', 2], ['famas', 3], ['m249', 0.3], ['sg550', 0.4], ['scout', 1], ['tmp', 1.5], ['ump45', 1.5], ['p90', 1.5], ['mp5', 1.5], ['m3', 0.8], ['xm1014', 0.8]];
      const budget = this.money - (this.money >= 3000 ? 650 : 0);
      let opts = prefs.filter(([w]) => WEAPONS[w].price <= budget);
      // Rich enough for a rifle: don't settle for an SMG most of the time.
      if (opts.some(([w]) => w === (T ? 'ak47' : 'm4a1')) && Math.random() < 0.8) opts = opts.filter(([w]) => WEAPONS[w].price >= 2000);
      if (this.money < 1500 || (budget < 2000 && Math.random() < 0.35)) opts = [];
      let id = null, r = Math.random() * opts.reduce((t, o) => t + o[1], 0);
      for (const [w, wt] of opts) if ((r -= wt) <= 0) { id = w; break; }
      if (id) {
        this.money -= WEAPONS[id].price;
        this.inv[1] = newWeapon(id);
      }
    }
    if (this.armor < 100) {
      if (this.money >= 1000) { this.money -= 1000; this.armor = 100; this.helmet = true; }
      else if (this.money >= 650) { this.money -= 650; this.armor = 100; }
    }
    if (!this.inv[1] && ['glock', 'usp'].includes(this.inv[2].def.id) && this.money >= 600 && Math.random() < 0.6) {
      const id = this.money >= 650 && Math.random() < 0.6 ? 'deagle' : T ? 'p228' : pick(['p228', 'fiveseven']);
      if (this.money >= WEAPONS[id].price) {
        this.money -= WEAPONS[id].price;
        this.inv[2] = newWeapon(id);
      }
    }
    if (!T && !this.hasKit && this.money >= 200 && Math.random() < 0.6) {
      this.money -= 200;
      this.hasKit = true;
    }
    // Spare cash goes on grenades.
    for (const [id, chance] of [['hegrenade', 0.5], ['flashbang', 0.3], ['smokegrenade', 0.25]]) {
      const def = WEAPONS[id];
      if (this.money >= def.price + 200 && this.nades[id] < def.max && Math.random() < chance) {
        this.money -= def.price;
        this.nades[id]++;
      }
    }
    this.syncNades();
    this.slot = this.bestSlot();
    this.refreshGun();
  }

  refreshGun() {
    this.body.setGun(this.weapon.def.id);
  }

  switchTo(slot) {
    if (!this.inv[slot] || slot === this.slot) return;
    this.slot = slot;
    this.reloading = false;
    this.deployT = 0.6;
    this.refreshGun();
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) { this.animateDeath(dt); return; }
    if (this.deployT > 0) this.deployT -= dt;
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.weapon.def.reload) this.finishReload();
    }
    const sp = this.weapon.def.spread;
    if (sp) this.spray = Math.max(0, this.spray - (dt * sp.max) / sp.recover);
    if (this.burstPause > 0) this.burstPause -= dt;
    if (this.alertT > 0) this.alertT -= dt;

    let move = null, mul = 1;
    if (g.phase !== 'freeze') {
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = rand(0.1, 0.18);
        this.perceive();
        this.think();
      }
      if (this.waitT > 0) this.waitT -= dt;
      if (this.task) this.doTask(dt);
      else if (this.target && this.targetVisible) [move, mul] = this.combat(dt);
      else {
        if (this.waitT <= 0) move = this.followPath();
        this.lookIdle(move);
      }
      const w = this.weapon;
      if (!this.target && !this.reloading && !w.def.melee && w.mag < w.def.mag * 0.5 && w.reserve > 0) this.startReload();
      if (!this.target && this.slot !== this.bestSlot() && !this.reloading) this.switchTo(this.bestSlot());
    }
    this.turn(dt);
    this.applyMove(dt, move, mul);
    this.animate(dt);
  }

  perceive() {
    const g = this.game, d = this.diff;
    if (g.time < (this.blindUntil || 0)) { this.targetVisible = false; return; } // flashed
    const eye = this.eye(v1);
    let best = null, bestScore = Infinity;
    for (const e of g.actors) {
      if (!e.alive || e.team === this.team) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      // Pistols don't pick fights across the map; rifles and the AWP reach further.
      const def = this.weapon.def;
      if (dist > (def.pellets ? 30 : def.slot === 2 ? 45 : def.scope ? 100 : 75)) continue;
      const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - this.aimYaw));
      const aware = e === this.target || g.time - this.hurtT < 1.5 || dist < 3.5;
      if (ang > d.fov && !aware) continue;
      if (!g.canSee(eye, e.headPos(v2)) && !g.canSee(eye, e.chestPos(v2))) continue;
      const score = dist * (e === this.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) this.acquire(best, best === this.target);
      this.targetVisible = true;
      this.lastSeen = g.time;
      this.lastSeenPos.copy(best.pos);
    } else this.targetVisible = false;
  }

  acquire(e, reacquire) {
    const d = this.diff;
    this.target = e;
    const dist = this.pos.distanceTo(e.pos);
    if (!reacquire && dist > 10 && dist < 26 && Math.random() < 0.3) this.throwAt('hegrenade', e.pos);
    const r = rand(d.reaction[0], d.reaction[1]);
    this.reactT = reacquire ? r * 0.4 : r;
    this.errYaw = (Math.random() < 0.5 ? -1 : 1) * d.err * rand(0.5, 1.2);
    this.errPitch = (Math.random() - 0.6) * d.err * 0.6;
    this.aimHead = Math.random() < d.head;
    this.burst = 0;
    this.burstLen = Math.round(rand(d.burst[0], d.burst[1]));
    this.strafeT = 0;
  }

  think() {
    const g = this.game;
    if (this.target && !this.target.alive) { this.target = null; this.targetVisible = false; }
    if (this.target && this.targetVisible) return;
    if (this.task) return;
    if (this.target) {
      if (g.time - this.lastSeen > 3.5) this.target = null;
      else if (!(this.team === 'CT' && g.bomb.state === 'planted') && !this.hasBomb) {
        this.maybeThrowHE();
        this.setGoal(this.lastSeenPos, 'chase');
        return;
      }
    }
    if (this.team === 'T') this.thinkTerrorist();
    else this.thinkCT();
  }

  thinkTerrorist() {
    const g = this.game, bomb = g.bomb, map = g.map;
    if (this.hasBomb) {
      if (!this.viaDone) return this.goVia();
      if (map.siteAt(this.pos.x, this.pos.z) === this.site && this.goalType === 'plant' && this.pathDone()) {
        this.task = { type: 'plant', t: 0, dur: 3 };
        return;
      }
      if (this.goalType !== 'plant') this.setGoal(map.randomPointIn(map.sites[this.site]), 'plant');
      return;
    }
    if (bomb.state === 'dropped' && g.closestBot(bomb.pos, 'T') === this) {
      this.setGoal(bomb.pos, 'bomb');
      return;
    }
    if (bomb.state === 'planted') {
      if (this.goalType !== 'guard' || (this.pathDone() && g.time > this.holdUntil)) {
        this.setGoal(map.randomPointIn(map.sites[bomb.site]), 'guard');
        this.holdUntil = g.time + rand(6, 12);
        this.watchPts = map.watchT[bomb.site];
      }
      return;
    }
    if (!this.viaDone) return this.goVia();
    if (this.goalType !== 'site' || (this.pathDone() && g.time > this.holdUntil)) {
      if (this.goalType !== 'site' && map.watchT[this.site]) this.throwAt('smokegrenade', pick(map.watchT[this.site]));
      this.setGoal(map.randomPointIn(map.sites[this.site]), 'site');
      this.holdUntil = g.time + rand(5, 10);
      this.watchPts = map.watchT[this.site];
    }
  }

  goVia() {
    if (this.goalType !== 'via') this.setGoal(this.via, 'via');
    else if (this.pathDone()) this.viaDone = true;
  }

  thinkCT() {
    const g = this.game, bomb = g.bomb, map = g.map;
    if (bomb.state === 'planted') {
      const d = Math.hypot(this.pos.x - bomb.pos.x, this.pos.z - bomb.pos.z);
      if (!bomb.defuser && (d < 1.4 || (this.goalType === 'defuse' && this.pathDone() && d < 3))) {
        this.task = { type: 'defuse', t: 0, dur: this.hasKit ? 5 : 10 };
        bomb.defuser = this;
        this.path = [];
        return;
      }
      if (bomb.defuser && bomb.defuser !== this) {
        if (this.goalType !== 'cover' || (this.pathDone() && g.time > this.holdUntil)) {
          this.setGoal(map.randomPointIn(map.sites[bomb.site]), 'cover');
          this.holdUntil = g.time + rand(4, 8);
          this.watchPts = map.watchCT[bomb.site];
        }
      } else this.setGoal(bomb.pos, 'defuse');
      return;
    }
    if (this.goalType !== 'hold' || (this.pathDone() && g.time > this.holdUntil)) {
      this.setGoal(map.randomPointIn(map.sites[this.site]), 'hold');
      this.holdUntil = g.time + rand(10, 20);
      this.watchPts = map.watchCT[this.site];
    }
  }

  doTask(dt) {
    const g = this.game, t = this.task, bomb = g.bomb;
    if (this.targetVisible && this.target && t.dur - t.t > 1.5) {
      if (t.type === 'defuse' && bomb.defuser === this) bomb.defuser = null;
      this.task = null;
      return;
    }
    if ((t.type === 'defuse' && bomb.state !== 'planted') || (t.type === 'plant' && !this.hasBomb)) {
      this.task = null;
      return;
    }
    t.t += dt;
    this.desPitch = -0.7;
    if (t.t >= t.dur) {
      this.task = null;
      if (t.type === 'plant') g.plantBomb(this);
      else g.defuseBomb(this);
    }
  }

  combat(dt) {
    const g = this.game, d = this.diff, t = this.target;
    const eye = this.eye(v1);
    const aim = this.aimHead ? t.headPos(v2) : t.chestPos(v2).setY(t.pos.y + t.height() - 0.65);
    const dx = aim.x - eye.x, dy = aim.y - eye.y, dz = aim.z - eye.z;
    const flat = Math.hypot(dx, dz), dist = Math.hypot(flat, dy);
    const decay = Math.exp(-d.settle * dt);
    this.errYaw *= decay;
    this.errPitch *= decay;
    this.desYaw = Math.atan2(-dx, -dz) + this.errYaw;
    this.desPitch = Math.atan2(dy, flat) + this.errPitch;
    this.reactT -= dt;

    let w = this.weapon;
    if (!w.def.melee && w.mag === 0 && !this.reloading) {
      if (w.reserve > 0) this.startReload();
      else this.switchTo(this.bestSlot());
    } else if (w.def.melee && this.bestSlot() !== 3) this.switchTo(this.bestSlot());
    w = this.weapon;
    const def = w.def;

    const off = Math.hypot(wrap(this.desYaw - this.aimYaw), this.desPitch - this.aimPitch);
    const tol = Math.atan2(0.3, dist) * 1.8 + 0.01;
    let fireOk = this.reactT <= 0 && this.interruptReload() && this.deployT <= 0 && this.burstPause <= 0 && g.time >= this.nextFire && off < tol;
    if (def.melee) fireOk = fireOk && dist < 1.9;
    if (fireOk) this.fire(dist);

    let move = null, speed = 0.55;
    if (def.melee) {
      move = { x: dx / flat, z: dz / flat };
      speed = 1;
    } else {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = rand(0.35, 1.0);
        this.strafeDir = pick([-1, -1, 0, 1, 1]);
      }
      const still = def.scope || (this.burst > 0 && d.comp >= 0.5 && dist > 8);
      if (!still && this.strafeDir) {
        const r = this.aimYaw;
        move = { x: Math.cos(r) * this.strafeDir, z: -Math.sin(r) * this.strafeDir };
      }
    }
    return [move, speed];
  }

  fire(dist) {
    const g = this.game, w = this.weapon, def = w.def, d = this.diff;
    const eye = this.eye(new THREE.Vector3());
    if (def.melee) {
      this.nextFire = g.time + def.rate;
      g.meleeHit(this, eye, this.aimDir(this.aimYaw, this.aimPitch, 0), def, false);
      return;
    }
    w.mag--;
    this.lastShotT = g.time;
    this.nextFire = g.time + def.rate * (def.auto ? 1 : rand(1.4, 1.9)) + (def.bolt ? rand(0.2, 0.6) : 0);
    const sp = def.spread;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const spread = sp.base + sp.move * Math.min(1, Math.max(0, hs / def.speed - 0.34) / 0.66) + this.spray;
    this.spray = Math.min(sp.max, this.spray + sp.shot);
    let res = null;
    for (const dir of this.shotDirs(this.aimYaw, this.aimPitch, spread, def)) res = res || g.fireBullet(this, eye, dir, def);
    const muzzle = this.muzzle(v3);
    g.emit('shot', { src: this, def, from: muzzle.clone(), to: res.end, tracer: Math.random() < 0.7 });
    g.noise(this.pos, this.team, def.sound === 'silenced' ? 14 : 45);
    this.errPitch += def.kick * DEG * (1 - d.comp) * 0.5;
    this.errYaw += (Math.random() - 0.5) * def.kick * DEG * (1 - d.comp);
    this.burst++;
    if (this.burst >= this.burstLen) {
      this.burst = 0;
      this.burstPause = rand(0.2, 0.5) + (dist > 25 ? 0.3 : 0);
      this.burstLen = dist < 7 ? 30 : Math.round(rand(d.burst[0], d.burst[1]));
    }
  }

  // Throw a grenade so it lands near `tgt` (simple ballistic aim on flat ground).
  throwAt(type, tgt) {
    const g = this.game;
    if (!this.nades[type] || g.time < (this.nextNadeT || 0)) return false;
    const eye = this.eye(new THREE.Vector3());
    const dx = tgt.x - eye.x, dz = tgt.z - eye.z, dist = Math.hypot(dx, dz);
    if (dist < 6 || dist > 30) return false;
    const speed = 15;
    const angle = 0.5 * Math.asin(Math.min(1, (dist * 20) / (speed * speed)));
    const dir = new THREE.Vector3((dx / dist) * Math.cos(angle), Math.sin(angle), (dz / dist) * Math.cos(angle));
    const origin = eye.clone().addScaledVector(dir, 0.4);
    if (g.map.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 3)) return false; // would bounce straight back
    g.throwNade(this, type, origin, dir.multiplyScalar(speed));
    this.nades[type]--;
    this.syncNades();
    this.nextNadeT = g.time + 5;
    return true;
  }

  // Chasing a lost target: flash or frag the spot where it was last seen.
  maybeThrowHE() {
    if (Math.random() > 0.5) return;
    if (!this.throwAt('flashbang', this.lastSeenPos)) this.throwAt('hegrenade', this.lastSeenPos);
  }

  muzzle(out) {
    const gun = this.body.gun;
    if (gun) return gun.localToWorld(out.copy(gun.userData.muzzle));
    const y = this.aimYaw;
    return out.set(this.pos.x - Math.sin(y) * 0.8, this.pos.y + 1.35, this.pos.z - Math.cos(y) * 0.8);
  }

  setGoal(pos, type) {
    if (this.goal && this.goalType === type && Math.hypot(this.goal.x - pos.x, this.goal.z - pos.z) < 1 && !this.pathDone()) return;
    this.goal = { x: pos.x, z: pos.z, y: pos.y };
    this.goalType = type;
    this.path = this.game.map.findPath(this.pos.x, this.pos.z, pos.x, pos.z, this.pos.y, pos.y);
    this.pathIdx = 0;
  }

  pathDone() { return !this.path || this.pathIdx >= this.path.length; }

  followPath() {
    while (this.path && this.pathIdx < this.path.length) {
      const p = this.path[this.pathIdx];
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < (this.pathIdx === this.path.length - 1 ? 0.3 : 0.7)) { this.pathIdx++; continue; }
      return { x: dx / dist, z: dz / dist };
    }
    return null;
  }

  lookIdle(move) {
    const g = this.game;
    const lookAt = (p) => {
      this.desYaw = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
      this.desPitch = 0;
    };
    if (this.alertT > 0) return lookAt(this.alertPos);
    if (move) {
      this.desYaw = Math.atan2(-move.x, -move.z);
      this.desPitch = 0;
      return;
    }
    if (this.watchPts && this.watchPts.length) {
      if (!this.watchPt || g.time > this.watchSwitch) {
        this.watchPt = pick(this.watchPts);
        this.watchSwitch = g.time + rand(2, 5);
      }
      lookAt(this.watchPt);
    }
  }

  hear(pos) {
    if (this.targetVisible) return;
    this.alertPos.copy(pos);
    this.alertT = 2.5;
  }

  onDamaged(attacker) {
    this.hurtT = this.game.time;
    this.body.flinch();
    if (attacker && !this.targetVisible) {
      this.alertPos.copy(attacker.pos);
      this.alertT = 2;
      this.thinkT = 0;
    }
  }

  onDeath() {
    this.body.die();
    this.deathT = 0;
    this.task = null;
    this.reloading = false;
    this.target = null;
    if (this.game.bomb.defuser === this) this.game.bomb.defuser = null;
  }

  turn(dt) {
    const max = this.diff.turn * dt;
    const k = Math.min(1, dt * 12);
    this.aimYaw = wrap(this.aimYaw + clamp(wrap(this.desYaw - this.aimYaw) * k, -max, max));
    this.aimPitch = clamp(this.aimPitch + clamp((this.desPitch - this.aimPitch) * k, -max, max), -1.3, 1.3);
    this.yaw = this.aimYaw;
  }

  applyMove(dt, move, mul) {
    const def = this.weapon.def;
    const speed = this.task ? 0 : def.speed * mul;
    let tx = 0, tz = 0;
    if (move) { tx = move.x * speed; tz = move.z * speed; }
    for (const o of this.game.actors) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        tx += (dx / d) * 2.5;
        tz += (dz / d) * 2.5;
      }
    }
    const k = Math.min(1, dt * 10);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    const map = this.game.map, r = 0.35, p = this.pos;
    const nx = p.x + this.vel.x * dt;
    let y = map.moveTo(nx, p.y, p.z, r);
    if (y !== null) { p.x = nx; p.y = y; }
    else { this.vel.x = 0; if (this.target) this.strafeDir *= -1; }
    const nz = p.z + this.vel.z * dt;
    y = map.moveTo(p.x, p.y, nz, r);
    if (y !== null) { p.z = nz; p.y = y; }
    else { this.vel.z = 0; if (this.target) this.strafeDir *= -1; }
    // Follow the floor: step up stairs, fall off ledges.
    const ground = map.groundAt(p.x, p.z, r, p.y);
    if (ground >= p.y || (ground > p.y - 0.35 && !(this.vy < 0))) { p.y = ground; this.vy = 0; } // stick to stairs/ramps going down
    else { this.vy = (this.vy || 0) - 20 * dt; p.y = Math.max(ground, p.y + this.vy * dt); }

    if (move && !this.task && !this.targetVisible) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        if (p.distanceTo(this.stuckPos) < 0.4 && this.goal) {
          this.path = map.findPath(p.x + rand(-0.5, 0.5), p.z + rand(-0.5, 0.5), this.goal.x, this.goal.z, p.y, this.goal.y);
          this.pathIdx = 0;
          this.vel.x += rand(-3, 3);
          this.vel.z += rand(-3, 3);
        }
        this.stuckT = 0;
        this.stuckPos.copy(p);
      }
    } else {
      this.stuckT = 0;
      this.stuckPos.copy(p);
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 3) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.38;
        this.game.emit('sound', { name: 'step', src: this, pos: p.clone() });
      }
    }
  }

  animate(dt) {
    const b = this.body;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const y = this.aimYaw;
    const side = hs > 0.5 ? (this.vel.x * Math.cos(y) - this.vel.z * Math.sin(y)) / hs : 0;
    const fwd = hs > 0.5 ? (-this.vel.x * Math.sin(y) - this.vel.z * Math.cos(y)) / hs : 0;
    b.root.position.copy(this.pos);
    b.root.rotation.set(0, this.aimYaw, 0);
    b.update(dt, {
      speed: hs, strafe: side, back: fwd < -0.5, pitch: this.aimPitch, task: !!this.task, crouch: this.crouchAmt,
      combat: !!(this.target && this.targetVisible), firing: this.game.time - this.lastShotT < 0.2,
    });
  }

  animateDeath(dt) {
    const b = this.body;
    b.root.position.copy(this.pos);
    if (this.deathT > 4) return;
    this.deathT += dt;
    b.update(dt, {});
  }

  remove() {
    this.game.removeBody(this.body);
  }
}
