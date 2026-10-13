import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { camoTexture, fabricTexture, leatherTexture, headTexture } from './textures.js';
import { segment, solveElbow } from './body.js';
import { gunInstance } from './guns.js';

// Articulated soldier models: hips -> thighs -> knees -> boots, and spine -> chest, head, arms.
// Arms are solved with two-bone IK so both hands sit on the weapon.

const V = THREE.Vector3;
let TM = null;

function teamMats() {
  if (TM) return TM;
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.45, roughness: 0.85, metalness: 0, ...o });
  const tex = (t, r) => { t.repeat.set(r, r); return t; };
  const ctCamo = tex(camoTexture('#3b4352', ['#2b313d', '#4e5869', '#1f242d', '#5d6676']), 2);
  TM = {
    CT: {
      uniform: std({ map: ctCamo }),
      pants: std({ map: ctCamo }),
      vest: std({ map: tex(fabricTexture('#2a2e33'), 2) }),
      pouch: std({ map: tex(fabricTexture('#33383f'), 1) }),
      strap: std({ color: 0x1c1e21 }),
      glove: std({ color: 0x18191a, roughness: 0.55 }),
      boot: std({ color: 0x141414, roughness: 0.5 }),
      helmet: std({ color: 0x2b3036, roughness: 0.55, metalness: 0.1 }),
      lens: std({ color: 0x0c0f14, roughness: 0.08, metalness: 0.9 }),
      head: std({ map: headTexture('#1e2023', '#c69a74'), roughness: 0.95 }),
      neck: std({ color: 0x1e2023 }),
      pad: std({ color: 0x1b1c1f, roughness: 0.6 }),
      belt: std({ color: 0x151617 }),
    },
    T: {
      uniform: std({ map: tex(leatherTexture('#4e3523'), 2), roughness: 0.6 }),
      pants: std({ map: tex(fabricTexture('#3a4458'), 3) }),
      vest: std({ map: tex(fabricTexture('#4b4a36'), 2) }),
      pouch: std({ map: tex(fabricTexture('#55543f'), 1) }),
      strap: std({ color: 0x3b3a2a }),
      glove: std({ color: 0xb98a63, roughness: 0.7 }),
      boot: std({ color: 0x3a2a1c, roughness: 0.6 }),
      helmet: null,
      lens: null,
      head: std({ map: headTexture('#151515', '#b98a63', { mouth: true }), roughness: 0.95 }),
      neck: std({ color: 0x151515 }),
      pad: null,
      belt: std({ color: 0x2a1d12 }),
    },
  };
  return TM;
}

