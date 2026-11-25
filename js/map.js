// ============================================================================
// js/map.js – 200x200 Weltkarten, historische Karten & Crusader-Kings-Provinzen
// ============================================================================

export const W = 200;
export const H = 200;
export const N = W * H;

export const T = { WATER: 0, GRASS: 1, FOREST: 2, HILL: 3, MOUNTAIN: 4, DESERT: 5, GOLD: 6 };
export const TERRAIN_KEYS = ['water', 'grass', 'forest', 'hill', 'mountain', 'desert', 'gold'];
export const TERRAIN_LABELS = ['Wasser', 'Gras', 'Wald', 'Hügel', 'Berg', 'Wüste', 'Goldvorkommen'];
export const TERRAIN_CHARS = 'wgfhmdo';

export const MAP_TYPES = {
  continents: 'Kontinente',
  world: 'Weltkarte',
  europe: 'Europa',
  germany: 'Deutschland',
  turkey: 'Türkei',
  rome: 'Römisches Reich',
  ottoman: 'Osmanisches Reich',
  archipelago: 'Inseln',
  valley: 'Tal',
  desert: 'Wüste',
  custom: 'Eigene Karte'
};

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
  const n1 = makeNoise(seed, 42 * scale);
  const n2 = makeNoise(seed + 1, 20 * scale);
  const n3 = makeNoise(seed + 2, 9 * scale);
  return (x, y) => n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
}

export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
export const isLand = (t) => t !== T.WATER;
export const isPassable = (t) => t !== T.WATER && t !== T.MOUNTAIN;

// Punkt-in-Polygon (Koordinaten normiert 0..100)
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function inAnyPoly(x, y, polys) {
  const px = (x / W) * 100;
  const py = (y / H) * 100;
  for (const p of polys) if (inPoly(px, py, p)) return true;
  return false;
}

// Vereinfachte Umrisse (0..100 Koordinaten) für echte/historische Karten
const SHAPES = {
  world: [
    // Nordamerika
    [[6,14],[22,10],[33,18],[28,34],[20,44],[14,38],[8,24]],
    // Südamerika
    [[21,46],[32,52],[35,66],[27,86],[22,82],[19,60]],
    // Europa
    [[43,16],[58,14],[60,28],[50,33],[42,28]],
    // Afrika
    [[42,35],[57,36],[63,50],[55,78],[47,76],[41,52]],
    // Asien
    [[58,14],[88,16],[94,32],[84,48],[68,48],[58,36]],
    // Australien
    [[78,62],[92,64],[91,78],[77,76]]
  ],
  europe: [
    // Kontinentaleuropa + Balkan
    [[14,56],[24,42],[44,32],[68,20],[88,18],[92,72],[68,78],[58,64],[46,72],[34,62],[18,74],[10,66]],
    // Großbritannien & Irland
    [[18,28],[28,24],[30,40],[20,42]],
    // Skandinavien
    [[40,10],[58,6],[62,24],[44,28]],
    // Italien
    [[46,60],[54,62],[60,82],[54,84],[46,70]]
  ],
  germany: [
    [[36,8],[58,8],[72,18],[76,34],[82,52],[70,68],[74,88],[54,92],[34,88],[22,74],[20,52],[26,30]]
  ],
  turkey: [
    // Anatolien
    [[14,28],[88,24],[94,44],[88,70],[60,72],[38,74],[14,66],[8,48]],
    // Thrakien
    [[6,18],[22,18],[24,28],[8,28]]
  ],
  rome: [
    // West-/Südeuropa + Italien + Balkan + Anatolien + Nordafrika (Mittelmeer bleibt Wasser!)
    [[6,36],[26,24],[48,22],[68,26],[92,34],[94,54],[72,56],[60,46],[48,54],[42,42],[24,44],[10,50]],
    // Italien-Stiefel
    [[42,42],[50,44],[56,66],[48,68],[42,52]],
    // Nordafrika + Levante
    [[6,64],[44,68],[74,72],[94,60],[94,88],[6,88]]
  ],
  ottoman: [
    // Balkan + Ungarn + Anatolien + Levante + Ägypten + Nordafrika
    [[20,16],[44,12],[60,26],[90,34],[92,66],[74,78],[64,92],[42,90],[46,72],[10,74],[10,60],[34,58],[30,34],[18,28]]
  ]
};

