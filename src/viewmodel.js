import * as THREE from 'three';
import { flashTexture, camoTexture, leatherTexture } from './textures.js';
import { buildGunModel } from './guns.js';
import { buildHand, segment } from './body.js';

// First-person weapon: the gun model plus gloved hands and sleeves, and its animation.

let armMats = null;
function getArmMats() {
  if (armMats) return armMats;
  const ctCamo = camoTexture('#3b4352', ['#2b313d', '#4e5869', '#1f242d', '#5d6676']);
  ctCamo.repeat.set(2, 2);
  const tJacket = leatherTexture('#4e3523');
  tJacket.repeat.set(2, 2);
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.6, ...o });
  armMats = {
    CT: {
      sleeve: std({ map: ctCamo, roughness: 0.9 }),
      glove: std({ color: 0x1a1a1b, roughness: 0.55, metalness: 0.05 }),
      cuff: std({ color: 0x232426, roughness: 0.8 }),
    },
    T: {
      sleeve: std({ map: tJacket, roughness: 0.65 }),
      glove: std({ color: 0x6a4a30, roughness: 0.7 }),
      cuff: std({ color: 0x2c2620, roughness: 0.9 }),
    },
  };
  return armMats;
}

function addArm(g, team, hand, elbow, shoulder) {
  const m = getArmMats()[team];
  hand.updateMatrix();
  const w = hand.userData.wrist.clone().applyMatrix4(hand.matrix);
  const toElbow = new THREE.Vector3(...elbow).sub(w).normalize();
  const cuffEnd = w.clone().addScaledVector(toElbow, 0.06);
  segment(g, w.toArray(), cuffEnd.toArray(), 0.031, 0.035, m.cuff);
  segment(g, cuffEnd.toArray(), elbow, 0.04, 0.052, m.sleeve, { seg: 14 });
  segment(g, elbow, shoulder, 0.054, 0.065, m.sleeve, { seg: 14, caps: false });
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.053, 14, 10), m.sleeve);
  joint.position.set(...elbow);
  g.add(joint);
}

function buildView(id, team) {
  const g = buildGunModel(id);
  const ud = g.userData;
  const m = getArmMats()[team];
  const type = ud.type;
  const grip = ud.grip;

  const right = buildHand(m.glove, { trigger: type !== 'knife' && type !== 'nade' });
  right.position.set(...grip.pos);
  right.rotation.x = -grip.tilt;
  g.add(right);
  if (type === 'knife' || type === 'nade') addArm(g, team, right, [0.1, -0.24, 0.3], [0.2, -0.3, 0.7]);
  else addArm(g, team, right, [0.13, -0.3, 0.32], [0.22, -0.3, 0.7]);

  if (type === 'rifle') {
    const left = buildHand(m.glove, { trigger: false });
    // Mirrored hand under the handguard: palm below, fingers curling up the right side, thumb on the left.
    left.scale.x = -1;
    left.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
    left.position.set(...ud.fore.pos);
    left.position.y -= 0.004;
    g.add(left);
    const f = ud.fore.pos[2];
    addArm(g, team, left, [-0.2, -0.27, f + 0.28], [-0.32, -0.25, f + 0.75]);
  } else if (type === 'pistol') {
    const left = buildHand(m.glove, { trigger: false });
    left.scale.x = -1;
    left.position.set(grip.pos[0] - 0.026, grip.pos[1] - 0.012, grip.pos[2] + 0.01);
    left.rotation.set(-grip.tilt, -0.35, 0);
    g.add(left);
    addArm(g, team, left, [-0.18, -0.24, 0.24], [-0.3, -0.25, 0.6]);
  }
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}

