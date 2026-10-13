// Maps built from a real 3D model (GLB) with exact triangle collision.
//
//   - Geometry is read straight from the GLB's binary buffer (works in the browser and in Node).
//   - A uniform spatial grid over the triangles answers box-overlap queries (player/bot movement)
//     and ray casts (bullets, line of sight, grenades) against the real mesh.
//   - A 1 m navigation grid of walkable floors (several levels per column, e.g. tunnels under
//     ceilings) is generated from the mesh for bot pathfinding, spawns and bombsite points.
//
// MeshMap exposes the same interface as the grid-based GameMap in map.js.

export const STEP = 0.55;      // highest rise you can walk up without jumping
const MAX_DROP = 2.6;          // deepest drop bots will take
const NAV = 1.0;               // navigation cell size (m)
const HULL_H = 1.75;           // standing hull height used for collision
const CLIP_ABOVE = 4.8;        // highest you may stand above the nearest walkable floor (crates yes, roofs no)
const CLIP_RADIUS = 4;         // ...searched within this distance

// ---------- GLB geometry ----------

const COMP = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

// Returns { pos: Float32Array (x,y,z per vertex, in model units), idx: Uint32Array (3 per triangle) }.
export function parseGLB(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLen)));
  const binOff = 20 + jsonLen + 8;
  const read = (accIndex) => {
    const acc = json.accessors[accIndex];
    const view = json.bufferViews[acc.bufferView];
    const Type = COMP[acc.componentType];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
    const start = binOff + (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || Type.BYTES_PER_ELEMENT * comps;
    const out = new Float64Array(acc.count * comps);
    const src = new DataView(arrayBuffer);
    const get = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < comps; c++) out[i * comps + c] = src[get](start + i * stride + c * Type.BYTES_PER_ELEMENT, true);
    }
    return out;
  };
  const positions = [], indices = [];
  let base = 0;
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4) continue;
      const p = read(prim.attributes.POSITION);
      const n = p.length / 3;
      for (let i = 0; i < p.length; i++) positions.push(p[i]);
      if (prim.indices !== undefined) for (const v of read(prim.indices)) indices.push(base + v);
      else for (let i = 0; i < n; i++) indices.push(base + i);
      base += n;
    }
  }
  return { pos: new Float32Array(positions), idx: new Uint32Array(indices), json };
}

// ---------- triangle / box / ray math ----------

// Separating-axis triangle vs axis-aligned box overlap (Akenine-Möller).
function triBox(c, h, t) {
  const v0x = t[0] - c[0], v0y = t[1] - c[1], v0z = t[2] - c[2];
  const v1x = t[3] - c[0], v1y = t[4] - c[1], v1z = t[5] - c[2];
  const v2x = t[6] - c[0], v2y = t[7] - c[1], v2z = t[8] - c[2];
  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;
  const axis = (ax, ay, az) => {
    const p0 = v0x * ax + v0y * ay + v0z * az, p1 = v1x * ax + v1y * ay + v1z * az, p2 = v2x * ax + v2y * ay + v2z * az;
    const r = h[0] * Math.abs(ax) + h[1] * Math.abs(ay) + h[2] * Math.abs(az);
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };
  // 9 edge cross-product axes
  if (axis(0, -e0z, e0y) || axis(0, -e1z, e1y) || axis(0, -e2z, e2y)) return false;
  if (axis(e0z, 0, -e0x) || axis(e1z, 0, -e1x) || axis(e2z, 0, -e2x)) return false;
  if (axis(-e0y, e0x, 0) || axis(-e1y, e1x, 0) || axis(-e2y, e2x, 0)) return false;
  // box face normals
  if (Math.min(v0x, v1x, v2x) > h[0] || Math.max(v0x, v1x, v2x) < -h[0]) return false;
  if (Math.min(v0y, v1y, v2y) > h[1] || Math.max(v0y, v1y, v2y) < -h[1]) return false;
  if (Math.min(v0z, v1z, v2z) > h[2] || Math.max(v0z, v1z, v2z) < -h[2]) return false;
  // triangle plane
  const nx = e0y * e1z - e0z * e1y, ny = e0z * e1x - e0x * e1z, nz = e0x * e1y - e0y * e1x;
  const d = nx * v0x + ny * v0y + nz * v0z;
  const r = h[0] * Math.abs(nx) + h[1] * Math.abs(ny) + h[2] * Math.abs(nz);
  return Math.abs(d) <= r;
}

