// ============================================================================
// js/game.js – Hauptspiel: Login, Lobby, Weltkarte, Dorf, Wirtschaft, Kampf
// ============================================================================
import {
  sb, isAdminUser, getSavedUser, loginWithNamePassword, loginAsGuest, logoutUser, subscribeMatchRealtime
} from './supabase.js';
import {
  getTerrainSprite, getBuildingSprite, getEmblemSprite, getUnitSprite, playSfx, setMuted, isMuted
} from './sprites.js';
import * as M from './map.js';
import { setupAdmin, openAdminPanel, openMapEditor, refreshAdminPanel } from './admin.js';

// ---------------------------------------------------------------------------
// KONSTANTEN
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const TILE = 16;      // Weltkarte: Pixel pro Tile (Weltkoordinaten)
const VTILE = 32;     // Dorf: Pixel pro Tile
const VSIZE = 40;     // Dorf: 40x40
const PLAYER_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#9b5de5', '#f15bb5', '#00bbf9', '#fb8500', '#8ac926', '#adb5bd'];
const EMBLEMS = { crown: 'Krone', lion: 'Löwe', dragon: 'Drache', sword: 'Schwert' };
const AGE_NAMES = ['', 'Dunkles Zeitalter', 'Feudalzeit', 'Ritterzeit', 'Kaiserzeit'];
const AGE_COST = {
  2: { wood: 300, raw_food: 300, gold: 100 },
  3: { stone: 400, raw_food: 400, gold: 300 },
  4: { stone: 700, raw_food: 600, gold: 600 }
};
const RES_ICON = { wood: '🪵', stone: '🪨', gold: '💰', raw_food: '🌾', bread: '🍞' };
const RES_NAME = { wood: 'Holz', stone: 'Stein', gold: 'Gold', raw_food: 'Nahrung', bread: 'Brot' };

const BUILDINGS = {
  castle: { name: 'Burg', cost: {}, time: 0, desc: 'Herz deines Dorfes. +5 Wohnraum.', hidden: true },
  house: { name: 'Haus', cost: { wood: 30 }, time: 8, desc: '+5 Wohnraum für Dorfbewohner.' },
  lumberjack: { name: 'Holzfäller', cost: { wood: 20 }, time: 8, prod: { wood: 1.0 }, workers: 2, desc: 'Produziert Holz.' },
  farm: { name: 'Bauernhof', cost: { wood: 35 }, time: 10, prod: { raw_food: 1.3 }, workers: 2, desc: 'Produziert Rohnahrung.' },
  bakery: { name: 'Bäckerei', cost: { wood: 40, stone: 30 }, time: 14, workers: 1, desc: 'Macht aus Rohnahrung haltbares Brot (+Moral).' },
  granary: { name: 'Kornspeicher', cost: { wood: 50, stone: 20 }, time: 12, desc: 'Verhindert, dass Rohnahrung verdirbt.' },
  quarry: { name: 'Steinbruch', cost: { wood: 40 }, time: 10, prod: { stone: 0.6 }, workers: 2, desc: 'Produziert Stein.' },
  goldmine: { name: 'Goldmine', cost: { wood: 50, stone: 30 }, time: 14, prod: { gold: 0.4 }, workers: 2, desc: 'Produziert Gold (+5% je Gold-Tile im Gebiet).' },
  blacksmith: { name: 'Schmiede', cost: { wood: 60, stone: 60 }, time: 18, desc: 'Ermöglicht neue Zeitalter.' },
  barracks: { name: 'Kaserne', cost: { wood: 80, stone: 40 }, time: 20, desc: 'Bildet Truppen aus.' },
  tavern: { name: 'Taverne', cost: { wood: 60, gold: 20 }, time: 14, desc: '+Moral über Zeit, ermöglicht Spione.' },
  market: { name: 'Marktplatz', cost: { wood: 70, gold: 30 }, time: 16, desc: 'Handel & Ressourcen verschicken.' },
  well: { name: 'Brunnen', cost: { stone: 25 }, time: 6, desc: 'Dorfbewohner löschen Brände automatisch.' },
  wall: { name: 'Mauer', cost: { stone: 6 }, time: 2, desc: 'Verteidigung gegen Plünderer (ziehen gedrückt halten).' },
  gate: { name: 'Tor', cost: { stone: 12, wood: 8 }, time: 4, desc: 'Durchgang in deiner Mauer, +Verteidigung.' },
  tower: { name: 'Wachturm', cost: { stone: 40, wood: 20 }, time: 12, desc: '+5% Kampfkraft im eigenen Gebiet (max +50%).' }
};

const UNITS = {
  swordsman: { name: 'Schwertkämpfer', age: 1, power: 10, speed: 1.5, cost: { gold: 8, raw_food: 15 } },
  archer: { name: 'Bogenschütze', age: 2, power: 9, speed: 1.5, cost: { wood: 15, gold: 10 }, note: '+50% auf Hügeln' },
  ship: { name: 'Schiff', age: 2, power: 6, speed: 1.0, cost: { wood: 40 }, note: 'Fährt über Wasser & Berge' },
  knight: { name: 'Ritter', age: 3, power: 24, speed: 1.0, cost: { gold: 30, raw_food: 20 } },
  catapult: { name: 'Katapult', age: 4, power: 40, speed: 2.5, cost: { wood: 60, stone: 40, gold: 20 } }
};
const BATCH = 5;

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const S = {
  user: null, match: null, players: [], me: null, buildings: [], armies: [], chat: [],
  terrain: null, terrainKey: '', landTotal: 1, terrainCanvases: {}, villageGround: {},
  territory: new Int8Array(M.N).fill(-1), territoryLoaded: false, territoryDirty: false, territoryVersion: 0, terrBuilt: -1,
  visible: new Uint8Array(M.N), explored: new Uint8Array(M.N), exploredDirty: false, fogVersion: 0, fogBuilt: -1,
  bridges: new Set(), terrCanvas: null, fogCanvas: null,
  view: 'world', camW: { x: 0, y: 0, z: 2 }, camV: { x: 0, y: 0, z: 1 },
  selectedArmyId: null, selectedBuildingId: null, selectedTile: null, buildType: null, bridgeMode: false, hoverTile: null,
  online: [], spied: {}, fogOff: false, unsub: null, timers: [], menuTimer: null, inGame: false,
  acc: { wood: 0, stone: 0, gold: 0, raw_food: 0, bread: 0 }, popAcc: 0,
  lastTerritoryWrite: 0, lastSnapshot: 0, lastExpand: 0, lastEvent: Date.now(), lastBanditCheck: 0, lastExploredSave: 0,
  authBusy: false, fireSeen: {}, endShown: false, activeTab: 'info', placing: new Set(), drag: null,
  lobbyFormFilled: false, myEmblem: 'crown', chatUnread: false, tickCount: 0
};

// ---------------------------------------------------------------------------
// HILFSFUNKTIONEN
// ---------------------------------------------------------------------------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const fmt = (n) => Math.floor(n || 0).toLocaleString('de-DE');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const costText = (cost) => Object.entries(cost).map(([k, v]) => `${RES_ICON[k]}${v}`).join(' ') || 'gratis';
const speed = () => S.match?.game_speed || 1;
const now = () => Date.now();
const isDone = (b) => new Date(b.construction_end_at).getTime() <= now();
const debounce = (fn, ms) => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};
const spriteUrlCache = new Map();
function spriteUrl(canvas, key) {
  if (!spriteUrlCache.has(key)) spriteUrlCache.set(key, canvas.toDataURL());
  return spriteUrlCache.get(key);
}
function emblemCanvas(emblem, color, size = 32) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0008';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(getEmblemSprite(emblem, color), 0, 0, size, size);
  return c;
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('in-game', id === 'screen-game');
}
function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const playerById = (id) => S.players.find((p) => p.id === id) || null;
const playerBySlot = (slot) => S.players.find((p) => p.slot === slot) || null;
function allied(idA, idB) {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  const a = playerById(idA);
  const b = playerById(idB);
  return Boolean(a && b && a.alliance && a.alliance === b.alliance);
}
const isAdmin = () => isAdminUser(S.user, S.match);

// ---------------------------------------------------------------------------
// SCHULZEIT-PvP (Europe/Berlin)
// ---------------------------------------------------------------------------
function berlinTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = parseInt(get('hour'), 10) % 24;
  return { day: get('weekday'), minutes: hour * 60 + parseInt(get('minute'), 10) };
}
function schoolWarEnd() {
  const { day, minutes } = berlinTime();
  const start = 8 * 60;
  let end = null;
  if (['Mon', 'Wed', 'Thu'].includes(day)) end = 15 * 60 + 30;
  if (['Tue', 'Fri'].includes(day)) end = 13 * 60 + 30;
  if (end !== null && minutes >= start && minutes < end) return end;
  return null;
}
function pvpAllowed() {
  const mode = S.match?.pvp_mode;
  if (mode === 'always_war') return true;
  if (mode === 'peace') return false;
  return schoolWarEnd() !== null;
}
function updatePvpBanner() {
  const el = $('pvp-banner');
  if (!S.match) return;
  const mode = S.match.pvp_mode;
  let text;
  let war;
  if (mode === 'always_war') {
    war = true;
    text = '⚔️ 24/7 KRIEG – PvP immer erlaubt';
  } else if (mode === 'peace') {
    war = false;
    text = '🕊️ FRIEDEN (Admin) – PvP gesperrt';
  } else {
    const end = schoolWarEnd();
    war = end !== null;
    text = war
      ? `⚔️ KRIEGSZEIT (Schulzeit) – PvP erlaubt bis ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
      : '🕊️ FREIZEIT-FRIEDEN – PvP gesperrt (Bauen, Handel & Banditen gehen!)';
  }
  el.textContent = text;
  el.className = `banner pvp ${war ? 'war' : 'peace'}`;
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
async function doLogin(mode) {
  $('login-error').textContent = '';
  playSfx('click');
  try {
    if (mode === 'guest') S.user = await loginAsGuest();
    else S.user = await loginWithNamePassword($('login-name').value, $('login-pw').value, mode === 'register');
    toast(`Willkommen, ${S.user.username}!`, 'ok');
    showMenu();
  } catch (e) {
    $('login-error').textContent = e.message;
  }
}

// ---------------------------------------------------------------------------
// MENÜ
// ---------------------------------------------------------------------------
function showMenu() {
  leaveMatchState();
  showScreen('screen-menu');
  $('menu-user').textContent = `${S.user.isGlobalAdmin ? '👑 ' : ''}${S.user.username}${S.user.isGuest ? ' (Gast)' : ''}`;
  $('btn-editor-menu').hidden = !S.user.isGlobalAdmin;
  refreshMenu();
  loadCustomMapOptions();
  S.menuTimer = setInterval(refreshMenu, 5000);
}

async function refreshMenu() {
  const { data: lb } = await sb.from('profiles').select('username,wins').order('wins', { ascending: false }).limit(10);
  $('leaderboard').innerHTML = (lb || []).length
    ? lb.map((p) => `<li><span>${esc(p.username)}</span><b>${p.wins} 🏆</b></li>`).join('')
    : '<li class="muted">Noch keine Einträge</li>';

  const since = new Date(now() - 2 * 24 * 3600 * 1000).toISOString();
  const { data: matches, error } = await sb
    .from('matches')
    .select('id,name,status,map_type,created_at,match_players(user_id)')
    .neq('status', 'finished')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) {
    $('lobby-list').innerHTML = `<p class="error">Fehler: ${esc(error.message)}<br>Wurde schema.sql in Supabase ausgeführt?</p>`;
    return;
  }
  const list = $('lobby-list');
  if (!matches.length) {
    list.innerHTML = '<p class="muted">Keine offenen Spiele – erstelle eins!</p>';
    return;
  }
  list.innerHTML = '';
  for (const m of matches) {
    const count = m.match_players.length;
    const member = m.match_players.some((p) => p.user_id === S.user.id);
    const statusTxt = { lobby: '🟢 Lobby', running: '⚔️ Läuft', paused: '⏸️ Pause' }[m.status] || m.status;
    const canJoin = member || (m.status === 'lobby' && count < 10);
    const div = document.createElement('div');
    div.className = 'lobby-item';
    div.innerHTML = `<div><b>${esc(m.name)}</b><div class="meta">${statusTxt} · ${M.MAP_TYPES[m.map_type] || m.map_type} · ${count}/10</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn small primary';
    btn.textContent = member ? 'Zurückkehren' : m.status === 'lobby' ? 'Beitreten' : 'Läuft';
    btn.disabled = !canJoin;
    btn.onclick = () => joinMatch(m.id);
    div.appendChild(btn);
    list.appendChild(div);
  }
}

