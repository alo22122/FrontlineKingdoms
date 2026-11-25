// ============================================================================
// js/map.js – Weltkarten-Generator (100x100), Terrain-Regeln & Kodierungen
// ============================================================================

export const W = 100;
export const H = 100;
export const N = W * H;

export const T = { WATER: 0, GRASS: 1, FOREST: 2, HILL: 3, MOUNTAIN: 4, DESERT: 5, GOLD: 6 };
export const TERRAIN_KEYS = ['water', 'grass', 'forest', 'hill', 'mountain', 'desert', 'gold'];
export const TERRAIN_LABELS = ['Wasser', 'Gras', 'Wald', 'Hügel', 'Berg', 'Wüste', 'Goldvorkommen'];
export const TERRAIN_CHARS = 'wgfhmdo';

export const MAP_TYPES = {
  continents: 'Kontinente',
  archipelago: 'Inseln',
  valley: 'Tal',
  desert: 'Wüste',
  custom: 'Eigene Karte'
};

/** Deterministischer Zufallsgenerator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed, cell) {
  const r = rng(seed);
  const gw = Math.ceil(W / cell) + 2;
  const g = new Float32Array(gw * gw);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix];
    const b = g[iy * gw + ix + 1];
    const c = g[(iy + 1) * gw + ix];
    const d = g[(iy + 1) * gw + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(seed, scale = 1) {
  const n1 = makeNoise(seed, 25 * scale);
  const n2 = makeNoise(seed + 1, 12 * scale);
  const n3 = makeNoise(seed + 2, 6 * scale);
  return (x, y) => n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
}

export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
export const isLand = (t) => t !== T.WATER;
export const isPassable = (t) => t !== T.WATER && t !== T.MOUNTAIN;

/** Erzeugt die Weltkarte als Uint8Array(10000). */
export function generateMap(type, seed, customGrid) {
  if (type === 'custom' && customGrid) return parseGrid(customGrid);

  const elevN = fbm(seed);
  const moistN = fbm(seed + 100);
  const islandN = fbm(seed + 200, 0.45);
  const r = rng(seed + 7);
  const t = new Uint8Array(N);
  const elev = new Float32Array(N);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      const ny = (y / (H - 1)) * 2 - 1;
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      const m = moistN(x, y);
      let e = elevN(x, y);
      let kind = T.GRASS;

      if (type === 'archipelago') {
        e = islandN(x, y) * 0.7 + e * 0.3 - 0.3 * edge * edge + 0.08;
        if (e < 0.5) kind = T.WATER;
        else if (e > 0.74) kind = T.MOUNTAIN;
        else if (e > 0.66) kind = T.HILL;
        else if (m > 0.56) kind = T.FOREST;
      } else if (type === 'valley') {
        const side = Math.abs(nx) + (e - 0.5) * 0.35;
        const riverX = 50 + Math.sin(y / 11 + seed) * 7 + (elevN(y, x) - 0.5) * 6;
        if (Math.abs(x - riverX) < 1.4) kind = T.WATER;
        else if (side > 0.82) kind = T.MOUNTAIN;
        else if (side > 0.62) kind = T.HILL;
        else if (m > 0.55) kind = T.FOREST;
        e = side;
      } else if (type === 'desert') {
        kind = T.DESERT;
        if (e < 0.24) kind = T.WATER;
        else if (e < 0.29 || m > 0.7) kind = T.GRASS;
        else if (e > 0.76) kind = T.MOUNTAIN;
        else if (e > 0.66) kind = T.HILL;
        if (kind === T.GRASS && m > 0.76) kind = T.FOREST;
      } else {
        // continents
        e = e + 0.12 - 0.45 * edge * edge * edge;
        if (e < 0.45) kind = T.WATER;
        else if (e > 0.73) kind = T.MOUNTAIN;
        else if (e > 0.65) kind = T.HILL;
        else if (m > 0.58) kind = T.FOREST;
      }

      t[idx(x, y)] = kind;
      elev[idx(x, y)] = e;
    }
  }

  // Flüsse für Kontinente (fließen bergab Richtung Meer)
  if (type === 'continents') {
    for (let k = 0; k < 3; k++) {
      let x = 0;
      let y = 0;
      let found = false;
      for (let tries = 0; tries < 300 && !found; tries++) {
        x = Math.floor(r() * W);
        y = Math.floor(r() * H);
        if (t[idx(x, y)] === T.HILL) found = true;
      }
      if (!found) continue;
      for (let step = 0; step < 140; step++) {
        if (t[idx(x, y)] === T.WATER && step > 0) break;
        t[idx(x, y)] = T.WATER;
        let best = null;
        let bestE = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx2 = x + dx;
          const ny2 = y + dy;
          if (!inBounds(nx2, ny2)) continue;
          const ev = elev[idx(nx2, ny2)] + r() * 0.04;
          if (ev < bestE) {
            bestE = ev;
            best = [nx2, ny2];
          }
        }
        if (!best) break;
        elev[idx(x, y)] = 9;
        [x, y] = best;
      }
    }
  }

  // Goldvorkommen
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!isPassable(t[i])) continue;
      let nearHill = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = t[idx(x + dx, y + dy)];
          if (n === T.HILL || n === T.MOUNTAIN) nearHill = true;
        }
      }
      const chance = (nearHill ? 0.035 : 0.004) * (type === 'desert' ? 1.8 : 1);
      if (r() < chance) t[i] = T.GOLD;
    }
  }
  return t;
}