// Two-sided Möller–Trumbore; returns distance or -1.
function rayTri(ox, oy, oz, dx, dy, dz, t) {
  const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
  const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const sx = ox - t[0], sy = oy - t[1], sz = oz - t[2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return d > 1e-5 ? d : -1;
}

// Uniform grid of triangle buckets over the XZ plane.
class TriangleGrid {
  constructor(tris, normals, bounds, cell = 2) {
    this.tris = tris;          // Float32Array, 9 per triangle
    this.normals = normals;    // Float32Array, 3 per triangle (unit)
    this.cell = cell;
    this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    const count = tris.length / 9;
    this.yMin = new Float32Array(count);
    this.yMax = new Float32Array(count);
    const lists = Array.from({ length: this.nx * this.nz }, () => []);
    for (let i = 0; i < count; i++) {
      const o = i * 9;
      const xs = [tris[o], tris[o + 3], tris[o + 6]], ys = [tris[o + 1], tris[o + 4], tris[o + 7]], zs = [tris[o + 2], tris[o + 5], tris[o + 8]];
      this.yMin[i] = Math.min(...ys);
      this.yMax[i] = Math.max(...ys);
      const x0 = this.ci(Math.min(...xs)), x1 = this.ci(Math.max(...xs));
      const z0 = this.cj(Math.min(...zs)), z1 = this.cj(Math.max(...zs));
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) lists[j * this.nx + k].push(i);
    }
    // Flatten into one array + offsets.
    this.start = new Uint32Array(lists.length + 1);
    let total = 0;
    lists.forEach((l, i) => { this.start[i] = total; total += l.length; });
    this.start[lists.length] = total;
    this.items = new Uint32Array(total);
    lists.forEach((l, i) => this.items.set(l, this.start[i]));
    this.stamp = new Uint32Array(count);
    this.query = 0;
    this.tri = new Float32Array(9);
  }

  ci(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
  cj(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell))); }

  load(i) {
    const o = i * 9, t = this.tri, s = this.tris;
    for (let k = 0; k < 9; k++) t[k] = s[o + k];
    return t;
  }

  boxHits(minX, minY, minZ, maxX, maxY, maxZ) {
    const q = ++this.query;
    const c = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const h = [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2];
    for (let j = this.cj(minZ); j <= this.cj(maxZ); j++) {
      for (let k = this.ci(minX); k <= this.ci(maxX); k++) {
        const b = j * this.nx + k;
        for (let p = this.start[b]; p < this.start[b + 1]; p++) {
          const i = this.items[p];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (this.yMin[i] > maxY || this.yMax[i] < minY) continue;
          if (triBox(c, h, this.load(i))) return true;
        }
      }
    }
    return false;
  }

  // Nearest hit along the ray: { t, i } or null. Walks the XZ buckets in order (2D DDA).
  ray(ox, oy, oz, dx, dy, dz, maxT) {
    const q = ++this.query;
    let best = maxT, bestI = -1;
    let k = Math.floor((ox - this.minX) / this.cell), j = Math.floor((oz - this.minZ) / this.cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(this.cell / dx) : Infinity, tdz = dz !== 0 ? Math.abs(this.cell / dz) : Infinity;
    let tmx = dx !== 0 ? ((this.minX + (k + (dx > 0 ? 1 : 0)) * this.cell) - ox) / dx : Infinity;
    let tmz = dz !== 0 ? ((this.minZ + (j + (dz > 0 ? 1 : 0)) * this.cell) - oz) / dz : Infinity;
    for (let n = 0; n < 4096; n++) {
      if (k >= 0 && j >= 0 && k < this.nx && j < this.nz) {
        const b = j * this.nx + k;
        for (let p = this.start[b]; p < this.start[b + 1]; p++) {
          const i = this.items[p];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          const d = rayTri(ox, oy, oz, dx, dy, dz, this.load(i));
          if (d > 0 && d < best) { best = d; bestI = i; }
        }
      } else if ((k < 0 && dx <= 0) || (j < 0 && dz <= 0) || (k >= this.nx && dx >= 0) || (j >= this.nz && dz >= 0)) break;
      const t1 = Math.min(tmx, tmz);
      if (best <= t1 || t1 >= maxT) break; // nothing in later buckets can be nearer
      if (tmx < tmz) { k += stepX; tmx += tdx; } else { j += stepZ; tmz += tdz; }
    }
    return bestI >= 0 ? { t: best, i: bestI } : null;
  }
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a;
    a.push(v);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------- prepared map data (shared by every MeshMap instance of the same map) ----------

const prepared = new Map();

// Load + index a mesh map once. `load(path)` returns an ArrayBuffer (fetch in the browser, fs in Node).
export async function prepareMeshMap(def, load) {
  if (prepared.has(def.id)) return prepared.get(def.id);
  const glb = parseGLB(await load(def.mesh));
  const s = def.scale, flip = def.flip ? -1 : 1;
  // Model units -> meters; optionally rotate 180° about X (Y and Z flipped) so +Y is up.
  const P = glb.pos, nV = P.length / 3;
  const W = new Float32Array(P.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nV; i++) {
    const x = P[i * 3] * s, y = P[i * 3 + 1] * s * flip, z = P[i * 3 + 2] * s * flip;
    W[i * 3] = x; W[i * 3 + 1] = y; W[i * 3 + 2] = z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  // Shift so the map starts at (0, 0, 0): same convention as the grid maps.
  const offset = { x: -minX, y: -minY, z: -minZ };
  for (let i = 0; i < nV; i++) { W[i * 3] += offset.x; W[i * 3 + 1] += offset.y; W[i * 3 + 2] += offset.z; }
  const bounds = { minX: 0, minY: 0, minZ: 0, maxX: maxX - minX, maxY: maxY - minY, maxZ: maxZ - minZ };
  const nT = glb.idx.length / 3;
  const tris = new Float32Array(nT * 9), normals = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    for (let v = 0; v < 3; v++) {
      const vi = glb.idx[t * 3 + v];
      tris[t * 9 + v * 3] = W[vi * 3]; tris[t * 9 + v * 3 + 1] = W[vi * 3 + 1]; tris[t * 9 + v * 3 + 2] = W[vi * 3 + 2];
    }
    const o = t * 9;
    const ax = tris[o + 3] - tris[o], ay = tris[o + 4] - tris[o + 1], az = tris[o + 5] - tris[o + 2];
    const bx = tris[o + 6] - tris[o], by = tris[o + 7] - tris[o + 1], bz = tris[o + 8] - tris[o + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
  }
  const grid = new TriangleGrid(tris, normals, bounds, 2);
  const data = { def, grid, bounds, transform: { scale: s, flip, offset } };
  data.nav = buildNav(data);
  prepared.set(def.id, data);
  return data;
}

export function isPrepared(id) { return prepared.has(id); }
export function getPrepared(id) {
  if (!prepared.has(id)) throw new Error(`map ${id} is not loaded yet`);
  return prepared.get(id);
}

// ---------- navigation grid ----------

function collidesWith(grid, x, y, z, r, h = HULL_H) {
  return grid.boxHits(x - r, y + STEP, z - r, x + r, y + h, z + r);
}

// Simulate walking from a to b: follow the floor in small steps (each rise <= STEP, each drop <= MAX_DROP),
// never bumping into a wall, and arrive on b's floor level.
function walkable(grid, ax, ay, az, bx, by, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2);
  let y = ay;
  for (let s = 1; s <= n; s++) {
    const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n;
    const from = y + STEP + 0.02;
    const hit = grid.ray(x, from, z, 0, -1, 0, STEP + MAX_DROP + 0.02);
    if (!hit) return false;
    y = from - hit.t;
    if (collidesWith(grid, x, y, z, 0.28)) return false;
  }
  return Math.abs(y - by) < 0.15;
}

function buildNav(data) {
  const { grid, bounds, def } = data;
  const nw = Math.ceil(bounds.maxX / NAV), nd = Math.ceil(bounds.maxZ / NAV);
  const nodesOfCell = Array.from({ length: nw * nd }, () => []);
  const nodeY = [], nodeCell = [];
  // 1) Walkable floors per column: cast down from the sky, then keep going below each surface.
  for (let j = 0; j < nd; j++) {
    for (let i = 0; i < nw; i++) {
      const x = (i + 0.5) * NAV, z = (j + 0.5) * NAV;
      let top = bounds.maxY + 2;
      for (let level = 0; level < 6; level++) {
        const hit = grid.ray(x, top, z, 0, -1, 0, top + 1);
        if (!hit) break;
        const y = top - hit.t;
        const ny = Math.abs(grid.normals[hit.i * 3 + 1]);
        if (ny > 0.7 && !collidesWith(grid, x, y, z, 0.3)) {
          nodesOfCell[j * nw + i].push(nodeY.length);
          nodeY.push(y);
          nodeCell.push(j * nw + i);
        }
        top = y - 0.05;
      }
    }
  }
  const N = nodeY.length;
  // 2) Links to neighbouring cells: step up at most STEP, drop at most MAX_DROP, no wall in between.
  const links = Array.from({ length: N }, () => []);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const linked = (a, b) => links[a].includes(b);
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const c = nodeCell[n], i = c % nw, j = (c / nw) | 0, ya = nodeY[n];
      for (const [di, dj] of dirs) {
        const diag = di && dj;
        if ((pass === 0) === !!diag) continue; // straight links first, then diagonals
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nw || nj >= nd) continue;
        for (const m of nodesOfCell[nj * nw + ni]) {
          const yb = nodeY[m];
          if (yb - ya > STEP * 2.2 || yb - ya < -MAX_DROP) continue;
          if (!walkable(grid, (i + 0.5) * NAV, ya, (j + 0.5) * NAV, (ni + 0.5) * NAV, yb, (nj + 0.5) * NAV)) continue;
          if (diag) {
            // Only cut a corner if both straight neighbours connect too.
            const okA = nodesOfCell[j * nw + ni].some((p) => linked(n, p) && linked(p, m));
            const okB = nodesOfCell[nj * nw + i].some((p) => linked(n, p) && linked(p, m));
            if (!okA || !okB) continue;
          }
          links[n].push(m);
        }
      }
    }
  }
  // 3) Keep only floors reachable from the spawns (drops out roof-tops and spaces inside walls).
  const reach = new Uint8Array(N);
  const queue = [];
  for (const team of ['T', 'CT']) {
    const r = def.spawns[team];
    for (let n = 0; n < N; n++) {
      const c = nodeCell[n], x = (c % nw + 0.5) * NAV, z = (((c / nw) | 0) + 0.5) * NAV;
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && nodeY[n] < (r.maxY ?? Infinity)) { reach[n] = 1; queue.push(n); }
    }
  }
  // Reachability must work both ways (you can drop down but must be able to walk back somewhere).
  const back = Array.from({ length: N }, () => []);
  for (let n = 0; n < N; n++) for (const m of links[n]) back[m].push(n);
  while (queue.length) {
    const n = queue.pop();
    for (const m of links[n]) if (!reach[m]) { reach[m] = 1; queue.push(m); }
    for (const m of back[n]) if (!reach[m]) { reach[m] = 1; queue.push(m); }
  }
  // 4) Player clip, like the invisible brushes CS maps put over roofs and wall tops: per 1 m column, the
  //    highest your feet may be = highest walkable floor within CLIP_RADIUS + CLIP_ABOVE. Columns with no
  //    walkable floor nearby (inside walls, outside the map) can't be entered at all.
  const clip = new Float32Array(nw * nd).fill(-Infinity);
  const R = Math.ceil(CLIP_RADIUS / NAV);
  for (let n = 0; n < N; n++) {
    if (!reach[n]) continue;
    const c = nodeCell[n], i = c % nw, j = (c / nw) | 0, top = nodeY[n] + CLIP_ABOVE;
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nw || jj >= nd || Math.hypot(di, dj) * NAV > CLIP_RADIUS) continue;
        const k = jj * nw + ii;
        if (top > clip[k]) clip[k] = top;
      }
    }
  }
  // Big crate stacks reach further from the floor than CLIP_RADIUS: let empty columns inherit the limit of
  // their neighbours (2 m), so their tops have no invisible walls. Cliffs and wall tops stay far above it.
  for (let pass = 0; pass < 2; pass++) {
    const prev = clip.slice();
    for (let j = 0; j < nd; j++) for (let i = 0; i < nw; i++) {
      const k = j * nw + i;
      if (prev[k] > -Infinity) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < nw && jj < nd && prev[jj * nw + ii] > clip[k]) clip[k] = prev[jj * nw + ii];
      }
    }
  }
  // Roofs: a surface you can't walk to that has a walkable floor underneath it (tunnels, covered passages),
  // plus everything connected to it at roof level. Crates and walls never have a floor inside them.
  const roof = new Uint8Array(N), rq = [];
  for (let n = 0; n < N; n++) {
    if (reach[n]) continue;
    if (nodesOfCell[nodeCell[n]].some((m) => reach[m] && nodeY[m] < nodeY[n] - 1.5)) { roof[n] = 1; rq.push(n); }
  }
  while (rq.length) {
    const n = rq.pop(), c = nodeCell[n], i = c % nw, j = (c / nw) | 0;
    for (const [di, dj] of dirs) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nw || jj >= nd) continue;
      for (const m of nodesOfCell[jj * nw + ii]) {
        if (!roof[m] && !reach[m] && Math.abs(nodeY[m] - nodeY[n]) < 0.6) { roof[m] = 1; rq.push(m); }
      }
    }
  }
  for (let n = 0; n < N; n++) if (roof[n]) clip[nodeCell[n]] = Math.min(clip[nodeCell[n]], nodeY[n] - 0.25);
  return { nw, nd, nodeY: Float32Array.from(nodeY), nodeCell: Int32Array.from(nodeCell), nodesOfCell, links, reach, clip };
}