async function loadCustomMapOptions() {
  const { data } = await sb.from('custom_maps').select('id,name').order('created_at', { ascending: false }).limit(50);
  const opts = (data || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('') || '<option value="">(keine gespeichert)</option>';
  $('create-custom').innerHTML = opts;
  $('lobby-custom').innerHTML = opts;
}

async function createMatch() {
  playSfx('click');
  const name = $('create-name').value.trim() || `${S.user.username}s Reich`;
  const mapType = $('create-map').value;
  const customId = mapType === 'custom' ? $('create-custom').value || null : null;
  if (mapType === 'custom' && !customId) return toast('Keine eigene Karte vorhanden.', 'err');
  const { data, error } = await sb
    .from('matches')
    .insert({ name, host_id: S.user.id, map_type: mapType, custom_map_id: customId, map_seed: Math.floor(Math.random() * 999999) })
    .select()
    .single();
  if (error) return toast('Fehler: ' + error.message, 'err');
  await joinMatch(data.id);
}

async function joinMatch(matchId) {
  playSfx('click');
  const { data: players } = await sb.from('match_players').select('id,user_id,slot').eq('match_id', matchId);
  const existing = (players || []).find((p) => p.user_id === S.user.id);
  if (!existing) {
    const { data: m } = await sb.from('matches').select('status').eq('id', matchId).single();
    if (!m || m.status !== 'lobby') return toast('Spiel läuft bereits.', 'err');
    if ((players || []).length >= 10) return toast('Lobby ist voll (10/10).', 'err');
    const used = new Set((players || []).map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const { error } = await sb.from('match_players').insert({
      match_id: matchId, user_id: S.user.id, username: S.user.username, slot,
      kingdom_name: `Reich von ${S.user.username}`.slice(0, 24), color: PLAYER_COLORS[slot], emblem: 'crown'
    });
    if (error) return toast('Beitritt fehlgeschlagen: ' + error.message, 'err');
  }
  await enterMatch(matchId);
}

// ---------------------------------------------------------------------------
// MATCH LADEN & SYNCHRONISIEREN
// ---------------------------------------------------------------------------
async function enterMatch(matchId) {
  clearInterval(S.menuTimer);
  const { data: m, error } = await sb.from('matches').select('*').eq('id', matchId).single();
  if (error || !m) return toast('Match nicht gefunden.', 'err');
  S.match = m;
  S.territoryLoaded = false;
  S.endShown = false;
  S.lobbyFormFilled = false;
  await reloadPlayers();
  if (!S.me) return toast('Du bist nicht in diesem Match.', 'err');
  const { data: ex } = await sb.from('match_players').select('explored_tiles').eq('id', S.me.id).single();
  M.decodeBits(ex?.explored_tiles || '', S.explored);
  await Promise.all([reloadBuildings(), reloadArmies(), reloadChat(), ensureTerrain()]);
  applyMatchTerritory(true);

  const rMatch = debounce(reloadMatch, 250);
  const rPlayers = debounce(reloadPlayers, 400);
  const rBuild = debounce(reloadBuildings, 300);
  const rArmies = debounce(reloadArmies, 200);
  const rChat = debounce(reloadChat, 150);
  S.unsub = subscribeMatchRealtime(matchId, S.user.id, {
    onMatch: rMatch, onPlayers: rPlayers, onBuildings: rBuild, onArmies: rArmies, onChat: rChat,
    onPresence: (ids) => { S.online = ids; }
  });
  S.timers.push(setInterval(fullReload, 5000));
  routeByStatus(null);
}

async function fullReload() {
  if (!S.match) return;
  await Promise.all([reloadMatch(), reloadPlayers(), reloadBuildings(), reloadArmies()]);
}

async function reloadMatch() {
  if (!S.match) return;
  const { data } = await sb.from('matches').select('*').eq('id', S.match.id).maybeSingle();
  if (!data) {
    toast('Das Match wurde gelöscht.', 'err');
    return showMenu();
  }
  const prev = S.match;
  S.match = data;
  if (prev.map_type !== data.map_type || prev.map_seed !== data.map_seed || prev.custom_map_id !== data.custom_map_id) {
    await ensureTerrain();
    if (S.match.status === 'lobby') drawLobbyPreview();
  }
  applyMatchTerritory(false);
  if (prev.status !== data.status) routeByStatus(prev.status);
  if (prev.season !== data.season) toast(data.season === 'winter' ? '❄️ Der Winter ist da! Doppelter Nahrungsverbrauch.' : '☀️ Der Sommer kehrt zurück.');
  if (prev.global_banner !== data.global_banner && data.global_banner) playSfx('horn');
  updateBanners();
  if (S.match.status === 'lobby') renderLobby();
  refreshAdminPanel();
}

async function reloadPlayers() {
  if (!S.match) return;
  const { data } = await sb
    .from('match_players')
    .select('id,match_id,user_id,username,slot,kingdom_name,color,emblem,age,alliance,wood,stone,gold,raw_food,bread,food,morale,population,territory_percent,capital_x,capital_y,is_eliminated,created_at')
    .eq('match_id', S.match.id)
    .order('slot');
  if (!data) return;
  S.players = data;
  const me = data.find((p) => p.user_id === S.user.id) || null;
  if (S.me && !me) {
    toast('Du wurdest aus dem Match entfernt.', 'err');
    S.me = null;
    return showMenu();
  }
  S.me = me;
  S.territoryVersion++;
  if (S.match.status === 'lobby') renderLobby();
  refreshAdminPanel();
}

async function reloadBuildings() {
  if (!S.match) return;
  const { data } = await sb.from('buildings').select('*').eq('match_id', S.match.id);
  if (!data) return;
  S.buildings = data;
  S.bridges = new Set(data.filter((b) => b.layer === 'world' && b.type === 'bridge').map((b) => M.idx(b.x, b.y)));
}

async function reloadArmies() {
  if (!S.match) return;
  const { data } = await sb.from('armies').select('*').eq('match_id', S.match.id);
  if (data) S.armies = data;
}

async function reloadChat() {
  if (!S.match) return;
  const { data } = await sb
    .from('chat_messages')
    .select('*')
    .eq('match_id', S.match.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (!data) return;
  const before = S.chat.length ? S.chat[S.chat.length - 1].id : null;
  S.chat = data.reverse();
  const last = S.chat.length ? S.chat[S.chat.length - 1] : null;
  if (last && last.id !== before && before !== null) {
    if (S.activeTab !== 'chat' && S.inGame) $('chat-badge').hidden = false;
    if (last.player_id !== S.me?.id) playSfx('click');
  }
  renderChat();
}

async function ensureTerrain() {
  const m = S.match;
  const key = `${m.map_type}_${m.map_seed}_${m.custom_map_id || ''}`;
  if (key === S.terrainKey && S.terrain) return;
  let grid = null;
  if (m.map_type === 'custom' && m.custom_map_id) {
    const { data } = await sb.from('custom_maps').select('grid_data').eq('id', m.custom_map_id).maybeSingle();
    grid = data?.grid_data || null;
  }
  S.terrain = M.generateMap(m.map_type, m.map_seed, grid);
  S.terrainKey = key;
  S.landTotal = Math.max(1, M.countLand(S.terrain));
  S.terrainCanvases = {};
}

/** Übernimmt Gebiet aus der DB (die Authority behält ihre eigene, neuere Version). */
function applyMatchTerritory(force) {
  if (!S.match) return;
  if (!force && amAuthority() && S.territoryLoaded) return;
  if (typeof S.match.territory === 'string' && S.match.territory.length === M.N) {
    M.decodeTerritory(S.match.territory, S.territory);
    S.territoryLoaded = true;
    S.territoryVersion++;
  } else if (force) {
    S.territory.fill(-1);
  }
}

function routeByStatus(prevStatus) {
  const st = S.match.status;
  if (st === 'lobby') {
    S.inGame = false;
    showLobby();
  } else {
    if (!S.inGame) showGame();
    if (prevStatus === 'lobby') {
      playSfx('horn');
      toast('⚔️ Das Spiel beginnt!', 'ok');
    }
    $('paused-overlay').hidden = st !== 'paused';
    if (st === 'finished') showEnd();
  }
}

function leaveMatchState() {
  if (S.unsub) S.unsub();
  S.unsub = null;
  S.timers.forEach(clearInterval);
  S.timers = [];
  clearInterval(S.menuTimer);
  S.inGame = false;
  S.match = null;
  S.me = null;
  S.players = [];
  S.buildings = [];
  S.armies = [];
  S.chat = [];
  S.selectedArmyId = null;
  S.selectedBuildingId = null;
  S.buildType = null;
  S.bridgeMode = false;
  S.fogOff = false;
  $('modal-end').hidden = true;
  $('modal-admin').hidden = true;
}

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------
function showLobby() {
  showScreen('screen-lobby');
  renderLobby();
  drawLobbyPreview();
}

function renderLobby() {
  if (!S.match || !S.me) return;
  $('lobby-title').textContent = `🏰 ${S.match.name}`;
  $('lobby-count').textContent = S.players.length;
  const admin = isAdmin();
  $('btn-admin-lobby').hidden = !admin;
  $('lobby-host-box').hidden = !admin;
  $('lobby-wait').hidden = admin;

  const list = $('lobby-players');
  list.innerHTML = '';
  for (const p of S.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.style.borderLeftColor = p.color;
    row.appendChild(emblemCanvas(p.emblem, p.color, 24));
    const info = document.createElement('div');
    info.className = 'grow';
    info.innerHTML = `<b>${esc(p.kingdom_name)}</b><br><small>${esc(p.username)}${p.user_id === S.match.host_id ? ' · 👑 Host' : ''}${S.online.includes(p.user_id) ? ' · 🟢' : ''}</small>`;
    row.appendChild(info);
    list.appendChild(row);
  }

  if (admin && document.activeElement?.tagName !== 'SELECT') {
    $('lobby-map').value = S.match.map_type;
    $('lobby-speed').value = String(S.match.game_speed);
    $('lobby-custom-wrap').hidden = S.match.map_type !== 'custom';
    if (S.match.custom_map_id) $('lobby-custom').value = S.match.custom_map_id;
  }

  if (!S.lobbyFormFilled) {
    S.lobbyFormFilled = true;
    $('my-kingdom').value = S.me.kingdom_name;
    $('my-color').value = S.me.color;
    S.myEmblem = S.me.emblem;
    renderEmblemPicker();
  }
  renderChat();
}

function renderEmblemPicker() {
  const box = $('emblem-picker');
  box.innerHTML = '';
  for (const [key, label] of Object.entries(EMBLEMS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.className = key === S.myEmblem ? 'active' : '';
    b.appendChild(emblemCanvas(key, $('my-color').value, 32));
    b.onclick = () => {
      S.myEmblem = key;
      playSfx('click');
      renderEmblemPicker();
    };
    box.appendChild(b);
  }
}

async function saveKingdom() {
  const kingdom_name = $('my-kingdom').value.trim().slice(0, 24) || S.me.kingdom_name;
  const { error } = await sb.from('match_players').update({ kingdom_name, color: $('my-color').value, emblem: S.myEmblem }).eq('id', S.me.id);
  if (error) return toast(error.message, 'err');
  playSfx('coins');
  toast('Königreich gespeichert!', 'ok');
  reloadPlayers();
}

async function updateMatchSettings(patch) {
  const { error } = await sb.from('matches').update(patch).eq('id', S.match.id);
  if (error) toast(error.message, 'err');
  else reloadMatch();
}

function drawLobbyPreview() {
  const c = $('lobby-preview');
  if (!c || !S.terrain) return;
  drawMiniMap(c, S.terrain, null);
}

const MINI_COLORS = ['#2563a8', '#4f8f3b', '#2f6b22', '#73ab59', '#8892a0', '#d8b467', '#f5c542'];
function drawMiniMap(canvas, terrain, territory) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(M.W, M.H);
  for (let i = 0; i < M.N; i++) {
    let [r, g, b] = hexToRgb(MINI_COLORS[terrain[i]] || '#000');
    if (territory && territory[i] >= 0) {
      const p = playerBySlot(territory[i]);
      const [pr, pg, pb] = hexToRgb(p ? p.color : PLAYER_COLORS[territory[i]]);
      r = (r + pr * 2) / 3;
      g = (g + pg * 2) / 3;
      b = (b + pb * 2) / 3;
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  const off = document.createElement('canvas');
  off.width = M.W;
  off.height = M.H;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}

async function leaveLobby() {
  if (S.match?.status === 'lobby' && S.me) {
    await sb.from('match_players').delete().eq('id', S.me.id);
    const rest = S.players.filter((p) => p.id !== S.me.id);
    if (rest.length === 0) await sb.from('matches').delete().eq('id', S.match.id);
    else if (S.match.host_id === S.user.id) await sb.from('matches').update({ host_id: rest[0].user_id }).eq('id', S.match.id);
  }
  showMenu();
}

// ---------------------------------------------------------------------------
// SPIELSTART (Host / Admin)
// ---------------------------------------------------------------------------
async function startMatch() {
  if (!S.match || S.match.status !== 'lobby') return toast('Spiel läuft bereits.', 'err');
  await reloadPlayers();
  await ensureTerrain();
  if (!S.players.length) return toast('Keine Spieler in der Lobby.', 'err');
  toast('Welt wird erschaffen…');
  const t = S.terrain;
  const territory = new Int8Array(M.N).fill(-1);
  const spawns = M.findSpawns(t, S.players.length, S.match.map_seed);
  const nowIso = new Date().toISOString();
  const buildingRows = [];
  const armyRows = [];

  for (let k = 0; k < S.players.length; k++) {
    const p = S.players[k];
    const [cx, cy] = spawns[k];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (M.inBounds(x, y) && dx * dx + dy * dy <= 10 && M.isLand(t[M.idx(x, y)])) territory[M.idx(x, y)] = p.slot;
      }
    }
    await sb.from('match_players').update({
      capital_x: cx, capital_y: cy, wood: 250, stone: 150, gold: 120, raw_food: 200, bread: 40,
      morale: 80, population: 5, age: 1, is_eliminated: false, territory_percent: 0
    }).eq('id', p.id);
    buildingRows.push(
      { match_id: S.match.id, player_id: p.id, layer: 'village', type: 'castle', x: 19, y: 19, construction_end_at: nowIso },
      { match_id: S.match.id, player_id: p.id, layer: 'village', type: 'farm', x: 16, y: 22, construction_end_at: nowIso },
      { match_id: S.match.id, player_id: p.id, layer: 'village', type: 'lumberjack', x: 23, y: 16, construction_end_at: nowIso },
      { match_id: S.match.id, player_id: p.id, layer: 'village', type: 'house', x: 22, y: 21, construction_end_at: nowIso }
    );
    armyRows.push({ match_id: S.match.id, player_id: p.id, unit_type: 'swordsman', count: 10, x: cx, y: cy });
  }

  // Banditenlager & Ruinen
  const r = M.rng(S.match.map_seed + 555);
  const farFromSpawns = (x, y) => spawns.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 9);
  let bandits = 0;
  let ruins = 0;
  for (let tries = 0; tries < 3000 && (bandits < 12 || ruins < 6); tries++) {
    const x = Math.floor(r() * M.W);
    const y = Math.floor(r() * M.H);
    if (!M.isPassable(t[M.idx(x, y)]) || !farFromSpawns(x, y)) continue;
    if (bandits < 12) {
      armyRows.push({ match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 6 + Math.floor(r() * 14), x, y });
      bandits++;
    } else {
      armyRows.push({ match_id: S.match.id, player_id: null, unit_type: 'ruin', count: 0, x, y });
      ruins++;
    }
  }

  await sb.from('buildings').delete().eq('match_id', S.match.id);
  await sb.from('armies').delete().eq('match_id', S.match.id);
  await sb.from('buildings').insert(buildingRows);
  await sb.from('armies').insert(armyRows);
  const terrStr = M.encodeTerritory(territory);
  await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: 0, owners_data: terrStr });
  const { error } = await sb.from('matches').update({ status: 'running', territory: terrStr, winner_id: null }).eq('id', S.match.id);
  if (error) return toast('Start fehlgeschlagen: ' + error.message, 'err');
  S.territory.set(territory);
  S.territoryLoaded = true;
  await sysChat('📜 Das Zeitalter der Königreiche beginnt! Erobert 70% der Welt, um zu siegen.');
  await fullReload();
}

