import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { gunInstance } from './guns.js';
import { buildCharacter, setCharacterGun, poseCharacter, dropCharacterGun } from './character.js';
import { solveElbow } from './body.js';
import { patchTexture } from './emblem.js';

// Rigged, animated player models (Quaternius, CC0 — see assets/models/CREDITS.md).
// Both share one 62-bone rig and a set of shooter animations, so bots can run, strafe,
// fire, flinch, crumple on death and kneel to plant or defuse. Our weapon models are
// parented to the right wrist bone so they follow every animation.

const FILES = { CT: 'assets/models/swat.glb', T: 'assets/models/punk_a.glb' };
const HEIGHT = 1.8;
const templates = {};
let loading = null;

const std = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, envMapIntensity: 0.5 });

// Re-dress the Punk as a CS-style terrorist: knit balaclava instead of the mohawk,
// olive shirt, leather vest, dark trousers.
function dressTerrorist(scene) {
  const balaclava = std(0x151515, 0.95);
  const recolor = { White: std(0x4e4b34), Black: std(0x2e2218, 0.6), LightBlue: std(0x262c36), Eye: std(0xd9cdb8, 0.6), Sleeve: std(0x3c3d2b) };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    const onHead = /Head/.test(o.name) || /Head/.test(o.parent?.name || '');
    if (onHead && ['Red_Dark', 'Earrings', 'Eyebrows', 'Red'].includes(name)) o.visible = false;
    else if (onHead && name === 'Skin') o.material = balaclava;
    else if (name === 'Skin') o.material = recolor.Sleeve;
    else if (recolor[name]) o.material = recolor[name];
  });
}

function dressCT(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name === 'Swat') o.material = std(0x1d2532, 0.8);
  });
}

function findBone(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name.replace(/[^A-Za-z]/g, '') === name) found = o; });
  return found;
}

