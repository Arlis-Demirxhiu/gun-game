import * as THREE from 'three';
import { holeTexture, puffTexture, flashTexture } from './textures.js';

const tmp = new THREE.Vector3();

// Bullet holes, impact dust, blood, tracers, muzzle light and the C4 explosion.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    const holeMat = new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const hg = new THREE.PlaneGeometry(0.13, 0.13);
    this.holes = [];
    this.holeI = 0;
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(hg, holeMat);
      m.visible = false;
      scene.add(m);
      this.holes.push(m);
    }
    this.puff = puffTexture();
    this.flashTex = flashTexture();
    this.parts = [];
    this.free = [];
    this.tracers = [];
    for (let i = 0; i < 32; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerI = 0;
    this.light = new THREE.PointLight(0xffc070, 0, 9, 2);
    scene.add(this.light);
    this.lightT = 0;
    this.boom = new THREE.PointLight(0xff9a40, 0, 80, 1.2);
    scene.add(this.boom);
    this.boomT = 0;
  }

  hole(p, n) {
    const m = this.holes[this.holeI++ % this.holes.length];
    m.visible = true;
    m.position.copy(p).addScaledVector(n, 0.01);
    m.lookAt(tmp.copy(m.position).add(n));
    m.rotateZ(Math.random() * Math.PI * 2);
  }

  particle(pos, vel, o) {
    let s = this.free.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, transparent: true, depthWrite: false }));
      this.scene.add(s);
    }
    s.visible = true;
    s.position.copy(pos);
    s.material.color.setHex(o.color);
    s.material.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.map = o.tex || this.puff;
    s.material.rotation = Math.random() * Math.PI * 2;
    s.scale.setScalar(o.size);
    this.parts.push({
      s, vel: vel.clone(), life: o.life, max: o.life, size: o.size,
      grow: o.grow || 0, grav: o.grav || 0, alpha: o.alpha ?? 1, drag: o.drag ?? 1.5,
    });
  }

  impact(p, n) {
    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      v.set(n.x, n.y, n.z).multiplyScalar(1 + Math.random() * 1.5);
      v.x += (Math.random() - 0.5) * 1.2; v.y += Math.random() * 0.8; v.z += (Math.random() - 0.5) * 1.2;
      this.particle(p, v, { color: 0xc8b088, size: 0.18, life: 0.45 + Math.random() * 0.3, grow: 1.8, grav: 1, alpha: 0.8 });
    }
    for (let i = 0; i < 2; i++) {
      v.set(n.x + (Math.random() - 0.5) * 2, n.y + Math.random(), n.z + (Math.random() - 0.5) * 2).multiplyScalar(4);
      this.particle(p, v, { color: 0xffd080, size: 0.06, life: 0.12, add: true, grav: 10 });
    }
  }

  blood(p, dir) {
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      v.copy(dir).multiplyScalar(1 + Math.random() * 2);
      v.x += (Math.random() - 0.5) * 1.5; v.y += Math.random() * 1.5; v.z += (Math.random() - 0.5) * 1.5;
      this.particle(p, v, { color: 0x8a0a0a, size: 0.14, life: 0.45, grav: 7, grow: 0.8 });
    }
  }

  tracer(a, b) {
    const tr = this.tracers[this.tracerI++ % this.tracers.length];
    const arr = tr.line.geometry.attributes.position.array;
    // Draw only a segment of the bullet path so it reads as a streak.
    const k = 0.15 + Math.random() * 0.4;
    arr[0] = a.x + (b.x - a.x) * k; arr[1] = a.y + (b.y - a.y) * k; arr[2] = a.z + (b.z - a.z) * k;
    arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
    tr.line.geometry.attributes.position.needsUpdate = true;
    tr.line.visible = true;
    tr.life = 0.06;
  }

  flash(pos) {
    this.light.position.copy(pos);
    this.lightT = 0.05;
  }

  // s scales the whole effect: 1 = C4, ~0.45 = HE grenade.
  explosion(p, s = 1) {
    const v = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let i = 0; i < Math.round(16 * Math.sqrt(s)); i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(10 * s);
      q.copy(p).add(new THREE.Vector3(0, s, 0));
      this.particle(q, v, { color: 0xffa040, size: 3 * s, life: 0.6 + Math.random() * 0.5, grow: 2.5, add: true, tex: this.flashTex, drag: 3 });
    }
    for (let i = 0; i < Math.round(20 * Math.sqrt(s)); i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).multiplyScalar(6 * s);
      this.particle(p, v, { color: 0x4f4a42, size: 3.5 * s, life: 3 * s + Math.random() * 2, grow: 2.5, alpha: 0.75, drag: 1.2 });
    }
    for (let i = 0; i < Math.round(40 * s); i++) {
      v.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize().multiplyScalar((10 + Math.random() * 15) * s);
      this.particle(p, v, { color: 0xffd080, size: 0.25, life: 1.2, add: true, grav: 15, drag: 0.5 });
    }
    this.boom.position.copy(p).y += 3 * s;
    this.boomT = 1.2 * s;
  }

  // Flashbang detonation: a blinding white burst and a short, very bright light.
  flashPop(p) {
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(2);
      this.particle(p, v, { color: 0xffffff, size: 2.5, life: 0.25, grow: 3, add: true, tex: this.flashTex, drag: 4 });
    }
    this.boom.color.setHex(0xffffff);
    this.boom.position.copy(p).y += 0.5;
    this.boomT = 0.35;
    this.boomWhite = true;
  }

  // A smoke cloud: many large soft puffs inside a sphere; scaled to the cloud's current radius.
  makeSmoke() {
    const g = new THREE.Group();
    g.userData.puffs = [];
    for (let i = 0; i < 38; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, transparent: true, depthWrite: false, opacity: 0 }));
      const shade = 1.7 + Math.random() * 0.5; // HDR grey so it reads as light smoke after tone mapping
      s.material.color.setRGB(shade, shade, shade * 0.96);
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.3 - 0.25, Math.random() * 2 - 1);
      if (v.length() > 1) v.normalize();
      s.position.copy(v);
      s.userData.base = v.clone();
      s.userData.size = 0.9 + Math.random() * 0.7;
      s.userData.phase = Math.random() * 6.28;
      s.material.rotation = Math.random() * 6.28;
      g.add(s);
      g.userData.puffs.push(s);
    }
    this.scene.add(g);
    return g;
  }

  updateSmoke(g, radius, maxRadius, t) {
    const k = Math.max(0, Math.min(1, radius / maxRadius));
    g.scale.setScalar(Math.max(0.05, radius));
    for (const s of g.userData.puffs) {
      const ph = s.userData.phase + t * 0.25;
      s.position.set(s.userData.base.x + Math.sin(ph) * 0.06, s.userData.base.y + Math.cos(ph * 0.7) * 0.04, s.userData.base.z + Math.cos(ph) * 0.06);
      s.scale.setScalar(s.userData.size);
      s.material.opacity = 0.9 * k;
      s.material.rotation += 0.0015;
    }
  }

  removeSmoke(g) {
    this.scene.remove(g);
    for (const s of g.userData.puffs) s.material.dispose();
  }

  clear() {
    for (const h of this.holes) h.visible = false;
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.free.push(p.s);
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.s.material.opacity = p.alpha * k;
      p.s.scale.setScalar(p.size * (1 + p.grow * (1 - k)));
    }
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
      else t.line.material.opacity = (t.life / 0.06) * 0.85;
    }
    this.lightT -= dt;
    this.light.intensity = this.lightT > 0 ? 20 : 0;
    this.boomT -= dt;
    this.boom.intensity = Math.max(0, this.boomT) * (this.boomWhite ? 900 : 200);
    if (this.boomT <= 0 && this.boomWhite) { this.boomWhite = false; this.boom.color.setHex(0xff9a40); }
  }
}