const BASES = {
  rifle: { x: 0.15, y: -0.195, z: -0.36, rx: 0.02, ry: 0.05, rz: 0 },
  pistol: { x: 0.15, y: -0.13, z: -0.34, rx: 0.02, ry: 0.32, rz: 0.03 },
  knife: { x: 0.17, y: -0.16, z: -0.34, rx: 0.25, ry: 0.4, rz: -0.35 },
  nade: { x: 0.17, y: -0.2, z: -0.32, rx: 0.15, ry: 0.35, rz: -0.1 },
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b5638, 2.6));
    const sun = new THREE.DirectionalLight(0xfff0d8, 5.5);
    sun.position.set(-0.6, 1, 0.5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.4);
    rim.position.set(0.8, 0.2, -1);
    this.scene.add(rim);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.models = {};
    this.cur = null;
    this.base = BASES.rifle;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.visible = false;
    this.kickZ = 0; this.kickRot = 0; this.bobT = 0; this.swayX = 0; this.swayY = 0;
    this.drawT = 1; this.swingT = 0; this.swingDur = 0.35; this.flashT = 0;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  set(id, team) {
    // Mid-throw: finish the throw with the current model, then swap.
    if (this.throwT > 0) { this.pendingSet = [id, team]; return; }
    const key = id + team;
    if (!this.models[key]) this.models[key] = buildView(id, team);
    if (this.cur) this.root.remove(this.cur);
    this.cur = this.models[key];
    this.root.add(this.cur);
    this.base = BASES[this.cur.userData.type];
    this.cur.add(this.flash);
    this.flash.position.copy(this.cur.userData.muzzle);
    this.flash.position.z -= 0.03;
    this.flash.scale.setScalar(this.cur.userData.type === 'pistol' ? 0.16 : 0.26);
    this.drawT = 0;
    this.swingT = 0;
  }

  fire(def) {
    const k = Math.min(def.kick, 3.5);
    this.kickZ += 0.025 + k * 0.012;
    this.kickRot += 0.03 + k * 0.025;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
  }

  // Overhand throw: wind back, then snap forward and drop out of view.
  throw() {
    this.throwT = 0.45;
  }

  swing(stab) {
    this.swingDur = stab ? 0.55 : 0.32;
    this.swingT = this.swingDur;
    this.stab = stab;
  }

  update(dt, s) {
    if (!this.cur) return;
    const b = this.base;
    if (s.onGround && s.speed > 0.05) this.bobT += dt * 11 * Math.min(1, s.speed + 0.3);
    const amp = s.onGround ? s.speed : 0;
    const bobX = Math.sin(this.bobT) * 0.012 * amp;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * amp;
    const k = Math.min(1, dt * 10);
    this.swayX += (Math.max(-0.03, Math.min(0.03, -s.mdx * 0.0005)) - this.swayX) * k;
    this.swayY += (Math.max(-0.03, Math.min(0.03, s.mdy * 0.0005)) - this.swayY) * k;
    this.kickZ *= Math.exp(-dt * 14);
    this.kickRot *= Math.exp(-dt * 12);
    this.drawT = Math.min(1, this.drawT + dt / 0.45);
    const e = 1 - Math.pow(1 - this.drawT, 3);
    let rx = b.rx + this.kickRot - (1 - e) * 0.8;
    let ry = b.ry + this.swayX * 2;
    let rz = b.rz;
    let y = b.y + bobY + this.swayY - (1 - e) * 0.2 - s.crouch * 0.01;
    let x = b.x + bobX + this.swayX;
    let z = b.z + this.kickZ;
    if (s.reload >= 0) {
      const dip = Math.sin(Math.PI * Math.min(1, s.reload));
      y -= 0.1 * dip;
      rx -= 0.5 * dip;
      rz += 0.35 * dip;
    }
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt);
      const p = 1 - this.swingT / this.swingDur;
      const w = Math.sin(p * Math.PI);
      if (this.stab) { z -= 0.12 * w; rx += 0.3 * w; }
      else { ry += 1.1 * w; x -= 0.08 * w; rz -= 0.6 * w; }
    }
    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt);
      if (this.throwT === 0 && this.pendingSet) { const [pid, pteam] = this.pendingSet; this.pendingSet = null; this.set(pid, pteam); }
      const p = 1 - this.throwT / 0.45;
      const back = Math.sin(Math.min(1, p / 0.4) * Math.PI * 0.5) * (p < 0.4 ? 1 : Math.max(0, 1 - (p - 0.4) / 0.25));
      const fwd = p > 0.4 ? Math.min(1, (p - 0.4) / 0.3) : 0;
      y += 0.12 * back - 0.3 * fwd;
      z += 0.08 * back - 0.25 * fwd;
      rx += 0.6 * back - 1.2 * fwd;
    }
    this.root.position.set(x, y, z);
    this.root.rotation.set(rx, ry, rz);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
  }
}