async function loadTemplate(team) {
  const gltf = await new GLTFLoader().loadAsync(FILES[team]);
  const scene = gltf.scene;
  if (team === 'T') dressTerrorist(scene); else dressCT(scene);
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      if (o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.5;
    }
  });
  const clips = {};
  for (const c of gltf.animations) clips[c.name.split('|').pop()] = c;

  // Measure height in the idle pose to normalize scale.
  const probe = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(probe);
  mixer.clipAction(clips.Idle_Gun || gltf.animations[0]).play();
  mixer.update(0);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3();
  probe.traverse((o) => {
    if (o.isSkinnedMesh && o.visible) {
      o.computeBoundingBox?.();
      if (o.boundingBox) box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  let h = box.max.y - box.min.y;
  if (!(h > 0.1 && h < 1000)) {
    const head = findBone(probe, 'Head');
    h = head ? head.getWorldPosition(new THREE.Vector3()).y * 1.1 : 1;
  }
  templates[team] = { scene, clips, scale: HEIGHT / h, minY: box.min.y };
}

export function loadHumans() {
  if (!loading) {
    loading = Promise.all(['CT', 'T'].map(loadTemplate)).then(() => true).catch((e) => {
      console.warn('Character models failed to load, using procedural characters.', e);
      return false;
    });
  }
  return loading;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const CROUCH_DROP = 0.55, CROUCH_LEAN = 0.35;

// Chest patch (Albanian eagle): set `on` to false to remove it. Size in meters, how far below the chest bone
// it sits, and how far off the vest.
const EMBLEM = { on: true, w: 0.18, h: 0.142, drop: -0.075, lift: 0.012 };
let emblemGeo = null, emblemMat = null;
function emblemGeometry() {
  if (emblemGeo) return emblemGeo;
  // Slightly curved to hug the chest instead of floating off it at the edges.
  emblemGeo = new THREE.PlaneGeometry(EMBLEM.w, EMBLEM.h, 8, 2);
  const p = emblemGeo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getX(i) * p.getX(i) * 1.6);
  emblemGeo.computeVertexNormals();
  return emblemGeo;
}
function emblemMaterial() {
  emblemMat ||= new THREE.MeshStandardMaterial({
    map: patchTexture(), transparent: true, alphaTest: 0.5, roughness: 0.92, metalness: 0, envMapIntensity: 0.3,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  return emblemMat;
}

// Rotate `bone` (in world space, about its own origin `pivot`) so the point `from` swings onto `to`.
function aimBone(bone, pivot, from, to) {
  const d1 = v3.subVectors(from, pivot).normalize();
  const d2 = v4.subVectors(to, pivot).normalize();
  q1.setFromUnitVectors(d1, d2).multiply(bone.getWorldQuaternion(q2));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(q2).invert().multiply(q1));
  bone.updateMatrixWorld(true);
}

export class HumanBody {
  constructor(team) {
    const t = templates[team];
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.model = SkeletonUtils.clone(t.scene);
    this.model.scale.setScalar(t.scale);
    this.model.position.y = -t.minY * t.scale;
    this.model.rotation.y = Math.PI; // the models face +z; ours face -z
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [name, clip] of Object.entries(t.clips)) this.actions[name] = this.mixer.clipAction(clip);
    for (const n of ['Death', 'HitRecieve']) {
      const a = this.actions[n];
      if (!a) continue;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    const bone = (n) => findBone(this.model, n);
    this.arms = {
      R: { up: bone('UpperArmR'), low: bone('LowerArmR'), wrist: bone('WristR'), pole: new THREE.Vector3(0.7, -1, 0.3) },
      L: { up: bone('UpperArmL'), low: bone('LowerArmL'), wrist: bone('WristL'), pole: new THREE.Vector3(-0.8, -1, 0.1) },
    };
    this.chest = bone('Chest');
    this.torso = bone('Torso');
    // Legs for the procedural crouch (the model has no crouch animation): knees point forward.
    this.hips = bone('Hips');
    this.legs = {
      L: { up: bone('UpperLegL'), low: bone('LowerLegL'), wrist: bone('FootL'), pole: new THREE.Vector3(0.2, 0, -1) },
      R: { up: bone('UpperLegR'), low: bone('LowerLegR'), wrist: bone('FootR'), pole: new THREE.Vector3(-0.2, 0, -1) },
    };
    this.legsOK = !!this.hips && Object.values(this.legs).every((l) => l.up && l.low && l.wrist);
    this.head = bone('Head');
    if (team === 'T' && this.head) this.addCap(t.scale);
    this.ikOK = Object.values(this.arms).every((a) => a.up && a.low && a.wrist) && this.chest;
    // The weapon lives in body space at the shoulder; both arms reach for it every frame.
    this.mount = new THREE.Group();
    this.root.add(this.mount);
    this.gun = null;
    this.gunId = null;
    this.cur = null;
    this.dead = false;
    this.flinchT = 0;
    this.calibrate();
    this.play('Idle_Gun_Pointing', 0);
  }

  // Knit cap over the balaclava, hiding what is left of the mohawk silhouette.
  addCap(scale) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1, envMapIntensity: 0.4 }),
    );
    cap.castShadow = true;
    this.cap = cap;
    this.capScale = scale;
  }

  // In the aiming pose: where the shoulders and chest sit in body space, and the wrist's
  // rotation relative to a forward-pointing gun (used to orient the trigger hand).
  calibrate() {
    this.placeEmblem();
    const aim = this.actions.Idle_Gun_Pointing || Object.values(this.actions)[0];
    aim.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const toBody = (b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    this.shoulderR = this.arms.R.up ? toBody(this.arms.R.up) : new THREE.Vector3(0.18, 1.45, 0);
    this.chestRest = this.chest ? toBody(this.chest) : new THREE.Vector3(0, 1.3, 0);
    this.holdQ = new THREE.Quaternion();
    if (this.arms.R.wrist) this.holdQ.copy(this.arms.R.wrist.getWorldQuaternion(new THREE.Quaternion()));
    if (this.head && this.cap) {
      // Cap sits on the crown, upright in body space; express that in head-bone space.
      const want = new THREE.Matrix4().compose(
        this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0.01)),
        new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      want.premultiply(this.head.matrixWorld.clone().invert());
      want.decompose(this.cap.position, this.cap.quaternion, this.cap.scale);
      this.head.add(this.cap);
    }
    aim.stop();
  }

  // Albanian eagle patch on the chest. Placed in a relaxed pose (arms down, out of the way) by casting a
  // ray at the chest from the front, then parented to the chest bone so it follows every animation.
  placeEmblem() {
    const pose = this.actions.Idle_Neutral || this.actions.Idle;
    if (!EMBLEM.on || !pose || !this.chest) return;
    pose.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const c = this.chest.getWorldPosition(new THREE.Vector3());
    const meshes = [];
    this.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const ray = new THREE.Raycaster(c.clone().add(new THREE.Vector3(0, EMBLEM.drop, -0.8)), new THREE.Vector3(0, 0, 1), 0, 1.2);
    const hit = ray.intersectObjects(meshes, false)[0];
    pose.stop();
    if (!hit) return;
    const patch = new THREE.Mesh(emblemGeometry(), emblemMaterial());
    patch.castShadow = false;
    patch.receiveShadow = true;
    const at = new THREE.Matrix4().compose(
      hit.point.clone().add(new THREE.Vector3(0, 0, -EMBLEM.lift)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), // face forward (-z)
      new THREE.Vector3(1, 1, 1));
    at.premultiply(this.chest.matrixWorld.clone().invert());
    at.decompose(patch.position, patch.quaternion, patch.scale);
    this.chest.add(patch);
    this.emblem = patch;
  }

  play(name, fade = 0.2) {
    if (this.cur === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.cur) this.actions[this.cur].fadeOut(fade);
    this.cur = name;
  }

  setGun(id) {
    if (this.gunId === id && this.gun) return;
    if (this.gun) this.mount.remove(this.gun);
    const gun = gunInstance(id);
    const ud = gun.userData;
    const sh = this.shoulderR;
    this.mount.position.copy(this.chestRest);
    const grip = new THREE.Vector3(...ud.grip.pos);
    let at;
    if (ud.type === 'rifle') {
      // Buttstock in the right shoulder pocket, sights just under eye level.
      const rear = new THREE.Box3().setFromObject(gun).max.z;
      at = new THREE.Vector3(sh.x - 0.06, sh.y - 0.06, sh.z - 0.03 - rear);
    } else if (ud.type === 'pistol') {
      at = new THREE.Vector3(0.04, sh.y - 0.08, sh.z - 0.42).sub(grip);
    } else {
      at = new THREE.Vector3(sh.x + 0.04, sh.y - 0.42, sh.z - 0.3).sub(grip);
    }
    gun.position.copy(at.sub(this.chestRest));
    this.mount.add(gun);
    this.gun = gun;
    this.gunId = id;
  }

  flinch() {
    if (!this.dead) this.flinchT = 0.25;
  }

  solveArm(arm, target) {
    const S = arm.up.getWorldPosition(v1);
    const E = arm.low.getWorldPosition(new THREE.Vector3());
    const W = arm.wrist.getWorldPosition(new THREE.Vector3());
    const pole = arm.pole.clone().applyQuaternion(this.root.quaternion);
    const Enew = solveElbow(S.clone(), target, S.distanceTo(E), E.distanceTo(W), pole);
    aimBone(arm.up, S.clone(), E, Enew);
    const E2 = arm.low.getWorldPosition(new THREE.Vector3());
    aimBone(arm.low, E2, arm.wrist.getWorldPosition(new THREE.Vector3()), target);
  }

  // s: { speed, strafe (-1..1 sideways), back, pitch, task, combat, firing, crouch (0..1) }
  update(dt, s) {
    if (this.dead) {
      this.mixer.update(dt);
      return;
    }
    let anim;
    if (s.task) anim = 'Interact';
    else if (s.speed > 0.8) {
      if (Math.abs(s.strafe) > 0.6) anim = s.strafe > 0 ? 'Run_Right' : 'Run_Left';
      else if (s.back) anim = 'Run_Back';
      else anim = s.speed < 3 ? 'Walk' : 'Run_Shoot';
    } else anim = s.firing ? 'Idle_Gun_Shoot' : 'Idle_Gun_Pointing';
    this.play(anim, 0.18);
    const a = this.actions[anim];
    if (a && /Run|Walk/.test(anim)) a.timeScale = Math.max(0.6, Math.min(1.4, s.speed / (anim === 'Walk' ? 2 : 5)));
    // Undo last frame's procedural offsets: bones the clip doesn't animate would keep accumulating them.
    if (this.hipsSaved) this.hips.position.copy(this.hipsSaved);
    if (this.torsoSaved) this.torso.quaternion.copy(this.torsoSaved);
    if (this.chestSaved) this.chest.quaternion.copy(this.chestSaved);
    this.mixer.update(dt);
    if (this.torso) this.torsoSaved = this.torso.quaternion.clone();
    if (this.chest) this.chestSaved = this.chest.quaternion.clone();
    this.crouch(s.crouch || 0);

    // Upper body leans toward the aim pitch; a hit makes it jolt back briefly.
    if (this.flinchT > 0) this.flinchT -= dt;
    const jolt = this.flinchT > 0 ? Math.sin((this.flinchT / 0.25) * Math.PI) * 0.25 : 0;
    const p = Math.max(-0.8, Math.min(0.8, s.pitch));
    if (this.torso) this.torso.rotateX(-p * 0.35 - jolt);
    if (this.chest) this.chest.rotateX(-p * 0.35);

    if (this.gun) this.gun.visible = !s.task;
    if (!this.gun || s.task || !this.ikOK) return;
    // Gun follows the chest (bob/sway) and pitches with the aim; then the arms reach for it.
    this.root.updateMatrixWorld(true);
    const chestNow = this.chest.getWorldPosition(v2).applyMatrix4(this.root.matrixWorld.clone().invert());
    this.mount.position.copy(chestNow);
    this.mount.rotation.set(p * 0.9 + jolt * 0.5, 0, 0);
    this.mount.updateMatrixWorld(true);
    const ud = this.gun.userData;
    const g = ud.grip.pos;
    const rTarget = this.gun.localToWorld(new THREE.Vector3(g[0], g[1] - 0.02, g[2] + 0.05));
    let lTarget;
    if (ud.type === 'rifle') lTarget = this.gun.localToWorld(new THREE.Vector3(-0.02, ud.fore.pos[1] - 0.035, ud.fore.pos[2] + 0.06));
    else if (ud.type === 'pistol') lTarget = this.gun.localToWorld(new THREE.Vector3(g[0] - 0.035, g[1] - 0.04, g[2] + 0.07));
    this.solveArm(this.arms.R, rTarget);
    if (lTarget) this.solveArm(this.arms.L, lTarget);
    // Trigger hand: rotate the wrist into its aiming-pose grip relative to the gun.
    const w = this.arms.R.wrist;
    q1.copy(this.mount.getWorldQuaternion(q2)).multiply(this.holdQ);
    w.quaternion.copy(w.parent.getWorldQuaternion(q2).invert().multiply(q1));
  }

  // Squat: drop the hips, keep the feet planted with leg IK, hunch the back a little.
  crouch(c) {
    if (!this.legsOK) return;
    this.hipsSaved = this.hips.position.clone();
    if (c < 0.01) return;
    this.root.updateMatrixWorld(true);
    const feet = [this.legs.L, this.legs.R].map((l) => l.wrist.getWorldPosition(new THREE.Vector3()));
    const hw = this.hips.getWorldPosition(new THREE.Vector3());
    hw.y -= CROUCH_DROP * c;
    this.hips.position.copy(this.hips.parent.worldToLocal(hw));
    this.hips.updateMatrixWorld(true);
    this.solveArm(this.legs.L, feet[0]);
    this.solveArm(this.legs.R, feet[1]);
    if (this.torso) this.torso.rotateX(CROUCH_LEAN * c);
  }

  die() {
    this.dead = true;
    if (this.gun) { this.mount.remove(this.gun); this.gun = null; this.gunId = null; }
    this.play('Death', 0.1);
  }

  reset() {
    this.dead = false;
    this.flinchT = 0;
    this.mixer.stopAllAction();
    this.cur = null;
    this.play('Idle_Gun_Pointing', 0);
    this.root.rotation.set(0, 0, 0);
  }
}