export function parseGrid(grid) {
  const str = typeof grid === 'string' ? grid : String(grid || '');
  const t = new Uint8Array(N).fill(T.GRASS);
  for (let i = 0; i < N && i < str.length; i++) {
    const k = TERRAIN_CHARS.indexOf(str[i]);
    t[i] = k >= 0 ? k : T.GRASS;
  }
  return t;
}

export function gridToString(t) {
  let s = '';
  for (let i = 0; i < N; i++) s += TERRAIN_CHARS[t[i]] || 'g';
  return s;
}

export function countLand(t) {
  let c = 0;
  for (let i = 0; i < N; i++) if (isLand(t[i])) c++;
  return c;
}

/** Sucht n möglichst weit voneinander entfernte Startpositionen. */
export function findSpawns(t, n, seed) {
  const r = rng(seed + 99);
  const cands = [];
  for (let y = 5; y < H - 5; y++) {
    for (let x = 5; x < W - 5; x++) {
      if (!isPassable(t[idx(x, y)])) continue;
      let ok = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isPassable(t[idx(x + dx, y + dy)])) ok++;
      if (ok >= 18) cands.push([x, y]);
    }
  }
  if (cands.length === 0) {
    for (let i = 0; i < N; i++) if (isPassable(t[i])) cands.push([i % W, Math.floor(i / W)]);
  }
  if (cands.length === 0) cands.push([50, 50]);

  const sample = [];
  for (let i = 0; i < 600; i++) sample.push(cands[Math.floor(r() * cands.length)]);
  const chosen = [sample[0]];
  while (chosen.length < n) {
    let best = sample[0];
    let bestD = -1;
    for (const c of sample) {
      let d = Infinity;
      for (const ch of chosen) d = Math.min(d, Math.hypot(c[0] - ch[0], c[1] - ch[1]));
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** Gebiet: Int8Array (-1 = neutral, 0..9 = Slot) <-> String */
export function encodeTerritory(arr) {
  let s = '';
  for (let i = 0; i < N; i++) s += arr[i] < 0 ? '.' : String.fromCharCode(65 + arr[i]);
  return s;
}

export function decodeTerritory(str, out) {
  const arr = out || new Int8Array(N);
  arr.fill(-1);
  if (typeof str !== 'string') return arr;
  for (let i = 0; i < N && i < str.length; i++) {
    const c = str.charCodeAt(i);
    arr[i] = c >= 65 && c < 75 ? c - 65 : -1;
  }
  return arr;
}

/** Erkundete Tiles als Hex-Bitmaske (2500 Zeichen). */
export function encodeBits(bits) {
  let s = '';
  for (let i = 0; i < N; i += 4) {
    s += ((bits[i] ? 1 : 0) | (bits[i + 1] ? 2 : 0) | (bits[i + 2] ? 4 : 0) | (bits[i + 3] ? 8 : 0)).toString(16);
  }
  return s;
}

export function decodeBits(str, out) {
  const bits = out || new Uint8Array(N);
  bits.fill(0);
  if (typeof str !== 'string') return bits;
  for (let k = 0; k < str.length && k * 4 < N; k++) {
    const v = parseInt(str[k], 16) || 0;
    for (let b = 0; b < 4; b++) bits[k * 4 + b] = (v >> b) & 1;
  }
  return bits;
}

/** Bresenham-Linie zwischen zwei Tiles. */
export function lineTiles(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 400; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/**
 * Prüft, ob eine Armee die direkte Linie laufen kann.
 * Berge sind unpassierbar; Wasser nur mit Brücke oder als Schiff.
 */
export function checkPath(t, bridges, x0, y0, x1, y1, unitType) {
  const pts = lineTiles(x0, y0, x1, y1);
  for (let k = 1; k < pts.length; k++) {
    const [x, y] = pts[k];
    const tile = t[idx(x, y)];
    if (tile === T.MOUNTAIN && unitType !== 'ship') return { ok: false, reason: 'Berge blockieren den Weg.' };
    if (tile === T.WATER && unitType !== 'ship' && !bridges.has(idx(x, y))) {
      return { ok: false, reason: 'Wasser im Weg – baue eine Brücke oder nutze Schiffe.' };
    }
  }
  return { ok: true };
}
