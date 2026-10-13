import * as THREE from 'three';
import { woodTexture } from './textures.js';

// Realistic-proportioned weapon models, built at real-world scale (meters).
// Most parts are side profiles traced as 2D shapes and extruded to their width.
// Gun-local frame: origin at the top of the pistol grip, barrel along -z, up is +y.
// A profile point is [forward, up], or [cx, cy, forward, up] for a quadratic curve.

let M = null;
function mats() {
  if (M) return M;
  const wood = woodTexture();
  wood.repeat.set(6, 6);
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.45, ...o });
  M = {
    blued: std({ color: 0x1b1c20, metalness: 0.85, roughness: 0.4 }),
    steel: std({ color: 0x3a3c40, metalness: 0.9, roughness: 0.3 }),
    dark: std({ color: 0x101012, metalness: 0.5, roughness: 0.6 }),
    anodized: std({ color: 0x1d1f21, metalness: 0.5, roughness: 0.5 }),
    alu: std({ color: 0x2e2e2b, metalness: 0.6, roughness: 0.5 }),
    polymer: std({ color: 0x141516, metalness: 0.05, roughness: 0.7 }),
    wood: std({ map: wood, color: 0xffffff, metalness: 0, roughness: 0.5 }),
    bakelite: std({ color: 0x5a2410, metalness: 0, roughness: 0.42 }),
    olive: std({ color: 0x4d5a3a, metalness: 0.05, roughness: 0.7 }),
    chrome: std({ color: 0xc4c4c4, metalness: 1, roughness: 0.2, envMapIntensity: 1 }),
    chromeDark: std({ color: 0x8c8c8c, metalness: 1, roughness: 0.3 }),
    blade: std({ color: 0xdcdcdc, metalness: 1, roughness: 0.16, envMapIntensity: 1 }),
    rubber: std({ color: 0x141414, metalness: 0, roughness: 0.9 }),
    lens: std({ color: 0x1b3a7a, metalness: 1, roughness: 0.05 }),
    smoked: std({ color: 0x2b2722, metalness: 0.1, roughness: 0.25, transparent: true, opacity: 0.72 }),
    augGreen: std({ color: 0x47513a, metalness: 0.05, roughness: 0.65 }),
    grey: std({ color: 0x3b3d3f, metalness: 0.1, roughness: 0.7 }),
    parker: std({ color: 0x2a2a28, metalness: 0.55, roughness: 0.55 }),
  };
  return M;
}

function shape(pts, S = THREE.Shape) {
  const s = new S();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.lineTo(p[0], p[1]);
  }
  return s;
}

function prof(g, pts, width, mat, { bevel = 0.003, holes = [], x = 0 } = {}) {
  const s = shape(pts);
  for (const h of holes) s.holes.push(shape(h, THREE.Path));
  const depth = Math.max(0.0005, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.x = x;
  g.add(m);
  return m;
}

// Round part along the barrel axis, from f0 to f1 (r1 at the rear, r2 at the front).
function tube(g, r1, r2, f0, f1, y, mat, { x = 0, seg = 18 } = {}) {
  const geo = new THREE.CylinderGeometry(r2, r1, f1 - f0, seg);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, -(f0 + f1) / 2);
  g.add(m);
  return m;
}

function box(g, w, h, f0, f1, y, mat, x = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, f1 - f0), mat);
  m.position.set(x, y, -(f0 + f1) / 2);
  g.add(m);
  return m;
}

// Cylinder sticking out sideways (axis x) or up (axis y).
function knob(g, r, len, axis, x, y, f, mat) {
  const geo = new THREE.CylinderGeometry(r, r, len, 12);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, -f);
  g.add(m);
  return m;
}

function triggerGroup(g, m, y0, mat) {
  prof(g, [[-0.004, y0], [0.074, y0], [0.074, y0 - 0.006], [0.046, y0 - 0.038], [-0.004, y0 - 0.038]], 0.01, mat, {
    bevel: 0.001, holes: [[[0.003, y0 - 0.004], [0.066, y0 - 0.004], [0.042, y0 - 0.031], [0.003, y0 - 0.031]]],
  });
  prof(g, [[0.03, y0], [0.037, y0], [0.033, y0 - 0.015], [0.022, y0 - 0.027], [0.026, y0 - 0.014]], 0.006, m.steel, { bevel: 0 });
}

function ak47(g) {
  const m = mats();
  prof(g, [[-0.085, -0.03], [0.205, -0.03], [0.205, 0.024], [0.19, 0.03], [-0.07, 0.03], [-0.085, 0.018]], 0.044, m.blued, { bevel: 0.002 });
  tube(g, 0.021, 0.021, -0.07, 0.19, 0.027, m.blued);
  box(g, 0.032, 0.026, 0.19, 0.24, 0.036, m.blued);
  box(g, 0.022, 0.012, 0.215, 0.255, 0.054, m.blued);
  knob(g, 0.006, 0.03, 'x', 0.036, 0.012, 0.15, m.steel);
  prof(g, [[-0.03, 0.0], [0.12, 0.004], [0.12, 0.014], [-0.03, 0.011]], 0.004, m.steel, { bevel: 0, x: 0.024 });
  triggerGroup(g, m, -0.03, m.blued);
  prof(g, [[0.0, -0.03], [-0.024, -0.07], [-0.034, -0.13], [-0.07, -0.13], [-0.06, -0.07], [-0.04, -0.03]], 0.032, m.bakelite, { bevel: 0.006 });
  prof(g, [[0.072, -0.03], [0.142, -0.03], [0.168, -0.13, 0.232, -0.215], [0.186, -0.24], [0.112, -0.13, 0.072, -0.03]], 0.03, m.blued, { bevel: 0.003 });
  prof(g, [[-0.08, 0.026], [-0.385, 0.0], [-0.392, -0.01], [-0.392, -0.1], [-0.38, -0.112], [-0.25, -0.08], [-0.12, -0.045], [-0.085, -0.03]], 0.04, m.wood, { bevel: 0.006 });
  prof(g, [[-0.392, 0.002], [-0.401, -0.004], [-0.401, -0.108], [-0.392, -0.114]], 0.042, m.blued, { bevel: 0.002 });
  prof(g, [[0.205, -0.03], [0.4, -0.026], [0.408, -0.012], [0.4, 0.014], [0.205, 0.016]], 0.05, m.wood, { bevel: 0.008 });
  tube(g, 0.017, 0.016, 0.24, 0.39, 0.037, m.wood);
  tube(g, 0.011, 0.011, 0.39, 0.47, 0.037, m.steel);
  box(g, 0.024, 0.042, 0.46, 0.495, 0.022, m.blued);
  tube(g, 0.011, 0.0095, 0.2, 0.66, 0.005, m.steel);
  box(g, 0.024, 0.016, 0.612, 0.645, 0.018, m.blued);
  box(g, 0.004, 0.032, 0.626, 0.632, 0.04, m.steel, 0.008);
  box(g, 0.004, 0.032, 0.626, 0.632, 0.04, m.steel, -0.008);
  box(g, 0.003, 0.026, 0.627, 0.631, 0.036, m.steel);
  tube(g, 0.014, 0.014, 0.655, 0.705, 0.005, m.blued);
  g.userData.muzzle = new THREE.Vector3(0, 0.005, -0.71);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.008, -0.3] };
  return 'rifle';
}