// ---------------------------------------------------------------------------
// SPIEL-ANSICHT STARTEN
// ---------------------------------------------------------------------------
function showGame() {
  showScreen('screen-game');
  S.inGame = true;
  S.lastSnapshot = now();
  S.lastExpand = now();
  S.lastEvent = now();
  resizeCanvas();
  centerOnCapital();
  S.camV = { x: 19 * VTILE + 16, y: 19 * VTILE + 16, z: 1 };
  centerVillageCam();
  setView('world');
  updateBanners();
  updatePvpBanner();
  renderPanel();
  S.timers.push(setInterval(clientTick, 2000));
  S.timers.push(setInterval(authorityTick, 1000));
  S.timers.push(setInterval(computeVisibility, 500));
  S.timers.push(setInterval(updateHud, 500));
  S.timers.push(setInterval(updatePvpBanner, 10000));
  S.timers.push(setInterval(() => {
    const a = document.activeElement;
    if (!a || !$('panel').contains(a) || a.tagName === 'BUTTON') renderPanel();
  }, 1500));
  computeVisibility();
  if (!S.rafRunning) {
    S.rafRunning = true;
    requestAnimationFrame(frame);
  }
}

function centerOnCapital() {
  const c = $('game-canvas');
  const z = S.camW.z;
  const cx = S.me?.capital_x ?? 50;
  const cy = S.me?.capital_y ?? 50;
  S.camW.x = cx * TILE + TILE / 2 - c.width / 2 / z;
  S.camW.y = cy * TILE + TILE / 2 - c.height / 2 / z;
}
function centerVillageCam() {
  const c = $('game-canvas');
  S.camV.z = clamp(Math.min(c.width, c.height) / (VSIZE * VTILE) * 1.6, 0.5, 2);
  S.camV.x = 20 * VTILE - c.width / 2 / S.camV.z;
  S.camV.y = 20 * VTILE - c.height / 2 / S.camV.z;
}

function resizeCanvas() {
  const wrap = $('canvas-wrap');
  const c = $('game-canvas');
  c.width = Math.max(200, wrap.clientWidth);
  c.height = Math.max(200, wrap.clientHeight);
}

function setView(v) {
  S.view = v;
  $('btn-view').textContent = v === 'world' ? '🏘️ Dorf' : '🌍 Weltkarte';
  if (v === 'world') S.buildType = null;
  else S.bridgeMode = false;
  updateModeHint();
  renderPanel();
}

function updateModeHint() {
  const el = $('mode-hint');
  let txt = '';
  if (S.view === 'village' && S.buildType) txt = `🔨 ${BUILDINGS[S.buildType].name} platzieren – Rechtsklick/Esc zum Abbrechen`;
  else if (S.view === 'world' && S.bridgeMode) txt = '🌉 Wasser-Tile neben deinem Gebiet anklicken – Esc zum Abbrechen';
  else if (S.view === 'world' && S.selectedArmyId) txt = '⚔️ Ziel-Tile anklicken, um die Armee zu schicken';
  el.textContent = txt;
  el.hidden = !txt;
}

function updateBanners() {
  const gb = $('global-banner');
  if (!S.match) return;
  gb.textContent = S.match.global_banner || '';
  gb.hidden = !S.match.global_banner;
  $('btn-admin').hidden = !isAdmin();
  $('paused-overlay').hidden = S.match.status !== 'paused';
}

function updateHud() {
  const me = S.me;
  if (!me || !S.match) return;
  $('res-wood').textContent = fmt(me.wood);
  $('res-stone').textContent = fmt(me.stone);
  $('res-gold').textContent = fmt(me.gold);
  $('res-raw').textContent = fmt(me.raw_food);
  $('res-bread').textContent = fmt(me.bread);
  $('res-pop').textContent = `${me.population}/${popCap()}`;
  $('res-morale').textContent = me.morale;
  $('res-territory').textContent = `${(me.territory_percent || 0).toFixed(1)}%`;
  $('res-age').textContent = `🏛️ ${AGE_NAMES[me.age]}`;
  $('res-season').textContent = `${S.match.season === 'winter' ? '❄️ Winter' : '☀️ Sommer'} · ${speed()}x`;
  $('res-raw').parentElement.classList.toggle('low', me.raw_food + me.bread <= 20);
  $('res-morale').parentElement.classList.toggle('low', me.morale < 30);
}

// ---------------------------------------------------------------------------
// WIRTSCHAFT (jeder Client simuliert sein eigenes Dorf)
// ---------------------------------------------------------------------------
const myBuildings = (layer = 'village') => (S.me ? S.buildings.filter((b) => b.player_id === S.me.id && b.layer === layer) : []);
const countDone = (type, player = S.me) =>
  player ? S.buildings.filter((b) => b.player_id === player.id && b.type === type && b.layer === 'village' && isDone(b)).length : 0;
const popCap = () => 5 + 5 * countDone('house');

function assignWorkers() {
  const assigned = new Map();
  const villagers = [];
  let free = S.me ? S.me.population : 0;
  const prodBuildings = myBuildings()
    .filter((b) => BUILDINGS[b.type]?.workers && isDone(b))
    .sort((a, b) => new Date(a.construction_end_at) - new Date(b.construction_end_at));
  for (const b of prodBuildings) {
    const n = Math.min(free, BUILDINGS[b.type].workers);
    assigned.set(b.id, n);
    for (let i = 0; i < n; i++) villagers.push(b);
    free -= n;
  }
  for (let i = 0; i < free; i++) villagers.push(null);
  return { assigned, villagers };
}

function countMyTerrain(type) {
  if (!S.me || !S.terrain) return 0;
  let c = 0;
  for (let i = 0; i < M.N; i++) if (S.territory[i] === S.me.slot && S.terrain[i] === type) c++;
  return c;
}

function estimateRates() {
  const me = S.me;
  if (!me) return {};
  const food = me.raw_food + me.bread;
  const mf = (food <= 0 ? 0.5 : 1) * (0.6 + me.morale / 250);
  const { assigned } = assignWorkers();
  const d = { wood: 0, stone: 0, gold: 0, raw_food: 0, bread: 0 };
  const goldBonus = 1 + Math.min(1, countMyTerrain(M.T.GOLD) * 0.05);
  for (const b of myBuildings()) {
    const def = BUILDINGS[b.type];
    if (!def || !isDone(b) || b.on_fire) continue;
    const staff = (assigned.get(b.id) || 0) / (def.workers || 1);
    if (def.prod) {
      for (const k in def.prod) d[k] += def.prod[k] * staff * mf * (k === 'gold' ? goldBonus : 1);
    }
    if (b.type === 'bakery') {
      d.raw_food -= 0.8 * staff * mf;
      d.bread += 0.8 * staff * mf;
    }
  }
  const consumption = me.population * 0.05 * (S.match?.season === 'winter' ? 2 : 1);
  return { d, consumption, mf };
}

async function clientTick() {
  const me = S.me;
  if (!me || !S.match || S.match.status !== 'running' || me.is_eliminated) return;
  const dt = 2 * speed();
  const { d: rate, consumption } = estimateRates();
  const d = {};
  for (const k in rate) d[k] = rate[k] * dt;

  // Bäckerei kann nur vorhandene Rohnahrung verarbeiten
  if (d.bread > 0 && me.raw_food + d.raw_food < 0) {
    const missing = -(me.raw_food + d.raw_food);
    d.bread = Math.max(0, d.bread - missing);
    d.raw_food += missing;
  }

  // Verbrauch: erst Rohnahrung, dann Brot
  let need = consumption * dt;
  const fromRaw = Math.min(Math.max(0, me.raw_food + d.raw_food), need);
  d.raw_food -= fromRaw;
  need -= fromRaw;
  const fromBread = Math.min(Math.max(0, me.bread + d.bread), need);
  d.bread -= fromBread;
  need -= fromBread;

  // Verderb ohne Kornspeicher
  if (countDone('granary') === 0) d.raw_food -= Math.max(0, me.raw_food) * 0.004 * dt;

  // Moral
  let morale = me.morale;
  const foodAfter = me.raw_food + me.bread + d.raw_food + d.bread;
  if (need > 0.01 || foodAfter <= 0.5) morale -= 1 * dt;
  else {
    if (me.bread > 0) morale += 0.25 * dt;
    morale += countDone('tavern') * 0.1 * dt;
    if (me.bread <= 0 && morale > 70) morale -= 0.15 * dt;
    if (morale < 55) morale += 0.1 * dt;
  }
  morale = Math.round(clamp(morale, 0, 100));

  // Bevölkerung
  const cap = popCap();
  let pop = me.population;
  if (foodAfter > 5 && pop < cap) {
    S.popAcc += (dt / 15) * Math.max(0.3, morale / 80);
    if (S.popAcc >= 1) {
      pop += 1;
      S.popAcc -= 1;
    }
  } else if (foodAfter <= 0.5 && pop > 3) {
    S.popAcc -= dt / 30;
    if (S.popAcc <= -1) {
      pop -= 1;
      S.popAcc += 1;
    }
  }
  pop = Math.min(pop, cap);

  // Ganzzahlige Deltas an die Datenbank (Rest wird angespart)
  const ints = {};
  let any = false;
  for (const k of ['wood', 'stone', 'gold', 'raw_food', 'bread']) {
    S.acc[k] += d[k] || 0;
    ints[k] = Math.trunc(S.acc[k]);
    S.acc[k] -= ints[k];
    if (ints[k] !== 0) any = true;
  }
  if (any) {
    await rpcAdd(me.id, ints, true);
    for (const k in ints) me[k] = Math.max(0, me[k] + ints[k]);
  }
  if (morale !== me.morale || pop !== me.population) {
    me.morale = morale;
    me.population = pop;
    await sb.from('match_players').update({ morale, population: pop }).eq('id', me.id);
  }

  await handleFires(dt);

  if (S.exploredDirty && now() - S.lastExploredSave > 15000) {
    S.lastExploredSave = now();
    S.exploredDirty = false;
    await sb.from('match_players').update({ explored_tiles: M.encodeBits(S.explored) }).eq('id', me.id);
  }
}