const geoCache = new Map();
function rb(w, h, d, r = 0.03) {
  const k = `${w},${h},${d},${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 3, r));
  return geoCache.get(k);
}
function sphere(r, ws = 16, hs = 12) {
  const k = `s${r},${ws},${hs}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, ws, hs));
  return geoCache.get(k);
}
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function buildCharacter(team) {
  const M = teamMats()[team];
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const hips = new THREE.Group();
  hips.position.y = 0.93;
  root.add(hips);
  mesh(hips, rb(0.37, 0.22, 0.24, 0.07), M.pants);
  mesh(hips, rb(0.39, 0.05, 0.26, 0.02), M.belt, 0, 0.08, 0);

  const thighs = [], knees = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group();
    thigh.position.set(side * 0.105, -0.04, 0);
    hips.add(thigh);
    segment(thigh, [0, 0.03, 0], [0, -0.45, 0], 0.1, 0.073, M.pants, { seg: 14 });
    if (team === 'CT' && side === 1) mesh(thigh, rb(0.06, 0.17, 0.11, 0.02), M.belt, 0.085, -0.17, -0.01);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    thigh.add(knee);
    mesh(knee, sphere(0.072, 12, 10), M.pants);
    if (M.pad) mesh(knee, rb(0.1, 0.11, 0.05, 0.02), M.pad, 0, -0.02, -0.055);
    segment(knee, [0, 0, 0], [0, -0.38, 0], 0.07, 0.054, M.pants, { seg: 14 });
    const ankle = new THREE.Group();
    ankle.position.y = -0.4;
    knee.add(ankle);
    segment(ankle, [0, 0.12, 0], [0, -0.02, 0], 0.062, 0.064, M.boot);
    mesh(ankle, rb(0.12, 0.1, 0.29, 0.035), M.boot, 0, -0.0, -0.05);
    thighs.push(thigh);
    knees.push(knee);
  }

  const spine = new THREE.Group();
  spine.position.y = 0.08;
  hips.add(spine);
  mesh(spine, rb(0.37, 0.3, 0.23, 0.08), M.uniform, 0, 0.14, 0);
  mesh(spine, rb(0.47, 0.28, 0.27, 0.1), M.uniform, 0, 0.36, 0);
  for (const side of [-1, 1]) mesh(spine, sphere(0.076), M.uniform, side * 0.215, 0.43, 0);
  if (team === 'CT') {
    mesh(spine, rb(0.48, 0.36, 0.31, 0.05), M.vest, 0, 0.3, 0);
    for (const x of [-0.12, 0, 0.12]) mesh(spine, rb(0.09, 0.115, 0.05, 0.015), M.pouch, x, 0.2, -0.165);
    mesh(spine, rb(0.07, 0.15, 0.05, 0.015), M.pouch, -0.14, 0.37, -0.165);
    segment(spine, [-0.14, 0.44, -0.165], [-0.14, 0.57, -0.165], 0.006, 0.006, M.strap);
    mesh(spine, rb(0.32, 0.3, 0.08, 0.03), M.pouch, 0, 0.3, 0.175);
  } else {
    mesh(spine, rb(0.4, 0.17, 0.06, 0.02), M.vest, 0, 0.22, -0.14);
    for (const x of [-0.11, 0, 0.11]) mesh(spine, rb(0.085, 0.13, 0.05, 0.015), M.pouch, x, 0.22, -0.175);
    for (const side of [-1, 1]) {
      segment(spine, [side * 0.13, 0.29, -0.145], [side * 0.12, 0.49, -0.08], 0.012, 0.012, M.strap);
      segment(spine, [side * 0.12, 0.49, -0.08], [side * 0.12, 0.46, 0.14], 0.012, 0.012, M.strap);
    }
    mesh(spine, rb(0.26, 0.07, 0.22, 0.03), M.uniform, 0, 0.5, 0.01);
  }
  segment(spine, [0, 0.47, 0], [0, 0.57, 0], 0.058, 0.052, M.neck);
  const head = mesh(spine, sphere(0.115, 24, 16), M.head, 0, 0.645, 0);
  head.scale.set(0.9, 1.06, 1);
  if (team === 'CT') {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.128, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), M.helmet);
    helmet.position.set(0, 0.668, 0.006);
    helmet.scale.set(1, 0.88, 1.08);
    helmet.castShadow = true;
    spine.add(helmet);
    mesh(spine, rb(0.17, 0.05, 0.04, 0.015), M.lens, 0, 0.678, -0.1);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.008, 6, 24), M.strap);
    strap.position.set(0, 0.683, 0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(0.95, 1.05, 1);
    spine.add(strap);
  } else {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.116, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.4), M.neck);
    cap.position.set(0, 0.668, 0);
    cap.scale.set(0.95, 0.9, 1.04);
    spine.add(cap);
  }

  const arms = new THREE.Group();
  spine.add(arms);
  return { root, hips, spine, thighs, knees, arms, gun: null, gunId: null, M };
}

