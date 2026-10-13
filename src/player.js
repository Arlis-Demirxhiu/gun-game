import * as THREE from 'three';
import { Actor } from './actor.js';

// Human-controlled actor. Runs identically in three places:
//   - offline: inside the local GameCore
//   - server:  inside the authoritative GameCore, driven by network input
//   - online client: as a local prediction of your own player (replayed on reconciliation)
// It never touches rendering or audio directly; it emits events through `game.emit`.

// Quake/GoldSrc-style movement (ground friction + air strafing), CS-ish values in meters.
const GRAVITY = 20, JUMP_V = 6.75, ACCEL = 5.5, AIR_ACCEL = 10, FRICTION = 4.5, STOP_SPEED = 1.9, AIR_CAP = 0.76;
const DEG = Math.PI / 180;
const RADIUS = 0.4;
const v1 = new THREE.Vector3();

export class Player extends Actor {
  constructor(game, team, name = 'You') {
    super(game, team, name);
    this.isPlayer = true;
    this.punchP = 0;
    this.punchY = 0;
    this.shots = 0;
    this.sideDir = 1;
    this.onGround = true;
    this.stepT = 0;
    this.scope = 0;
    this.rezoomAt = 0;
    this.rezoomLevel = 0;
    this.trigger = false;
    this.task = null;
    this.bobT = 0;
    this.deathT = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.punchP = this.punchY = 0;
    this.crouchAmt = 0;
    this.scope = 0;
    this.rezoomAt = 0;
    this.task = null;
    this.reloading = false;
    this.spray = 0;
    this.shots = 0;
    this.deathT = 0;
    this.onGround = true;
    this.slot = this.inv[1] ? 1 : 2;
    this.lastSlot = 3;
    this.deployT = 0;
    this.game.emit('vm', { to: this, op: 'set' });
  }

