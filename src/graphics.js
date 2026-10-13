import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Rendering pipeline. High quality:
//   sky -> world -> ambient occlusion (GTAO) -> first-person weapon -> bloom -> ACES tone map -> grade/vignette
// Low quality renders the same scenes directly with tone mapping and no post effects.

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, contrast: { value: 1.06 }, warmth: { value: 0.03 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float contrast; uniform float warmth; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(warmth, warmth * 0.4, -warmth);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.8);
      c.rgb *= mix(1.0 - vignette, 1.0, smoothstep(0.75, 0.2, length(d)));
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

// Draws a scene over the previous result with a fresh depth buffer (used for the first-person weapon).
// RenderPass.clearDepth clears whichever target was bound before it switches targets, so it can't be used here.
class OverlayPass extends RenderPass {
  render(renderer, writeBuffer, readBuffer, ...rest) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    super.render(renderer, writeBuffer, readBuffer, ...rest);
  }
}

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,245,225,1)');
  grd.addColorStop(1, 'rgba(255,245,225,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Graphics {
  constructor(container, quality = 'high') {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.42;
    r.autoClear = false;
    container.appendChild(r.domElement);
    this.quality = quality;
    this.composer = null;
  }

  // Physical sky (Rayleigh/Mie scattering) and the environment maps derived from it.
  setupSky(scene, sunDir) {
    this.skyScene = new THREE.Scene();
    const sky = (this.sky = new Sky());
    sky.scale.setScalar(400);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.5;
    u.rayleigh.value = 1.0;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
    this.skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(this.skyScene, 0, 0.1, 1000).texture;
    this.studioEnv = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    pmrem.dispose();
  }

  setupDust(scene) {
    const N = 450, R = 22;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() * 2 - 1) * R;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.035, map: dustTexture(), transparent: true, opacity: 0.45, depthWrite: false, color: 0xfff0d0,
    }));
    this.dust.frustumCulled = false;
    this.dustR = R;
    this.dustVel = Array.from({ length: N }, () => new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.15));
    scene.add(this.dust);
  }

  updateDust(dt, center) {
    if (!this.dust) return;
    const a = this.dust.geometry.attributes.position, R = this.dustR, p = a.array;
    for (let i = 0; i < this.dustVel.length; i++) {
      const v = this.dustVel[i];
      for (let k = 0; k < 3; k++) {
        p[i * 3 + k] += v.getComponent(k) * dt;
        const c = k === 0 ? center.x : k === 1 ? center.y : center.z;
        const rel = p[i * 3 + k] - c;
        if (rel > R) p[i * 3 + k] -= 2 * R;
        else if (rel < -R) p[i * 3 + k] += 2 * R;
      }
      if (p[i * 3 + 1] < 0.05) p[i * 3 + 1] += 2 * R * 0.5;
    }
    a.needsUpdate = true;
  }

  buildComposer(scene, camera, vmScene, vmCamera) {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const c = (this.composer = new EffectComposer(r, target));
    c.addPass(new RenderPass(this.skyScene, camera));
    const world = new RenderPass(scene, camera);
    world.clear = false;
    c.addPass(world);
    const ao = (this.aoPass = new GTAOPass(scene, camera, size.x, size.y, {}, {
      radius: 0.7, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12, distanceFallOff: 1,
    }));
    ao.blendIntensity = 0.85;
    // Sprites (smoke, dust puffs, flashes) are soft billboards: keep them out of the AO depth/normal
    // pass, otherwise their quads cast square dark halos.
    const hideOverride = ao.overrideVisibility.bind(ao);
    ao.overrideVisibility = () => {
      hideOverride();
      scene.traverse((o) => { if (o.isSprite) o.visible = false; });
    };
    // AO at half resolution: a large saving on high-DPI screens, and the denoise hides the upscale.
    const aoSetSize = ao.setSize.bind(ao);
    ao.setSize = (w, h) => aoSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    c.addPass(ao);
    const vm = (this.vmPass = new OverlayPass(vmScene, vmCamera));
    vm.clear = false;
    c.addPass(vm);
    c.addPass((this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.5, 1.0)));
    c.addPass(new OutputPass());
    c.addPass(new ShaderPass(GradeShader));
    this.scene = scene;
    this.camera = camera;
    this.vmScene = vmScene;
    this.vmCamera = vmCamera;
    this.resize();
  }

  setQuality(q, sun) {
    this.quality = q;
    const high = q === 'high';
    if (sun) {
      const s = high ? 4096 : 2048;
      if (sun.shadow.mapSize.x !== s) {
        sun.shadow.mapSize.set(s, s);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    if (this.dust) this.dust.visible = high;
    this.resize();
  }

  resize() {
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 1.5 : 1));
    r.setSize(innerWidth, innerHeight);
    if (this.composer) {
      this.composer.setPixelRatio(r.getPixelRatio());
      this.composer.setSize(innerWidth, innerHeight);
    }
  }

  render(dt, showVM) {
    this.sky.position.copy(this.camera.position);
    if (this.quality === 'high' && this.composer) {
      this.vmPass.enabled = showVM;
      this.composer.render(dt);
      return;
    }
    const r = this.renderer;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.skyScene, this.camera);
    r.render(this.scene, this.camera);
    if (showVM) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}