function ikArm(parent, S, H, pole, M) {
  const E = solveElbow(S, H, 0.29, 0.27, pole);
  segment(parent, S.toArray(), E.toArray(), 0.062, 0.05, M.uniform, { seg: 12 });
  mesh(parent, sphere(0.05, 12, 8), M.uniform, E.x, E.y, E.z);
  segment(parent, E.toArray(), H.toArray(), 0.049, 0.037, M.uniform, { seg: 12 });
  mesh(parent, rb(0.05, 0.085, 0.075, 0.02), M.glove, H.x, H.y - 0.01, H.z);
}

export function setCharacterGun(ch, id) {
  if (ch.gunId === id) return;
  ch.gunId = id;
  if (ch.gun) ch.spine.remove(ch.gun);
  ch.spine.remove(ch.arms);
  ch.arms = new THREE.Group();
  ch.spine.add(ch.arms);

  const gun = gunInstance(id);
  const ud = gun.userData;
  let R;
  if (ud.type === 'rifle') R = new V(0.12, 0.37, -0.2);
  else if (ud.type === 'pistol') R = new V(0.05, 0.4, -0.42);
  else R = new V(0.2, 0.12, -0.28);
  gun.position.copy(R).sub(new V(...ud.grip.pos));
  if (ud.type === 'rifle') {
    // Seat the buttstock in the shoulder pocket rather than through the back.
    const rear = new THREE.Box3().setFromObject(gun).max.z;
    gun.position.z += 0.07 - rear;
    R.z = gun.position.z + ud.grip.pos[2];
  }
  ch.spine.add(gun);
  ch.gun = gun;

  let L;
  if (ud.type === 'rifle') L = gun.position.clone().add(new V(...ud.fore.pos)).add(new V(-0.01, -0.03, 0.07));
  else if (ud.type === 'pistol') L = R.clone().add(new V(-0.03, -0.01, 0.015));
  else L = new V(-0.26, 0.06, -0.06);
  ikArm(ch.arms, new V(0.21, 0.43, 0.03), R, new V(0.7, -1, 0.4), ch.M);
  ikArm(ch.arms, new V(-0.19, 0.43, -0.09), L, new V(-0.8, -1, 0.1), ch.M);
}

export function poseCharacter(ch, s) {
  const amp = Math.min(1, s.speed / 3);
  const p = s.phase;
  if (s.task) {
    ch.hips.position.y = 0.55;
    ch.thighs[0].rotation.x = 1.4; ch.thighs[1].rotation.x = 0.6;
    ch.knees[0].rotation.x = -2.2; ch.knees[1].rotation.x = -2.0;
    ch.spine.rotation.x = -0.45;
    return;
  }
  ch.hips.position.y = 0.93 - Math.abs(Math.cos(p)) * 0.035 * amp;
  ch.thighs[0].rotation.x = Math.sin(p) * 0.6 * amp;
  ch.thighs[1].rotation.x = -Math.sin(p) * 0.6 * amp;
  ch.knees[0].rotation.x = -(0.05 + Math.max(0, Math.sin(p - 1.1)) * 1.1) * amp;
  ch.knees[1].rotation.x = -(0.05 + Math.max(0, Math.sin(p + Math.PI - 1.1)) * 1.1) * amp;
  ch.spine.rotation.x = Math.max(-0.7, Math.min(0.7, s.pitch)) * 0.85;
  ch.spine.rotation.y = Math.sin(p) * 0.06 * amp;
}

// Death pose: the weapon is dropped, arms splay out to the sides.
export function dropCharacterGun(ch) {
  if (ch.gun) ch.spine.remove(ch.gun);
  ch.gun = null;
  ch.gunId = null;
  ch.spine.remove(ch.arms);
  ch.arms = new THREE.Group();
  ch.spine.add(ch.arms);
  ikArm(ch.arms, new V(0.21, 0.43, 0.03), new V(0.5, 0.25, 0.12), new V(0.2, -1, 0.5), ch.M);
  ikArm(ch.arms, new V(-0.2, 0.43, 0.03), new V(-0.52, 0.35, 0.05), new V(-0.2, -1, 0.5), ch.M);
}