async function handleFires(dt) {
  const hasWell = countDone('well') > 0;
  for (const b of myBuildings().filter((x) => x.on_fire)) {
    if (hasWell) {
      if (!S.fireSeen[b.id]) S.fireSeen[b.id] = now();
      else if (now() - S.fireSeen[b.id] > 5000) {
        delete S.fireSeen[b.id];
        b.on_fire = false;
        b.hp = 100;
        await sb.from('buildings').update({ on_fire: false, hp: 100 }).eq('id', b.id);
        toast(`💧 Dorfbewohner haben den Brand (${BUILDINGS[b.type]?.name}) gelöscht!`, 'ok');
      }
    } else {
      b.hp = Math.round(b.hp - 3 * dt);
      if (b.hp <= 0) {
        await sb.from('buildings').delete().eq('id', b.id);
        S.buildings = S.buildings.filter((x) => x.id !== b.id);
        toast(`🔥 ${BUILDINGS[b.type]?.name} ist abgebrannt! Baue einen Brunnen!`, 'err');
        playSfx('fire');
      } else {
        await sb.from('buildings').update({ hp: b.hp }).eq('id', b.id);
      }
    }
  }
}

async function rpcAdd(playerId, d, clampMode) {
  const { data, error } = await sb.rpc('add_resources', {
    p_player: playerId,
    d_wood: Math.round(d.wood || 0),
    d_stone: Math.round(d.stone || 0),
    d_gold: Math.round(d.gold || 0),
    d_raw: Math.round(d.raw_food || 0),
    d_bread: Math.round(d.bread || 0),
    p_clamp: Boolean(clampMode)
  });
  if (error) {
    console.warn('add_resources', error);
    return false;
  }
  return data === true;
}

async function spend(cost, mult = 1) {
  const me = S.me;
  const neg = {};
  for (const k in cost) {
    const v = cost[k] * mult;
    if ((me[k] || 0) < v) {
      toast(`Nicht genug ${RES_NAME[k]}! (${fmt(me[k])}/${v})`, 'err');
      return false;
    }
    neg[k] = -v;
  }
  if (!Object.keys(neg).length) return true;
  const ok = await rpcAdd(me.id, neg, false);
  if (!ok) {
    toast('Nicht genug Ressourcen!', 'err');
    return false;
  }
  for (const k in neg) me[k] += neg[k];
  return true;
}

async function sysChat(message) {
  if (!S.match) return;
  await sb.from('chat_messages').insert({ match_id: S.match.id, player_id: null, sender_name: '📜 Chronik', message });
}

// ---------------------------------------------------------------------------
// AKTIONEN: Bauen, Zeitalter, Truppen, Brücken
// ---------------------------------------------------------------------------
async function placeBuilding(type, x, y) {
  const key = `${x},${y}`;
  if (S.placing.has(key)) return;
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if (x < 0 || y < 0 || x >= VSIZE || y >= VSIZE) return;
  if (myBuildings().some((b) => b.x === x && b.y === y)) return;
  const def = BUILDINGS[type];
  S.placing.add(key);
  try {
    if (!(await spend(def.cost))) {
      S.buildType = type === 'wall' ? S.buildType : null;
      return;
    }
    const end = new Date(now() + (def.time * 1000) / speed()).toISOString();
    const { data, error } = await sb
      .from('buildings')
      .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'village', type, x, y, hp: 100, construction_end_at: end })
      .select()
      .single();
    if (error) {
      await rpcAdd(S.me.id, def.cost, true);
      return toast(error.message, 'err');
    }
    S.buildings.push(data);
    playSfx('build');
  } finally {
    S.placing.delete(key);
  }
}

async function demolish(b) {
  if (b.type === 'castle') return toast('Die Burg kann nicht abgerissen werden.', 'err');
  if (!confirm(`${BUILDINGS[b.type]?.name} abreißen? (50% Rückerstattung)`)) return;
  await sb.from('buildings').delete().eq('id', b.id);
  S.buildings = S.buildings.filter((x) => x.id !== b.id);
  const refund = {};
  for (const k in BUILDINGS[b.type].cost) refund[k] = Math.floor(BUILDINGS[b.type].cost[k] / 2);
  await rpcAdd(S.me.id, refund, true);
  S.selectedBuildingId = null;
  playSfx('build');
  renderPanel();
}

async function ageUp() {
  const me = S.me;
  if (me.age >= 4) return;
  if (countDone('blacksmith') === 0) return toast('Du brauchst eine fertige Schmiede!', 'err');
  if (!(await spend(AGE_COST[me.age + 1]))) return;
  me.age += 1;
  await sb.from('match_players').update({ age: me.age }).eq('id', me.id);
  playSfx('horn');
  toast(`🏛️ Neues Zeitalter: ${AGE_NAMES[me.age]}!`, 'ok');
  await sysChat(`🏛️ ${me.kingdom_name} erreicht die ${AGE_NAMES[me.age]}!`);
  renderPanel();
}

async function trainUnits(type) {
  const me = S.me;
  const u = UNITS[type];
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if (countDone('barracks') === 0) return toast('Du brauchst eine fertige Kaserne!', 'err');
  if (me.age < u.age) return toast(`Benötigt ${AGE_NAMES[u.age]}.`, 'err');
  if (me.capital_x == null) return toast('Keine Hauptstadt.', 'err');
  if (!(await spend(u.cost, BATCH))) return;
  const home = S.armies.find((a) => a.player_id === me.id && a.unit_type === type && a.target_x == null && a.x === me.capital_x && a.y === me.capital_y);
  if (home) {
    home.count += BATCH;
    await sb.from('armies').update({ count: home.count }).eq('id', home.id);
  } else {
    const { data } = await sb
      .from('armies')
      .insert({ match_id: S.match.id, player_id: me.id, unit_type: type, count: BATCH, x: me.capital_x, y: me.capital_y })
      .select()
      .single();
    if (data) S.armies.push(data);
  }
  playSfx('build');
  toast(`${BATCH}× ${u.name} ausgebildet!`, 'ok');
  renderPanel();
}

async function buildBridge(x, y) {
  const i = M.idx(x, y);
  if (S.terrain[i] !== M.T.WATER) return toast('Brücken nur auf Wasser!', 'err');
  if (S.bridges.has(i)) return toast('Hier ist schon eine Brücke.', 'err');
  let adj = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (!M.inBounds(nx, ny)) continue;
    const ni = M.idx(nx, ny);
    if (S.territory[ni] === S.me.slot || S.bridges.has(ni)) adj = true;
  }
  if (!adj) return toast('Brücke muss an dein Gebiet oder eine Brücke grenzen.', 'err');
  if (!(await spend({ wood: 60, stone: 20 }))) return;
  const { data } = await sb
    .from('buildings')
    .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'world', type: 'bridge', x, y, construction_end_at: new Date().toISOString() })
    .select()
    .single();
  if (data) {
    S.buildings.push(data);
    S.bridges.add(i);
  }
  playSfx('build');
}

function travelMs(unitType, x0, y0, x1, y1) {
  const spt = UNITS[unitType]?.speed || 2;
  return (Math.hypot(x1 - x0, y1 - y0) * spt * 1000) / speed();
}

function armyPos(a) {
  if (a.target_x == null || !a.arrives_at) return { x: a.x, y: a.y, moving: false };
  const arr = new Date(a.arrives_at).getTime();
  const dur = Math.max(1, travelMs(a.unit_type, a.x, a.y, a.target_x, a.target_y));
  const t = clamp(1 - (arr - now()) / dur, 0, 1);
  return { x: a.x + (a.target_x - a.x) * t, y: a.y + (a.target_y - a.y) * t, moving: true };
}

async function moveArmy(a, tx, ty) {
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if (a.target_x != null) return toast('Diese Armee ist bereits unterwegs.', 'err');
  if (a.x === tx && a.y === ty) return;
  const path = M.checkPath(S.terrain, S.bridges, a.x, a.y, tx, ty, a.unit_type);
  if (!path.ok) return toast(path.reason, 'err');
  const owner = S.territory[M.idx(tx, ty)];
  const ownerP = owner >= 0 ? playerBySlot(owner) : null;
  const enemyArmy = S.armies.find((e) => e.player_id && e.player_id !== a.player_id && e.target_x == null && Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 1 && !allied(e.player_id, a.player_id));
  const attacksPlayer = (ownerP && ownerP.id !== S.me.id && !allied(ownerP.id, S.me.id)) || enemyArmy;
  if (attacksPlayer && !pvpAllowed()) return toast('🕊️ Freizeit-Frieden! Angriffe auf Spieler sind gerade gesperrt.', 'err');
  if (ownerP && allied(ownerP.id, S.me.id) && ownerP.id !== S.me.id) toast('Verbündetes Gebiet – kein Angriff.');
  const arrives = new Date(now() + travelMs(a.unit_type, a.x, a.y, tx, ty)).toISOString();
  a.target_x = tx;
  a.target_y = ty;
  a.arrives_at = arrives;
  await sb.from('armies').update({ target_x: tx, target_y: ty, arrives_at: arrives }).eq('id', a.id);
  playSfx(attacksPlayer ? 'horn' : 'click');
  S.selectedArmyId = null;
  updateModeHint();
  renderPanel();
}

async function splitArmy(a) {
  if (a.count < 2 || a.target_x != null) return;
  const half = Math.floor(a.count / 2);
  a.count -= half;
  await sb.from('armies').update({ count: a.count }).eq('id', a.id);
  const { data } = await sb
    .from('armies')
    .insert({ match_id: S.match.id, player_id: a.player_id, unit_type: a.unit_type, count: half, x: a.x, y: a.y })
    .select()
    .single();
  if (data) S.armies.push(data);
  playSfx('click');
  renderPanel();
}

async function mergeArmies(a) {
  const others = S.armies.filter((o) => o.id !== a.id && o.player_id === a.player_id && o.unit_type === a.unit_type && o.target_x == null && o.x === a.x && o.y === a.y);
  if (!others.length) return toast('Keine gleiche Armee auf diesem Feld.', 'err');
  let total = a.count;
  for (const o of others) {
    total += o.count;
    await sb.from('armies').delete().eq('id', o.id);
  }
  a.count = total;
  await sb.from('armies').update({ count: total }).eq('id', a.id);
  S.armies = S.armies.filter((o) => !others.includes(o));
  playSfx('click');
  renderPanel();
}

// ---------------------------------------------------------------------------
// DIPLOMATIE, HANDEL, SPIONAGE
// ---------------------------------------------------------------------------
async function setAlliance(name) {
  const alliance = name.trim().slice(0, 20);
  await sb.from('match_players').update({ alliance }).eq('id', S.me.id);
  S.me.alliance = alliance;
  playSfx('coins');
  toast(alliance ? `🤝 Allianz „${alliance}“ beigetreten` : 'Allianz verlassen', 'ok');
  if (alliance) await sysChat(`🤝 ${S.me.kingdom_name} tritt der Allianz „${alliance}“ bei.`);
  reloadPlayers();
}

async function sendSpy(p) {
  if (S.me.age < 2) return toast('Spione benötigen die Feudalzeit.', 'err');
  if (countDone('tavern') === 0) return toast('Spione werden in der Taverne angeworben.', 'err');
  if (!(await spend({ gold: 30 }))) return;
  S.spied[p.id] = now() + 120000;
  playSfx('coins');
  toast(`🕵️ Spion hat ${p.kingdom_name} ausgekundschaftet (2 Min.)`, 'ok');
  renderPanel();
}

async function marketTrade(res, mode) {
  if (countDone('market') === 0) return toast('Du brauchst einen fertigen Marktplatz.', 'err');
  if (mode === 'sell') {
    if (!(await spend({ [res]: 100 }))) return;
    await rpcAdd(S.me.id, { gold: 30 }, true);
    S.me.gold += 30;
  } else {
    if (!(await spend({ gold: 50 }))) return;
    await rpcAdd(S.me.id, { [res]: 100 }, true);
    S.me[res] += 100;
  }
  playSfx('coins');
}

async function sendResources(p, res, amount) {
  if (countDone('market') === 0) return toast('Du brauchst einen fertigen Marktplatz.', 'err');
  amount = Math.floor(amount);
  if (!(amount > 0)) return;
  if (!(await spend({ [res]: amount }))) return;
  await rpcAdd(p.id, { [res]: amount }, true);
  playSfx('coins');
  toast(`📦 ${amount} ${RES_NAME[res]} an ${p.kingdom_name} gesendet`, 'ok');
  await sysChat(`📦 ${S.me.kingdom_name} schickt ${amount} ${RES_NAME[res]} an ${p.kingdom_name}.`);
}

