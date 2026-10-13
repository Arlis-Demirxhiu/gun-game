import * as THREE from 'three';

// The Albanian double-headed eagle, drawn procedurally (black on the red of the flag) as a chest patch.
// Coordinates: one half of the eagle in a box about 200 x 200 centered on (0, 0), y down; the other half
// is mirrored.

const RED = '#e41e20', BLACK = '#0d0d0d';
let cutColor = RED; // background color, for the lines between feathers

// A tapered feather from (x, y) at `angle` (radians, 0 = right, positive = down), with a pointed tip.
function feather(ctx, x, y, angle, len, width) {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  ctx.beginPath();
  ctx.moveTo(x + nx * width, y + ny * width);
  ctx.quadraticCurveTo(x + dx * len * 0.6 + nx * width * 1.1, y + dy * len * 0.6 + ny * width * 1.1, x + dx * len, y + dy * len);
  ctx.quadraticCurveTo(x + dx * len * 0.6 - nx * width * 0.9, y + dy * len * 0.6 - ny * width * 0.9, x - nx * width, y - ny * width);
  ctx.closePath();
  ctx.fill();
}

// Solid wing: raised high and spread wide (the flag's "W" outline), its outer edge cut into feather tips.
const WING = { px: 14, py: 0, a0: -1.2, a1: 0.5, n: 10 };
const wingLen = (t) => 112 - 50 * Math.pow(t, 1.15);  // top feathers longest, lower ones shorter

function wing(ctx) {
  const { px, py, a0, a1, n } = WING;
  const at = (a, L) => [px + Math.cos(a) * L, py + Math.sin(a) * L];
  ctx.beginPath();
  ctx.moveTo(8, -14);
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    ctx.lineTo(...at(a, wingLen(i / n)));
    if (i < n) {
      const am = a + (a1 - a0) / n / 2;
      ctx.lineTo(...at(am, wingLen((i + 0.5) / n) * 0.8));
    }
  }
  ctx.quadraticCurveTo(44, 40, 10, 32);
  ctx.closePath();
  ctx.fill();
  // Lines between the long feathers give the wing its layered look.
  ctx.save();
  ctx.strokeStyle = cutColor;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const am = a0 + ((a1 - a0) * (i + 0.5)) / n, L = wingLen((i + 0.5) / n) * 0.8;
    ctx.beginPath();
    ctx.moveTo(...at(am, L * 0.62));
    ctx.lineTo(...at(am, L * 0.97));
    ctx.stroke();
  }
  ctx.restore();
}

function half(ctx) {
  // Neck and head turned outward, with the hooked, open beak — outlined in the background color so they
  // stand apart from the wings behind them.
  ctx.beginPath();
  ctx.moveTo(-2, -10);
  ctx.quadraticCurveTo(2, -40, 16, -58);
  ctx.quadraticCurveTo(22, -74, 34, -75);   // crown
  ctx.quadraticCurveTo(45, -75, 51, -68);   // forehead
  ctx.lineTo(62, -64);                      // upper beak tip
  ctx.quadraticCurveTo(61, -58, 55, -59);   // hook
  ctx.lineTo(50, -60);
  ctx.lineTo(57, -54);                      // lower beak
  ctx.lineTo(46, -54);
  ctx.quadraticCurveTo(36, -52, 32, -44);   // throat
  ctx.quadraticCurveTo(22, -28, 14, 0);
  ctx.closePath();
  ctx.save();
  ctx.strokeStyle = cutColor;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  ctx.fill();
  // Body.
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.quadraticCurveTo(24, -18, 21, 20);
  ctx.quadraticCurveTo(17, 50, 0, 58);
  ctx.closePath();
  ctx.fill();
  // Tail: a fan of feathers pointing down.
  for (const [a, l] of [[1.5, 52], [1.26, 50], [1.02, 44], [0.8, 34]]) feather(ctx, 2, 48, a, l, 6.5);
  // Leg and talons.
  ctx.beginPath();
  ctx.moveTo(10, 34);
  ctx.lineTo(17, 31);
  ctx.lineTo(33, 50);
  ctx.lineTo(27, 55);
  ctx.closePath();
  ctx.fill();
  for (const [a, l] of [[0.1, 13], [0.8, 13], [1.5, 11]]) feather(ctx, 30, 53, a, l, 2.4);
}

// Draw the eagle centered at (cx, cy), `size` pixels tall.
export function drawEagle(ctx, cx, cy, size, color = BLACK, bg = RED) {
  ctx.save();
  ctx.translate(cx, cy + size * 0.04);
  ctx.scale(size / 200, size / 200);
  ctx.fillStyle = color;
  cutColor = bg;
  for (const sx of [1, -1]) { ctx.save(); ctx.scale(sx, 1); wing(ctx); ctx.restore(); }
  for (const sx of [1, -1]) { ctx.save(); ctx.scale(sx, 1); half(ctx); ctx.restore(); }
  // Eyes, punched out in the background color.
  ctx.fillStyle = bg;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.arc(38 * s, -66, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The patch: red field, thin dark border, eagle in the middle (sizes in pixels).
export function drawPatch(ctx, w, h) {
  const r = Math.min(w, h) * 0.08;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, r);
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3a0a0a';
  ctx.stroke();
  // Fabric: faint weave so it reads as an embroidered patch, not a sticker.
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();
  drawEagle(ctx, w / 2, h / 2, h * 0.86);
}

let patchTex = null;
export function patchTexture() {
  if (patchTex) return patchTex;
  const c = document.createElement('canvas');
  c.width = 280;
  c.height = 220;
  drawPatch(c.getContext('2d'), c.width, c.height);
  patchTex = new THREE.CanvasTexture(c);
  patchTex.colorSpace = THREE.SRGBColorSpace;
  patchTex.anisotropy = 4;
  return patchTex;
}