export function generateMap(type, seed, customGrid) {
  if (type === 'custom' && customGrid) return parseGrid(customGrid);

  const elevN = fbm(seed);
  const moistN = fbm(seed + 100);
  const islandN = fbm(seed + 200, 0.45);
  const r = rng(seed + 7);
  const t = new Uint8Array(N);
  const elev = new Float32Array(N);
  const shapePolys = SHAPES[type] || null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      const ny = (y / (H - 1)) * 2 - 1;
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      const m = moistN(x, y);
      let e = elevN(x, y);
      let kind = T.GRASS;

      if (shapePolys) {
        const wobble = (elevN(x * 1.4, y * 1.4) - 0.5) * 4;
        const onLand = inAnyPoly(x + wobble, y + wobble, shapePolys);
        if (!onLand) {
          kind = T.WATER;
        } else {
          if (type === 'germany' && y > H * 0.84 && e > 0.54) kind = T.MOUNTAIN;
          else if (e > 0.74) kind = T.MOUNTAIN;
          else if (e > 0.63) kind = T.HILL;
          else if ((type === 'turkey' || type === 'ottoman' || type === 'rome') && y > H * 0.68 && m < 0.48) kind = T.DESERT;
          else if (type === 'world' && Math.abs(ny) < 0.25 && m < 0.45) kind = T.DESERT;
          else if (m > 0.56) kind = T.FOREST;
        }
      } else if (type === 'archipelago') {
        e = islandN(x, y) * 0.7 + e * 0.3 - 0.3 * edge * edge + 0.08;
        if (e < 0.5) kind = T.WATER;
        else if (e > 0.74) kind = T.MOUNTAIN;
        else if (e > 0.66) kind = T.HILL;
        else if (m > 0.56) kind = T.FOREST;
      } else if (type === 'valley') {
        const side = Math.abs(nx) + (e - 0.5) * 0.35;
        const riverX = W / 2 + Math.sin(y / 20 + seed) * 14 + (elevN(y, x) - 0.5) * 10;
        if (Math.abs(x - riverX) < 2.2) kind = T.WATER;
        else if (side > 0.84) kind = T.MOUNTAIN;
        else if (side > 0.64) kind = T.HILL;
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
        e = e + 0.13 - 0.45 * edge * edge * edge;
        if (e < 0.44) kind = T.WATER;
        else if (e > 0.73) kind = T.MOUNTAIN;
        else if (e > 0.64) kind = T.HILL;
        else if (m > 0.57) kind = T.FOREST;
      }

      t[idx(x, y)] = kind;
      elev[idx(x, y)] = e;
    }
  }

  // Flüsse
  if (type === 'continents' || type === 'europe' || type === 'germany') {
    for (let k = 0; k < 4; k++) {
      let x = 0, y = 0, found = false;
      for (let tries = 0; tries < 400 && !found; tries++) {
        x = Math.floor(r() * W);
        y = Math.floor(r() * H);
        if (t[idx(x, y)] === T.HILL) found = true;
      }
      if (!found) continue;
      for (let step = 0; step < 220; step++) {
        if (t[idx(x, y)] === T.WATER && step > 0) break;
        t[idx(x, y)] = T.WATER;
        let best = null, bestE = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx2 = x + dx, ny2 = y + dy;
          if (!inBounds(nx2, ny2)) continue;
          const ev = elev[idx(nx2, ny2)] + r() * 0.04;
          if (ev < bestE) { bestE = ev; best = [nx2, ny2]; }
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
      const chance = (nearHill ? 0.025 : 0.003) * (type === 'desert' ? 1.8 : 1);
      if (r() < chance) t[i] = T.GOLD;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// CRUSADER-KINGS-PROVINZEN (Voronoi-Grafschaften auf der 200x200 Karte)
// ---------------------------------------------------------------------------
const PROV_NAMES = {
  germany: ['Brandenburg','Bayern','Sachsen','Schwaben','Rheinland','Westfalen','Holstein','Franken','Thüringen','Hessen','Pommern','Pfalz','Baden','Hannover','Mecklenburg','Elsass','Tirol','Böhmen'],
  turkey: ['Anatolien','Thrakien','Konya','Kappadokien','Marmara','Izmır','Antalya','Trabzon','Erzurum','Adana','Ankara','Bursa','Sivas','Van','Diyarbakir','Samsun','Edirne','Kayseri'],
  ottoman: ['Konstantinopel','Rumelien','Anatolien','Bosnien','Serbien','Bulgarien','Walachei','Griechenland','Syrien','Ägypten','Mesopotamien','Krim','Karaman','Kairo','Damaskus','Belgrad','Athen','Bagdad'],
  rome: ['Latium','Etrurien','Gallien','Hispania','Britannia','Germania','Aegyptus','Asia','Graecia','Sicilia','Africa','Syria','Dacia','Dalmatia','Macedonia','Lusitania','Narbonensis','Campania'],
  europe: ['Ile-de-France','Kastilien','Lombardei','Wessex','Burgund','Böhmen','Polen','Litauen','Ungarn','Normandie','Aragon','Schottland','Flandern','Venetien','Skandinavien','Preußen','Toskana','Mähren'],
  default: ['Eisenmark','Kronland','Silbertal','Grünwald','Sturmfels','Adlerhorst','Wolfsburg','Goldbach','Nordwacht','Südmark','Drachenstein','Königsberg','Eichenhain','Sonnental','Nebelgrat','Schwarzwald','Rabenfels','Löwenstein']
};

export function generateProvinces(terrain, seed, mapType = 'continents') {
  const r = rng(seed + 31337);
  const centers = [];
  const minDist = 13;

  // Zentren mit Mindestabstand auf begehbarem Land wählen
  for (let tries = 0; tries < 8000 && centers.length < 150; tries++) {
    const x = 4 + Math.floor(r() * (W - 8));
    const y = 4 + Math.floor(r() * (H - 8));
    if (!isPassable(terrain[idx(x, y)])) continue;
    let ok = true;
    for (const c of centers) {
      if ((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y) < minDist * minDist) {
        ok = false;
        break;
      }
    }
    if (ok) centers.push({ id: centers.length, x, y, tiles: [], goldCount: 0 });
  }
  if (!centers.length) centers.push({ id: 0, x: 100, y: 100, tiles: [], goldCount: 0 });

  const provOf = new Int16Array(N).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!isLand(terrain[i])) continue;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const dx = centers[k].x - x;
        const dy = centers[k].y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      provOf[i] = best;
      centers[best].tiles.push(i);
      if (terrain[i] === T.GOLD) centers[best].goldCount++;
    }
  }

  const pool = PROV_NAMES[mapType] || PROV_NAMES.default;
  const provinces = centers.map((c, i) => ({
    id: i,
    name: i < pool.length ? pool[i] : `${pool[i % pool.length]} ${Math.floor(i / pool.length) + 1}`,
    cx: c.x,
    cy: c.y,
    tiles: c.tiles,
    goldBonus: c.goldCount * 2
  }));

  return { provOf, provinces };
}

