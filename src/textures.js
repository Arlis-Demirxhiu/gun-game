import * as THREE from 'three';

// Procedural canvas textures so the game has zero binary assets.

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function texture(c, { repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grain(g, size, amount) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Soft color blotches, drawn wrapped so the texture still tiles.
function blotches(g, size, count, colors, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = rMin + Math.random() * (rMax - rMin);
    const col = colors[i % colors.length];
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const cx = x + ox, cy = y + oy;
        if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, rgba(col, col[3]));
        grd.addColorStop(1, rgba(col, 0));
        g.fillStyle = grd;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
}

export function sandstoneTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#c4a068';
  g.fillRect(0, 0, S, S);
  blotches(g, S, 60, [[150, 110, 60, 0.25], [235, 205, 155, 0.3], [120, 90, 50, 0.15]], 15, 80);
  const rows = 4, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    g.fillStyle = 'rgba(85,60,30,0.55)';
    g.fillRect(0, y, S, 4);
    g.fillStyle = 'rgba(255,240,200,0.25)';
    g.fillRect(0, y + 4, S, 3);
    const off = (r % 2) * S / 4;
    for (let k = 0; k < 2; k++) {
      const x = (off + k * S / 2) % S;
      g.fillStyle = 'rgba(85,60,30,0.5)';
      g.fillRect(x, y, 4, rh);
      g.fillStyle = 'rgba(255,240,200,0.2)';
      g.fillRect(x + 4, y, 3, rh);
    }
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(90,65,35,${0.1 + Math.random() * 0.25})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 5, 1 + Math.random() * 3);
  }
  grain(g, S, 28);
  return texture(c);
}

export function floorTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#b3905c';
  g.fillRect(0, 0, S, S);
  blotches(g, S, 80, [[140, 105, 60, 0.3], [215, 185, 135, 0.3], [160, 125, 80, 0.2]], 20, 110);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(105,78,45,0.45)' : 'rgba(230,210,170,0.45)';
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, S, 34);
  return texture(c);
}

export function crateTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#8a6232';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) {
    const y = (i * S) / 5;
    g.fillStyle = `rgba(${(100 + Math.random() * 40) | 0},${(70 + Math.random() * 30) | 0},35,0.35)`;
    g.fillRect(0, y, S, S / 5);
    g.fillStyle = 'rgba(40,25,10,0.6)';
    g.fillRect(0, y, S, 2);
  }
  g.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = 'rgba(60,40,15,0.25)';
    g.beginPath();
    const y = Math.random() * S;
    g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 6, S * 0.7, y + (Math.random() - 0.5) * 6, S, y);
    g.stroke();
  }
  const b = 22;
  g.fillStyle = '#5a3c1a';
  g.fillRect(0, 0, S, b);
  g.fillRect(0, S - b, S, b);
  g.fillRect(0, 0, b, S);
  g.fillRect(S - b, 0, b, S);
  g.strokeStyle = '#5a3c1a';
  g.lineWidth = 20;
  g.beginPath();
  g.moveTo(b, b);
  g.lineTo(S - b, S - b);
  g.stroke();
  g.strokeStyle = 'rgba(20,10,0,0.6)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeRect(b, b, S - 2 * b, S - 2 * b);
  g.fillStyle = '#2b2b2b';
  for (const [x, y] of [[b / 2, b / 2], [S - b / 2, b / 2], [b / 2, S - b / 2], [S - b / 2, S - b / 2]]) {
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, S, 20);
  return texture(c);
}

export function letterTexture(letter) {
  const S = 256;
  const [c, g] = canvas(S);
  g.font = 'bold 210px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(170,30,20,0.85)';
  g.fillText(letter, S / 2, S / 2 + 10);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] *= 0.55 + Math.random() * 0.45;
  g.putImageData(img, 0, 0);
  return texture(c, { repeat: false });
}