function m4a1(g) {
  const m = mats();
  prof(g, [[-0.075, 0.0], [0.175, 0.0], [0.175, 0.036], [-0.075, 0.036]], 0.04, m.anodized, { bevel: 0.003 });
  prof(g, [[-0.062, 0.036], [0.122, 0.036], [0.11, 0.08], [0.072, 0.088], [-0.052, 0.088], [-0.062, 0.076]], 0.022, m.anodized, {
    bevel: 0.002, holes: [[[-0.035, 0.045], [0.095, 0.045], [0.086, 0.071], [-0.035, 0.071]]],
  });
  knob(g, 0.011, 0.03, 'x', 0, 0.082, -0.045, m.anodized);
  prof(g, [[-0.07, -0.04], [0.062, -0.04], [0.066, -0.062], [0.136, -0.062], [0.14, -0.04], [0.172, -0.028], [0.172, 0.0], [-0.07, 0.0]], 0.038, m.anodized, { bevel: 0.002 });
  knob(g, 0.008, 0.02, 'x', 0.022, 0.03, -0.055, m.anodized);
  box(g, 0.003, 0.02, 0.0, 0.08, 0.018, m.steel, 0.0215);
  triggerGroup(g, m, -0.04, m.anodized);
  prof(g, [[0.0, -0.04], [-0.022, -0.08], [-0.03, -0.135], [-0.065, -0.135], [-0.058, -0.08], [-0.04, -0.04]], 0.032, m.polymer, { bevel: 0.005 });
  prof(g, [[0.068, -0.058], [0.133, -0.058], [0.15, -0.14, 0.164, -0.225], [0.104, -0.232], [0.09, -0.14, 0.068, -0.058]], 0.026, m.alu, { bevel: 0.002 });
  tube(g, 0.015, 0.015, -0.27, -0.07, 0.014, m.anodized);
  prof(g, [[-0.17, 0.034], [-0.33, 0.03], [-0.336, 0.02], [-0.336, -0.085], [-0.325, -0.092], [-0.29, -0.072], [-0.17, -0.012]], 0.042, m.polymer, {
    bevel: 0.004, holes: [[[-0.2, 0.02], [-0.29, 0.016], [-0.29, -0.01], [-0.2, 0.0]]],
  });
  box(g, 0.05, 0.008, -0.088, -0.062, 0.03, m.anodized);
  tube(g, 0.029, 0.029, 0.175, 0.188, 0.016, m.anodized);
  tube(g, 0.025, 0.025, 0.188, 0.36, 0.016, m.polymer, { seg: 10 });
  for (let i = 0; i < 6; i++) box(g, 0.052, 0.004, 0.2 + i * 0.026, 0.212 + i * 0.026, 0.016, m.dark);
  tube(g, 0.024, 0.016, 0.36, 0.372, 0.016, m.anodized);
  tube(g, 0.0085, 0.0085, 0.37, 0.53, 0.016, m.steel);
  prof(g, [[0.39, 0.004], [0.42, 0.004], [0.414, 0.075], [0.398, 0.075]], 0.018, m.anodized, { bevel: 0.001 });
  box(g, 0.004, 0.022, 0.403, 0.409, 0.086, m.steel);
  tube(g, 0.011, 0.011, 0.53, 0.58, 0.016, m.steel);
  g.userData.muzzle = new THREE.Vector3(0, 0.016, -0.585);
  g.userData.grip = { pos: [0, -0.088, 0.033], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.002, -0.27] };
  return 'rifle';
}

function awp(g) {
  const m = mats();
  prof(g, [[-0.42, -0.135], [-0.42, 0.03], [-0.405, 0.042], [-0.2, 0.042], [-0.14, 0.022], [-0.1, 0.0], [0.38, 0.0], [0.4, -0.02], [0.4, -0.04], [0.38, -0.055], [0.06, -0.055], [0.0, -0.06], [-0.025, -0.155], [-0.075, -0.165], [-0.13, -0.15]], 0.06, m.olive, {
    bevel: 0.006, holes: [[[-0.085, -0.045], [-0.055, -0.06], [-0.07, -0.125], [-0.1, -0.13], [-0.15, -0.06]]],
  });
  prof(g, [[-0.42, 0.03], [-0.432, 0.03], [-0.432, -0.135], [-0.42, -0.135]], 0.062, m.rubber, { bevel: 0.002 });
  tube(g, 0.02, 0.02, -0.1, 0.15, 0.02, m.blued);
  knob(g, 0.005, 0.05, 'x', 0.045, 0.02, -0.06, m.steel);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), m.steel);
  ball.position.set(0.072, 0.02, 0.06);
  g.add(ball);
  tube(g, 0.014, 0.011, 0.15, 0.68, 0.02, m.blued);
  tube(g, 0.017, 0.017, 0.68, 0.745, 0.02, m.blued);
  for (const s of [-1, 1]) box(g, 0.003, 0.01, 0.69, 0.735, 0.02, m.dark, s * 0.016);
  tube(g, 0.016, 0.016, -0.1, 0.18, 0.088, m.dark);
  tube(g, 0.016, 0.026, 0.18, 0.22, 0.088, m.dark);
  tube(g, 0.026, 0.026, 0.22, 0.28, 0.088, m.dark);
  tube(g, 0.022, 0.016, -0.15, -0.1, 0.088, m.dark);
  tube(g, 0.022, 0.022, -0.2, -0.15, 0.088, m.dark);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 20), m.lens);
  lens.position.set(0, 0.088, -0.281);
  lens.rotation.y = Math.PI;
  g.add(lens);
  knob(g, 0.012, 0.026, 'y', 0, 0.112, 0.04, m.dark);
  knob(g, 0.012, 0.026, 'x', 0.026, 0.088, 0.04, m.dark);
  for (const f of [-0.06, 0.12]) {
    tube(g, 0.02, 0.02, f, f + 0.016, 0.088, m.blued);
    box(g, 0.02, 0.04, f, f + 0.016, 0.055, m.blued);
  }
  box(g, 0.04, 0.05, 0.03, 0.1, -0.07, m.steel);
  triggerGroup(g, m, -0.055, m.blued);
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.75);
  g.userData.grip = { pos: [0, -0.1, 0.034], tilt: 0.25 };
  g.userData.fore = { pos: [0, -0.04, -0.25] };
  return 'rifle';
}