// ---------- MeshMap ----------

export class MeshMap {
  constructor(data) {
    this.data = data;
    this.def = data.def;
    this.id = data.def.id;
    this.grid = data.grid;
    this.nav = data.nav;
    this.width = data.bounds.maxX;
    this.depth = data.bounds.maxZ;
    this.maxH = data.bounds.maxY;
    this.isMesh = true;
    this.sites = data.def.sites;
    this.spawnRects = data.def.spawns;
    this.routes = data.def.routes;
    this.watchCT = data.def.watchCT;
    this.watchT = data.def.watchT;
  }

  get center() { return { x: this.width / 2, z: this.depth / 2 }; }

  // ----- collision -----

  collides(x, y, z, r, h = HULL_H) { return collidesWith(this.grid, x, y, z, r, h); }

  // Feet height after moving to (x, z) from height y: y itself when free, a step higher when the
  // way is blocked only by stairs (Quake-style step-up), or null when blocked.
  // `over` = how far the feet are above the player clip where you stand now (0 normally). A move may not
  // take you further over it, so you can't climb onto roofs — but if you ever end up above it, you can
  // always walk back down instead of being stuck.
  moveTo(x, y, z, r, h = HULL_H, over = 0) {
    const lim = this.feetLimit(x, z), allowed = Math.max(0.01, over);
    if (y - lim > allowed) return null;                           // player clip
    const ground = this.groundAt(x, z, r, y);
    if (ground < y - 40) return null;                             // no floor below: a hole in the world
    if (ground > y && ground - lim > allowed) return null;        // would step up onto a clipped surface
    if (!this.collides(x, y, z, r, h)) return y;
    return ground > y && !this.collides(x, ground, z, r, h) ? ground : null;
  }