export function parseGrid(grid) {
  const str = typeof grid === 'string' ? grid : String(grid || '');
  const t = new Uint8Array(N).fill(T.GRASS);
  // Abwärtskompatibilität für alte 100x100 Custom-Maps (2x hochskalieren)
  if (str.length > 0 && str.length <= 10500) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = Math.floor(y / 2) * 100 + Math.floor(x / 2);
        const k = TERRAIN_CHARS.indexOf(str[si]);
        t[idx(x, y)] = k >= 0 ? k : T.GRASS;
      }
    }
    return t;
  }
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

export function findSpawns(t, n, seed) {
  const r = rng(seed + 99);
  const cands = [];
  for (let y = 8; y < H - 8; y += 2) {
    for (let x = 8; x < W - 8; x += 2) {
      if (!isPassable(t[idx(x, y)])) continue;
      let ok = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isPassable(t[idx(x + dx, y + dy)])) ok++;
      if (ok >= 36) cands.push([x, y]);
    }
  }
  if (cands.length === 0) {
    for (let i = 0; i < N; i++) if (isPassable(t[i])) cands.push([i % W, Math.floor(i / W)]);
  }
  if (cands.length === 0) cands.push([100, 100]);

  const sample = [];
  for (let i = 0; i < 600; i++) sample.push(cands[Math.floor(r() * cands.length)]);
  const chosen = [sample[0]];
  while (chosen.length < n) {
    let best = sample[0], bestD = -1;
    for (const c of sample) {
      let d = Infinity;
      for (const ch of chosen) d = Math.min(d, Math.hypot(c[0] - ch[0], c[1] - ch[1]));
      if (d > bestD) { bestD = d; best = c; }
    }
    chosen.push(best);
  }
  return chosen;
}

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

export function lineTiles(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (let guard = 0; guard < 800; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

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