function mp5(g) {
  const m = mats();
  tube(g, 0.022, 0.022, -0.06, 0.25, 0.012, m.blued);
  box(g, 0.016, 0.01, -0.05, 0.22, 0.036, m.blued);
  prof(g, [[-0.06, -0.008], [0.07, -0.008], [0.07, -0.03], [0.035, -0.045], [0.01, -0.045], [-0.012, -0.13], [-0.05, -0.13], [-0.04, -0.06], [-0.06, -0.04]], 0.034, m.polymer, {
    bevel: 0.004, holes: [[[0.0, -0.016], [0.054, -0.016], [0.03, -0.038], [0.0, -0.038]]],
  });
  prof(g, [[0.026, -0.016], [0.032, -0.016], [0.028, -0.03], [0.02, -0.036], [0.022, -0.028]], 0.006, m.steel, { bevel: 0 });
  box(g, 0.03, 0.03, 0.08, 0.125, -0.012, m.blued);
  prof(g, [[0.085, -0.01], [0.115, -0.01], [0.135, -0.1, 0.175, -0.19], [0.15, -0.2], [0.1, -0.1, 0.085, -0.01]], 0.022, m.blued, { bevel: 0.002 });
  prof(g, [[0.12, -0.012], [0.27, -0.006], [0.275, 0.005], [0.27, 0.03], [0.12, 0.034], [0.115, 0.012]], 0.052, m.polymer, { bevel: 0.012 });
  tube(g, 0.009, 0.009, 0.26, 0.31, 0.012, m.steel);
  tube(g, 0.012, 0.012, 0.298, 0.312, 0.012, m.blued);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 18), m.blued);
  hood.position.set(0, 0.066, -0.255);
  g.add(hood);
  box(g, 0.006, 0.03, 0.25, 0.26, 0.05, m.blued);
  knob(g, 0.012, 0.026, 'x', 0, 0.056, -0.04, m.blued);
  tube(g, 0.008, 0.008, 0.1, 0.27, 0.04, m.blued, { x: -0.012 });
  knob(g, 0.005, 0.03, 'x', -0.03, 0.04, 0.2, m.steel);
  prof(g, [[-0.06, 0.03], [-0.32, 0.025], [-0.33, 0.015], [-0.33, -0.085], [-0.315, -0.09], [-0.2, -0.06], [-0.06, -0.04]], 0.04, m.polymer, { bevel: 0.005 });
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.315);
  g.userData.grip = { pos: [0, -0.08, 0.03], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.002, -0.2] };
  return 'rifle';
}

function pistol(g, kind) {
  const m = mats();
  const deagle = kind === 'deagle';
  const usp = kind === 'usp';
  const p228 = kind === 'p228', five = kind === 'fiveseven';
  const slideMat = deagle ? m.chrome : usp ? m.anodized : p228 ? m.parker : five ? m.grey : m.blued;
  const frameMat = deagle ? m.chromeDark : p228 ? m.anodized : five ? m.augGreen : m.polymer;
  const inner = new THREE.Group();
  const s = deagle ? 1.22 : 1;
  inner.scale.setScalar(s);
  g.add(inner);
  const L = usp ? 0.165 : five ? 0.17 : p228 ? 0.15 : 0.155;
  prof(inner, [[-0.035, 0.012], [L - 0.005, 0.012], [L, 0.02], [L, 0.038], [L - 0.008, 0.046], [-0.03, 0.046], [-0.035, 0.04]], 0.025, slideMat, { bevel: 0.002 });
  for (let i = 0; i < 6; i++) box(inner, 0.0262, 0.026, -0.03 + i * 0.006, -0.027 + i * 0.006, 0.03, m.dark);
  box(inner, 0.004, 0.012, 0.03, 0.075, 0.04, m.dark, 0.011);
  box(inner, 0.007, 0.007, L - 0.016, L - 0.008, 0.05, m.dark);
  box(inner, 0.018, 0.008, -0.03, -0.018, 0.05, m.dark);
  tube(inner, 0.0065, 0.0065, L - 0.002, L + 0.002, 0.03, m.dark);
  prof(inner, [[-0.03, -0.005], [L - 0.008, -0.002], [L - 0.008, 0.012], [-0.03, 0.012]], 0.022, frameMat, { bevel: 0.002 });
  prof(inner, [[0.0, -0.005], [0.07, -0.002], [0.072, -0.012], [0.06, -0.04], [0.0, -0.04]], 0.01, frameMat, {
    bevel: 0.001, holes: [[[0.007, -0.009], [0.062, -0.008], [0.052, -0.034], [0.007, -0.034]]],
  });
  prof(inner, [[0.028, -0.005], [0.034, -0.005], [0.03, -0.02], [0.02, -0.03], [0.023, -0.018]], 0.006, m.steel, { bevel: 0 });
  prof(inner, [[0.008, -0.005], [-0.012, -0.11], [-0.05, -0.108], [-0.043, -0.02], [-0.052, 0.0], [-0.036, 0.008]], 0.03, deagle ? m.rubber : frameMat, { bevel: 0.004 });
  if (deagle) {
    prof(inner, [[-0.005, 0.046], [L + 0.045, 0.046], [L + 0.045, 0.06], [L + 0.035, 0.068], [-0.005, 0.068]], 0.022, slideMat, { bevel: 0.002 });
    tube(inner, 0.009, 0.009, L + 0.044, L + 0.047, 0.04, m.dark);
    g.userData.muzzle = new THREE.Vector3(0, 0.04 * s, -(L + 0.05) * s);
  } else g.userData.muzzle = new THREE.Vector3(0, 0.03 * s, -(L + 0.005) * s);
  g.userData.grip = { pos: [0, -0.058 * s, 0.022 * s], tilt: 0.2 };
  return 'pistol';
}

// ---------- shared parts for the long guns ----------

// Trigger guard + pistol grip hanging from y0 (top of the grip at the origin).
function rifleGrip(g, m, y0, guardMat, gripMat) {
  triggerGroup(g, m, y0, guardMat);
  prof(g, [[0.0, y0], [-0.024, y0 - 0.04], [-0.034, y0 - 0.1], [-0.07, y0 - 0.1], [-0.06, y0 - 0.04], [-0.04, y0]], 0.032, gripMat, { bevel: 0.006 });
}

// Straight box magazine from (f, y) going down `len`, raked forward by `rake` (forward shift at the bottom).
function boxMag(g, f, y, len, depth, width, rake, mat) {
  prof(g, [[f, y], [f + depth, y], [f + depth + rake, y - len], [f + rake, y - len]], width, mat, { bevel: 0.003 });
  prof(g, [[f + rake - 0.003, y - len], [f + depth + rake + 0.003, y - len], [f + depth + rake + 0.003, y - len - 0.008], [f + rake - 0.003, y - len - 0.008]], width + 0.004, mat, { bevel: 0.001 });
}

// Curved rifle magazine (AK style), `c` sets how much it bends forward.
function curvedMag(g, f, y, len, depth, width, c, mat) {
  prof(g, [[f, y], [f + depth, y], [f + depth + c * 0.4, y - len * 0.5, f + depth + c, y - len], [f + c - 0.004, y - len - 0.012], [f + c * 0.4, y - len * 0.5, f, y]], width, mat, { bevel: 0.003 });
}

// Telescopic sight along the barrel axis: tube from f0 to f1 at height y with bells and lenses.
function scope(g, m, f0, f1, y, r = 0.016, bell = 0.024) {
  tube(g, r, r, f0 + 0.05, f1 - 0.06, y, m.dark);
  tube(g, r + 0.004, bell, f1 - 0.06, f1 - 0.02, y, m.dark);
  tube(g, bell, bell, f1 - 0.02, f1, y, m.dark);
  tube(g, bell - 0.004, r + 0.004, f0, f0 + 0.05, y, m.dark);
  const front = new THREE.Mesh(new THREE.CircleGeometry(bell - 0.003, 20), m.lens);
  front.position.set(0, y, -f1 - 0.001);
  front.rotation.y = Math.PI;
  g.add(front);
  knob(g, r * 0.75, 0.024, 'y', 0, y + r + 0.008, (f0 + f1) / 2, m.dark);
  knob(g, r * 0.75, 0.024, 'x', r + 0.008, y, (f0 + f1) / 2, m.dark);
}