  // Highest the feet may be at (x, z) — see the player clip in buildNav.
  feetLimit(x, z) {
    const { nw, nd, clip } = this.nav;
    const i = Math.floor(x / NAV), j = Math.floor(z / NAV);
    return i < 0 || j < 0 || i >= nw || j >= nd ? -Infinity : clip[j * nw + i];
  }

  // Highest floor under the footprint that's at most a step above `y` (top of the map if y is unknown).
  groundAt(x, z, r, y) {
    const from = y === undefined ? this.maxH + 2 : y + STEP + 0.02;
    let best = -Infinity;
    const k = r * 0.7;
    for (const [ox, oz] of [[0, 0], [k, k], [-k, k], [k, -k], [-k, -k]]) {
      const hit = this.grid.ray(x + ox, from, z + oz, 0, -1, 0, from + 60);
      if (hit) best = Math.max(best, from - hit.t);
    }
    return best === -Infinity ? (y ?? 0) - 50 : best;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const hit = this.grid.ray(ox, oy, oz, dx, dy, dz, maxDist);
    if (!hit) return null;
    const n = this.grid.normals;
    let nx = n[hit.i * 3], ny = n[hit.i * 3 + 1], nz = n[hit.i * 3 + 2];
    if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // face the shooter
    return { t: hit.t, nx, ny, nz };
  }