// The original procedural soldier, wrapped in the same interface (fallback if models can't load).
export class ProceduralBody {
  constructor(team) {
    this.ch = buildCharacter(team);
    this.root = this.ch.root;
    this.phase = 0;
    this.deathT = 0;
    this.dead = false;
  }
  get gun() { return this.ch.gun; }
  setGun(id) { setCharacterGun(this.ch, id); }
  flinch() {}
  update(dt, s) {
    if (this.dead) {
      if (this.deathT > 1) return;
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.45);
      this.root.rotation.x = k * k * Math.PI * 0.49;
      this.ch.knees[0].rotation.x = -0.6 * k;
      this.ch.knees[1].rotation.x = -0.3 * k;
      this.ch.spine.rotation.x = 0.25 * k;
      this.root.position.y += 0.12 * k;
      return;
    }
    this.phase += dt * s.speed * 2.0;
    poseCharacter(this.ch, { speed: s.speed, phase: this.phase, pitch: s.pitch, task: s.task });
  }
  die() { this.dead = true; this.deathT = 0; dropCharacterGun(this.ch); }
  reset() { this.dead = false; this.deathT = 0; this.root.rotation.set(0, 0, 0); }
}

export function createBody(team) {
  return templates[team] ? new HumanBody(team) : new ProceduralBody(team);
}