// Scope rings sitting on the receiver at y0 holding a tube at height y.
function scopeMounts(g, m, fs, y0, y, mat = m.blued) {
  for (const f of fs) {
    box(g, 0.022, y - y0, f, f + 0.016, (y + y0) / 2, mat);
    tube(g, 0.02, 0.02, f, f + 0.016, y, mat);
  }
}

function flashHider(g, m, f, y, r = 0.011, len = 0.05) {
  tube(g, r, r, f, f + len, y, m.blued);
  for (let i = 0; i < 4; i++) box(g, 0.003, r * 2.2, f + len - 0.025, f + len, y, m.dark, 0).rotation.z = (i * Math.PI) / 4;
}

// ---------- shotguns ----------

function shotgun(g, auto) {
  const m = mats();
  prof(g, [[-0.06, -0.03], [0.16, -0.03], [0.16, 0.036], [0.14, 0.046], [-0.035, 0.046], [-0.06, 0.03]], 0.046, m.anodized, { bevel: 0.003 });
  box(g, 0.004, 0.034, 0.0, 0.1, 0.008, m.steel, 0.024); // ejection port
  rifleGrip(g, m, -0.03, m.anodized, m.polymer);
  tube(g, 0.0115, 0.0115, 0.16, 0.67, 0.024, m.blued); // barrel
  tube(g, 0.012, 0.012, 0.16, 0.6, -0.008, m.blued);  // magazine tube
  tube(g, 0.013, 0.013, 0.6, 0.625, -0.008, m.steel);
  box(g, 0.012, 0.032, 0.58, 0.6, 0.008, m.blued);       // barrel clamp
  box(g, 0.004, 0.014, 0.65, 0.66, 0.042, m.steel);       // front sight
  prof(g, [[0.02, 0.046], [0.06, 0.046], [0.055, 0.066], [0.03, 0.066]], 0.024, m.anodized, {
    bevel: 0.001, holes: [[[0.034, 0.05], [0.052, 0.05], [0.049, 0.06], [0.036, 0.06]]],
  }); // ghost ring
  if (auto) {
    // XM1014: fixed forend, rail, collapsible stock on a buffer tube.
    tube(g, 0.024, 0.022, 0.2, 0.4, 0.004, m.polymer, { seg: 12 });
    for (let i = 0; i < 5; i++) box(g, 0.05, 0.004, 0.24 + i * 0.03, 0.25 + i * 0.03, -0.012, m.dark);
    box(g, 0.022, 0.008, -0.03, 0.14, 0.05, m.dark);
    for (let i = 0; i < 8; i++) box(g, 0.024, 0.004, -0.025 + i * 0.02, -0.018 + i * 0.02, 0.055, m.dark);
    tube(g, 0.015, 0.015, -0.27, -0.06, 0.018, m.anodized);
    prof(g, [[-0.16, 0.036], [-0.34, 0.032], [-0.345, 0.02], [-0.345, -0.08], [-0.33, -0.088], [-0.29, -0.07], [-0.16, -0.006]], 0.042, m.polymer, {
      bevel: 0.004, holes: [[[-0.19, 0.02], [-0.3, 0.016], [-0.3, -0.04], [-0.2, 0.0]]],
    });
  } else {
    // M3: pump forend and a solid pistol-grip stock.
    tube(g, 0.023, 0.023, 0.27, 0.46, 0.002, m.polymer, { seg: 12 });
    for (let i = 0; i < 6; i++) box(g, 0.05, 0.004, 0.29 + i * 0.028, 0.3 + i * 0.028, -0.016, m.dark);
    prof(g, [[-0.06, 0.03], [-0.38, 0.004], [-0.392, -0.006], [-0.392, -0.108], [-0.378, -0.12], [-0.2, -0.07], [-0.06, -0.03]], 0.042, m.polymer, { bevel: 0.006 });
  }
  if (auto) prof(g, [[-0.345, 0.02], [-0.356, 0.02], [-0.356, -0.08], [-0.345, -0.088]], 0.044, m.rubber, { bevel: 0.002 });
  else prof(g, [[-0.392, 0.004], [-0.404, 0.0], [-0.404, -0.112], [-0.392, -0.118]], 0.044, m.rubber, { bevel: 0.002 });
  g.userData.muzzle = new THREE.Vector3(0, 0.024, -0.675);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.022, auto ? -0.31 : -0.37] };
  return 'rifle';
}

// ---------- SMGs ----------

function tmp(g) {
  const m = mats();
  prof(g, [[-0.06, -0.02], [0.16, -0.02], [0.17, 0.0], [0.17, 0.04], [0.15, 0.05], [-0.05, 0.05], [-0.06, 0.035]], 0.036, m.polymer, { bevel: 0.004 });
  box(g, 0.016, 0.008, -0.04, 0.14, 0.054, m.dark);
  box(g, 0.004, 0.016, -0.04, -0.03, 0.064, m.dark, 0.006);
  box(g, 0.004, 0.016, -0.04, -0.03, 0.064, m.dark, -0.006);
  box(g, 0.004, 0.014, 0.13, 0.138, 0.064, m.dark);
  knob(g, 0.006, 0.05, 'x', 0, 0.034, -0.02, m.dark);
  triggerGroup(g, m, -0.02, m.polymer);
  prof(g, [[0.0, -0.02], [-0.012, -0.13], [-0.05, -0.13], [-0.042, -0.02]], 0.03, m.polymer, { bevel: 0.005 });
  prof(g, [[-0.01, -0.13], [-0.013, -0.215], [-0.044, -0.215], [-0.047, -0.13]], 0.024, m.blued, { bevel: 0.002 });
  prof(g, [[0.115, -0.02], [0.15, -0.02], [0.146, -0.11], [0.138, -0.118], [0.122, -0.118], [0.118, -0.11]], 0.028, m.polymer, { bevel: 0.005 });
  tube(g, 0.019, 0.019, 0.17, 0.37, 0.018, m.dark); // suppressor
  tube(g, 0.016, 0.019, 0.365, 0.375, 0.018, m.steel);
  g.userData.muzzle = new THREE.Vector3(0, 0.018, -0.38);
  g.userData.grip = { pos: [0, -0.068, 0.026], tilt: 0.15 };
  g.userData.fore = { pos: [0, -0.06, -0.135] };
  return 'rifle';
}

