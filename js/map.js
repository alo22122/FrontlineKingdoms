// ============================================================================
// js/map.js – 200x200 Weltkarten, historische Karten & Crusader-Kings-Provinzen
// ============================================================================

export const W = 640;
export const H = 640;
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
  const n1 = makeNoise(seed, 130 * scale);
  const n2 = makeNoise(seed + 1, 64 * scale);
  const n3 = makeNoise(seed + 2, 28 * scale);
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

// Detaillierte Umrisse (0..100 Koordinaten) für echte & historische Karten
const SHAPES = {
  world: [
    // Nord- & Mittelamerika + Grönland
    [[6,22],[9,15],[15,12],[22,11],[27,13],[31,17],[30,22],[26,26],[22,30],[20,35],[18,39],[21,42],[24,45],[22,46],[18,43],[15,38],[14,33],[12,28],[8,27]],
    [[29,6],[36,5],[38,10],[33,14],[28,12]], // Grönland
    // Südamerika
    [[23,46],[28,47],[33,52],[36,57],[34,64],[30,72],[27,82],[25,88],[23,86],[22,74],[21,62],[20,52]],
    // Europa
    [[42,27],[44,24],[48,22],[47,16],[50,11],[55,10],[58,14],[56,19],[59,21],[60,26],[57,29],[53,30],[50,33],[48,30],[45,31],[42,30]],
    [[42,19],[45,18],[45,23],[42,23]], // Großbritannien
    // Afrika
    [[42,33],[48,33],[55,35],[58,39],[62,45],[60,52],[57,59],[54,68],[51,74],[48,72],[46,62],[45,52],[41,47],[40,40]],
    [[59,62],[61,61],[61,68],[58,68]], // Madagaskar
    // Asien + Arabien + Indien + Südostasien
    [[58,14],[66,12],[76,12],[87,15],[94,19],[91,24],[86,27],[86,33],[82,38],[77,42],[75,47],[71,44],[68,48],[66,42],[62,40],[58,36],[60,31],[57,28]],
    [[88,26],[91,25],[91,31],[88,32]], // Japan
    [[74,50],[79,51],[82,55],[76,55]], // Indonesien
    // Australien
    [[78,61],[85,59],[91,63],[92,71],[88,76],[81,75],[77,70],[77,65]]
  ],
  europe: [
    // Kontinentaleuropa: Iberien, Frankreich, Benelux, Deutschland, Polen, Osteuropa, Balkan, Griechenland
    [[11,64],[14,57],[22,55],[24,49],[21,45],[28,41],[35,38],[40,33],[44,32],[45,28],[48,29],[51,33],[58,30],[64,25],[72,22],[86,18],[92,22],[92,58],[82,60],[74,58],[68,62],[66,68],[62,74],[58,76],[56,70],[54,64],[48,60],[44,62],[38,59],[32,60],[27,63],[24,70],[18,74],[12,72],[10,68]],
    // Italien-Stiefel + Sizilien
    [[42,60],[47,61],[51,67],[55,74],[57,78],[54,81],[51,77],[48,71],[44,65]],
    [[49,81],[53,81],[52,85],[48,84]],
    // Großbritannien & Irland
    [[20,26],[25,23],[27,31],[28,39],[21,41],[20,34]],
    [[14,30],[18,29],[18,36],[14,36]],
    // Skandinavien (Norwegen, Schweden, Finnland)
    [[39,24],[42,15],[48,8],[56,6],[62,10],[64,20],[58,24],[53,22],[49,26],[44,26]]
  ],
  germany: [
    // Realistische Kontur Deutschlands (Schleswig-Holstein, Nord/Ostsee, Niederrhein, Saar, Bodensee, Alpen, Bayerischer Wald, Sachsen, Oder/Neiße)
    [[41,8],[47,7],[50,12],[58,15],[67,15],[71,20],[72,28],[76,36],[78,44],[73,49],[65,54],[69,62],[75,70],[71,78],[65,86],[58,88],[51,86],[44,88],[36,88],[31,82],[30,72],[26,64],[22,56],[24,46],[28,36],[32,26],[37,22],[39,14]]
  ],
  turkey: [
    // Thrakien + Marmara + Anatolien (Buchten von Izmir, Antalya, Hatay, Schwarzmeerküste)
    [[7,22],[14,19],[22,20],[25,27],[20,30],[12,29]], // Thrakien
    [[14,32],[24,30],[34,27],[48,25],[64,24],[78,25],[88,24],[93,32],[94,46],[90,58],[82,65],[68,66],[56,68],[51,74],[47,68],[38,67],[30,70],[21,67],[14,62],[12,52],[14,42],[12,35]]
  ],
  rome: [
    // West-/Südeuropa (Hispanien, Gallien, Alpen, Balkan, Griechenland, Anatolien)
    [[6,46],[10,36],[20,34],[24,25],[33,22],[44,22],[54,26],[64,28],[74,30],[88,30],[92,38],[88,48],[74,50],[66,46],[62,54],[58,56],[54,48],[48,44],[42,42],[34,44],[26,44],[20,48],[14,54],[6,52]],
    // Italien + Sizilien
    [[40,42],[45,43],[50,52],[54,60],[51,63],[46,56],[42,48]],
    [[46,63],[50,63],[49,67],[45,66]],
    // Britannien
    [[21,12],[27,10],[28,21],[21,22]],
    // Nordafrika + Ägypten + Levante (lässt das Mittelmeer frei!)
    [[6,64],[18,62],[32,64],[44,68],[56,70],[72,72],[84,68],[88,54],[94,48],[94,88],[6,88]]
  ],
  ottoman: [
    // Ungarn + Balkan + Krim + Anatolien + Levante + Mesopotamien + Ägypten + Nordafrika
    [[22,16],[34,12],[44,15],[52,22],[60,20],[66,18],[64,26],[54,30],[64,34],[78,34],[90,36],[92,52],[86,64],[74,66],[70,76],[74,88],[62,90],[54,76],[46,72],[34,74],[18,74],[10,70],[12,62],[28,62],[44,62],[48,54],[42,46],[34,44],[30,36],[26,28],[20,24]]
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
        const wobble = (elevN(x * 1.4, y * 1.4) - 0.5) * 1.2;
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
  const minDist = 32;

  // Zentren mit Mindestabstand auf begehbarem Land wählen
  for (let tries = 0; tries < 24000 && centers.length < 320; tries++) {
    const x = 10 + Math.floor(r() * (W - 20));
    const y = 10 + Math.floor(r() * (H - 20));
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
  // Abwärtskompatibilität für 100x100, 200x200, 320x320 oder 480x480 Custom-Maps
  const srcSize = str.length > 0 && str.length <= 10500 ? 100 : (str.length <= 41000 ? 200 : (str.length <= 105000 ? 320 : (str.length <= 235000 ? 480 : 0)));
  if (srcSize > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = Math.floor((y * srcSize) / H) * srcSize + Math.floor((x * srcSize) / W);
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

export function checkPath(t, bridges, x0, y0, x1, y1, unitType, season = 'summer', enemyWalls = null) {
  const pts = lineTiles(x0, y0, x1, y1);
  let waterStreak = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x, y] = pts[k];
    const i = idx(x, y);
    const tile = t[i];
    if (enemyWalls && enemyWalls.has(i) && unitType !== 'ship' && unitType !== 'catapult') {
      return { ok: false, reason: '🧱 Eine feindliche Mauer blockiert den Weg! Zerstöre sie mit einem Katapult.' };
    }
    if (tile === T.MOUNTAIN && unitType !== 'ship') return { ok: false, reason: 'Berge blockieren den Weg.' };
    if (tile === T.WATER && unitType !== 'ship' && !bridges.has(i)) {
      waterStreak++;
      if (season !== 'winter' || waterStreak > 3) {
        return { ok: false, reason: season === 'winter' ? 'Zu breites Wasser (max. 3 Eis-Felder im Winter).' : 'Wasser im Weg – baue eine Brücke oder nutze Schiffe.' };
      }
    } else {
      waterStreak = 0;
    }
  }
  return { ok: true };
}