async function sendChat(text) {
  const message = text.trim().slice(0, 200);
  if (!message || !S.match || !S.me) return;
  await sb.from('chat_messages').insert({ match_id: S.match.id, player_id: S.me.id, sender_name: S.me.kingdom_name, message });
  reloadChat();
}

function renderChat() {
  const html = S.chat
    .map((m) => {
      const t = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const p = playerById(m.player_id);
      const color = p ? p.color : '#9fc6e8';
      return m.player_id
        ? `<div class="msg"><time>${t}</time><b style="color:${color}">${esc(m.sender_name)}:</b> ${esc(m.message)}</div>`
        : `<div class="msg sys"><time>${t}</time>${esc(m.message)}</div>`;
    })
    .join('');
  for (const id of ['chat-log', 'lobby-chat-log']) {
    const el = $(id);
    if (!el) continue;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = html;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// AUTHORITY (ein Client berechnet Kämpfe, Ausbreitung, Events & Sieg)
// ---------------------------------------------------------------------------
function amAuthority() {
  if (!S.match || !S.user) return false;
  const members = new Set(S.players.map((p) => p.user_id));
  const online = S.online.filter((id) => members.has(id));
  if (online.length === 0) return S.user.id === S.match.host_id;
  if (online.includes(S.match.host_id)) return S.user.id === S.match.host_id;
  return [...online].sort()[0] === S.user.id;
}

async function authorityTick() {
  if (S.authBusy || !S.match || S.match.status !== 'running' || !amAuthority() || !S.terrain) return;
  S.authBusy = true;
  try {
    if (!S.territoryLoaded) applyMatchTerritory(true);
    const t = now();
    const sp = speed();
    const arrived = S.armies.filter((a) => a.target_x != null && a.arrives_at && new Date(a.arrives_at).getTime() <= t);
    for (const a of arrived) {
      if (S.armies.includes(a)) await resolveArrival(a);
    }
    if (t - S.lastExpand > 4000 / sp) {
      S.lastExpand = t;
      passiveExpand();
    }
    if (S.territoryDirty && t - S.lastTerritoryWrite > 2000) await writeTerritory();
    if (t - S.lastSnapshot > 60000) {
      S.lastSnapshot = t;
      await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: Math.floor(t / 1000), owners_data: M.encodeTerritory(S.territory) });
    }
    if (t - S.lastEvent > 150000 / sp) {
      S.lastEvent = t;
      await randomEvent();
    }
    if (t - S.lastBanditCheck > 30000) {
      S.lastBanditCheck = t;
      await maintainBandits();
    }
  } catch (e) {
    console.warn('authorityTick', e);
  } finally {
    S.authBusy = false;
  }
}

function towersOf(p) {
  return countDone('tower', p);
}
function defenseOf(p) {
  return countDone('wall', p) * 0.2 + countDone('gate', p) * 0.5 + countDone('tower', p) * 2;
}

function armyPower(a, x, y) {
  const u = UNITS[a.unit_type];
  let pw = (u ? u.power : a.unit_type === 'bandit' ? 8 : 0) * a.count;
  const tile = S.terrain[M.idx(x, y)];
  if (a.unit_type === 'archer' && tile === M.T.HILL) pw *= 1.5;
  if (!a.player_id && tile === M.T.FOREST) pw *= 1.15;
  const p = playerById(a.player_id);
  if (p) {
    pw *= 0.75 + p.morale / 400;
    if (S.territory[M.idx(x, y)] === p.slot) pw *= 1 + Math.min(0.5, towersOf(p) * 0.05);
  }
  return pw;
}

function fight(att, def) {
  const ap = armyPower(att, att.x, att.y);
  const dp = armyPower(def, def.x, def.y);
  if (dp <= 0) return { attackerWins: true, remaining: att.count };
  if (ap <= 0) return { attackerWins: false, remaining: def.count };
  if (ap >= dp) return { attackerWins: true, remaining: Math.max(1, Math.ceil(att.count * (1 - (dp / ap) * 0.8))) };
  return { attackerWins: false, remaining: Math.max(1, Math.ceil(def.count * (1 - (ap / dp) * 0.8))) };
}

async function updateArmy(a, patch) {
  Object.assign(a, patch);
  await sb.from('armies').update(patch).eq('id', a.id);
}
async function deleteArmy(a) {
  S.armies = S.armies.filter((x) => x.id !== a.id);
  await sb.from('armies').delete().eq('id', a.id);
}

async function resolveArrival(a) {
  const tx = a.target_x;
  const ty = a.target_y;
  const pvp = pvpAllowed();
  const attacker = playerById(a.player_id);
  let count = a.count;
  const foes = S.armies.filter(
    (e) => e.id !== a.id && e.target_x == null && Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 1 &&
      e.player_id !== a.player_id && !allied(e.player_id, a.player_id)
  );
  for (const e of foes) {
    if (a.player_id && e.player_id && !pvp) continue;
    if (!a.player_id && !e.player_id) continue;
    const res = fight({ ...a, count, x: tx, y: ty }, e);
    const defender = playerById(e.player_id);
    if (res.attackerWins) {
      count = res.remaining;
      await deleteArmy(e);
      if (!e.player_id && attacker) await grantLoot(attacker, e);
      else if (defender) await sysChat(`⚔️ ${attacker ? attacker.kingdom_name : 'Barbaren'} besiegt eine Armee von ${defender.kingdom_name}!`);
    } else {
      await updateArmy(e, { count: res.remaining });
      await deleteArmy(a);
      if (attacker) await sysChat(`🛡️ Die Armee von ${attacker.kingdom_name} wurde ${defender ? 'von ' + defender.kingdom_name : 'von Banditen'} geschlagen!`);
      return;
    }
  }
  await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
  if (attacker) {
    conquer(tx, ty, Math.min(4, 1 + Math.floor(count / 15)), attacker, pvp);
  } else {
    // Barbaren plündern
    const owner = S.territory[M.idx(tx, ty)];
    const victim = owner >= 0 ? playerBySlot(owner) : null;
    if (victim) {
      const loss = Math.round(Math.max(10, 70 - defenseOf(victim) * 5));
      await rpcAdd(victim.id, { gold: -loss, wood: -loss, raw_food: -loss }, true);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (M.inBounds(tx + dx, ty + dy) && S.territory[M.idx(tx + dx, ty + dy)] === victim.slot) {
            S.territory[M.idx(tx + dx, ty + dy)] = -1;
          }
        }
      }
      S.territoryDirty = true;
      S.territoryVersion++;
      await sysChat(`🔥 Barbaren plündern ${victim.kingdom_name} (-${loss} Gold/Holz/Nahrung)!`);
    }
  }
}

async function grantLoot(p, e) {
  const ruin = e.unit_type === 'ruin';
  const gold = ruin ? 80 + Math.floor(Math.random() * 70) : 30 + e.count * 4;
  const loot = ruin ? { gold, wood: 40, stone: 40 } : { gold, raw_food: 30 };
  await rpcAdd(p.id, loot, true);
  await sysChat(`💰 ${p.kingdom_name} plündert ${ruin ? 'eine Ruine' : 'ein Banditenlager'} (+${gold} Gold)!`);
}

function conquer(tx, ty, R, p, pvp) {
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R + 0.5) continue;
      const x = tx + dx;
      const y = ty + dy;
      if (!M.inBounds(x, y)) continue;
      const i = M.idx(x, y);
      if (!M.isLand(S.terrain[i])) continue;
      const owner = S.territory[i];
      if (owner === p.slot) continue;
      if (owner === -1) S.territory[i] = p.slot;
      else {
        const op = playerBySlot(owner);
        if (pvp && (!op || !allied(op.id, p.id))) S.territory[i] = p.slot;
      }
    }
  }
  S.territoryDirty = true;
  S.territoryVersion++;
}

function passiveExpand() {
  const cand = new Map();
  const t = S.terrain;
  const terr = S.territory;
  for (let y = 0; y < M.H; y++) {
    for (let x = 0; x < M.W; x++) {
      const i = M.idx(x, y);
      if (terr[i] !== -1 || !M.isPassable(t[i])) continue;
      const seen = new Set();
      if (x > 0 && terr[i - 1] >= 0) seen.add(terr[i - 1]);
      if (x < M.W - 1 && terr[i + 1] >= 0) seen.add(terr[i + 1]);
      if (y > 0 && terr[i - M.W] >= 0) seen.add(terr[i - M.W]);
      if (y < M.H - 1 && terr[i + M.W] >= 0) seen.add(terr[i + M.W]);
      for (const s of seen) {
        if (!cand.has(s)) cand.set(s, []);
        cand.get(s).push(i);
      }
    }
  }
  let changed = false;
  for (const p of S.players) {
    if (p.is_eliminated || p.morale <= 25) continue;
    const arr = cand.get(p.slot);
    if (!arr || !arr.length) continue;
    const n = 2 + Math.floor(p.population / 8);
    for (let k = 0; k < n && arr.length; k++) {
      const j = Math.floor(Math.random() * arr.length);
      const i = arr.splice(j, 1)[0];
      if (terr[i] === -1) {
        terr[i] = p.slot;
        changed = true;
      }
    }
  }
  if (changed) {
    S.territoryDirty = true;
    S.territoryVersion++;
  }
}

async function writeTerritory() {
  S.lastTerritoryWrite = now();
  S.territoryDirty = false;
  const str = M.encodeTerritory(S.territory);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < M.N; i++) if (S.territory[i] >= 0) counts[S.territory[i]]++;
  await sb.from('matches').update({ territory: str }).eq('id', S.match.id);
  S.match.territory = str;
  const startedLongAgo = now() - new Date(S.match.created_at).getTime() > 30000;
  for (const p of S.players) {
    const pct = Math.round((counts[p.slot] / S.landTotal) * 1000) / 10;
    const patch = {};
    if (Math.abs(pct - (p.territory_percent || 0)) >= 0.1) patch.territory_percent = pct;
    if (counts[p.slot] === 0 && !p.is_eliminated && startedLongAgo && p.capital_x != null) {
      patch.is_eliminated = true;
      await sysChat(`☠️ ${p.kingdom_name} wurde vernichtet!`);
    }
    if (Object.keys(patch).length) {
      Object.assign(p, patch);
      await sb.from('match_players').update(patch).eq('id', p.id);
    }
    if (pct >= 70 && S.match.status === 'running') {
      await endMatch(p, str);
      return;
    }
  }
}

async function endMatch(p, terrStr) {
  await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: Math.floor(now() / 1000), owners_data: terrStr });
  await sb.from('matches').update({ status: 'finished', winner_id: p.user_id }).eq('id', S.match.id);
  const { data: prof } = await sb.from('profiles').select('wins').eq('id', p.user_id).maybeSingle();
  if (prof) await sb.from('profiles').update({ wins: (prof.wins || 0) + 1 }).eq('id', p.user_id);
  await sysChat(`👑 ${p.kingdom_name} hat 70% der Welt erobert und das Spiel gewonnen!`);
  await reloadMatch();
}

async function randomEvent() {
  const r = Math.random();
  if (r < 0.45) {
    await triggerFire(1);
  } else if (r < 0.75) {
    const season = S.match.season === 'summer' ? 'winter' : 'summer';
    await sb.from('matches').update({ season }).eq('id', S.match.id);
    await sysChat(season === 'winter' ? '❄️ Der Winter bricht herein – doppelter Nahrungsverbrauch!' : '☀️ Der Frühling kommt, der Schnee schmilzt.');
  } else {
    await spawnBarbarians();
  }
}

/** Setzt bei `perPlayer`-vielen zufälligen Spielern ein Gebäude in Brand. */
async function triggerFire(playerCount = 1, all = false) {
  const victims = S.players.filter((p) => !p.is_eliminated).sort(() => Math.random() - 0.5);
  const chosen = all ? victims : victims.slice(0, playerCount);
  for (const p of chosen) {
    const options = S.buildings.filter((b) => b.player_id === p.id && b.layer === 'village' && isDone(b) && !b.on_fire && !['castle', 'wall', 'gate', 'tower', 'well'].includes(b.type));
    if (!options.length) continue;
    const b = options[Math.floor(Math.random() * options.length)];
    b.on_fire = true;
    await sb.from('buildings').update({ on_fire: true }).eq('id', b.id);
    await sysChat(`🔥 Feuer! In ${p.kingdom_name} brennt ein Gebäude (${BUILDINGS[b.type]?.name}).`);
  }
}