function mac10(g) {
  const m = mats();
  prof(g, [[-0.055, -0.025], [0.19, -0.025], [0.19, 0.042], [0.182, 0.048], [-0.05, 0.048], [-0.055, 0.04]], 0.05, m.blued, { bevel: 0.003 });
  knob(g, 0.007, 0.014, 'y', 0, 0.058, 0.05, m.steel);         // cocking knob
  box(g, 0.004, 0.012, 0.03, 0.11, 0.05, m.dark);
  box(g, 0.006, 0.018, 0.175, 0.182, 0.056, m.blued);          // front sight post
  prof(g, [[-0.05, 0.048], [-0.02, 0.048], [-0.022, 0.066], [-0.045, 0.066]], 0.03, m.blued, { bevel: 0.001, holes: [[[-0.04, 0.052], [-0.028, 0.052], [-0.028, 0.06], [-0.04, 0.06]]] });
  tube(g, 0.012, 0.012, 0.19, 0.205, 0.018, m.blued);
  tube(g, 0.0085, 0.0085, 0.205, 0.245, 0.018, m.steel);       // threaded barrel
  for (let i = 0; i < 5; i++) tube(g, 0.0095, 0.0095, 0.21 + i * 0.007, 0.213 + i * 0.007, 0.018, m.dark);
  triggerGroup(g, m, -0.025, m.blued);
  prof(g, [[0.0, -0.025], [-0.004, -0.12], [-0.046, -0.12], [-0.042, -0.025]], 0.036, m.polymer, { bevel: 0.004 });
  prof(g, [[-0.003, -0.12], [-0.005, -0.25], [-0.043, -0.25], [-0.045, -0.12]], 0.026, m.blued, { bevel: 0.002 });
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 16, Math.PI), m.dark);
  strap.position.set(0, -0.025, -0.165);
  strap.rotation.set(0, Math.PI / 2, Math.PI);
  g.add(strap);
  for (const x of [-0.03, 0.03]) tube(g, 0.004, 0.004, -0.17, -0.05, 0.0, m.steel, { x }); // collapsed wire stock
  box(g, 0.066, 0.04, -0.18, -0.17, -0.005, m.steel);
  g.userData.muzzle = new THREE.Vector3(0, 0.018, -0.25);
  g.userData.grip = { pos: [0, -0.073, 0.026], tilt: 0.08 };
  g.userData.fore = { pos: [0, -0.03, -0.15] };
  return 'rifle';
}

function ump45(g) {
  const m = mats();
  prof(g, [[-0.08, -0.03], [0.28, -0.03], [0.3, -0.015], [0.3, 0.036], [0.28, 0.046], [-0.07, 0.046], [-0.08, 0.032]], 0.044, m.polymer, { bevel: 0.006 });
  for (let i = 0; i < 6; i++) box(g, 0.046, 0.003, 0.17 + i * 0.018, 0.176 + i * 0.018, -0.022, m.dark); // grip ribs
  box(g, 0.02, 0.01, -0.06, 0.27, 0.052, m.dark);
  for (let i = 0; i < 14; i++) box(g, 0.022, 0.004, -0.055 + i * 0.023, -0.047 + i * 0.023, 0.058, m.dark);
  prof(g, [[-0.05, 0.057], [-0.03, 0.057], [-0.032, 0.08], [-0.048, 0.08]], 0.024, m.dark, { bevel: 0.001, holes: [[[-0.045, 0.062], [-0.035, 0.062], [-0.036, 0.074], [-0.044, 0.074]]] });
  prof(g, [[0.25, 0.057], [0.27, 0.057], [0.268, 0.082], [0.252, 0.082]], 0.022, m.dark, { bevel: 0.001 });
  knob(g, 0.006, 0.04, 'x', -0.022, 0.03, 0.1, m.dark);
  rifleGrip(g, m, -0.03, m.polymer, m.polymer);
  boxMag(g, 0.085, -0.03, 0.17, 0.042, 0.026, 0.02, m.dark);
  tube(g, 0.01, 0.01, 0.3, 0.345, 0.012, m.steel);
  tube(g, 0.012, 0.012, 0.33, 0.345, 0.012, m.blued);
  prof(g, [[-0.08, 0.036], [-0.33, 0.03], [-0.336, 0.02], [-0.336, -0.085], [-0.322, -0.092], [-0.29, -0.074], [-0.08, -0.02]], 0.036, m.polymer, {
    bevel: 0.004, holes: [[[-0.11, 0.02], [-0.3, 0.016], [-0.3, -0.06], [-0.13, -0.012]]],
  });
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.35);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.036, -0.21] };
  return 'rifle';
}

function p90(g) {
  const m = mats();
  // Bullpup body: the stock runs back past the grip, the action sits behind the hand.
  prof(g, [[-0.215, 0.03], [-0.215, -0.1], [-0.2, -0.12], [-0.08, -0.12], [-0.05, -0.05], [-0.04, -0.02], [0.22, -0.02], [0.245, 0.0], [0.245, 0.05], [0.21, 0.07], [-0.19, 0.07]], 0.056, m.polymer, { bevel: 0.01 });
  // Thumb-hole front grip.
  prof(g, [[0.06, -0.02], [0.2, -0.02], [0.2, -0.07], [0.17, -0.115], [0.14, -0.12], [0.11, -0.1]], 0.05, m.polymer, {
    bevel: 0.008, holes: [[[0.125, -0.035], [0.185, -0.035], [0.18, -0.07], [0.16, -0.098], [0.14, -0.1]]],
  });
  triggerGroup(g, m, -0.02, m.polymer);
  prof(g, [[0.0, -0.02], [-0.012, -0.11], [-0.048, -0.11], [-0.04, -0.02]], 0.034, m.polymer, { bevel: 0.006 });
  box(g, 0.05, 0.022, -0.16, 0.19, 0.081, m.smoked); // translucent top magazine
  box(g, 0.054, 0.006, -0.17, 0.2, 0.072, m.dark);
  prof(g, [[-0.01, 0.092], [0.09, 0.092], [0.09, 0.122], [0.075, 0.13], [0.005, 0.13], [-0.01, 0.12]], 0.03, m.dark, { bevel: 0.003 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.01, 16), m.lens);
  lens.position.set(0, 0.112, -0.0915);
  lens.rotation.y = Math.PI;
  g.add(lens);
  tube(g, 0.009, 0.009, 0.245, 0.29, 0.022, m.steel);
  tube(g, 0.012, 0.012, 0.27, 0.29, 0.022, m.dark);
  g.userData.muzzle = new THREE.Vector3(0, 0.022, -0.295);
  g.userData.grip = { pos: [0, -0.07, 0.03], tilt: 0.2 };
  g.userData.fore = { pos: [0, -0.07, -0.15] };
  return 'rifle';
}

// ---------- rifles ----------

