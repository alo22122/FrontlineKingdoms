// ============================================================================
// js/sprites.js - 100% Code Pixel-Art Generator (Offscreen Canvases) & 8-Bit SFX
// ============================================================================

const spriteCache = new Map();

function createCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function px(ctx, x, y, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/**
 * Zeichnet ein 16x16 Pixel-Pattern aus einem String-Array.
 */
function drawPattern(size, rows, palette) {
  const c = createCanvas(size);
  const ctx = c.getContext('2d');
  const scale = size / rows.length;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.' && palette[ch]) {
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  return c;
}

// ============================================================================
// TERRAIN SPRITES (16x16)
// ============================================================================
export function getTerrainSprite(type, season = 'summer', variant = 0) {
  const v = variant & 3;
  const key = `terrain_${type}_${season}_${v}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  const c = createCanvas(16);
  const ctx = c.getContext('2d');
  const winter = season === 'winter';
  const ox = (v * 5) % 12;
  const oy = (v * 7) % 12;

  if (type === 'grass') {
    const bases = winter ? ['#d7e7f5','#d2e3f2','#dcebf7','#cfe0f0'] : ['#4a8c38','#478736','#4e913b','#448333'];
    px(ctx, 0, 0, bases[v], 16, 16);
    px(ctx, (1 + ox) % 14, (2 + oy) % 14, winter ? '#c3d7eb' : '#3d782d', 3, 1);
    px(ctx, (9 + ox) % 13, (4 + oy) % 14, winter ? '#eef6fc' : '#63ab4a', 3, 1);
    px(ctx, (4 + oy) % 14, (9 + ox) % 14, winter ? '#c3d7eb' : '#3b732b', 2, 2);
    if (v === 1) px(ctx, 11, 11, winter ? '#eef6fc' : '#f2d14b', 1, 1); // kleine Blume
    if (v === 2) px(ctx, 3, 12, winter ? '#b8cde0' : '#73b856', 2, 1);
    if (v === 3) px(ctx, 12, 3, winter ? '#eef6fc' : '#d65a4f', 1, 1);
  } else if (type === 'forest') {
    const bases = winter ? ['#c8dceb','#c2d7e8','#cde0ef','#bfd4e5'] : ['#356b26','#326624','#397029','#2f6122'];
    px(ctx, 0, 0, bases[v], 16, 16);
    const t1x = 2 + (v % 2) * 2, t2x = 9 - (v % 2);
    px(ctx, t1x, 12, 'rgba(0,0,0,0.2)', 6, 2);
    px(ctx, t2x, 13, 'rgba(0,0,0,0.2)', 6, 2);
    px(ctx, t1x + 2, 8, '#5a3821', 2, 5);
    px(ctx, t1x, 3, winter ? '#97bdd4' : '#204a17', 6, 6);
    px(ctx, t1x + 1, 2, winter ? '#e6f2fa' : '#2f6e22', 4, 3);
    px(ctx, t2x + 2, 9, '#4f301b', 2, 5);
    px(ctx, t2x, 5, winter ? '#85adc7' : '#1b4013', 6, 5);
    px(ctx, t2x + 1, 4, winter ? '#d8ebf7' : '#2c6320', 4, 2);
  } else if (type === 'water') {
    const bases = winter ? ['#4674a1','#42709c','#4a78a6','#3e6c96'] : ['#1f5a9c','#1d5594','#225fa3','#1b518c'];
    px(ctx, 0, 0, bases[v], 16, 16);
    px(ctx, (2 + ox) % 11, (3 + oy) % 13, winter ? '#89b8e0' : '#367ec9', 5, 1);
    px(ctx, (8 + oy) % 10, (10 + ox) % 13, winter ? '#a6cef0' : '#4a90db', 5, 1);
    if (v % 2 === 0) px(ctx, 3, 13, winter ? '#75a6d1' : '#367ec9', 4, 1);
  } else if (type === 'mountain') {
    px(ctx, 0, 0, winter ? '#b3c4d4' : '#55634e', 16, 16);
    const shift = v % 2;
    px(ctx, 2 + shift, 12, '#4a515c', 12 - shift, 4);
    px(ctx, 3 + shift, 8, '#606875', 10 - shift, 5);
    px(ctx, 5 + shift, 4, '#798291', 6, 5);
    px(ctx, 8 + shift, 5, '#5b6370', 3, 8);
    px(ctx, 5 + shift, 2, '#eef5fc', 6, 3);
    px(ctx, 6 + shift, 1, '#ffffff', 4, 2);
  } else if (type === 'hill') {
    px(ctx, 0, 0, winter ? '#c8dceb' : '#55913f', 16, 16);
    const sx = v % 3;
    px(ctx, 2 + sx, 8, winter ? '#aec4d9' : '#6ea855', 11, 5);
    px(ctx, 4 + sx, 6, winter ? '#dceaf5' : '#85bd68', 7, 3);
    px(ctx, 3 + sx, 13, winter ? '#96acc2' : '#3f6e2e', 9, 1);
  } else if (type === 'desert') {
    const bases = ['#d8b467','#d4af61','#dcb96d','#cfa95b'];
    px(ctx, 0, 0, bases[v], 16, 16);
    px(ctx, (2 + ox) % 10, (5 + oy) % 13, '#c29846', 6, 1);
    px(ctx, (8 + oy) % 10, (10 + ox) % 13, '#ebd08d', 6, 1);
    if (v === 2) px(ctx, 11, 3, '#6b8e3d', 2, 3); // kleiner Kaktus/Strauch
  } else if (type === 'gold') {
    px(ctx, 0, 0, winter ? '#c0d1e0' : '#53644d', 16, 16);
    px(ctx, 3, 6, '#656d78', 10, 7);
    px(ctx, 4 + (v % 2), 7, '#f5c542', 3, 3);
    px(ctx, 9, 8 + (v % 2), '#ffd966', 3, 3);
    px(ctx, 6, 7, '#fff3b0', 1, 1);
    px(ctx, 10, 9, '#fff3b0', 1, 1);
  } else if (type === 'bridge') {
    px(ctx, 0, 0, '#2563a8', 16, 16);
    px(ctx, 0, 4, '#7a4e28', 16, 8);
    px(ctx, 0, 3, '#543317', 16, 1);
    px(ctx, 0, 12, '#543317', 16, 1);
    for (let i = 1; i < 16; i += 3) {
      px(ctx, i, 5, '#996436', 2, 6);
    }
  }

  spriteCache.set(key, c);
  return c;
}

// ============================================================================
// BUILDING SPRITES (32x32 für Dorf-Ansicht)
// ============================================================================
export function getBuildingSprite(type, color = '#c94a38') {
  const key = `bld_${type}_${color}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  const c = createCanvas(32);
  const ctx = c.getContext('2d');

  // Leichter Bodenschatten
  px(ctx, 4, 26, 'rgba(0,0,0,0.3)', 24, 4);

  switch (type) {
    case 'castle':
      px(ctx, 3, 10, '#8a929e', 26, 18);
      px(ctx, 1, 4, '#737b87', 8, 24);
      px(ctx, 23, 4, '#737b87', 8, 24);
      px(ctx, 1, 2, '#9aa3b0', 2, 3);
      px(ctx, 5, 2, '#9aa3b0', 2, 3);
      px(ctx, 23, 2, '#9aa3b0', 2, 3);
      px(ctx, 27, 2, '#9aa3b0', 2, 3);
      px(ctx, 12, 18, '#4a2e16', 8, 10);
      px(ctx, 3, 12, '#1f2329', 3, 4);
      px(ctx, 26, 12, '#1f2329', 3, 4);
      px(ctx, 15, 2, '#5e391b', 1, 9);
      px(ctx, 16, 2, color, 6, 4);
      break;
    case 'house':
      px(ctx, 6, 14, '#e6d3b3', 20, 14);
      px(ctx, 4, 8, color, 24, 7);
      px(ctx, 8, 4, color, 16, 5);
      px(ctx, 13, 19, '#5e3a1e', 6, 9);
      px(ctx, 8, 17, '#8ad4f5', 4, 4);
      px(ctx, 20, 17, '#8ad4f5', 4, 4);
      break;
    case 'lumberjack':
      px(ctx, 5, 13, '#8c5a32', 18, 14);
      px(ctx, 4, 9, '#5c381b', 20, 5);
      px(ctx, 11, 18, '#3d2410', 5, 9);
      // Holzstapel
      px(ctx, 24, 19, '#a87040', 6, 8);
      px(ctx, 25, 20, '#d9a46c', 2, 2);
      px(ctx, 27, 23, '#d9a46c', 2, 2);
      break;
    case 'farm':
      px(ctx, 2, 16, '#c29242', 28, 12);
      for (let x = 4; x < 28; x += 4) {
        px(ctx, x, 17, '#f0c85a', 2, 10);
      }
      px(ctx, 6, 5, '#b84835', 14, 11);
      px(ctx, 4, 3, '#7a2c1e', 18, 4);
      break;
    case 'bakery':
      px(ctx, 6, 12, '#e8dcc5', 20, 15);
      px(ctx, 5, 7, '#a84f32', 22, 6);
      // Ofen & Rauch
      px(ctx, 21, 3, '#6e6e78', 4, 6);
      px(ctx, 22, 0, '#cfd8e3', 3, 3);
      px(ctx, 12, 19, '#2b1e16', 8, 8);
      px(ctx, 13, 21, '#ff7b29', 6, 5);
      break;
    case 'granary':
      px(ctx, 7, 10, '#d4b475', 18, 18);
      px(ctx, 5, 5, '#8a5d29', 22, 6);
      px(ctx, 9, 13, '#9c783c', 14, 2);
      px(ctx, 13, 19, '#4a3114', 6, 9);
      break;
    case 'quarry':
      px(ctx, 4, 14, '#7d8590', 24, 14);
      px(ctx, 8, 8, '#9aa3b0', 14, 10);
      px(ctx, 14, 18, '#464d57', 10, 9);
      px(ctx, 6, 20, '#b5bec9', 5, 5);
      break;
    case 'goldmine':
      px(ctx, 4, 10, '#636a73', 24, 18);
      px(ctx, 10, 16, '#1f2329', 12, 12);
      px(ctx, 8, 14, '#704721', 3, 14);
      px(ctx, 21, 14, '#704721', 3, 14);
      px(ctx, 8, 13, '#704721', 16, 3);
      px(ctx, 6, 22, '#ffd038', 4, 4);
      px(ctx, 23, 21, '#ffd038', 4, 4);
      break;
    case 'blacksmith':
      px(ctx, 5, 13, '#575d66', 22, 15);
      px(ctx, 4, 9, '#393e45', 24, 5);
      px(ctx, 20, 3, '#42474f', 5, 7);
      px(ctx, 10, 19, '#ff621f', 7, 8);
      px(ctx, 22, 22, '#22262b', 6, 4); // Amboss
      break;
    case 'barracks':
      px(ctx, 4, 10, '#858d99', 24, 18);
      px(ctx, 4, 6, color, 24, 5);
      px(ctx, 4, 4, '#666e7a', 4, 4);
      px(ctx, 14, 4, '#666e7a', 4, 4);
      px(ctx, 24, 4, '#666e7a', 4, 4);
      px(ctx, 12, 18, '#4a2e16', 8, 10);
      break;
    case 'tavern':
      px(ctx, 5, 11, '#d9c29c', 22, 17);
      px(ctx, 3, 6, '#96422b', 26, 6);
      px(ctx, 12, 18, '#543218', 8, 10);
      px(ctx, 7, 14, '#ffd24d', 4, 4);
      px(ctx, 21, 14, '#ffd24d', 4, 4);
      break;
    case 'market':
      px(ctx, 4, 14, '#b8834f', 24, 14);
      // Markise gestreift
      for (let x = 3; x < 29; x += 4) {
        px(ctx, x, 8, (x / 4) % 2 === 0 ? color : '#f5f0e6', 4, 7);
      }
      px(ctx, 7, 19, '#f5c542', 5, 5);
      px(ctx, 18, 19, '#64b84b', 6, 5);
      break;
    case 'well':
      px(ctx, 8, 16, '#87919e', 16, 11);
      px(ctx, 10, 18, '#3678c9', 12, 5);
      px(ctx, 9, 8, '#6e4522', 2, 10);
      px(ctx, 21, 8, '#6e4522', 2, 10);
      px(ctx, 7, 4, '#9e4731', 18, 5);
      break;
    case 'bridge':
      px(ctx, 2, 8, '#8a592d', 28, 16);
      px(ctx, 2, 6, '#5c3818', 28, 3);
      px(ctx, 2, 23, '#5c3818', 28, 3);
      for (let x = 4; x < 28; x += 5) {
        px(ctx, x, 10, '#ab7340', 3, 12);
      }
      break;
    case 'harbor':
      px(ctx, 4, 14, '#8a592d', 24, 12);
      px(ctx, 6, 8, '#e6d3b3', 12, 10);
      px(ctx, 5, 5, color, 14, 4);
      px(ctx, 20, 12, '#f5f0e6', 6, 8);
      px(ctx, 22, 6, '#543218', 2, 10);
      px(ctx, 18, 22, '#f5c542', 5, 4);
      break;
    case 'caravan':
      px(ctx, 3, 18, '#7a4e28', 22, 7);
      px(ctx, 6, 10, '#f0e2c8', 16, 9);
      px(ctx, 6, 10, color, 16, 3);
      px(ctx, 6, 24, '#3b220e', 5, 5);
      px(ctx, 18, 24, '#3b220e', 5, 5);
      px(ctx, 25, 16, '#a87040', 5, 6);
      break;
    case 'wall':
      px(ctx, 0, 8, '#7d8590', 32, 20);
      px(ctx, 0, 4, '#666e78', 6, 5);
      px(ctx, 13, 4, '#666e78', 6, 5);
      px(ctx, 26, 4, '#666e78', 6, 5);
      px(ctx, 4, 13, '#636b75', 10, 5);
      px(ctx, 18, 19, '#636b75', 10, 5);
      break;
    case 'gate':
      px(ctx, 0, 6, '#7d8590', 32, 22);
      px(ctx, 8, 11, '#5e391b', 16, 17);
      px(ctx, 15, 11, '#3b220e', 2, 17);
      px(ctx, 10, 15, '#9ca4b0', 4, 2);
      px(ctx, 18, 15, '#9ca4b0', 4, 2);
      break;
    case 'tower':
    case 'world_tower':
      px(ctx, 7, 6, '#7d8590', 18, 22);
      px(ctx, 5, 2, '#5c636e', 22, 6);
      px(ctx, 5, 0, '#9aa3b0', 5, 3);
      px(ctx, 14, 0, '#9aa3b0', 4, 3);
      px(ctx, 22, 0, '#9aa3b0', 5, 3);
      px(ctx, 14, 11, '#1f2329', 4, 6);
      px(ctx, 13, 19, color, 6, 6);
      break;
    case 'fort':
      px(ctx, 3, 10, '#6d7580', 26, 18);
      px(ctx, 2, 6, '#87919e', 7, 22);
      px(ctx, 23, 6, '#87919e', 7, 22);
      px(ctx, 11, 14, '#543218', 10, 14);
      px(ctx, 13, 3, color, 6, 5);
      px(ctx, 12, 3, '#3b220e', 1, 8);
      break;
    case 'outpost':
      px(ctx, 6, 12, '#8a592d', 20, 16);
      px(ctx, 4, 8, color, 24, 5);
      px(ctx, 12, 18, '#3b220e', 8, 10);
      px(ctx, 22, 20, '#f5c542', 5, 5);
      break;
    default:
      px(ctx, 6, 6, color, 20, 20);
  }

  spriteCache.set(key, c);
  return c;
}

// ============================================================================
// EMBLEM SPRITES (16x16)
// ============================================================================
export function getEmblemSprite(emblem, color = '#ffd166') {
  const key = `emb_${emblem}_${color}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  let rows;
  if (emblem === 'crown') {
    rows = [
      '........',
      '.A....A.',
      '.A.AA.A.',
      '.AAAAAA.',
      '.ABBBBA.',
      '.AAAAAA.',
      '.CCCCCC.',
      '........'
    ];
  } else if (emblem === 'lion') {
    rows = [
      '..AAAA..',
      '.ABBBBA.',
      '.ABCCBA.',
      '.ABBBBA.',
      '..AAAA..',
      '.AABAAA.',
      '..A..A..',
      '........'
    ];
  } else if (emblem === 'dragon') {
    rows = [
      '....AA..',
      '..AAAA..',
      '.AABAAA.',
      'AA.AAA..',
      '..AAAAA.',
      '.AA.AA..',
      'AA...AA.',
      '........'
    ];
  } else {
    // sword
    rows = [
      '......A.',
      '.....AA.',
      '....AA..',
      '...AA...',
      '.AAA....',
      '..BA....',
      '.BB.....',
      '........'
    ];
  }

  const c = drawPattern(16, rows, {
    A: color,
    B: '#ffffff',
    C: '#e63946'
  });
  spriteCache.set(key, c);
  return c;
}

// ============================================================================
// UNIT & VILLAGER SPRITES (16x16)
// ============================================================================
export function getUnitSprite(unitType, color = '#e74c3c') {
  const key = `unit_${unitType}_${color}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  const c = createCanvas(16);
  const ctx = c.getContext('2d');

  if (unitType === 'ship') {
    px(ctx, 2, 10, '#6e421f', 12, 4);
    px(ctx, 4, 14, '#4f2e14', 8, 1);
    px(ctx, 7, 3, '#543218', 2, 8);
    px(ctx, 4, 4, '#f5f0e6', 7, 5);
    px(ctx, 6, 5, color, 3, 3);
  } else if (unitType === 'warship') {
    px(ctx, 1, 10, '#4f2e14', 14, 4);
    px(ctx, 3, 14, '#361e0c', 10, 1);
    px(ctx, 5, 2, '#543218', 2, 9);
    px(ctx, 10, 4, '#543218', 2, 7);
    px(ctx, 3, 3, '#f5f0e6', 5, 5);
    px(ctx, 9, 5, color, 5, 4);
    px(ctx, 12, 9, '#9aa3b0', 3, 2); // Bug-Katapult
  } else if (unitType === 'catapult') {
    px(ctx, 2, 10, '#6e421f', 12, 3);
    px(ctx, 3, 12, '#3b220e', 3, 3);
    px(ctx, 10, 12, '#3b220e', 3, 3);
    px(ctx, 6, 4, '#8a592d', 2, 7);
    px(ctx, 4, 3, '#9aa3b0', 4, 3);
  } else {
    // Standard Humanoid (villager, swordsman, archer, knight, spy)
    px(ctx, 6, 2, '#f0c4a0', 4, 4); // Kopf
    if (unitType === 'king') {
      px(ctx, 5, 0, '#ffd23f', 6, 2); // Goldene Krone
      px(ctx, 5, 0, '#ffffff', 1, 1);
      px(ctx, 10, 0, '#ffffff', 1, 1);
      px(ctx, 3, 6, '#ffd23f', 10, 6); // Königlicher Mantel
    } else if (unitType === 'knight' || unitType === 'swordsman') {
      px(ctx, 5, 1, '#9aa3b0', 6, 3); // Helm
    } else if (unitType === 'spy') {
      px(ctx, 5, 1, '#262930', 6, 4); // Kapuze
    } else if (unitType === 'archer') {
      px(ctx, 5, 1, '#2f6b22', 6, 2); // Hut
    }
    px(ctx, 4, 6, color, 8, 6); // Torso / Wappenrock
    px(ctx, 5, 12, '#38302e', 2, 3);
    px(ctx, 9, 12, '#38302e', 2, 3);

    if (unitType === 'swordsman' || unitType === 'knight' || unitType === 'king') {
      px(ctx, 12, 4, unitType === 'king' ? '#ffd23f' : '#dce3eb', 2, 6); // Schwert
    } else if (unitType === 'archer') {
      px(ctx, 12, 4, '#8a592d', 2, 7); // Bogen
    }
  }

  spriteCache.set(key, c);
  return c;
}

/**
 * Verbundene Sprites für Mauern & Brücken (mask: 1=Nord, 2=Ost, 4=Süd, 8=West).
 */
export function getConnectedSprite(type, mask = 0) {
  const key = `conn_${type}_${mask}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = createCanvas(16);
  const ctx = c.getContext('2d');
  const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;

  if (type === 'wall') {
    // Mitte
    px(ctx, 4, 4, '#87919e', 8, 8);
    px(ctx, 5, 5, '#666e78', 6, 2);
    px(ctx, 5, 9, '#555d66', 6, 2);
    if (N) { px(ctx, 4, 0, '#87919e', 8, 5); px(ctx, 5, 1, '#666e78', 6, 2); }
    if (S) { px(ctx, 4, 11, '#87919e', 8, 5); px(ctx, 5, 13, '#555d66', 6, 2); }
    if (W) { px(ctx, 0, 4, '#87919e', 5, 8); px(ctx, 1, 6, '#666e78', 3, 2); }
    if (E) { px(ctx, 11, 4, '#87919e', 5, 8); px(ctx, 12, 6, '#666e78', 3, 2); }
    if (!mask) { px(ctx, 3, 3, '#9aa3b0', 3, 3); px(ctx, 10, 3, '#9aa3b0', 3, 3); }
  } else if (type === 'bridge') {
    px(ctx, 4, 4, '#8a592d', 8, 8);
    if (N || S || (!E && !W)) {
      px(ctx, 4, 0, '#8a592d', 8, 16);
      px(ctx, 3, 0, '#543317', 1, 16);
      px(ctx, 12, 0, '#543317', 1, 16);
      for (let y = 1; y < 16; y += 3) px(ctx, 5, y, '#ab7340', 6, 2);
    }
    if (E || W) {
      px(ctx, 0, 4, '#8a592d', 16, 8);
      px(ctx, 0, 3, '#543317', 16, 1);
      px(ctx, 0, 12, '#543317', 16, 1);
      for (let x = 1; x < 16; x += 3) px(ctx, x, 5, '#ab7340', 2, 6);
    }
  }
  spriteCache.set(key, c);
  return c;
}

/** Zeichnet einen Flaggen-Hintergrund für Spieler-Wappen. */
export function drawFlagBg(ctx, pattern, color, size) {
  ctx.fillStyle = '#181410';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = color;
  if (pattern === 'stripes') {
    const h = Math.max(2, Math.floor(size / 4));
    ctx.fillRect(0, 0, size, h);
    ctx.fillRect(0, h * 2, size, h);
  } else if (pattern === 'cross') {
    const w = Math.max(2, Math.floor(size / 4));
    ctx.fillRect(Math.floor((size - w) / 2), 0, w, size);
    ctx.fillRect(0, Math.floor((size - w) / 2), size, w);
  } else if (pattern === 'split') {
    ctx.fillRect(0, 0, Math.floor(size / 2), size);
  } else if (pattern === 'diagonal') {
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(size, 0); ctx.lineTo(0, size); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }
}

// ============================================================================
// WEB AUDIO API - 8-BIT SOUND EFFEKTE
// ============================================================================
let audioCtx = null;
let muted = false;

export function setMuted(val) {
  muted = Boolean(val);
}

export function isMuted() {
  return muted;
}

function ensureAudio() {
  if (muted) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function tone(freq, duration, type = 'square', delay = 0, vol = 0.08) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

export function playSfx(name) {
  if (muted) return;
  switch (name) {
    case 'click':
      tone(520, 0.06, 'square', 0, 0.05);
      break;
    case 'build':
      tone(190, 0.08, 'triangle', 0, 0.12);
      tone(240, 0.09, 'square', 0.09, 0.08);
      break;
    case 'coins':
      tone(987, 0.07, 'square', 0, 0.06);
      tone(1318, 0.14, 'square', 0.07, 0.07);
      break;
    case 'horn':
      tone(220, 0.18, 'sawtooth', 0, 0.08);
      tone(277, 0.18, 'sawtooth', 0.15, 0.08);
      tone(330, 0.3, 'sawtooth', 0.3, 0.09);
      break;
    case 'fire':
      tone(140, 0.14, 'sawtooth', 0, 0.08);
      tone(110, 0.18, 'sawtooth', 0.12, 0.08);
      break;
    default:
      tone(440, 0.06, 'square', 0, 0.05);
  }
}