  // ----- regions -----

  inRect(x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }
  siteAt(x, z) {
    for (const k in this.sites) if (this.inRect(x, z, this.sites[k])) return k;
    return null;
  }
  inBuyZone(x, z, team) {
    const r = this.spawnRects[team], m = 6;
    return x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  }

  nodePos(n) {
    const c = this.nav.nodeCell[n];
    return { x: (c % this.nav.nw + 0.5) * NAV, z: (((c / this.nav.nw) | 0) + 0.5) * NAV, y: this.nav.nodeY[n] };
  }

  nodesIn(r) {
    const key = JSON.stringify(r);
    this.rectCache ||= new Map();
    if (this.rectCache.has(key)) return this.rectCache.get(key);
    const out = [];
    for (let n = 0; n < this.nav.nodeY.length; n++) {
      if (!this.nav.reach[n]) continue;
      const p = this.nodePos(n);
      if (this.inRect(p.x, p.z, r) && p.y < (r.maxY ?? Infinity)) out.push(n);
    }
    this.rectCache.set(key, out);
    return out;
  }

  spawnPoints(team) {
    // Every other cell (2 m apart) with room for a standing player; shuffled.
    const pts = this.nodesIn(this.spawnRects[team]).map((n) => this.nodePos(n))
      .filter((p) => Math.round(p.x - 0.5) % 2 === 0 && Math.round(p.z - 0.5) % 2 === 0 && !this.collides(p.x, p.y, p.z, 0.42));
    for (let i = pts.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    return pts;
  }

  randomPointIn(r) {
    const nodes = this.nodesIn(r);
    const p = this.nodePos(nodes[(Math.random() * nodes.length) | 0]);
    return { x: p.x + (Math.random() - 0.5) * 0.4, z: p.z + (Math.random() - 0.5) * 0.4, y: p.y };
  }

  // ----- pathfinding -----

  nodeNear(x, z, y) {
    const { nw, nd, nodesOfCell, nodeY, reach } = this.nav;
    const ci = Math.floor(x / NAV), cj = Math.floor(z / NAV);
    for (let ring = 0; ring <= 4; ring++) {
      let best = -1, bestScore = Infinity;
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= nw || j >= nd) continue;
          for (const n of nodesOfCell[j * nw + i]) {
            if (!reach[n]) continue;
            const dy = y === undefined ? 0 : Math.abs(nodeY[n] - y);
            if (y !== undefined && dy > 3) continue;
            const score = Math.hypot(di, dj) + dy * 2;
            if (score < bestScore) { bestScore = score; best = n; }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  findPath(sx, sz, tx, tz, sy, ty) {
    const start = this.nodeNear(sx, sz, sy), goal = this.nodeNear(tx, tz, ty);
    if (start < 0 || goal < 0) return [];
    const { links, nodeY } = this.nav;
    const g = new Map([[start, 0]]), came = new Map(), closed = new Set();
    const gp = this.nodePos(goal);
    const h = (n) => { const p = this.nodePos(n); return Math.hypot(p.x - gp.x, p.z - gp.z); };
    const open = new Heap();
    open.push([h(start), start]);
    let found = start === goal;
    while (open.size && !found) {
      const cur = open.pop()[1];
      if (closed.has(cur)) continue;
      if (cur === goal) { found = true; break; }
      closed.add(cur);
      const cp = this.nodePos(cur);
      for (const m of links[cur]) {
        if (closed.has(m)) continue;
        const mp = this.nodePos(m);
        const ng = g.get(cur) + Math.hypot(mp.x - cp.x, mp.z - cp.z) + Math.max(0, nodeY[m] - nodeY[cur]) * 0.5;
        if (ng < (g.get(m) ?? Infinity)) { g.set(m, ng); came.set(m, cur); open.push([ng + h(m), m]); }
      }
    }
    if (!found) return [];
    const nodes = [];
    for (let n = goal; n !== undefined; n = came.get(n)) { nodes.push(n); if (n === start) break; }
    nodes.reverse();
    const pts = nodes.map((n) => this.nodePos(n));
    pts[pts.length - 1] = { ...pts[pts.length - 1], x: tx, z: tz };
    // String-pull: skip waypoints while a straight walk stays on connected floor.
    const out = [];
    let cur = { x: sx, z: sz, y: sy ?? nodeY[start] }, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i && !this.lineClear(cur.x, cur.z, pts[j].x, pts[j].z, 0.32, cur.y)) j--;
      out.push(pts[j]);
      cur = pts[j];
      i = j + 1;
    }
    return out;
  }

  // Walkable straight line: floor all along (no climb over a step) and no wall in the way.
  lineClear(ax, az, bx, bz, r, ay) {
    const { nw, nd, nodesOfCell, nodeY, reach } = this.nav;
    const dist = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(dist / 0.35));
    let y = ay;
    for (let s = 0; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n;
      const i = Math.floor(x / NAV), j = Math.floor(z / NAV);
      if (i < 0 || j < 0 || i >= nw || j >= nd) return false;
      let best = null;
      for (const m of nodesOfCell[j * nw + i]) {
        if (!reach[m]) continue;
        const dy = nodeY[m] - (y ?? nodeY[m]);
        if (dy > STEP || dy < -MAX_DROP) continue;
        if (best === null || Math.abs(dy) < Math.abs(nodeY[best] - (y ?? nodeY[m]))) best = m;
      }
      if (best === null) return false;
      y = nodeY[best];
      if (this.collides(x, y, z, r)) return false;
    }
    return true;
  }