function galil(g) {
  const m = mats();
  prof(g, [[-0.085, -0.03], [0.21, -0.03], [0.21, 0.026], [0.195, 0.032], [-0.07, 0.032], [-0.085, 0.02]], 0.044, m.blued, { bevel: 0.002 });
  tube(g, 0.021, 0.021, -0.07, 0.19, 0.029, m.blued);
  knob(g, 0.006, 0.05, 'y', 0.026, 0.045, 0.14, m.steel); // upturned charging handle
  rifleGrip(g, m, -0.03, m.blued, m.polymer);
  curvedMag(g, 0.075, -0.03, 0.17, 0.068, 0.03, 0.05, m.blued);
  prof(g, [[0.21, -0.03], [0.4, -0.026], [0.405, -0.012], [0.4, 0.016], [0.21, 0.018]], 0.052, m.polymer, { bevel: 0.008 });
  for (let i = 0; i < 6; i++) box(g, 0.054, 0.004, 0.24 + i * 0.026, 0.248 + i * 0.026, 0.0, m.dark);
  tube(g, 0.011, 0.011, 0.21, 0.47, 0.038, m.blued);           // gas tube
  box(g, 0.024, 0.042, 0.46, 0.49, 0.022, m.blued);
  tube(g, 0.011, 0.0095, 0.2, 0.62, 0.005, m.steel);
  flashHider(g, m, 0.62, 0.005, 0.012, 0.05);
  prof(g, [[0.45, 0.04], [0.5, 0.04], [0.5, 0.06], [0.45, 0.06]], 0.018, m.blued, { bevel: 0.001 }); // carry handle base
  box(g, 0.004, 0.03, 0.47, 0.476, 0.072, m.steel);
  // Folding skeleton stock (extended).
  for (const y of [0.016, -0.075]) tube(g, 0.008, 0.008, -0.36, -0.085, y, m.blued);
  prof(g, [[-0.36, 0.03], [-0.385, 0.03], [-0.385, -0.1], [-0.36, -0.1]], 0.04, m.blued, { bevel: 0.003 });
  prof(g, [[-0.385, 0.03], [-0.395, 0.03], [-0.395, -0.1], [-0.385, -0.1]], 0.042, m.rubber, { bevel: 0.002 });
  g.userData.muzzle = new THREE.Vector3(0, 0.005, -0.675);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.01, -0.31] };
  return 'rifle';
}

function famas(g) {
  const m = mats();
  prof(g, [[-0.38, 0.04], [-0.38, -0.1], [-0.365, -0.115], [-0.22, -0.075], [-0.17, -0.03], [0.27, -0.03], [0.3, -0.012], [0.3, 0.04]], 0.052, m.polymer, { bevel: 0.008 });
  prof(g, [[-0.38, -0.1], [-0.39, -0.1], [-0.39, 0.04], [-0.38, 0.04]], 0.054, m.rubber, { bevel: 0.002 });
  for (let i = 0; i < 6; i++) box(g, 0.054, 0.004, 0.12 + i * 0.026, 0.128 + i * 0.026, -0.02, m.dark);
  // The long carrying handle that doubles as the sight rail.
  prof(g, [[-0.27, 0.04], [0.24, 0.04], [0.24, 0.12], [0.2, 0.135], [-0.22, 0.135], [-0.27, 0.105]], 0.024, m.polymer, {
    bevel: 0.003, holes: [[[-0.22, 0.056], [0.2, 0.056], [0.2, 0.11], [-0.2, 0.11]]],
  });
  box(g, 0.004, 0.02, 0.2, 0.208, 0.145, m.steel);
  rifleGrip(g, m, -0.03, m.polymer, m.polymer);
  boxMag(g, -0.205, -0.07, 0.11, 0.04, 0.026, 0.01, m.blued); // magazine behind the grip
  tube(g, 0.0095, 0.0095, 0.3, 0.46, 0.012, m.steel);
  flashHider(g, m, 0.44, 0.012, 0.012, 0.04);
  for (const x of [-0.028, 0.028]) tube(g, 0.005, 0.005, 0.12, 0.33, -0.018, m.dark, { x }); // folded bipod
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.485);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.036, -0.2] };
  return 'rifle';
}

// SG 552 Commando / SG 550 sniper: same family, the 550 has the long barrel, thumbhole stock and bipod.
function sg55x(g, sniper) {
  const m = mats();
  prof(g, [[-0.075, -0.03], [0.21, -0.03], [0.21, 0.04], [-0.06, 0.04], [-0.075, 0.026]], 0.044, m.parker, { bevel: 0.003 });
  box(g, 0.004, 0.024, 0.02, 0.12, 0.01, m.steel, 0.023);
  knob(g, 0.007, 0.04, 'x', 0.03, 0.022, 0.14, m.dark);
  rifleGrip(g, m, -0.03, m.parker, m.polymer);
  curvedMag(g, 0.08, -0.03, 0.17, 0.06, 0.028, 0.03, m.smoked);
  tube(g, 0.024, 0.022, 0.21, 0.39, 0.006, m.polymer, { seg: 14 });
  for (let i = 0; i < 5; i++) box(g, 0.05, 0.004, 0.23 + i * 0.03, 0.238 + i * 0.03, -0.017, m.dark);
  const L = sniper ? 0.72 : 0.47;
  tube(g, 0.0095, 0.009, 0.39, L, 0.006, m.steel);
  flashHider(g, m, L, 0.006, 0.0115, 0.045);
  if (sniper) {
    for (const x of [-0.026, 0.026]) tube(g, 0.005, 0.005, 0.2, 0.42, -0.02, m.dark, { x });
    prof(g, [[-0.075, 0.03], [-0.38, 0.03], [-0.39, 0.02], [-0.39, -0.11], [-0.37, -0.12], [-0.24, -0.08], [-0.075, -0.02]], 0.044, m.polymer, {
      bevel: 0.005, holes: [[[-0.105, 0.012], [-0.2, 0.01], [-0.21, -0.05], [-0.12, -0.03]]],
    });
    box(g, 0.03, 0.03, -0.32, -0.2, 0.05, m.polymer); // cheek rest
    scopeMounts(g, m, [-0.03, 0.12], 0.04, 0.09);
    scope(g, m, -0.12, 0.2, 0.09, 0.016, 0.024);
  } else {
    // Skeleton side-folding stock, extended.
    prof(g, [[-0.075, 0.03], [-0.34, 0.02], [-0.348, 0.008], [-0.348, -0.09], [-0.335, -0.098], [-0.075, -0.02]], 0.032, m.polymer, {
      bevel: 0.004, holes: [[[-0.1, 0.012], [-0.32, 0.006], [-0.32, -0.07], [-0.12, -0.012]]],
    });
    scopeMounts(g, m, [0.0, 0.06], 0.04, 0.072, m.dark);
    tube(g, 0.018, 0.018, -0.03, 0.11, 0.072, m.dark);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.015, 16), m.lens);
    lens.position.set(0, 0.072, -0.111);
    lens.rotation.y = Math.PI;
    g.add(lens);
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.006, -(L + 0.05));
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.02, -0.3] };
  return 'rifle';
}

