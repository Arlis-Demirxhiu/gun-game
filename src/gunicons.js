import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildGunModel } from './guns.js';

// Side-view pictures of the weapon models for the buy menu, rendered once each with a small offscreen
// renderer and cached as image URLs.

const W = 360, H = 150;
let ctx = null;
const cache = new Map();

function setup() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.3, 1, 1);
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x404040, 0.8));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(0, 0, 5);
  ctx = { renderer, scene, camera };
}

// Returns a data URL, or null if the id has no model (armor, kit) or WebGL isn't available.
export function gunIcon(id) {
  if (cache.has(id)) return cache.get(id);
  let url = null;
  try {
    if (!ctx) setup();
    const { renderer, scene, camera } = ctx;
    const g = buildGunModel(id);
    // Barrel to the right, like the CS buy menu pictures.
    g.rotation.y = g.userData.type === 'nade' ? 0 : -Math.PI / 2;
    const wrap = new THREE.Group();
    wrap.add(g);
    scene.add(wrap);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    wrap.position.sub(c);
    const half = Math.max(size.x / 2 / (W / H), size.y / 2) * 1.08;
    Object.assign(camera, { left: -half * (W / H), right: half * (W / H), top: half, bottom: -half });
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL('image/png');
    scene.remove(wrap);
    wrap.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  } catch {
    url = null;
  }
  cache.set(id, url);
  return url;
}
