import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Shared anatomy helpers for first-person arms and third-person characters.

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

// Tapered cylinder from point a (radius ra) to point b (radius rb).
export function segment(parent, a, b, ra, rb, mat, { seg = 12, caps = false } = {}) {
  const A = tmpA.set(...a), B = tmpB.set(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(rb, ra, len, seg, 1, false);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  m.castShadow = true;
  parent.add(m);
  if (caps) {
    for (const [p, r] of [[a, ra], [b, rb]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, seg, 8), mat);
      s.position.set(...p);
      s.castShadow = true;
      parent.add(s);
    }
  }
  return m;
}

function capsule(parent, a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = Math.max(0.001, A.distanceTo(B));
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, B.sub(A).normalize());
  parent.add(m);
  return m;
}

function chain(parent, pts, r, mat) {
  for (let i = 0; i < pts.length - 1; i++) capsule(parent, pts[i], pts[i + 1], r * (1 - i * 0.08), mat);
}

// A right hand closed around a grip whose axis is local +Y (grip front is -Z).
// Palm and back of the hand sit on +X; fingers wrap around the front to -X.
// Mirror with scale.x = -1 for a left hand. `trigger` extends the index finger.
export function buildHand(mat, { trigger = true, open = 0 } = {}) {
  const h = new THREE.Group();
  const palmGeo = new RoundedBoxGeometry(0.026, 0.084, 0.058, 2, 0.011);
  const palm = new THREE.Mesh(palmGeo, mat);
  palm.position.set(0.025, -0.004, 0.01);
  h.add(palm);
  const knuck = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.06, 3, 8), mat);
  knuck.position.set(0.024, -0.004, -0.016);
  h.add(knuck);
  const ys = [0.028, 0.008, -0.012, -0.031];
  ys.forEach((y, i) => {
    const k = i === 3 ? 0.82 : 1;
    if (i === 0 && trigger) {
      chain(h, [[0.024, y, -0.016], [0.012, y + 0.004, -0.04], [0.002, y, -0.058]], 0.0085, mat);
    } else {
      const w = 0.026 * k;
      chain(h, [[0.024, y, -0.016], [0.012, y, -0.016 - w * (1.2 - open)], [-0.012 * k, y, -0.02 - w * (1 - open)], [-0.024 * k + open * 0.02, y, -0.006 - open * 0.03]], 0.0085 * (i === 3 ? 0.88 : 1), mat);
    }
  });
  chain(h, [[0.02, 0.03, 0.035], [-0.004, 0.042, 0.03], [-0.024, 0.042, 0.014], [-0.03, 0.038, -0.004]], 0.0095, mat);
  h.userData.wrist = new THREE.Vector3(0.03, -0.045, 0.035);
  return h;
}

// Two-bone IK: elbow position for shoulder S, hand target H, bone lengths a/b and a pole hint.
export function solveElbow(S, H, a, b, pole) {
  const d = Math.min(S.distanceTo(H), a + b - 1e-4);
  const dir = H.clone().sub(S).normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
  perp.normalize();
  return S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
}