  // inp: { keys{}, pressed:Set, fire, firePressed, fire2Pressed, wheel, yaw, pitch }
  update(dt, inp) {
    if (!this.alive) { this.deathT += dt; return; }
    this.yaw = inp.yaw;
    this.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch));
    this.updateTask(dt, inp);
    const frozen = this.isFrozen();
    const hs = this.simulate(dt, inp, frozen, true);
    this.updateWeapon(dt, inp, frozen, hs);
  }

  isFrozen() {
    return this.game.phase === 'freeze' || !!this.task;
  }

  // Movement only. `fx` is false when the client replays inputs during reconciliation.
  simulate(dt, inp, frozen, fx) {
    const def = this.weapon.def;
    let wantCrouch = !!(inp.keys.KeyC || inp.keys.ControlLeft);
    // Can't stand up under a low ceiling.
    if (!wantCrouch && this.crouchAmt > 0 && this.game.map.isMesh && this.game.map.collides(this.pos.x, this.pos.y, this.pos.z, RADIUS, 1.8)) wantCrouch = true;
    this.crouchAmt += Math.max(-dt * 7, Math.min(dt * 7, (wantCrouch ? 1 : 0) - this.crouchAmt));

    let fw = (inp.keys.KeyW ? 1 : 0) - (inp.keys.KeyS ? 1 : 0);
    let sd = (inp.keys.KeyD ? 1 : 0) - (inp.keys.KeyA ? 1 : 0);
    if (frozen) fw = sd = 0;
    const yaw = inp.yaw ?? this.yaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let wx = -sy * fw + cy * sd, wz = -cy * fw - sy * sd;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    let maxSpeed = this.scope && def.scopedSpeed ? def.scopedSpeed : def.speed;
    const walking = !!(inp.keys.ShiftLeft || inp.keys.ShiftRight);
    if (walking) maxSpeed *= 0.52;
    if (this.crouchAmt > 0.5) maxSpeed *= 0.34;
    const wish = wl > 0 ? maxSpeed : 0;

    if (this.onGround) {
      if (inp.pressed.has('Space') && !frozen) {
        this.vel.y = JUMP_V;
        this.onGround = false;
      } else this.friction(dt);
    }
    if (this.onGround) this.accelerate(wx, wz, wish, dt);
    else this.airAccelerate(wx, wz, wish, dt);

    this.vel.y -= GRAVITY * dt;
    const wasAir = !this.onGround;
    const vyBefore = this.vel.y;
    this.move(dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!fx) return hs;

    const g = this.game;
    if (wasAir && this.onGround && vyBefore < -7) g.emit('sound', { name: 'land', src: this, pos: this.pos.clone() });
    if (this.onGround && hs > 1.2) {
      this.bobT += dt * hs;
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.36 * (6 / Math.max(hs, 3));
        if (!walking && this.crouchAmt < 0.5 && hs > 3.2) {
          g.emit('sound', { name: 'step', src: this, pos: this.pos.clone() });
          g.noise(this.pos, this.team, 16);
        }
      }
    }
    return hs;
  }

  friction(dt) {
    const v = this.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.02) { v.x = v.z = 0; return; }
    const drop = Math.max(speed, STOP_SPEED) * FRICTION * dt;
    const k = Math.max(speed - drop, 0) / speed;
    v.x *= k;
    v.z *= k;
  }

  accelerate(wx, wz, wish, dt) {
    const cur = this.vel.x * wx + this.vel.z * wz;
    const add = wish - cur;
    if (add <= 0) return;
    const a = Math.min(ACCEL * dt * wish, add);
    this.vel.x += a * wx;
    this.vel.z += a * wz;
  }

  airAccelerate(wx, wz, wish, dt) {
    const capped = Math.min(wish, AIR_CAP);
    const cur = this.vel.x * wx + this.vel.z * wz;
    const add = capped - cur;
    if (add <= 0) return;
    const a = Math.min(AIR_ACCEL * wish * dt, add);
    this.vel.x += a * wx;
    this.vel.z += a * wz;
  }

  move(dt) {
    const map = this.game.map, p = this.pos, v = this.vel;
    const n = Math.max(1, Math.ceil((Math.max(Math.abs(v.x), Math.abs(v.z)) * dt) / 0.2));
    const sdt = dt / n;
    const over = () => (map.feetLimit ? Math.max(0, p.y - map.feetLimit(p.x, p.z)) : 0); // above the player clip
    for (let i = 0; i < n; i++) {
      const nx = p.x + v.x * sdt;
      let y = map.moveTo(nx, p.y, p.z, RADIUS, this.hullHeight(), over());
      if (y === null) v.x = 0; else { p.x = nx; p.y = y; }
      const nz = p.z + v.z * sdt;
      y = map.moveTo(p.x, p.y, nz, RADIUS, this.hullHeight(), over());
      if (y === null) v.z = 0; else { p.z = nz; p.y = y; }
    }
    // Body blocking against everyone else.
    for (const o of this.game.actors) {
      if (o === this || !o.alive || Math.abs(o.pos.y - p.y) > 1.6) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 1e-4) {
        const nx = o.pos.x + (dx / d) * 0.7, nz = o.pos.z + (dz / d) * 0.7;
        if (!map.collides(nx, p.y, nz, RADIUS, this.hullHeight())) { p.x = nx; p.z = nz; }
      }
    }
    // Head against a ceiling: stop rising.
    if (v.y > 0 && map.isMesh && map.collides(p.x, p.y + v.y * dt, p.z, RADIUS, this.hullHeight())) v.y = 0;
    p.y += v.y * dt;
    // Invisible "player clip" over roofs and wall tops (see MeshMap.feetLimit).
    // Jumping can't lift you over it (never pushes you down: that could sink you into a crate).
    const lim = map.feetLimit ? map.feetLimit(p.x, p.z) : Infinity;
    if (v.y > 0 && p.y > lim && lim > -1e6) { p.y = Math.max(lim, p.y - v.y * dt); v.y = 0; }
    const ground = map.groundAt(p.x, p.z, RADIUS, p.y);
    // Walking down stairs/ramps: stay on the floor instead of hopping off every step.
    if (this.onGround && v.y <= 0 && ground < p.y && ground > p.y - 0.35) p.y = ground;
    if (p.y <= ground) {
      p.y = ground;
      if (v.y < 0) v.y = 0;
      this.onGround = true;
    } else this.onGround = false;
  }

  currentSpread(hs) {
    const def = this.weapon.def, sp = def.spread;
    if (!sp) return 0;
    let s = def.scope && !this.scope ? sp.unscoped : sp.base;
    s += sp.move * Math.min(1, Math.max(0, hs / def.speed - 0.34) / 0.66);
    if (!this.onGround) s += sp.air;
    s += this.spray;
    if (this.crouchAmt > 0.5 && this.onGround) s *= 0.75;
    return s;
  }

  updateWeapon(dt, inp, frozen, hs) {
    const g = this.game, now = g.time;
    if (!this.task) {
      for (const n of [1, 2, 3]) if (inp.pressed.has('Digit' + n)) this.switchTo(n);
      if (inp.pressed.has('Digit4')) {
        if (this.slot === 4) { if (this.cycleNade()) g.emit('vm', { to: this, op: 'set' }); }
        else this.switchTo(4);
      }
      if (inp.pressed.has('KeyQ')) this.switchTo(this.lastSlot);
      if (inp.wheel) {
        const order = [1, 2, 3, 4].filter((s) => this.inv[s]);
        const i = order.indexOf(this.slot);
        this.switchTo(order[(i + (inp.wheel > 0 ? 1 : -1) + order.length) % order.length]);
      }
      if (inp.pressed.has('KeyG')) g.dropActive(this);
    }
    const w = this.weapon, def = w.def, sp = def.spread;
    if (sp) this.spray = Math.max(0, this.spray - (dt * sp.max) / sp.recover);
    const firing = inp.fire || inp.firePressed;
    if (!firing) this.shots = Math.max(0, this.shots - dt * 12);
    const decay = Math.min(1, dt * 6);
    this.punchP -= this.punchP * decay;
    this.punchY -= this.punchY * decay;
    if (this.deployT > 0) this.deployT -= dt;
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= def.reload) this.finishReload();
    }
    if (this.rezoomAt && now >= this.rezoomAt) {
      if (def.zoom && !this.reloading) this.scope = this.rezoomLevel;
      this.rezoomAt = 0;
    }
    if (inp.fire2Pressed && def.zoom && !this.reloading && !this.task) {
      this.scope = (this.scope + 1) % (def.zoom.length + 1);
      this.rezoomAt = 0;
      g.emit('sound', { name: 'zoom', to: this, pred: true });
    }
    if (frozen) {
      if (!firing) this.trigger = false;
      return;
    }
    if (def.nade) {
      // Left click throws, right click lobs (underhand).
      if ((inp.firePressed || inp.fire2Pressed) && now >= this.nextFire && this.deployT <= 0 && this.nades[def.id] > 0) {
        this.throwNade(def, inp.fire2Pressed && !inp.firePressed);
      }
      return;
    }
    if (inp.pressed.has('KeyR')) this.startReload();
    if (inp.fire2Pressed && def.melee && now >= this.nextFire) this.melee(true);
    if (firing && now >= this.nextFire && this.deployT <= 0 && this.interruptReload()) {
      if (def.melee) this.melee(false);
      else if (!this.trigger || def.auto) {
        if (w.mag > 0) this.shoot(hs);
        else {
          if (!this.trigger) g.emit('sound', { name: 'dry', to: this, pred: true });
          this.trigger = true;
          this.nextFire = now + 0.2;
          this.startReload();
        }
      }
    }
    if (!inp.fire) this.trigger = false;
  }

  shoot(hs) {
    const g = this.game, w = this.weapon, def = w.def, sp = def.spread;
    w.mag--;
    this.firedShots = (this.firedShots || 0) + 1;
    this.nextFire = g.time + def.rate;
    this.trigger = true;
    const spread = this.currentSpread(hs);
    const eye = this.eye(new THREE.Vector3());
    let res = null;
    for (const dir of this.shotDirs(this.yaw + this.punchY, this.pitch + this.punchP, spread, def)) {
      const r = g.fireBullet(this, eye, dir, def);
      res = res || r;
    }

    this.shots++;
    const k = def.kick * DEG * (1 + Math.min(this.shots, 9) * 0.22);
    this.punchP = Math.min(12 * DEG, this.punchP + k * (0.85 + Math.random() * 0.3));
    if (this.shots > 3 && def.sideKick) {
      if (Math.random() < 0.15) this.sideDir *= -1;
      this.punchY += this.sideDir * def.sideKick * DEG * Math.random();
    } else this.punchY += (Math.random() - 0.5) * k * 0.3;
    this.spray = Math.min(sp.max, this.spray + sp.shot);

    g.noise(this.pos, this.team, def.sound === 'silenced' ? 14 : 45);
    const fwd = this.aimDir(this.yaw, this.pitch, 0, v1);
    const muzzle = eye.clone().addScaledVector(fwd, 0.7);
    muzzle.x += Math.cos(this.yaw) * 0.12;
    muzzle.z -= Math.sin(this.yaw) * 0.12;
    muzzle.y -= 0.12;
    g.emit('vm', { to: this, op: 'fire', def });
    g.emit('shot', { src: this, def, from: muzzle, to: res.end, tracer: Math.random() < 0.3 });
    if (def.bolt && this.scope) {
      this.rezoomLevel = this.scope;
      this.scope = 0;
      this.rezoomAt = g.time + def.rate * 0.85;
    }
  }

  throwNade(def, lob) {
    const g = this.game;
    this.nextFire = g.time + 0.8;
    const pitch = Math.min(1.4, this.pitch + (lob ? 0.25 : 0.1));
    const dir = this.aimDir(this.yaw, pitch, 0);
    const origin = this.eye(new THREE.Vector3()).addScaledVector(dir, 0.4);
    const vel = dir.multiplyScalar(lob ? 9 : 17).addScaledVector(this.vel, 0.6);
    g.throwNade(this, def.id, origin, vel);
    (this.thrown || (this.thrown = [])).push(def.id);
    g.emit('vm', { to: this, op: 'throw' });
    this.nades[def.id]--;
    this.syncNades();
    // Out of this type: next grenade if any, else back to a gun.
    if (this.inv[4]) { this.deployT = 0.5; g.emit('vm', { to: this, op: 'set' }); }
    else this.switchTo(this.bestSlot(), true);
  }

  melee(stab) {
    const g = this.game, def = this.weapon.def;
    this.nextFire = g.time + (stab ? def.rate2 : def.rate);
    g.emit('vm', { to: this, op: 'swing', stab });
    const eye = this.eye(new THREE.Vector3());
    const res = g.meleeHit(this, eye, this.aimDir(this.yaw, this.pitch, 0), def, stab);
    g.emit('melee', { src: this, result: res, pos: this.pos.clone() });
  }

  startReload() {
    if (super.startReload()) {
      this.scope = 0;
      this.rezoomAt = 0;
      this.game.emit('sound', { name: 'reload', to: this, pred: true, arg: this.weapon.def.reload });
      return true;
    }
    return false;
  }

  switchTo(slot, force = false) {
    if (!this.inv[slot] || (slot === this.slot && !force)) return;
    if (slot !== this.slot) this.lastSlot = this.slot;
    this.slot = slot;
    this.reloading = false;
    this.scope = 0;
    this.rezoomAt = 0;
    this.deployT = slot === 3 ? 0.4 : 0.75;
    this.spray = 0;
    this.shots = 0;
    this.game.emit('vm', { to: this, op: 'set' });
    this.game.emit('sound', { name: 'draw', to: this, pred: true });
  }

  canPlant() {
    const g = this.game;
    return this.hasBomb && this.onGround && g.phase === 'live' && !!g.map.siteAt(this.pos.x, this.pos.z);
  }

  canDefuse() {
    const b = this.game.bomb;
    return this.team === 'CT' && this.game.phase === 'live' && b.state === 'planted' && (!b.defuser || b.defuser === this) &&
      Math.hypot(this.pos.x - b.pos.x, this.pos.z - b.pos.z) < 1.8 && Math.abs(this.pos.y - b.pos.y) < 1.5;
  }

  cancelTask() {
    if (this.task && this.task.type === 'defuse' && this.game.bomb.defuser === this) this.game.bomb.defuser = null;
    this.task = null;
  }

  updateTask(dt, inp) {
    const g = this.game;
    const holdE = !!inp.keys.KeyE;
    if (this.task) {
      const ok = this.task.type === 'plant' ? this.canPlant() : this.canDefuse();
      if (!holdE || !ok) { this.cancelTask(); return; }
      this.task.t += dt;
      this.task.tick -= dt;
      if (this.task.tick <= 0) { this.task.tick = 0.3; g.emit('sound', { name: 'plantTick', to: this, pred: true }); }
      if (this.task.t >= this.task.dur) {
        const type = this.task.type;
        this.task = null;
        if (type === 'plant') g.plantBomb(this);
        else g.defuseBomb(this);
      }
      return;
    }
    if (!inp.pressed.has('KeyE')) return;
    if (this.canPlant()) {
      this.task = { type: 'plant', t: 0, dur: 3, tick: 0, label: 'Planting the bomb...' };
    } else if (this.canDefuse()) {
      this.task = { type: 'defuse', t: 0, dur: this.hasKit ? 5 : 10, tick: 0, label: this.hasKit ? 'Defusing (kit)...' : 'Defusing...' };
      g.bomb.defuser = this;
    } else return;
    this.scope = 0;
    this.reloading = false;
  }
}