  // ----- presentation -----

  // Top-down radar picture from the navigation grid (brighter = higher).
  radar() {
    if (this.radarCache) return this.radarCache;
    const { nw, nd, nodeY, nodeCell, reach } = this.nav;
    const S = 4;
    const c = document.createElement('canvas');
    c.width = nw * S;
    c.height = nd * S;
    const g = c.getContext('2d');
    const top = new Float32Array(nw * nd).fill(-1);
    for (let n = 0; n < nodeY.length; n++) if (reach[n]) top[nodeCell[n]] = Math.max(top[nodeCell[n]], nodeY[n]);
    const maxY = Math.max(...top) || 1;
    for (let k = 0; k < top.length; k++) {
      if (top[k] < 0) continue;
      const l = 0.45 + 0.4 * (top[k] / maxY);
      g.fillStyle = `rgba(${(205 * l) | 0},${(185 * l) | 0},${(145 * l) | 0},0.75)`;
      g.fillRect((k % nw) * S, ((k / nw) | 0) * S, S, S);
    }
    g.font = 'bold 30px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(220,40,30,0.9)';
    for (const [k, r] of Object.entries(this.sites)) g.fillText(k, ((r.x0 + r.x1) / 2 / NAV) * S, ((r.z0 + r.z1) / 2 / NAV) * S);
    this.radarCache = { canvas: c, x0: 0, z0: 0, w: nw * NAV, d: nd * NAV };
    return this.radarCache;
  }

  // The model itself is loaded by the client (GLTFLoader) and attached as data.visual.
  buildMeshes(scene) {
    const group = this.data.visual.clone();
    group.name = 'map:' + this.id;
    group.userData.shared = true; // geometry/materials belong to the loaded model, never dispose them
    scene.add(group);
    return group;
  }
}