async function spawnBarbarians() {
  const sp = speed();
  const rows = [];
  for (const p of S.players) {
    if (p.is_eliminated || p.capital_x == null) continue;
    for (let tries = 0; tries < 80; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 9 + Math.random() * 5;
      const x = Math.round(p.capital_x + Math.cos(ang) * dist);
      const y = Math.round(p.capital_y + Math.sin(ang) * dist);
      if (!M.inBounds(x, y) || !M.isPassable(S.terrain[M.idx(x, y)])) continue;
      rows.push({
        match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 8 + p.age * 6, x, y,
        target_x: p.capital_x, target_y: p.capital_y,
        arrives_at: new Date(now() + (Math.hypot(x - p.capital_x, y - p.capital_y) * 2000) / sp).toISOString()
      });
      break;
    }
  }
  if (rows.length) {
    await sb.from('armies').insert(rows);
    await sysChat('🪓 BARBAREN-ANGRIFF! Horden marschieren auf die Hauptstädte zu!');
    await reloadArmies();
  }
}

async function maintainBandits() {
  const camps = S.armies.filter((a) => !a.player_id && a.unit_type === 'bandit' && a.target_x == null).length;
  if (camps >= 6) return;
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.floor(Math.random() * M.W);
    const y = Math.floor(Math.random() * M.H);
    const i = M.idx(x, y);
    if (!M.isPassable(S.terrain[i]) || S.territory[i] !== -1) continue;
    await sb.from('armies').insert({ match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 8 + Math.floor(Math.random() * 15), x, y });
    return;
  }
}

// ---------------------------------------------------------------------------
// FOG OF WAR
// ---------------------------------------------------------------------------
function computeVisibility() {
  if (!S.me || !S.terrain) return;
  const vis = S.visible;
  if (S.fogOff || S.match?.status === 'finished') {
    vis.fill(1);
  } else {
    vis.fill(0);
    const friendly = new Set(S.players.filter((p) => p.id === S.me.id || allied(p.id, S.me.id)).map((p) => p.slot));
    const mark = (cx, cy, r) => {
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= M.H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x >= 0 && x < M.W) vis[y * M.W + x] = 1;
        }
      }
    };
    for (let i = 0; i < M.N; i++) if (friendly.has(S.territory[i])) mark(i % M.W, Math.floor(i / M.W), 2);
    for (const a of S.armies) {
      if (!a.player_id || !allied(a.player_id, S.me.id)) continue;
      const p = armyPos(a);
      mark(Math.round(p.x), Math.round(p.y), 4);
    }
    if (S.me.capital_x != null) mark(S.me.capital_x, S.me.capital_y, 5);
  }
  for (let i = 0; i < M.N; i++) {
    if (vis[i] && !S.explored[i]) {
      S.explored[i] = 1;
      S.exploredDirty = true;
    }
  }
  S.fogVersion++;
}

// ---------------------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------------------
function frame() {
  if (!S.inGame) {
    S.rafRunning = false;
    return;
  }
  try {
    render();
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(frame);
}

function getTerrainCanvas() {
  const season = S.match?.season || 'summer';
  if (!S.terrainCanvases[season]) {
    const c = document.createElement('canvas');
    c.width = M.W * TILE;
    c.height = M.H * TILE;
    const ctx = c.getContext('2d');
    for (let i = 0; i < M.N; i++) {
      ctx.drawImage(getTerrainSprite(M.TERRAIN_KEYS[S.terrain[i]], season), (i % M.W) * TILE, Math.floor(i / M.W) * TILE);
    }
    S.terrainCanvases[season] = c;
  }
  return S.terrainCanvases[season];
}

function rebuildTerritoryCanvas() {
  if (!S.terrCanvas) {
    S.terrCanvas = document.createElement('canvas');
    S.terrCanvas.width = M.W;
    S.terrCanvas.height = M.H;
  }
  const ctx = S.terrCanvas.getContext('2d');
  const img = ctx.createImageData(M.W, M.H);
  const colors = {};
  for (const p of S.players) colors[p.slot] = hexToRgb(p.color);
  const terr = S.territory;
  for (let i = 0; i < M.N; i++) {
    const o = terr[i];
    if (o < 0) continue;
    const x = i % M.W;
    const y = Math.floor(i / M.W);
    const border =
      (x > 0 && terr[i - 1] !== o) || (x < M.W - 1 && terr[i + 1] !== o) ||
      (y > 0 && terr[i - M.W] !== o) || (y < M.H - 1 && terr[i + M.W] !== o);
    const [r, g, b] = colors[o] || hexToRgb(PLAYER_COLORS[o]);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = border ? 210 : 95;
  }
  ctx.putImageData(img, 0, 0);
  S.terrBuilt = S.territoryVersion;
}

function rebuildFogCanvas() {
  if (!S.fogCanvas) {
    S.fogCanvas = document.createElement('canvas');
    S.fogCanvas.width = M.W;
    S.fogCanvas.height = M.H;
  }
  const ctx = S.fogCanvas.getContext('2d');
  const img = ctx.createImageData(M.W, M.H);
  for (let i = 0; i < M.N; i++) {
    img.data[i * 4 + 3] = S.visible[i] ? 0 : S.explored[i] ? 140 : 255;
    img.data[i * 4] = 8;
    img.data[i * 4 + 1] = 10;
    img.data[i * 4 + 2] = 16;
  }
  ctx.putImageData(img, 0, 0);
  S.fogBuilt = S.fogVersion;
}

function render() {
  const c = $('game-canvas');
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  if (!S.terrain || !S.me) return;
  if (S.view === 'world') renderWorld(ctx);
  else renderVillage(ctx);
}

function renderWorld(ctx) {
  const cam = S.camW;
  const z = cam.z;
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  const season = S.match.season;
  ctx.drawImage(getTerrainCanvas(), 0, 0);
  for (const i of S.bridges) ctx.drawImage(getTerrainSprite('bridge', season), (i % M.W) * TILE, Math.floor(i / M.W) * TILE);

  if (S.terrBuilt !== S.territoryVersion) rebuildTerritoryCanvas();
  ctx.drawImage(S.terrCanvas, 0, 0, M.W * TILE, M.H * TILE);

  // Hauptstädte
  for (const p of S.players) {
    if (p.capital_x == null || p.is_eliminated) continue;
    const i = M.idx(p.capital_x, p.capital_y);
    if (!S.explored[i] && !S.fogOff) continue;
    ctx.fillStyle = '#000a';
    ctx.fillRect(p.capital_x * TILE - 2, p.capital_y * TILE - 2, TILE + 4, TILE + 4);
    ctx.drawImage(getEmblemSprite(p.emblem, p.color), p.capital_x * TILE, p.capital_y * TILE);
  }

  // Armeen
  const tNow = now();
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'center';
  for (const a of S.armies) {
    const pos = armyPos(a);
    const ix = Math.round(pos.x);
    const iy = Math.round(pos.y);
    if (!M.inBounds(ix, iy)) continue;
    const friendly = a.player_id && allied(a.player_id, S.me.id);
    if (!friendly && !S.visible[M.idx(ix, iy)]) continue;
    const owner = playerById(a.player_id);
    let sprite;
    if (!a.player_id) sprite = getUnitSprite(a.unit_type === 'ruin' ? 'ruin' : pos.moving ? 'bandit' : 'camp', '#7a2c2c');
    else sprite = getUnitSprite(a.unit_type, owner ? owner.color : '#888');
    const px = pos.x * TILE;
    const py = pos.y * TILE + (pos.moving ? Math.sin(tNow / 120) * 0.8 : 0);
    if (friendly && pos.moving) {
      ctx.strokeStyle = '#ffffffaa';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8);
      ctx.lineTo(a.target_x * TILE + 8, a.target_y * TILE + 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (a.id === S.selectedArmyId) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 1, py - 1, TILE + 2, TILE + 2);
    }
    ctx.drawImage(sprite, px, py);
    if (a.unit_type !== 'ruin') {
      ctx.fillStyle = '#000c';
      ctx.fillRect(px + 2, py + TILE - 1, 12, 6);
      ctx.fillStyle = owner ? '#fff' : '#ff9a8a';
      ctx.fillText(String(a.count), px + 8, py + TILE + 4);
    }
  }

  if (!S.fogOff) {
    if (S.fogBuilt !== S.fogVersion) rebuildFogCanvas();
    ctx.drawImage(S.fogCanvas, 0, 0, M.W * TILE, M.H * TILE);
  }

  if (S.hoverTile) {
    ctx.strokeStyle = S.bridgeMode ? '#4fc3f7' : '#ffffffcc';
    ctx.lineWidth = 1 / z * 1.5;
    ctx.strokeRect(S.hoverTile.x * TILE, S.hoverTile.y * TILE, TILE, TILE);
  }
}

function getVillageGround() {
  const season = S.match?.season || 'summer';
  if (!S.villageGround[season]) {
    const c = document.createElement('canvas');
    c.width = VSIZE * VTILE;
    c.height = VSIZE * VTILE;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const r = M.rng(42);
    for (let y = 0; y < VSIZE; y++) {
      for (let x = 0; x < VSIZE; x++) {
        ctx.drawImage(getTerrainSprite(r() < 0.06 ? 'hill' : 'grass', season), x * VTILE, y * VTILE, VTILE, VTILE);
      }
    }
    ctx.strokeStyle = '#00000022';
    for (let k = 0; k <= VSIZE; k++) {
      ctx.beginPath();
      ctx.moveTo(k * VTILE, 0);
      ctx.lineTo(k * VTILE, VSIZE * VTILE);
      ctx.moveTo(0, k * VTILE);
      ctx.lineTo(VSIZE * VTILE, k * VTILE);
      ctx.stroke();
    }
    S.villageGround[season] = c;
  }
  return S.villageGround[season];
}