export function holeTexture() {
  const S = 64;
  const [c, g] = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(8,6,4,1)');
  grd.addColorStop(0.3, 'rgba(15,12,8,0.95)');
  grd.addColorStop(0.5, 'rgba(40,30,20,0.5)');
  grd.addColorStop(1, 'rgba(40,30,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return texture(c, { repeat: false });
}

export function puffTexture() {
  const S = 64;
  const [c, g] = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return texture(c, { repeat: false });
}

export function flashTexture() {
  const S = 128;
  const [c, g] = canvas(S);
  g.translate(S / 2, S / 2);
  for (let k = 0; k < 6; k++) {
    g.save();
    g.rotate((k / 6) * Math.PI * 2 + Math.random() * 0.4);
    const len = S * (0.32 + Math.random() * 0.16);
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,240,180,1)');
    grd.addColorStop(1, 'rgba(255,140,30,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(len, 0);
    g.lineTo(0, 7);
    g.fill();
    g.restore();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.3);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.4, 'rgba(255,200,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.fillRect(-S / 2, -S / 2, S, S);
  return texture(c, { repeat: false });
}

// ---------- weapon & character materials ----------

export function woodTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#7a4320';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * S;
    const amp = 2 + Math.random() * 6, freq = 0.01 + Math.random() * 0.03, ph = Math.random() * 6;
    g.strokeStyle = Math.random() < 0.6 ? `rgba(60,28,10,${0.15 + Math.random() * 0.3})` : `rgba(170,100,50,${0.1 + Math.random() * 0.2})`;
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath();
    for (let x = 0; x <= S; x += 4) {
      const yy = y + Math.sin(x * freq + ph) * amp;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  grain(g, S, 14);
  return texture(c);
}

export function camoTexture(base, colors, { size = 256, blobs = 70 } = {}) {
  const S = size;
  const [c, g] = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < blobs; i++) {
    g.fillStyle = colors[i % colors.length];
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 22;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        const n = 7;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = r * (0.6 + Math.random() * 0.6);
          const px = x + ox + Math.cos(a) * rr * 1.4, py = y + oy + Math.sin(a) * rr;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.fill();
      }
    }
  }
  // woven fabric
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(0, y, S, 1);
  }
  grain(g, S, 22);
  return texture(c);
}

export function fabricTexture(base, { lines = true, amount = 26 } = {}) {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  if (lines) {
    for (let i = 0; i < S; i += 2) {
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.fillRect(i, 0, 1, S);
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(0, i, S, 1);
    }
  }
  blotches(g, S, 10, [[0, 0, 0, 0.12], [255, 255, 255, 0.06]], 10, 40);
  grain(g, S, amount);
  return texture(c);
}

export function leatherTexture(base) {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  blotches(g, S, 40, [[0, 0, 0, 0.25], [255, 220, 180, 0.12]], 10, 50);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
    g.lineWidth = 1;
    g.beginPath();
    const x = Math.random() * S, y = Math.random() * S;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.random() * 30 - 15, y + Math.random() * 10, x + Math.random() * 40 - 20, y + Math.random() * 20 - 10);
    g.stroke();
  }
  grain(g, S, 30);
  return texture(c);
}

// Equirectangular head texture for a SphereGeometry: the face sits at u = 0.75 (facing -z).
export function headTexture(mask, skin, { mouth = false } = {}) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = mask;
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = 'rgba(255,255,255,0.035)';
    g.fillRect(0, y, W, 1);
  }
  const cx = W * 0.75, ey = H * 0.43;
  // eye opening in the balaclava
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(cx, ey, 30, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(80,40,20,0.35)';
  g.fillRect(cx - 28, ey - 9, 56, 3);
  for (const s of [-1, 1]) {
    g.fillStyle = '#f2efe8';
    g.beginPath();
    g.ellipse(cx + s * 12, ey + 1, 6, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3b2a1c';
    g.beginPath();
    g.arc(cx + s * 12, ey + 1, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx + s * 12, ey + 1, 1.2, 0, Math.PI * 2);
    g.fill();
  }
  if (mouth) {
    g.fillStyle = skin;
    g.beginPath();
    g.ellipse(cx, H * 0.62, 10, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a2a22';
    g.fillRect(cx - 6, H * 0.62, 12, 1.5);
  }
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return texture(c, { repeat: false });
}

// Tangent-space normal map derived from a texture's luminance (dark = recessed),
// so mortar lines, planks and pebbles catch the light.
export function normalMapFrom(src, strength = 2, repeat = true) {
  const W = src.width, H = src.height;
  const d = src.getContext('2d').getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const out = g.createImageData(W, H);
  const at = (x, y) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      out.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