function aug(g) {
  const m = mats();
  // Bullpup: smooth green polymer stock, magazine behind the grip, built-in 1.5x scope.
  prof(g, [[-0.4, 0.035], [-0.4, -0.1], [-0.38, -0.118], [-0.25, -0.1], [-0.19, -0.04], [0.1, -0.035], [0.135, -0.01], [0.135, 0.035]], 0.06, m.augGreen, { bevel: 0.012 });
  prof(g, [[-0.4, -0.1], [-0.41, -0.1], [-0.41, 0.035], [-0.4, 0.035]], 0.06, m.rubber, { bevel: 0.002 });
  // Big enclosed trigger guard.
  prof(g, [[-0.06, -0.035], [0.1, -0.035], [0.09, -0.12], [-0.035, -0.125]], 0.026, m.augGreen, {
    bevel: 0.004, holes: [[[-0.02, -0.045], [0.08, -0.045], [0.072, -0.11], [-0.008, -0.112]]],
  });
  prof(g, [[0.0, -0.035], [-0.012, -0.11], [-0.04, -0.11], [-0.032, -0.035]], 0.03, m.augGreen, { bevel: 0.005 });
  prof(g, [[0.03, -0.035], [0.037, -0.035], [0.033, -0.05], [0.022, -0.06], [0.026, -0.048]], 0.006, m.steel, { bevel: 0 });
  boxMag(g, -0.2, -0.06, 0.13, 0.042, 0.028, 0.025, m.smoked);
  // Integrated scope / carry handle.
  prof(g, [[-0.1, 0.035], [0.08, 0.035], [0.07, 0.075], [-0.09, 0.075]], 0.026, m.augGreen, { bevel: 0.004 });
  scope(g, m, -0.17, 0.11, 0.09, 0.017, 0.022);
  tube(g, 0.022, 0.022, 0.135, 0.16, 0.006, m.dark);
  tube(g, 0.011, 0.01, 0.16, 0.44, 0.006, m.steel);
  flashHider(g, m, 0.42, 0.006, 0.013, 0.04);
  // Folding vertical foregrip.
  prof(g, [[0.15, 0.0], [0.19, 0.0], [0.186, -0.115], [0.176, -0.122], [0.162, -0.122], [0.155, -0.112]], 0.032, m.augGreen, { bevel: 0.006 });
  g.userData.muzzle = new THREE.Vector3(0, 0.006, -0.465);
  g.userData.grip = { pos: [0, -0.07, 0.03], tilt: 0.2 };
  g.userData.fore = { pos: [0, -0.07, -0.17] };
  return 'rifle';
}

// ---------- snipers ----------

function scout(g) {
  const m = mats();
  prof(g, [[-0.4, -0.12], [-0.4, 0.028], [-0.385, 0.038], [-0.2, 0.036], [-0.12, 0.016], [-0.08, 0.0], [0.4, 0.0], [0.415, -0.015], [0.41, -0.035], [0.38, -0.045], [0.06, -0.045], [0.0, -0.05], [-0.02, -0.075], [-0.032, -0.135], [-0.075, -0.14], [-0.1, -0.085], [-0.2, -0.085]], 0.048, m.grey, { bevel: 0.006 });
  prof(g, [[-0.4, 0.028], [-0.412, 0.028], [-0.412, -0.12], [-0.4, -0.12]], 0.05, m.rubber, { bevel: 0.002 });
  tube(g, 0.018, 0.018, -0.09, 0.15, 0.018, m.blued);       // action
  knob(g, 0.0045, 0.045, 'x', 0.04, 0.018, -0.05, m.steel); // bolt handle
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), m.steel);
  ball.position.set(0.064, 0.018, 0.05);
  g.add(ball);
  tube(g, 0.0125, 0.009, 0.15, 0.7, 0.018, m.blued);
  tube(g, 0.011, 0.011, 0.69, 0.71, 0.018, m.dark);
  for (const x of [-0.022, 0.022]) tube(g, 0.0045, 0.0045, 0.2, 0.38, -0.035, m.dark, { x }); // folded bipod
  triggerGroup(g, m, -0.045, m.blued);
  box(g, 0.03, 0.04, 0.03, 0.09, -0.06, m.dark);             // magazine
  scopeMounts(g, m, [-0.05, 0.1], 0.03, 0.074);
  scope(g, m, -0.17, 0.22, 0.074, 0.014, 0.021);
  g.userData.muzzle = new THREE.Vector3(0, 0.018, -0.715);
  g.userData.grip = { pos: [0, -0.095, 0.034], tilt: 0.25 };
  g.userData.fore = { pos: [0, -0.045, -0.25] };
  return 'rifle';
}

function g3sg1(g) {
  const m = mats();
  prof(g, [[-0.085, -0.03], [0.26, -0.03], [0.26, 0.036], [-0.07, 0.036], [-0.085, 0.024]], 0.046, m.parker, { bevel: 0.002 });
  for (const x of [-0.0235, 0.0235]) box(g, 0.002, 0.008, -0.07, 0.25, 0.0, m.dark, x); // stamped ribs
  tube(g, 0.015, 0.015, 0.2, 0.3, 0.048, m.parker);                                     // cocking tube
  knob(g, 0.005, 0.04, 'x', -0.026, 0.05, 0.24, m.dark);
  rifleGrip(g, m, -0.03, m.polymer, m.polymer);
  boxMag(g, 0.1, -0.03, 0.15, 0.06, 0.03, 0.006, m.blued);
  tube(g, 0.027, 0.024, 0.26, 0.48, 0.012, m.polymer, { seg: 14 });
  for (let i = 0; i < 7; i++) box(g, 0.056, 0.004, 0.28 + i * 0.026, 0.287 + i * 0.026, -0.01, m.dark);
  tube(g, 0.0105, 0.0095, 0.48, 0.76, 0.012, m.steel);
  flashHider(g, m, 0.76, 0.012, 0.0125, 0.05);
  prof(g, [[-0.085, 0.03], [-0.42, 0.028], [-0.43, 0.018], [-0.43, -0.11], [-0.41, -0.12], [-0.26, -0.075], [-0.085, -0.02]], 0.044, m.polymer, { bevel: 0.006 });
  prof(g, [[-0.34, 0.028], [-0.18, 0.03], [-0.18, 0.06], [-0.33, 0.06]], 0.04, m.polymer, { bevel: 0.006 }); // cheek piece
  scopeMounts(g, m, [-0.02, 0.14], 0.036, 0.096);
  scope(g, m, -0.12, 0.24, 0.096, 0.016, 0.026);
  g.userData.muzzle = new THREE.Vector3(0, 0.012, -0.815);
  g.userData.grip = { pos: [0, -0.078, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.016, -0.36] };
  return 'rifle';
}

// ---------- machine gun ----------