function renderVillage(ctx) {
  const cam = S.camV;
  const z = cam.z;
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  ctx.drawImage(getVillageGround(), 0, 0);
  ctx.strokeStyle = '#e8b64c';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, VSIZE * VTILE, VSIZE * VTILE);

  const tNow = now();
  const mine = myBuildings();
  for (const b of mine) {
    const def = BUILDINGS[b.type];
    const done = isDone(b);
    const px = b.x * VTILE;
    const py = b.y * VTILE;
    ctx.globalAlpha = done ? 1 : 0.5;
    ctx.drawImage(getBuildingSprite(b.type, S.me.color), px, py);
    ctx.globalAlpha = 1;
    if (!done) {
      const total = (def?.time || 1) * 1000 / speed();
      const left = new Date(b.construction_end_at).getTime() - tNow;
      const prog = clamp(1 - left / total, 0, 1);
      ctx.fillStyle = '#000a';
      ctx.fillRect(px + 2, py + 27, 28, 4);
      ctx.fillStyle = '#e8b64c';
      ctx.fillRect(px + 2, py + 27, 28 * prog, 4);
      if (Math.floor(tNow / 300) % 2) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px + 24, py + 4, 4, 2);
      }
    }
    if (b.on_fire) {
      for (let k = 0; k < 5; k++) {
        const fx = px + 4 + ((k * 7 + Math.floor(tNow / 90)) % 24);
        const fh = 6 + ((tNow / 60 + k * 13) % 8);
        ctx.fillStyle = k % 2 ? '#ff6a1a' : '#ffd23f';
        ctx.fillRect(fx, py + 20 - fh, 3, fh);
      }
    }
    if (b.hp < 100) {
      ctx.fillStyle = '#000a';
      ctx.fillRect(px + 2, py - 3, 28, 3);
      ctx.fillStyle = '#e04b3c';
      ctx.fillRect(px + 2, py - 3, 28 * (b.hp / 100), 3);
    }
    if (b.id === S.selectedBuildingId) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, VTILE, VTILE);
    }
  }

  // Dorfbewohner
  const castle = mine.find((b) => b.type === 'castle') || { x: 19, y: 19 };
  const { villagers } = assignWorkers();
  const burning = mine.filter((b) => b.on_fire);
  const hasWell = countDone('well') > 0;
  const vSprite = getUnitSprite('villager', S.me.color);
  villagers.forEach((b, i) => {
    let x;
    let y;
    let target = b;
    if (hasWell && burning.length && i % 2 === 0) target = burning[i % burning.length];
    if (target) {
      const t = ((tNow / 6000) * speed() + i * 0.17) % 1;
      const pp = t < 0.5 ? t * 2 : 2 - t * 2;
      x = (castle.x + (target.x - castle.x) * pp) * VTILE + 8;
      y = (castle.y + (target.y - castle.y) * pp) * VTILE + 12;
    } else {
      const ang = tNow / 2500 + i * 1.7;
      x = castle.x * VTILE + 8 + Math.cos(ang) * (30 + (i % 3) * 10);
      y = castle.y * VTILE + 12 + Math.sin(ang) * (24 + (i % 4) * 6);
    }
    ctx.drawImage(vSprite, x, y + Math.abs(Math.sin(tNow / 150 + i)) * -2);
  });

  // Bau-Vorschau
  if (S.buildType && S.hoverTile) {
    const { x, y } = S.hoverTile;
    if (x >= 0 && y >= 0 && x < VSIZE && y < VSIZE) {
      const blocked = mine.some((b) => b.x === x && b.y === y);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(getBuildingSprite(S.buildType, S.me.color), x * VTILE, y * VTILE);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = blocked ? '#ff4040' : '#7dff7a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * VTILE, y * VTILE, VTILE, VTILE);
    }
  }

  if (S.match.season === 'winter') {
    ctx.fillStyle = '#ffffffcc';
    for (let k = 0; k < 120; k++) {
      const sx = (k * 97 + tNow / 30) % (VSIZE * VTILE);
      const sy = (k * 53 + tNow / 12) % (VSIZE * VTILE);
      ctx.fillRect(sx, sy, 2, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// INPUT (Maus & Touch)
// ---------------------------------------------------------------------------
function camNow() {
  return S.view === 'world' ? S.camW : S.camV;
}
function screenToTile(mx, my) {
  const cam = camNow();
  const ts = S.view === 'world' ? TILE : VTILE;
  return { x: Math.floor((cam.x + mx / cam.z) / ts), y: Math.floor((cam.y + my / cam.z) / ts) };
}
function zoomAt(mx, my, factor) {
  const cam = camNow();
  const [min, max] = S.view === 'world' ? [0.4, 6] : [0.4, 3];
  const nz = clamp(cam.z * factor, min, max);
  const wx = cam.x + mx / cam.z;
  const wy = cam.y + my / cam.z;
  cam.z = nz;
  cam.x = wx - mx / nz;
  cam.y = wy - my / nz;
}

function bindCanvas() {
  const c = $('game-canvas');
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  };
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { mx, my } = pos(e);
    zoomAt(mx, my, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  c.addEventListener('pointerdown', (e) => {
    const { mx, my } = pos(e);
    c.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      S.buildType = null;
      S.bridgeMode = false;
      S.selectedArmyId = null;
      updateModeHint();
      renderPanel();
      return;
    }
    const cam = camNow();
    S.drag = { sx: mx, sy: my, cx: cam.x, cy: cam.y, moved: false, paint: S.view === 'village' && ['wall', 'gate'].includes(S.buildType) };
    if (S.drag.paint) {
      const t = screenToTile(mx, my);
      placeBuilding(S.buildType, t.x, t.y);
    }
  });
  c.addEventListener('pointermove', (e) => {
    const { mx, my } = pos(e);
    S.hoverTile = screenToTile(mx, my);
    const d = S.drag;
    if (!d) return;
    if (Math.abs(mx - d.sx) + Math.abs(my - d.sy) > 5) d.moved = true;
    if (d.paint) {
      if (d.moved) placeBuilding(S.buildType, S.hoverTile.x, S.hoverTile.y);
      return;
    }
    if (d.moved) {
      const cam = camNow();
      cam.x = d.cx - (mx - d.sx) / cam.z;
      cam.y = d.cy - (my - d.sy) / cam.z;
    }
  });
  c.addEventListener('pointerup', (e) => {
    const d = S.drag;
    S.drag = null;
    if (!d || d.moved || d.paint) return;
    const { mx, my } = pos(e);
    onCanvasClick(screenToTile(mx, my));
  });
  c.addEventListener('pointerleave', () => { S.hoverTile = null; });
}

function onCanvasClick(t) {
  if (!S.me || !S.match) return;
  if (S.view === 'village') {
    if (S.buildType) {
      placeBuilding(S.buildType, t.x, t.y);
      if (!['wall', 'gate'].includes(S.buildType) && !window.event?.shiftKey) {
        S.buildType = null;
        updateModeHint();
        renderPanel();
      }
      return;
    }
    const b = myBuildings().find((x) => x.x === t.x && x.y === t.y);
    S.selectedBuildingId = b ? b.id : null;
    S.activeTab = 'info';
    setActiveTab('info');
    playSfx('click');
    return;
  }

  if (!M.inBounds(t.x, t.y)) return;
  if (S.bridgeMode) {
    buildBridge(t.x, t.y);
    return;
  }
  const own = S.armies.find((a) => a.player_id === S.me.id && a.target_x == null && a.x === t.x && a.y === t.y && a.id !== S.selectedArmyId);
  if (own && !S.selectedArmyId) {
    S.selectedArmyId = own.id;
    playSfx('click');
    updateModeHint();
    setActiveTab('army');
    return;
  }
  const sel = S.armies.find((a) => a.id === S.selectedArmyId);
  if (sel) {
    if (own && own.x === sel.x && own.y === sel.y) {
      S.selectedArmyId = own.id;
      return renderPanel();
    }
    moveArmy(sel, t.x, t.y);
    return;
  }
  if (own) {
    S.selectedArmyId = own.id;
    updateModeHint();
    setActiveTab('army');
    return;
  }
  S.selectedTile = t;
  setActiveTab('info');
}

function bindKeys() {
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') {
      S.buildType = null;
      S.bridgeMode = false;
      S.selectedArmyId = null;
      updateModeHint();
      renderPanel();
    }
    if (e.key === 'Tab' && S.inGame) {
      e.preventDefault();
      setView(S.view === 'world' ? 'village' : 'world');
    }
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  setInterval(() => {
    if (!S.inGame) return;
    const cam = camNow();
    const step = 12 / cam.z;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= step;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += step;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= step;
    if (keys.has('d') || keys.has('arrowright')) cam.x += step;
  }, 16);
}

// ---------------------------------------------------------------------------
// SIDEBAR-PANELS
// ---------------------------------------------------------------------------
function setActiveTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('panel').hidden = tab === 'chat';
  $('panel-chat').hidden = tab !== 'chat';
  if (tab === 'chat') {
    $('chat-badge').hidden = true;
    renderChat();
    const log = $('chat-log');
    log.scrollTop = log.scrollHeight;
  }
  renderPanel();
}

function renderPanel() {
  if (!S.inGame || !S.me || S.activeTab === 'chat') return;
  const el = $('panel');
  const scroll = el.scrollTop;
  el.innerHTML = '';
  const fn = { info: panelInfo, build: panelBuild, army: panelArmy, diplo: panelDiplo }[S.activeTab];
  if (fn) fn(el);
  el.scrollTop = scroll;
}

function h(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}
function btn(label, onClick, cls = 'btn small', disabled = false, title = '') {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = label;
  b.disabled = disabled;
  if (title) b.title = title;
  b.onclick = (e) => {
    e.preventDefault();
    playSfx('click');
    onClick();
  };
  return b;
}

function panelInfo(el) {
  const me = S.me;
  if (me.is_eliminated) el.appendChild(h('<div class="info-box"><b>☠️ Dein Reich wurde vernichtet.</b><br>Du kannst weiter zuschauen.</div>'));

  if (S.view === 'village' && S.selectedBuildingId) {
    const b = S.buildings.find((x) => x.id === S.selectedBuildingId);
    if (b) {
      const def = BUILDINGS[b.type];
      const { assigned } = assignWorkers();
      const box = h(`<div class="info-box"><h3>${def.name}</h3><p class="muted">${def.desc}</p>
        <div class="stat"><span>Zustand</span><b>${b.hp} HP${b.on_fire ? ' 🔥' : ''}</b></div>
        <div class="stat"><span>Status</span><b>${isDone(b) ? 'Fertig' : 'Im Bau…'}</b></div>
        ${def.workers ? `<div class="stat"><span>Arbeiter</span><b>${assigned.get(b.id) || 0}/${def.workers}</b></div>` : ''}</div>`);
      box.firstChild.appendChild(btn('🪓 Abreißen', () => demolish(b), 'btn small danger'));
      el.appendChild(box);
    }
  } else if (S.view === 'world' && S.selectedTile) {
    const { x, y } = S.selectedTile;
    const i = M.idx(x, y);
    const known = S.explored[i] || S.fogOff;
    const owner = S.territory[i] >= 0 ? playerBySlot(S.territory[i]) : null;
    el.appendChild(h(`<div class="info-box"><h3>Feld (${x}, ${y})</h3>
      <div class="stat"><span>Gelände</span><b>${known ? M.TERRAIN_LABELS[S.terrain[i]] : '???'}${S.bridges.has(i) ? ' + Brücke' : ''}</b></div>
      <div class="stat"><span>Besitzer</span><b>${known ? (owner ? esc(owner.kingdom_name) : 'Neutral') : '???'}</b></div></div>`));
  }

  const { d, consumption, mf } = estimateRates();
  const { villagers } = assignWorkers();
  const idle = villagers.filter((v) => !v).length;
  const net = d.raw_food + d.bread - consumption;
  el.appendChild(h(`<div class="info-box"><h3>📊 ${esc(me.kingdom_name)}</h3>
    <div class="stat"><span>Zeitalter</span><b>${AGE_NAMES[me.age]}</b></div>
    <div class="stat"><span>Einwohner</span><b>${me.population}/${popCap()} (${idle} frei)</b></div>
    <div class="stat"><span>Moral</span><b>${me.morale}% (Arbeit ×${mf.toFixed(2)})</b></div>
    <div class="bar"><i style="width:${me.morale}%;background:${me.morale < 30 ? '#c8443a' : '#5fae4a'}"></i></div>
    <h3>Produktion / Sek.</h3>
    <div class="stat"><span>🪵 Holz</span><b>+${d.wood.toFixed(1)}</b></div>
    <div class="stat"><span>🪨 Stein</span><b>+${d.stone.toFixed(1)}</b></div>
    <div class="stat"><span>💰 Gold</span><b>+${d.gold.toFixed(1)}</b></div>
    <div class="stat"><span>🌾/🍞 Nahrung netto</span><b style="color:${net < 0 ? '#ff7b6e' : '#9be38a'}">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b></div>
    <p class="muted">× Tempo ${speed()}x. ${countDone('granary') ? '✅ Kornspeicher schützt Nahrung.' : '⚠️ Ohne Kornspeicher verdirbt Rohnahrung!'}
    ${countDone('well') ? ' ✅ Brunnen löscht Feuer.' : ' ⚠️ Ohne Brunnen brennen Gebäude ab.'}
    ${S.match.season === 'winter' ? ' ❄️ Winter: doppelter Verbrauch!' : ''}</p></div>`));

  el.appendChild(h(`<div class="info-box muted">
    <b>Steuerung:</b> Ziehen = Karte bewegen · Mausrad/＋－ = Zoom · WASD = scrollen · Tab = Ansicht wechseln ·
    Armee anklicken → Ziel anklicken · Rechtsklick/Esc = abbrechen. Ziel: <b>70% der Welt</b> erobern!</div>`));
}

function panelBuild(el) {
  const me = S.me;
  const ageBox = h(`<div class="info-box"><h3>🏛️ ${AGE_NAMES[me.age]}</h3></div>`);
  if (me.age < 4) {
    const cost = AGE_COST[me.age + 1];
    ageBox.firstChild.appendChild(h(`<p class="muted">Nächstes: <b>${AGE_NAMES[me.age + 1]}</b> – ${costText(cost)}<br>Benötigt fertige Schmiede.</p>`));
    ageBox.firstChild.appendChild(btn('⬆️ Zeitalter aufsteigen', ageUp, 'btn small gold', countDone('blacksmith') === 0));
  } else ageBox.firstChild.appendChild(h('<p class="muted">Höchstes Zeitalter erreicht!</p>'));
  el.appendChild(ageBox);

  el.appendChild(h('<h3>🔨 Gebäude (Dorf)</h3><p class="muted">Wählen, dann frei im Dorf platzieren. Shift = mehrere.</p>'));
  const grid = document.createElement('div');
  grid.className = 'grid2';
  for (const [type, def] of Object.entries(BUILDINGS)) {
    if (def.hidden) continue;
    const afford = Object.entries(def.cost).every(([k, v]) => (me[k] || 0) >= v);
    const b = document.createElement('button');
    b.className = `bcard${S.buildType === type ? ' active' : ''}`;
    b.title = def.desc;
    b.disabled = !afford;
    b.innerHTML = `<img src="${spriteUrl(getBuildingSprite(type, me.color), 'b' + type + me.color)}" alt=""><div><div class="name">${def.name}</div><div class="cost">${costText(def.cost)}</div></div>`;
    b.onclick = () => {
      playSfx('click');
      S.buildType = type;
      S.selectedBuildingId = null;
      if (S.view !== 'village') setView('village');
      updateModeHint();
      renderPanel();
    };
    grid.appendChild(b);
  }
  el.appendChild(grid);

  el.appendChild(h('<h3>🌉 Weltkarte</h3><p class="muted">Brücke über Flüsse/Meer: 🪵60 🪨20. Muss an dein Gebiet grenzen.</p>'));
  el.appendChild(btn(S.bridgeMode ? '❌ Brückenbau beenden' : '🌉 Brücke bauen', () => {
    S.bridgeMode = !S.bridgeMode;
    if (S.view !== 'world') setView('world');
    updateModeHint();
    renderPanel();
  }, `btn small${S.bridgeMode ? ' active' : ''}`));
}

