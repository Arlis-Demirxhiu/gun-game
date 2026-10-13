import * as THREE from 'three';
import { MeshMap, prepareMeshMap, getPrepared } from './meshmap.js';
import { sandstoneTexture, floorTexture, crateTexture, letterTexture, normalMapFrom } from './textures.js';

// The map is a height grid: every cell is floor, wall, crate or big crate.
// That keeps collision, hitscan and bot pathfinding simple and exact.

export const CELL = 2.5;
export const FLOOR = 0, WALL = 1, CRATE = 2, BIG = 3;
export const HEIGHTS = [0, 6, 1.05, 2.1];
// Highest rise you can walk up without jumping (stairs/ramps), and the deepest drop bots will take.
export const STEP = 0.55;
const MAX_DROP = 2.6;
const CRATE_H = HEIGHTS[CRATE];

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
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

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  quad(a, b, c, d, n, uvs) {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    // Pick winding so the face points along n.
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    else this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- map definitions ----------
// Each map is a grid of cells (CELL meters). `build` carves floor out of solid wall and places crates.
// Points (routes, watch spots, decals) are in cell units.

export const MAPS = {
  dust: {
    id: 'dust', name: 'Dust', blurb: 'large · 5v5', size: [44, 36], teamSize: 5,
    // A small dust2-inspired layout: CT spawn north, T spawn south, A east, B west.
    build(m) {
      const F = (a, b, c, d) => m.rect(a, b, c, d, FLOOR);
      const Wl = (a, b, c, d) => m.rect(a, b, c, d, WALL);
      F(1, 1, 12, 10);   // B site
      F(16, 1, 27, 6);   // CT spawn
      F(30, 1, 42, 10);  // A site
      F(12, 3, 16, 5);   // CT -> B
      F(27, 3, 30, 5);   // CT -> A
      F(20, 6, 23, 28);  // mid
      F(24, 12, 33, 13); // catwalk / short A
      F(32, 10, 33, 13);
      F(38, 10, 42, 30); // long A
      F(2, 10, 6, 30);   // B tunnels
      F(7, 17, 19, 18);  // lower tunnels
      F(14, 29, 29, 34); // T spawn
      F(2, 30, 14, 32);  // T -> tunnels
      F(29, 30, 42, 32); // T -> long
      F(17, 22, 26, 26); // outside mid
      Wl(34, 9, 37, 10); // A site front wall
      Wl(30, 9, 31, 10);
      Wl(9, 7, 12, 10);  // B closet
      m.set(38, 21, WALL); m.set(41, 21, WALL); m.set(42, 21, WALL); // long doors
      m.set(2, 11, WALL); m.set(6, 11, WALL); // tunnel mouth
      const C = (x, z) => m.set(x, z, CRATE);
      const B = (x, z) => m.set(x, z, BIG);
      B(3, 3); B(4, 3); C(3, 4); B(8, 3); C(8, 4); C(6, 7); B(6, 8);          // B site
      B(35, 4); B(36, 4); C(35, 5); B(40, 6); C(39, 6); C(40, 7); C(32, 3);   // A site
      B(20, 10); B(23, 10); C(22, 20);                                       // mid doors
      C(41, 15); B(38, 25); B(38, 26);                                       // long
      C(28, 12);                                                             // catwalk
      B(16, 33); B(17, 33); C(27, 30); C(26, 33);                            // T spawn
      C(18, 2); C(25, 2);                                                    // CT spawn
      B(2, 20); C(6, 25); C(12, 17);                                         // tunnels
      B(18, 24); C(25, 23);                                                  // outside mid
    },
    sites: { A: { x0: 30, z0: 1, x1: 42, z1: 8 }, B: { x0: 1, z0: 1, x1: 11, z1: 9 } },
    spawns: { T: { x0: 15, z0: 30, x1: 28, z1: 34 }, CT: { x0: 17, z0: 1, x1: 26, z1: 5 } },
    routes: { A: [[40.5, 18.5], [30.5, 13]], B: [[4.5, 20.5], [12.5, 18.5]] },
    watchCT: { A: [[40, 11], [33, 11]], B: [[4.5, 11.5]] },
    watchT: { A: [[29, 4.5], [33, 11.5], [40, 11]], B: [[12.5, 4.5], [4.5, 11.5]] },
    decals: [['A', 33.5, 6], ['B', 5.5, 6]],
  },

  outpost: {
    id: 'outpost', name: 'Outpost', blurb: 'small · 1v1–3v3', size: [26, 22], teamSize: 3,
    // Compact: CT spawn north between the two sites, T spawn south.
    // West: A long lane + a catwalk from mid. East: B lane + a short connector from mid.
    build(m) {
      const F = (a, b, c, d) => m.rect(a, b, c, d, FLOOR);
      F(10, 1, 15, 4);   // CT spawn
      F(1, 1, 8, 7);     // A site (west)
      F(17, 1, 24, 7);   // B site (east)
      F(8, 2, 10, 3);    // CT -> A
      F(15, 2, 17, 3);   // CT -> B
      F(12, 5, 13, 16);  // mid
      F(2, 8, 4, 18);    // A long
      F(21, 8, 23, 18);  // B lane
      F(5, 11, 11, 12);  // catwalk: mid -> A long
      F(14, 8, 20, 9);   // short: mid -> B lane
      F(9, 17, 16, 20);  // T spawn
      F(4, 17, 9, 18);   // T -> A long
      F(16, 17, 21, 18); // T -> B lane
      const C = (x, z) => m.set(x, z, CRATE);
      const B = (x, z) => m.set(x, z, BIG);
      B(3, 3); B(4, 3); C(3, 4); C(6, 6);             // A site cover
      B(21, 3); B(21, 4); C(22, 3); C(19, 6);         // B site cover
      B(12, 8); C(13, 13);                            // breaks the mid sightline
      C(3, 13); C(22, 12);                            // lane cover
      C(11, 19); C(14, 19);                           // T spawn
      C(11, 2); C(14, 2);                             // CT spawn
    },
    sites: { A: { x0: 1, z0: 1, x1: 8, z1: 7 }, B: { x0: 17, z0: 1, x1: 24, z1: 7 } },
    spawns: { T: { x0: 9, z0: 17, x1: 16, z1: 20 }, CT: { x0: 10, z0: 1, x1: 15, z1: 4 } },
    routes: { A: [[3.5, 14.5], [7.5, 11.5]], B: [[22.5, 14.5], [17.5, 8.5]] },
    watchCT: { A: [[3.5, 8.5], [5, 11.5]], B: [[22.5, 8.5], [20, 8.5]] },
    watchT: { A: [[9.5, 2.5]], B: [[16.5, 2.5]] },
    decals: [['A', 5.5, 3], ['B', 19.5, 3]],
  },

  // de_dust2: the real map geometry (vrchris, Sketchfab, CC-BY-4.0) with exact triangle collision —
  // see meshmap.js. Coordinates below are meters in map space (x east, z south, y up).
  dust2: {
    id: 'dust2', name: 'Dust II', blurb: 'classic · 5v5', teamSize: 5,
    mesh: 'assets/maps/dust2.glb', scale: 0.0254, flip: true, // Half-Life units -> meters, model is upside down
    sites: { A: { x0: 84, z0: 22, x1: 99, z1: 34 }, B: { x0: 12, z0: 20, x1: 30, z1: 40 } },
    // CT spawn: the sandy yard under the cliff; T spawn: the bottom yard. maxY skips roofs above them.
    spawns: { T: { x0: 46, z0: 113, x1: 72, z1: 122, maxY: 7 }, CT: { x0: 34, z0: 29, x1: 56, z1: 40, maxY: 4 } },
    routes: { A: [{ x: 104, z: 60 }, { x: 75, z: 57 }], B: [{ x: 22, z: 79 }, { x: 20, z: 55 }] },   // long / catwalk, tunnels
    watchCT: { A: [{ x: 104, z: 50 }, { x: 75, z: 48 }], B: [{ x: 20, z: 52 }, { x: 32, z: 34 }] },
    watchT: { A: [{ x: 80, z: 40 }, { x: 75, z: 45 }], B: [{ x: 32, z: 34 }, { x: 20, z: 52 }] },
  },
};
export const MAP_IDS = Object.keys(MAPS);

// Mesh maps must be loaded first (preloadMap); grid maps are built on the spot.
export function createMap(id) {
  const def = MAPS[id] || MAPS.dust;
  return def.mesh ? new MeshMap(getPrepared(def.id)) : new GameMap(def.id);
}

// `load(path)` -> ArrayBuffer. Resolves to the prepared data for mesh maps (null for grid maps).
export function preloadMap(id, load) {
  const def = MAPS[id];
  return def && def.mesh ? prepareMeshMap(def, load) : Promise.resolve(null);
}

export class GameMap {
  constructor(id = 'dust') {
    const def = (this.def = MAPS[id] || MAPS.dust);
    this.id = def.id;
    [this.w, this.h] = def.size;
    this.grid = new Uint8Array(this.w * this.h).fill(WALL);
    this.elev = new Float32Array(this.w * this.h); // floor height of each cell (raised areas, stairs)
    this.wallH = def.wallH || HEIGHTS[WALL];
    this.maxH = this.wallH + 0.01;
    this.width = this.w * CELL;
    this.depth = this.h * CELL;
    def.build(this);
    const P = (list) => list.map(([x, z]) => ({ x: x * CELL, z: z * CELL }));
    const pts = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, P(v)]));
    this.sites = def.sites;
    this.spawnRects = def.spawns;
    this.routes = pts(def.routes);
    this.watchCT = pts(def.watchCT);
    this.watchT = pts(def.watchT);
  }

  inBounds(gx, gz) { return gx >= 0 && gz >= 0 && gx < this.w && gz < this.h; }
  type(gx, gz) { return this.inBounds(gx, gz) ? this.grid[gz * this.w + gx] : WALL; }
  set(gx, gz, t) { if (this.inBounds(gx, gz)) this.grid[gz * this.w + gx] = t; }
  rect(x0, z0, x1, z1, t) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, z, t);
  }
  // Carve walkable floor at elevation e (meters) — raised platforms, ramps and stairs.
  floor(x0, z0, x1, z1, e = 0) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.inBounds(x, z)) continue;
        this.grid[z * this.w + x] = FLOOR;
        this.elev[z * this.w + x] = e;
      }
    }
  }
  // Solid height of a cell: floors at their elevation, crates on top of it, walls full height.
  heightAt(gx, gz) {
    if (!this.inBounds(gx, gz)) return 50;
    const i = gz * this.w + gx, t = this.grid[i];
    if (t === WALL) return this.wallH;
    return this.elev[i] + HEIGHTS[t];
  }
  floorAt(gx, gz) { return this.inBounds(gx, gz) ? this.elev[gz * this.w + gx] : 0; }
  walkable(gx, gz) { return this.type(gx, gz) === FLOOR; }
  cell(v) { return Math.floor(v / CELL); }
  get center() { return { x: this.width / 2, z: this.depth / 2 }; }

  siteAt(x, z) {
    const gx = this.cell(x), gz = this.cell(z);
    for (const k in this.sites) {
      const s = this.sites[k];
      if (gx >= s.x0 && gx <= s.x1 && gz >= s.z0 && gz <= s.z1) return k;
    }
    return null;
  }

  inBuyZone(x, z, team) {
    const s = this.spawnRects[team];
    const gx = this.cell(x), gz = this.cell(z);
    return gx >= s.x0 - 2 && gx <= s.x1 + 2 && gz >= s.z0 - 2 && gz <= s.z1 + 2;
  }

  cellsIn(r) {
    const out = [];
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (this.walkable(x, z)) out.push([x, z]);
    return out;
  }

  spawnPoints(team) {
    const cells = this.cellsIn(this.spawnRects[team]);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells.map(([x, z]) => ({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL }));
  }

  randomPointIn(r, margin = 0.6) {
    const cells = this.cellsIn(r);
    const [x, z] = cells[(Math.random() * cells.length) | 0];
    const j = CELL / 2 - margin;
    return { x: (x + 0.5) * CELL + (Math.random() * 2 - 1) * j, z: (z + 0.5) * CELL + (Math.random() * 2 - 1) * j };
  }

  // True if a box of half-size r with feet at y overlaps anything too tall to step onto.
  collides(x, y, z, r) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) if (this.heightAt(gx, gz) > y + STEP) return true;
    }
    return false;
  }

  moveTo(x, y, z, r) { return this.collides(x, y, z, r) ? null : y; }

  groundAt(x, z, r) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    let h = 0;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const c = this.heightAt(gx, gz);
        if (c > h && c < 40) h = c;
      }
    }
    return h;
  }

  // Exact ray vs height-field (2D DDA through cells). Returns {t, nx, ny, nz} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let gx = Math.floor(ox / CELL), gz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (gx + 1) * CELL : gx * CELL) - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (gz + 1) * CELL : gz * CELL) - oz) / dz : Infinity;
    const tFloor = dy < 0 ? -oy / dy : Infinity;
    let t0 = 0, axis = -1;
    for (let i = 0; i < 300; i++) {
      const t1 = Math.min(tMaxX, tMaxZ, maxDist);
      const h = this.heightAt(gx, gz);
      if (h > 0) {
        if (oy + dy * t0 < h) {
          if (axis === 0) return { t: t0, nx: -stepX, ny: 0, nz: 0 };
          if (axis === 1) return { t: t0, nx: 0, ny: 0, nz: -stepZ };
          return { t: 0, nx: 0, ny: 1, nz: 0 };
        }
        if (dy < 0) {
          const tTop = (h - oy) / dy;
          if (tTop <= t1) return tTop <= maxDist ? { t: tTop, nx: 0, ny: 1, nz: 0 } : null;
        }
      } else if (tFloor <= t1) {
        return tFloor <= maxDist ? { t: tFloor, nx: 0, ny: 1, nz: 0 } : null;
      }
      if (t1 >= maxDist) return null;
      if (dy > 0 && oy + dy * t1 > this.maxH) return null;
      if (tMaxX < tMaxZ) { gx += stepX; t0 = tMaxX; tMaxX += tDeltaX; axis = 0; }
      else { gz += stepZ; t0 = tMaxZ; tMaxZ += tDeltaZ; axis = 1; }
    }
    return null;
  }

  // Can a bot walk straight from a to b? Every sample must be floor, with no climb taller than a step.
  lineClear(ax, az, bx, bz, r) {
    const dist = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(dist / 0.3));
    let prev = this.floorAt(this.cell(ax), this.cell(az));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (!this.walkable(this.cell(x - r), this.cell(z - r)) || !this.walkable(this.cell(x + r), this.cell(z - r)) ||
          !this.walkable(this.cell(x - r), this.cell(z + r)) || !this.walkable(this.cell(x + r), this.cell(z + r))) return false;
      let hi = -Infinity, lo = Infinity;
      for (const [cx, cz] of [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]]) {
        const e = this.floorAt(this.cell(cx), this.cell(cz));
        hi = Math.max(hi, e); lo = Math.min(lo, e);
      }
      if (hi - prev > STEP || hi - lo > STEP) return false; // no ledges inside the bot's footprint
      prev = hi;
    }
    return true;
  }

  // Bots may step up a stair or drop down a ledge, but not climb a ledge.
  canStep(ax, az, bx, bz) {
    const rise = this.floorAt(bx, bz) - this.floorAt(ax, az);
    return rise <= STEP && rise >= -MAX_DROP;
  }

  nearestWalkable(gx, gz) {
    if (this.walkable(gx, gz)) return [gx, gz];
    for (let r = 1; r < 8; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.walkable(gx + dx, gz + dz)) return [gx + dx, gz + dz];
        }
      }
    }
    return [gx, gz];
  }

  // A* on the cell grid, then string-pulled into a short list of world points.
  findPath(sx, sz, tx, tz) {
    const [ax, az] = this.nearestWalkable(this.cell(sx), this.cell(sz));
    const [bx, bz] = this.nearestWalkable(this.cell(tx), this.cell(tz));
    const N = this.w * this.h;
    const start = az * this.w + ax, goal = bz * this.w + bx;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const h = (i) => {
      const dx = Math.abs((i % this.w) - bx), dz = Math.abs(((i / this.w) | 0) - bz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    g[start] = 0;
    const open = new Heap();
    open.push([h(start), start]);
    while (open.size) {
      const cur = open.pop()[1];
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      const cx = cur % this.w, cz = (cur / this.w) | 0;
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.walkable(nx, nz) || !this.canStep(cx, cz, nx, nz)) continue;
        if (dx && dz && (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz) ||
          !this.canStep(cx, cz, cx + dx, cz) || !this.canStep(cx, cz, cx, cz + dz))) continue;
        const ni = nz * this.w + nx;
        if (closed[ni]) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          open.push([ng + h(ni), ni]);
        }
      }
    }
    if (goal !== start && came[goal] === -1) return [];
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => ({ x: ((i % this.w) + 0.5) * CELL, z: (((i / this.w) | 0) + 0.5) * CELL }));
    if (this.walkable(this.cell(tx), this.cell(tz))) pts[pts.length - 1] = { x: tx, z: tz };
    const out = [];
    let cur = { x: sx, z: sz };
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 12);
      while (j > i && !this.lineClear(cur.x, cur.z, pts[j].x, pts[j].z, 0.42)) j--;
      out.push(pts[j]);
      cur = pts[j];
      i = j + 1;
    }
    return out;
  }

  // Adds the map's meshes to `scene` in one group and returns it (remove + dispose to unload).
  buildMeshes(scene) {
    const group = new THREE.Group();
    group.name = 'map:' + this.id;
    const wallTex = sandstoneTexture(), floorTex = floorTexture(), crateTex = crateTexture();
    const wb = new GeoBuilder(), cb = new GeoBuilder(), tb = new GeoBuilder();
    // Side quad of cell (gx,gz) facing (dx,dz), from y0 to y1, into builder b.
    const side = (b, gx, gz, dx, dz, y0, y1, crate) => {
      const x0 = gx * CELL, x1 = x0 + CELL, z0 = gz * CELL, z1 = z0 + CELL;
      let a, bq, c, d, ua, ub;
      if (dx === 1) { a = [x1, y0, z0]; bq = [x1, y0, z1]; c = [x1, y1, z1]; d = [x1, y1, z0]; ua = z0; ub = z1; }
      else if (dx === -1) { a = [x0, y0, z1]; bq = [x0, y0, z0]; c = [x0, y1, z0]; d = [x0, y1, z1]; ua = z1; ub = z0; }
      else if (dz === 1) { a = [x1, y0, z1]; bq = [x0, y0, z1]; c = [x0, y1, z1]; d = [x1, y1, z1]; ua = x1; ub = x0; }
      else { a = [x0, y0, z0]; bq = [x1, y0, z0]; c = [x1, y1, z0]; d = [x0, y1, z0]; ua = x0; ub = x1; }
      const uvs = crate
        ? [[0, y0 / CRATE_H], [2, y0 / CRATE_H], [2, y1 / CRATE_H], [0, y1 / CRATE_H]]
        : [[ua / CELL, y0 / CELL], [ub / CELL, y0 / CELL], [ub / CELL, y1 / CELL], [ua / CELL, y1 / CELL]];
      b.quad(a, bq, c, d, [dx, 0, dz], uvs);
    };
    for (let gz = 0; gz < this.h; gz++) {
      for (let gx = 0; gx < this.w; gx++) {
        const t = this.type(gx, gz);
        const e = t === WALL ? 0 : this.floorAt(gx, gz);
        const h = this.heightAt(gx, gz);
        const x0 = gx * CELL, x1 = x0 + CELL, z0 = gz * CELL, z1 = z0 + CELL;
        const worldUV = [[x0 / CELL, z0 / CELL], [x1 / CELL, z0 / CELL], [x1 / CELL, z1 / CELL], [x0 / CELL, z1 / CELL]];
        // Raised floor (platforms, stairs): stone top, sandstone sides down to lower neighbours.
        if (e > 0) {
          if (t === FLOOR) tb.quad([x0, e, z0], [x1, e, z0], [x1, e, z1], [x0, e, z1], [0, 1, 0], worldUV);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!this.inBounds(gx + dx, gz + dz)) continue;
            const nh = this.heightAt(gx + dx, gz + dz);
            if (nh < e) side(wb, gx, gz, dx, dz, nh, e, false);
          }
        }
        if (t === FLOOR) continue;
        const crate = t !== WALL;
        const b = crate ? cb : wb;
        b.quad([x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], [0, 1, 0], crate ? [[0, 0], [2, 0], [2, 2], [0, 2]] : worldUV);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!this.inBounds(gx + dx, gz + dz)) continue;
          const nh = Math.max(this.heightAt(gx + dx, gz + dz), e);
          if (nh < h) side(b, gx, gz, dx, dz, nh, h, crate);
        }
      }
    }
    const surface = (map, normalStrength, roughness) => new THREE.MeshStandardMaterial({
      map, normalMap: normalMapFrom(map.image, normalStrength), roughness, metalness: 0, envMapIntensity: 0.35,
    });
    const walls = new THREE.Mesh(wb.build(), surface(wallTex, 3, 0.95));
    const crates = new THREE.Mesh(cb.build(), surface(crateTex, 2.5, 0.8));
    const tops = new THREE.Mesh(tb.build(), surface(floorTexture(), 4, 1));
    for (const m of [walls, crates, tops]) {
      if (!m.geometry.attributes.position.count) continue; // flat maps have no raised floors
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }

    floorTex.repeat.set(this.w, this.h);
    const floorMat = surface(floorTex, 4, 1);
    floorMat.normalMap.repeat.set(this.w, this.h);
    const fg = new THREE.PlaneGeometry(this.width, this.depth);
    fg.rotateX(-Math.PI / 2);
    fg.translate(this.width / 2, 0, this.depth / 2);
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    group.add(floor);

    for (const [letter, cx, cz] of this.def.decals) {
      const g = new THREE.PlaneGeometry(6, 6);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
        map: letterTexture(letter), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }));
      m.position.set(cx * CELL, this.floorAt(Math.floor(cx), Math.floor(cz)) + 0.02, cz * CELL);
      m.receiveShadow = true;
      group.add(m);
    }
    scene.add(group);
    return group;
  }
}
