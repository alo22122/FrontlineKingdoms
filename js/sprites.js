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
export function getTerrainSprite(type, season = 'summer') {
  const key = `terrain_${type}_${season}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  const c = createCanvas(16);
  const ctx = c.getContext('2d');
  const winter = season === 'winter';

  if (type === 'grass') {
    px(ctx, 0, 0, winter ? '#d9e8f5' : '#4f8f3b', 16, 16);
    px(ctx, 2, 3, winter ? '#c3d7eb' : '#437d31', 2, 1);
    px(ctx, 10, 6, winter ? '#eef6fc' : '#63a84b', 2, 1);
    px(ctx, 5, 11, winter ? '#c3d7eb' : '#437d31', 1, 2);
    px(ctx, 12, 13, winter ? '#eef6fc' : '#63a84b', 2, 1);
  } else if (type === 'forest') {
    px(ctx, 0, 0, winter ? '#cddfee' : '#3a722a', 16, 16);
    // Baum 1
    px(ctx, 4, 8, '#5a3821', 2, 5);
    px(ctx, 2, 3, winter ? '#9dc2d8' : '#24521a', 6, 6);
    px(ctx, 3, 2, winter ? '#e6f2fa' : '#2f6b22', 4, 3);
    // Baum 2
    px(ctx, 11, 9, '#5a3821', 2, 5);
    px(ctx, 9, 5, winter ? '#89b0c9' : '#1f4716', 6, 5);
    px(ctx, 10, 4, winter ? '#d8ebf7' : '#2c6320', 4, 2);
  } else if (type === 'water') {
    px(ctx, 0, 0, winter ? '#4a7ba8' : '#2563a8', 16, 16);
    px(ctx, 2, 4, winter ? '#89b8e0' : '#3b82cf', 5, 1);
    px(ctx, 8, 10, winter ? '#a6cef0' : '#5298e3', 6, 1);
    px(ctx, 3, 13, winter ? '#75a6d1' : '#3b82cf', 4, 1);
  } else if (type === 'mountain') {
    px(ctx, 0, 0, winter ? '#b8c8d8' : '#5d6b56', 16, 16);
    px(ctx, 3, 11, '#5b636e', 10, 4);
    px(ctx, 4, 7, '#6f7885', 8, 5);
    px(ctx, 6, 3, '#8892a0', 4, 5);
    // Schneegipfel
    px(ctx, 6, 2, '#f2f7fc', 4, 3);
    px(ctx, 7, 1, '#ffffff', 2, 2);
  } else if (type === 'hill') {
    px(ctx, 0, 0, winter ? '#cddfee' : '#5b9644', 16, 16);
    px(ctx, 2, 8, winter ? '#b3c8db' : '#73ab59', 12, 5);
    px(ctx, 4, 6, winter ? '#dceaf5' : '#85bd68', 8, 3);
    px(ctx, 3, 13, winter ? '#9eb4c9' : '#437332', 10, 1);
  } else if (type === 'desert') {
    px(ctx, 0, 0, '#d8b467', 16, 16);
    px(ctx, 2, 5, '#c49d4d', 5, 1);
    px(ctx, 9, 10, '#e5c67e', 5, 1);
    px(ctx, 5, 13, '#c49d4d', 3, 1);
  } else if (type === 'gold') {
    px(ctx, 0, 0, winter ? '#c5d6e6' : '#586952', 16, 16);
    px(ctx, 3, 6, '#6e7680', 10, 7);
    px(ctx, 5, 7, '#f5c542', 3, 3);
    px(ctx, 9, 9, '#ffd966', 3, 3);
    px(ctx, 6, 10, '#d49b1a', 2, 2);
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
      px(ctx, 7, 6, '#7d8590', 18, 22);
      px(ctx, 5, 2, '#5c636e', 22, 6);
      px(ctx, 5, 0, '#9aa3b0', 5, 3);
      px(ctx, 14, 0, '#9aa3b0', 4, 3);
      px(ctx, 22, 0, '#9aa3b0', 5, 3);
      px(ctx, 14, 11, '#1f2329', 4, 6);
      px(ctx, 13, 19, color, 6, 6);
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
  } else if (unitType === 'catapult') {
    px(ctx, 2, 10, '#6e421f', 12, 3);
    px(ctx, 3, 12, '#3b220e', 3, 3);
    px(ctx, 10, 12, '#3b220e', 3, 3);
    px(ctx, 6, 4, '#8a592d', 2, 7);
    px(ctx, 4, 3, '#9aa3b0', 4, 3);
  } else if (unitType === 'camp') {
    // Banditenlager: Zelt + Lagerfeuer
    px(ctx, 2, 13, 'rgba(0,0,0,0.35)', 12, 2);
    px(ctx, 7, 2, '#5c2a2a', 2, 2);
    px(ctx, 5, 4, '#7a3030', 6, 3);
    px(ctx, 3, 7, '#8f3a3a', 10, 3);
    px(ctx, 2, 10, '#a34545', 12, 3);
    px(ctx, 7, 9, '#2b1a1a', 2, 4);
    px(ctx, 12, 12, '#ff8c1a', 3, 2);
    px(ctx, 13, 11, '#ffd23f', 1, 1);
  } else if (unitType === 'ruin') {
    px(ctx, 2, 13, 'rgba(0,0,0,0.3)', 12, 2);
    px(ctx, 2, 6, '#8d8f94', 3, 8);
    px(ctx, 11, 4, '#8d8f94', 3, 10);
    px(ctx, 5, 10, '#a3a6ab', 6, 4);
    px(ctx, 6, 8, '#6b6e73', 2, 2);
    px(ctx, 8, 12, '#ffd23f', 2, 1);
  } else if (unitType === 'bandit') {
    px(ctx, 5, 2, '#38302e', 6, 4);
    px(ctx, 6, 4, '#f0c4a0', 4, 3);
    px(ctx, 4, 7, '#6b2727', 8, 5);
    px(ctx, 5, 12, '#2b2422', 2, 3);
    px(ctx, 9, 12, '#2b2422', 2, 3);
    px(ctx, 12, 5, '#cfd8e3', 2, 6);
  } else {
    // Standard Humanoid (villager, swordsman, archer, knight, spy)
    px(ctx, 6, 2, '#f0c4a0', 4, 4); // Kopf
    if (unitType === 'knight' || unitType === 'swordsman') {
      px(ctx, 5, 1, '#9aa3b0', 6, 3); // Helm
    } else if (unitType === 'spy') {
      px(ctx, 5, 1, '#262930', 6, 4); // Kapuze
    } else if (unitType === 'archer') {
      px(ctx, 5, 1, '#2f6b22', 6, 2); // Hut
    }
    px(ctx, 4, 6, color, 8, 6); // Torso / Wappenrock
    px(ctx, 5, 12, '#38302e', 2, 3);
    px(ctx, 9, 12, '#38302e', 2, 3);

    if (unitType === 'swordsman' || unitType === 'knight') {
      px(ctx, 12, 4, '#dce3eb', 2, 6); // Schwert
    } else if (unitType === 'archer') {
      px(ctx, 12, 4, '#8a592d', 2, 7); // Bogen
    }
  }

  spriteCache.set(key, c);
  return c;
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