function m249(g) {
  const m = mats();
  prof(g, [[-0.12, -0.035], [0.2, -0.035], [0.2, 0.05], [-0.11, 0.05], [-0.12, 0.04]], 0.07, m.parker, { bevel: 0.004 });
  prof(g, [[-0.1, 0.05], [0.17, 0.05], [0.16, 0.075], [-0.08, 0.078], [-0.1, 0.066]], 0.066, m.parker, { bevel: 0.004 }); // feed cover
  box(g, 0.02, 0.012, -0.06, 0.15, 0.084, m.dark);
  box(g, 0.004, 0.026, -0.07, -0.06, 0.095, m.steel);
  // Ammo box hanging below on the left, belt into the feed tray.
  prof(g, [[0.02, -0.03], [0.14, -0.03], [0.14, -0.15], [0.12, -0.16], [0.02, -0.16]], 0.07, m.olive, { bevel: 0.006, x: -0.012 });
  box(g, 0.028, 0.03, 0.06, 0.1, 0.02, m.steel, -0.05);
  rifleGrip(g, m, -0.035, m.parker, m.polymer);
  prof(g, [[0.2, -0.035], [0.36, -0.03], [0.365, -0.015], [0.36, 0.02], [0.2, 0.022]], 0.06, m.polymer, { bevel: 0.008 });
  tube(g, 0.014, 0.013, 0.2, 0.66, 0.02, m.blued);
  tube(g, 0.008, 0.008, 0.36, 0.52, -0.008, m.blued); // gas tube
  box(g, 0.036, 0.008, 0.22, 0.4, 0.04, m.dark);        // heat shield
  for (const x of [-0.024, 0.024]) tube(g, 0.006, 0.006, 0.38, 0.62, -0.022, m.dark, { x }); // folded bipod
  box(g, 0.05, 0.02, 0.5, 0.53, -0.008, m.blued);
  // Carry handle.
  prof(g, [[0.22, 0.034], [0.32, 0.034], [0.32, 0.07], [0.3, 0.08], [0.24, 0.08], [0.22, 0.07]], 0.016, m.dark, {
    bevel: 0.002, holes: [[[0.235, 0.044], [0.305, 0.044], [0.305, 0.068], [0.235, 0.068]]],
  });
  box(g, 0.004, 0.03, 0.635, 0.642, 0.045, m.steel);
  flashHider(g, m, 0.66, 0.02, 0.014, 0.05);
  prof(g, [[-0.12, 0.04], [-0.43, 0.02], [-0.44, 0.008], [-0.44, -0.1], [-0.425, -0.11], [-0.3, -0.08], [-0.12, -0.03]], 0.05, m.polymer, { bevel: 0.006 });
  prof(g, [[-0.44, 0.008], [-0.45, 0.008], [-0.45, -0.1], [-0.44, -0.1]], 0.052, m.rubber, { bevel: 0.002 });
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.715);
  g.userData.grip = { pos: [0, -0.083, 0.036], tilt: 0.3 };
  g.userData.fore = { pos: [0, -0.04, -0.28] };
  return 'rifle';
}

function knife(g) {
  const m = mats();
  prof(g, [[0.012, 0.014], [0.14, 0.014], [0.17, 0.011], [0.225, 0.004], [0.205, -0.016, 0.15, -0.017], [0.012, -0.017]], 0.004, m.blade, { bevel: 0.0015 });
  box(g, 0.0058, 0.004, 0.02, 0.13, 0.006, m.chromeDark);
  prof(g, [[0.0, -0.03], [0.012, -0.03], [0.012, 0.026], [0.0, 0.026]], 0.02, m.steel, { bevel: 0.002 });
  prof(g, [[0.0, -0.016], [-0.02, -0.022, -0.035, -0.016], [-0.05, -0.012, -0.065, -0.018], [-0.08, -0.023, -0.1, -0.017], [-0.112, -0.014], [-0.115, 0.0], [-0.112, 0.014], [0.0, 0.014]], 0.024, m.rubber, { bevel: 0.005 });
  tube(g, 0.013, 0.012, -0.125, -0.112, 0.0, m.steel);
  g.userData.muzzle = new THREE.Vector3(0, 0, -0.2);
  g.userData.grip = { pos: [0, 0, 0.055], tilt: Math.PI / 2 };
  return 'knife';
}

// Hand grenades, held upright in the palm (body along +y).
function grenade(g, kind) {
  const m = mats();
  if (!M.nadeOlive) {
    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.45, ...o });
    M.nadeOlive = std({ color: 0x3f4a2c, metalness: 0.3, roughness: 0.6 });
    M.nadeGrey = std({ color: 0x6d7175, metalness: 0.7, roughness: 0.35 });
    M.nadeSmoke = std({ color: 0x4b5a46, metalness: 0.4, roughness: 0.5 });
    M.nadeBand = std({ color: 0xd8d8d0, metalness: 0.1, roughness: 0.6 });
  }
  const y = (geo, mat, py, px = 0, pz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); g.add(o); return o; };
  if (kind === 'he') {
    const body = y(new THREE.SphereGeometry(0.033, 16, 12), M.nadeOlive, 0.04);
    body.scale.set(1, 1.2, 1);
    for (let i = 0; i < 3; i++) y(new THREE.TorusGeometry(0.031 - Math.abs(i - 1) * 0.008, 0.002, 4, 18), m.dark, 0.022 + i * 0.018).rotation.x = Math.PI / 2;
  } else {
    y(new THREE.CylinderGeometry(0.027, 0.027, 0.105, 16), kind === 'flash' ? M.nadeGrey : M.nadeSmoke, 0.052);
    if (kind === 'flash') for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      y(new THREE.BoxGeometry(0.006, 0.03, 0.006), m.dark, 0.05, Math.cos(a) * 0.027, Math.sin(a) * 0.027);
    } else y(new THREE.CylinderGeometry(0.0275, 0.0275, 0.016, 16), M.nadeBand, 0.07);
  }
  y(new THREE.CylinderGeometry(0.011, 0.013, 0.026, 10), m.steel, 0.095);
  const spoon = y(new THREE.BoxGeometry(0.012, 0.075, 0.006), m.steel, 0.07, 0, 0.03);
  spoon.rotation.x = -0.15;
  const ring = y(new THREE.TorusGeometry(0.011, 0.0025, 6, 14), m.steel, 0.105, 0.02);
  ring.rotation.y = Math.PI / 2;
  g.userData.muzzle = new THREE.Vector3(0, 0.1, 0);
  g.userData.grip = { pos: [0, 0.035, 0.0], tilt: 0 };
  return 'nade';
}

const cache = {};

// Returns a fresh group for the weapon. Geometry is rebuilt each call; materials are shared.
export function buildGunModel(id) {
  const g = new THREE.Group();
  let type;
  switch (id) {
    case 'ak47': type = ak47(g); break;
    case 'm4a1': type = m4a1(g); break;
    case 'awp': type = awp(g); break;
    case 'mp5': type = mp5(g); break;
    case 'm3': type = shotgun(g, false); break;
    case 'xm1014': type = shotgun(g, true); break;
    case 'tmp': type = tmp(g); break;
    case 'mac10': type = mac10(g); break;
    case 'ump45': type = ump45(g); break;
    case 'p90': type = p90(g); break;
    case 'galil': type = galil(g); break;
    case 'famas': type = famas(g); break;
    case 'sg552': type = sg55x(g, false); break;
    case 'sg550': type = sg55x(g, true); break;
    case 'aug': type = aug(g); break;
    case 'scout': type = scout(g); break;
    case 'g3sg1': type = g3sg1(g); break;
    case 'm249': type = m249(g); break;
    case 'glock':
    case 'usp':
    case 'p228':
    case 'fiveseven':
    case 'deagle': type = pistol(g, id); break;
    case 'hegrenade': type = grenade(g, 'he'); break;
    case 'flashbang': type = grenade(g, 'flash'); break;
    case 'smokegrenade': type = grenade(g, 'smoke'); break;
    default: type = knife(g);
  }
  g.userData.type = type;
  return g;
}

// Cached template, cloned for bots and dropped weapons (shares geometry).
export function gunInstance(id) {
  if (!cache[id]) cache[id] = buildGunModel(id);
  const c = cache[id].clone();
  c.userData = { ...cache[id].userData };
  c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return c;
}
