import * as THREE from 'three';
import { newWeapon, WEAPONS, GRENADES } from './weapons.js';

export const REGION_MUL = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

// Slab test: distance along the ray to an axis-aligned box, or null.
export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const lo = [x0, y0, z0], hi = [x1, y1, z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < lo[a] || oo[a] > hi[a]) return null;
    } else {
      let t1 = (lo[a] - oo[a]) / dd[a], t2 = (hi[a] - oo[a]) / dd[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Shared state for the player and bots.
export class Actor {
  constructor(game, team, name) {
    this.game = game;
    this.team = team;
    this.name = name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.alive = true;
    this.needsReset = true;
    this.money = 800;
    this.kills = 0;
    this.deaths = 0;
    this.inv = { 1: null, 2: null, 3: null, 4: null };
    this.nades = { hegrenade: 0, flashbang: 0, smokegrenade: 0 };
    this.nadeSel = null;
    this.slot = 2;
    this.lastSlot = 3;
    this.hasBomb = false;
    this.hasKit = false;
    this.crouchAmt = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.nextFire = 0;
    this.deployT = 0;
    this.spray = 0;
  }

  get weapon() { return this.inv[this.slot] || this.inv[3]; }
  // Body (hitbox) height: crouching squats the model down to 1.1 m.
  height() { return 1.8 - 0.7 * this.crouchAmt; }
  // Collision hull height, as in CS 1.6: 72 units standing, 36 crouched (fits through crouch holes).
  hullHeight() { return 1.8 - 0.88 * this.crouchAmt; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + Math.min(this.height() - 0.16, this.hullHeight() - 0.1), this.pos.z); }
  headPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height() - 0.15, this.pos.z); }
  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height() - 0.5, this.pos.z); }

  // Grenades: counts per type; inv[4] is the currently selected type (null when you have none).
  syncNades() {
    if (!this.nades) this.nades = { hegrenade: 0, flashbang: 0, smokegrenade: 0 };
    if (!this.nades[this.nadeSel]) this.nadeSel = GRENADES.find((t) => this.nades[t] > 0) || null;
    this.inv[4] = this.nadeSel ? { def: WEAPONS[this.nadeSel], mag: this.nades[this.nadeSel], reserve: 0 } : null;
    if (this.slot === 4 && !this.inv[4]) this.slot = this.bestSlot();
  }

  // Selecting slot 4 again cycles to the next grenade type you carry.
  cycleNade() {
    const have = GRENADES.filter((t) => this.nades[t] > 0);
    if (!have.length) return false;
    this.nadeSel = have[(have.indexOf(this.nadeSel) + 1) % have.length];
    this.syncNades();
    return true;
  }

  resetLoadout() {
    this.nades = { hegrenade: 0, flashbang: 0, smokegrenade: 0 };
    this.nadeSel = null;
    this.inv = { 1: null, 2: newWeapon(this.team === 'T' ? 'glock' : 'usp'), 3: newWeapon('knife'), 4: null };
    this.slot = 2;
    this.lastSlot = 3;
    this.armor = 0;
    this.helmet = false;
    this.hasKit = false;
  }

  refillAmmo() {
    for (const s of [1, 2]) {
      const w = this.inv[s];
      if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
    }
  }

  bestSlot() {
    for (const s of [1, 2]) {
      const w = this.inv[s];
      if (w && w.mag + w.reserve > 0) return s;
    }
    return 3;
  }

  startReload() {
    const w = this.weapon;
    if (this.reloading || w.def.melee || w.mag >= w.def.mag || w.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    return true;
  }

  finishReload() {
    const w = this.weapon;
    if (w.def.shells) {
      // Shotguns load one shell at a time and keep going until full.
      w.mag++;
      w.reserve--;
      this.reloadT = 0;
      this.reloading = w.mag < w.def.mag && w.reserve > 0;
      return;
    }
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    this.reloading = false;
  }

  // Firing a shotgun shell-by-shell reload stops it (if there's a shell to shoot).
  interruptReload() {
    const w = this.weapon;
    if (this.reloading && w.def.shells && w.mag > 0) this.reloading = false;
    return !this.reloading;
  }

  // Bullet directions for one shot: one, or a cone of pellets around the aim for shotguns.
  shotDirs(yaw, pitch, spread, def) {
    const center = this.aimDir(yaw, pitch, spread);
    if (!def.pellets) return [center];
    const cy = Math.atan2(-center.x, -center.z), cp = Math.asin(Math.max(-1, Math.min(1, center.y)));
    return Array.from({ length: def.pellets }, () => this.aimDir(cy, cp, def.pelletSpread * Math.sqrt(Math.random()) * 1.6));
  }

  aimDir(yaw, pitch, spread, out = new THREE.Vector3()) {
    const cp = Math.cos(pitch);
    out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    if (spread > 0) {
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const up = new THREE.Vector3().crossVectors(right, out);
      const a = Math.random() * Math.PI * 2;
      const r = Math.tan(spread * Math.random());
      out.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    return out;
  }

  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    const h = this.height(), p = this.pos;
    let best = null;
    const test = (region, cy, hy, hxz) => {
      const t = rayBox(o, d, p.x - hxz, p.y + cy - hy, p.z - hxz, p.x + hxz, p.y + cy + hy, p.z + hxz);
      if (t !== null && t < maxT && (!best || t < best.t)) best = { t, region };
    };
    const legH = h - 0.94;
    test('head', h - 0.15, 0.15, 0.15);
    test('chest', h - 0.51, 0.21, 0.26);
    test('stomach', h - 0.83, 0.11, 0.24);
    test('legs', legH / 2, legH / 2, 0.2);
    return best;
  }
}