function panelArmy(el) {
  const me = S.me;
  const hasBarracks = countDone('barracks') > 0;
  el.appendChild(h(`<h3>🛡️ Ausbilden (${BATCH}er Trupps)</h3>${hasBarracks ? '' : '<p class="muted">⚠️ Baue zuerst eine <b>Kaserne</b>.</p>'}`));
  for (const [type, u] of Object.entries(UNITS)) {
    const locked = me.age < u.age;
    const row = document.createElement('div');
    row.className = 'army-row';
    const total = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, v * BATCH]));
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(type, me.color), 'u' + type + me.color)}" alt=""><div class="grow"><b>${u.name}</b> · ⚔️${u.power}<br><span class="muted">${costText(total)}${u.note ? ' · ' + u.note : ''}${locked ? ' · 🔒 ' + AGE_NAMES[u.age] : ''}</span></div>`;
    row.appendChild(btn('+5', () => trainUnits(type), 'btn small primary', !hasBarracks || locked));
    el.appendChild(row);
  }

  el.appendChild(h('<h3>⚔️ Deine Armeen</h3><p class="muted">Armee wählen → auf der Weltkarte Ziel anklicken. Banditen 🏕️ & Ruinen 🏚️ geben Beute.</p>'));
  const mine = S.armies.filter((a) => a.player_id === me.id);
  if (!mine.length) el.appendChild(h('<p class="muted">Keine Armeen.</p>'));
  for (const a of mine) {
    const p = armyPos(a);
    const row = document.createElement('div');
    row.className = `army-row${a.id === S.selectedArmyId ? ' sel' : ''}`;
    const eta = a.arrives_at ? Math.max(0, Math.ceil((new Date(a.arrives_at).getTime() - now()) / 1000)) : 0;
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(a.unit_type, me.color), 'u' + a.unit_type + me.color)}" alt=""><div class="grow"><b>${a.count}× ${UNITS[a.unit_type]?.name || a.unit_type}</b><br><span class="muted">${p.moving ? `🚶 → (${a.target_x},${a.target_y}) ${eta}s` : `📍 (${a.x},${a.y})`}</span></div>`;
    row.appendChild(btn(a.id === S.selectedArmyId ? '✔' : 'Wählen', () => {
      S.selectedArmyId = a.id === S.selectedArmyId ? null : a.id;
      if (S.view !== 'world') setView('world');
      const c = $('game-canvas');
      S.camW.x = p.x * TILE - c.width / 2 / S.camW.z;
      S.camW.y = p.y * TILE - c.height / 2 / S.camW.z;
      updateModeHint();
      renderPanel();
    }, 'btn small', p.moving));
    el.appendChild(row);
    if (a.id === S.selectedArmyId && !p.moving) {
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.style.marginBottom = '8px';
      actions.appendChild(btn('✂️ Teilen', () => splitArmy(a), 'btn small', a.count < 2));
      actions.appendChild(btn('🔗 Vereinen', () => mergeArmies(a)));
      el.appendChild(actions);
    }
  }
}

function panelDiplo(el) {
  const me = S.me;
  const allyBox = h(`<div class="info-box"><h3>🤝 Allianz</h3><p class="muted">Gleicher Allianz-Name = verbündet (kein Angriff, geteilte Sicht).</p></div>`);
  const form = document.createElement('form');
  form.className = 'row';
  form.innerHTML = `<input id="ally-input" maxlength="20" placeholder="Allianz-Name" value="${esc(me.alliance)}">`;
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn small';
  saveBtn.textContent = 'OK';
  form.appendChild(saveBtn);
  form.onsubmit = (e) => {
    e.preventDefault();
    setAlliance($('ally-input').value);
  };
  allyBox.firstChild.appendChild(form);
  el.appendChild(allyBox);

  const hasMarket = countDone('market') > 0;
  const mk = h(`<div class="info-box"><h3>⚖️ Marktplatz</h3>${hasMarket ? '<p class="muted">Verkaufe 100 Waren für 30 Gold oder kaufe 100 für 50 Gold.</p>' : '<p class="muted">⚠️ Baue einen Marktplatz zum Handeln.</p>'}</div>`);
  if (hasMarket) {
    for (const r of ['wood', 'stone', 'raw_food']) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.margin = '4px 0';
      row.appendChild(h(`<span style="width:80px;display:inline-block">${RES_ICON[r]} ${RES_NAME[r]}</span>`));
      row.appendChild(btn('Verkaufen', () => marketTrade(r, 'sell')));
      row.appendChild(btn('Kaufen', () => marketTrade(r, 'buy')));
      mk.firstChild.appendChild(row);
    }
  }
  el.appendChild(mk);

  el.appendChild(h('<h3>👑 Königreiche</h3>'));
  const sorted = [...S.players].sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0));
  for (const p of sorted) {
    const isMe = p.id === me.id;
    const ally = !isMe && allied(p.id, me.id);
    const spied = (S.spied[p.id] || 0) > now();
    const box = document.createElement('div');
    box.className = 'info-box';
    box.style.borderLeft = `5px solid ${p.color}`;
    const head = document.createElement('div');
    head.className = 'row';
    head.appendChild(emblemCanvas(p.emblem, p.color, 24));
    head.appendChild(h(`<div><b>${esc(p.kingdom_name)}</b>${isMe ? ' (Du)' : ''}${ally ? ' 🤝' : ''}${p.is_eliminated ? ' ☠️' : ''}<br><span class="muted">${esc(p.username)} · ${AGE_NAMES[p.age]} · 🗺️ ${(p.territory_percent || 0).toFixed(1)}%${p.alliance ? ' · „' + esc(p.alliance) + '“' : ''}${S.online.includes(p.user_id) ? ' · 🟢' : ''}</span></div>`));
    box.appendChild(head);
    if (!isMe && (spied || ally)) {
      box.appendChild(h(`<div class="muted">🕵️ 🪵${fmt(p.wood)} 🪨${fmt(p.stone)} 💰${fmt(p.gold)} 🌾${fmt(p.raw_food)} 🍞${fmt(p.bread)} 👥${p.population} 😊${p.morale}</div>`));
    }
    if (!isMe && !p.is_eliminated) {
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.style.marginTop = '6px';
      actions.appendChild(btn('🕵️ Spion (30💰)', () => sendSpy(p), 'btn small', me.age < 2 || countDone('tavern') === 0, 'Benötigt Feudalzeit + Taverne'));
      if (hasMarket) {
        const sel = document.createElement('select');
        sel.style.width = '80px';
        sel.style.display = 'inline-block';
        sel.innerHTML = ['wood', 'stone', 'gold', 'raw_food'].map((r) => `<option value="${r}">${RES_ICON[r]}</option>`).join('');
        const amt = document.createElement('input');
        amt.type = 'number';
        amt.value = '50';
        amt.min = '1';
        amt.style.width = '70px';
        amt.style.display = 'inline-block';
        actions.appendChild(sel);
        actions.appendChild(amt);
        actions.appendChild(btn('📦', () => sendResources(p, sel.value, Number(amt.value)), 'btn small', false, 'Ressourcen senden'));
      }
      box.appendChild(actions);
    }
    el.appendChild(box);
  }
}

// ---------------------------------------------------------------------------
// SIEG & ZEITRAFFER-REPLAY
// ---------------------------------------------------------------------------
async function showEnd() {
  if (S.endShown) return;
  S.endShown = true;
  const winner = S.players.find((p) => p.user_id === S.match.winner_id);
  const iWon = winner && winner.user_id === S.user.id;
  $('end-title').textContent = iWon ? '🏆 SIEG!' : '⚔️ Spiel beendet';
  $('end-text').textContent = winner ? `${winner.kingdom_name} (${winner.username}) hat 70% der Welt erobert!` : 'Das Spiel ist vorbei.';
  $('modal-end').hidden = false;
  if (iWon) playSfx('horn');
  const { data } = await sb.from('map_snapshots').select('owners_data,created_at').eq('match_id', S.match.id).order('created_at');
  const snaps = (data || []).map((s) => s.owners_data).filter((s) => typeof s === 'string');
  if (typeof S.match.territory === 'string' && S.match.territory.length === M.N) snaps.push(S.match.territory);
  if (!snaps.length) return;
  const canvas = $('replay-canvas');
  const arr = new Int8Array(M.N);
  let k = 0;
  const timer = setInterval(() => {
    if ($('modal-end').hidden) return clearInterval(timer);
    M.decodeTerritory(snaps[k], arr);
    drawMiniMap(canvas, S.terrain, arr);
    $('replay-info').textContent = `⏳ Zeitraffer: ${k + 1}/${snaps.length}`;
    k = (k + 1) % snaps.length;
  }, Math.max(150, 4000 / snaps.length));
}

// ---------------------------------------------------------------------------
// STATISCHE EVENT-BINDINGS
// ---------------------------------------------------------------------------
function toggleMute() {
  setMuted(!isMuted());
  const icon = isMuted() ? '🔇' : '🔊';
  $('btn-mute').textContent = icon;
  $('btn-mute-global').textContent = icon;
  localStorage.setItem('fk_muted', isMuted() ? '1' : '0');
}

function bindStatic() {
  $('btn-login').onclick = () => doLogin('login');
  $('btn-register').onclick = () => doLogin('register');
  $('btn-guest').onclick = () => doLogin('guest');
  $('login-pw').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin('login'));
  $('btn-logout').onclick = () => {
    logoutUser();
    S.user = null;
    leaveMatchState();
    showScreen('screen-login');
  };
  $('btn-create').onclick = createMatch;
  $('create-map').onchange = () => { $('create-custom-wrap').hidden = $('create-map').value !== 'custom'; };
  $('btn-editor-menu').onclick = openMapEditor;

  $('btn-save-kingdom').onclick = saveKingdom;
  $('my-color').oninput = renderEmblemPicker;
  $('btn-leave-lobby').onclick = leaveLobby;
  $('btn-admin-lobby').onclick = openAdminPanel;
  $('btn-start').onclick = startMatch;
  $('btn-reroll').onclick = () => updateMatchSettings({ map_seed: Math.floor(Math.random() * 999999) });
  $('lobby-map').onchange = () => {
    const v = $('lobby-map').value;
    $('lobby-custom-wrap').hidden = v !== 'custom';
    const patch = { map_type: v };
    if (v === 'custom') {
      if (!$('lobby-custom').value) return toast('Keine eigene Karte vorhanden.', 'err');
      patch.custom_map_id = $('lobby-custom').value;
    }
    updateMatchSettings(patch);
  };
  $('lobby-custom').onchange = () => updateMatchSettings({ custom_map_id: $('lobby-custom').value });
  $('lobby-speed').onchange = () => updateMatchSettings({ game_speed: Number($('lobby-speed').value) });
  $('lobby-chat-form').onsubmit = (e) => {
    e.preventDefault();
    sendChat($('lobby-chat-input').value);
    $('lobby-chat-input').value = '';
  };

  $('chat-form').onsubmit = (e) => {
    e.preventDefault();
    sendChat($('chat-input').value);
    $('chat-input').value = '';
  };
  $('btn-view').onclick = () => {
    playSfx('click');
    setView(S.view === 'world' ? 'village' : 'world');
  };
  $('btn-admin').onclick = openAdminPanel;
  $('btn-mute').onclick = toggleMute;
  $('btn-mute-global').onclick = toggleMute;
  $('btn-leave-game').onclick = () => {
    if (confirm('Zurück zum Menü? Dein Reich bleibt bestehen und du kannst jederzeit zurückkehren.')) showMenu();
  };
  $('btn-zoom-in').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 1.25); };
  $('btn-zoom-out').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 0.8); };
  $('btn-center').onclick = () => (S.view === 'world' ? centerOnCapital() : centerVillageCam());
  $('btn-end-menu').onclick = showMenu;
  document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { playSfx('click'); setActiveTab(b.dataset.tab); }; });
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { $(b.dataset.close).hidden = true; }; });
  window.addEventListener('resize', () => S.inGame && resizeCanvas());
  bindCanvas();
  bindKeys();
}

// ---------------------------------------------------------------------------
// ADMIN-API & START
// ---------------------------------------------------------------------------
setupAdmin({
  S, sb, M, toast, rpcAdd, sysChat, startMatch, spawnBarbarians, triggerFire, fullReload, isAdmin,
  onFogChange: () => { S.fogVersion++; computeVisibility(); },
  onCustomMapsChanged: loadCustomMapOptions
});

function boot() {
  bindStatic();
  if (localStorage.getItem('fk_muted') === '1') toggleMute();
  const saved = getSavedUser();
  if (saved) {
    S.user = saved;
    showMenu();
  } else {
    showScreen('screen-login');
  }
}

boot();
