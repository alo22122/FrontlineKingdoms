// ============================================================================
// js/game.js – Vereinfachtes Hauptspiel: Alles auf einer 200x200 Weltkarte
// ============================================================================
import {
  sb, isAdminUser, getSavedUser, loginWithNamePassword, loginAsGuest, logoutUser, subscribeMatchRealtime
} from './supabase.js';
import {
  getTerrainSprite, getBuildingSprite, getEmblemSprite, getUnitSprite, playSfx, setMuted, isMuted
} from './sprites.js';
import * as M from './map.js';
import { setupAdmin, openAdminPanel, openMapEditor, refreshAdminPanel } from './admin.js';

const $ = (id) => document.getElementById(id);
const TILE = 16;
const PLAYER_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#9b5de5', '#f15bb5', '#00bbf9', '#fb8500', '#8ac926', '#adb5bd'];
const EMBLEMS = { crown: 'Krone', lion: 'Löwe', dragon: 'Drache', sword: 'Schwert' };
const AGE_NAMES = ['', 'Dunkles Zeitalter', 'Feudalzeit', 'Ritterzeit', 'Kaiserzeit'];
const AGE_COST = {
  2: { wood: 200, raw_food: 200, gold: 100 },
  3: { wood: 350, raw_food: 350, gold: 250 },
  4: { wood: 500, raw_food: 500, gold: 500 }
};
const RES_ICON = { wood: '🪵', gold: '💰', raw_food: '🌾' };
const RES_NAME = { wood: 'Holz', gold: 'Gold', raw_food: 'Nahrung' };

// Alle Gebäude werden direkt auf der Weltkarte gebaut
const BUILDINGS = {
  house:      { name: 'Haus',       cost: { wood: 25 },           desc: '+5 Einwohner-Limit (schnellere Produktion).' },
  farm:       { name: 'Bauernhof',  cost: { wood: 30 },           prod: { raw_food: 2.0 }, desc: 'Produziert 🌾 Nahrung für Truppen.' },
  lumberjack: { name: 'Holzfäller', cost: { wood: 20 },           prod: { wood: 2.0 },     desc: 'Produziert 🪵 Holz für Gebäude & Schiffe.' },
  goldmine:   { name: 'Goldmine',   cost: { wood: 40 },           prod: { gold: 1.5 },     desc: 'Produziert 💰 Gold (2× auf Gold-Feldern).' },
  barracks:   { name: 'Kaserne',    cost: { wood: 50, gold: 20 }, desc: 'Ermöglicht Truppen auszubilden.' },
  tower:      { name: 'Wachturm',   cost: { wood: 40, gold: 20 }, desc: 'Deckt Sicht auf & +15% Kampfkraft.' }
};

const UNITS = {
  swordsman: { name: 'Schwertkämpfer', age: 1, power: 10, speed: 1.5, cost: { gold: 8, raw_food: 15 } },
  archer:    { name: 'Bogenschütze',   age: 2, power: 9,  speed: 1.5, cost: { wood: 15, gold: 10 }, note: '+50% auf Hügeln' },
  ship:      { name: 'Schiff',         age: 2, power: 6,  speed: 1.0, cost: { wood: 40 }, note: 'Fährt über Wasser' },
  knight:    { name: 'Ritter',         age: 3, power: 24, speed: 1.0, cost: { gold: 30, raw_food: 20 } },
  catapult:  { name: 'Katapult',       age: 4, power: 40, speed: 2.5, cost: { wood: 60, gold: 30 } }
};
const BATCH = 5;

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const S = {
  user: null, match: null, players: [], me: null, buildings: [], armies: [], chat: [],
  terrain: null, terrainKey: '', landTotal: 1, terrainCanvases: {},
  provinces: [], provOf: null, provBorderCanvas: null,
  territory: new Int8Array(M.N).fill(-1), territoryLoaded: false, territoryDirty: false, territoryVersion: 0, terrBuilt: -1,
  visible: new Uint8Array(M.N), explored: new Uint8Array(M.N), exploredDirty: false, fogVersion: 0, fogBuilt: -1,
  bridges: new Set(), terrCanvas: null, fogCanvas: null,
  camW: { x: 0, y: 0, z: 1.5 },
  selectedArmyId: null, selectedTile: null, buildType: null, bridgeMode: false, hoverTile: null,
  online: [], spied: {}, fogOff: false, unsub: null, timers: [], menuTimer: null, inGame: false,
  acc: { wood: 0, gold: 0, raw_food: 0 }, popAcc: 0,
  lastTerritoryWrite: 0, lastSnapshot: 0, lastEvent: Date.now(), lastBanditCheck: 0, lastExploredSave: 0,
  authBusy: false, endShown: false, activeTab: 'build', drag: null,
  lobbyFormFilled: false, myEmblem: 'crown', rafRunning: false, tutStep: -1
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
const costText = (cost) => Object.entries(cost).map(([k, v]) => `${RES_ICON[k] || ''}${v}`).join(' ') || 'gratis';
const speed = () => S.match?.game_speed || 1;
const now = () => Date.now();
const debounce = (fn, ms) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

const spriteUrlCache = new Map();
function spriteUrl(canvas, key) {
  if (!spriteUrlCache.has(key)) spriteUrlCache.set(key, canvas.toDataURL());
  return spriteUrlCache.get(key);
}
function emblemCanvas(emblem, color, size = 32) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
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
  const a = playerById(idA), b = playerById(idB);
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
  return { day: get('weekday'), minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
}
function schoolWarEnd() {
  const { day, minutes } = berlinTime();
  let end = null;
  if (['Mon', 'Wed', 'Thu'].includes(day)) end = 15 * 60 + 30;
  if (['Tue', 'Fri'].includes(day)) end = 13 * 60 + 30;
  return end !== null && minutes >= 8 * 60 && minutes < end ? end : null;
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
  let text, war;
  if (mode === 'always_war') { war = true; text = '⚔️ 24/7 KRIEG'; }
  else if (mode === 'peace') { war = false; text = '🕊️ FRIEDEN (Admin)'; }
  else {
    const end = schoolWarEnd();
    war = end !== null;
    text = war
      ? `⚔️ SCHULZEIT-KRIEG bis ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
      : '🕊️ FREIZEIT-FRIEDEN (Bauen & Banditen gehen!)';
  }
  el.textContent = text;
  el.className = `banner pvp ${war ? 'war' : 'peace'}`;
}

// ---------------------------------------------------------------------------
// LOGIN & MENÜ
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
    .neq('status', 'finished').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(25);
  if (error) { $('lobby-list').innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  const list = $('lobby-list');
  if (!matches.length) { list.innerHTML = '<p class="muted">Keine offenen Spiele – erstelle eins!</p>'; return; }
  list.innerHTML = '';
  for (const m of matches) {
    const count = m.match_players.length;
    const member = m.match_players.some((p) => p.user_id === S.user.id);
    const statusTxt = { lobby: '🟢 Lobby', running: '⚔️ Läuft', paused: '⏸️ Pause' }[m.status] || m.status;
    const div = document.createElement('div');
    div.className = 'lobby-item';
    div.innerHTML = `<div><b>${esc(m.name)}</b><div class="meta">${statusTxt} · ${M.MAP_TYPES[m.map_type] || m.map_type} · ${count}/10</div></div>`;
    const b = document.createElement('button');
    b.className = 'btn small primary';
    b.textContent = member ? 'Zurückkehren' : m.status === 'lobby' ? 'Beitreten' : 'Läuft';
    b.disabled = !(member || (m.status === 'lobby' && count < 10));
    b.onclick = () => joinMatch(m.id);
    div.appendChild(b);
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
    .select().single();
  if (error) return toast('Fehler: ' + error.message, 'err');
  await joinMatch(data.id);
}

async function joinMatch(matchId) {
  playSfx('click');
  const { data: players } = await sb.from('match_players').select('id,user_id,slot').eq('match_id', matchId);
  if (!(players || []).some((p) => p.user_id === S.user.id)) {
    const { data: m } = await sb.from('matches').select('status').eq('id', matchId).single();
    if (!m || m.status !== 'lobby') return toast('Spiel läuft bereits.', 'err');
    if ((players || []).length >= 10) return toast('Lobby ist voll (10/10).', 'err');
    const used = new Set((players || []).map((p) => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
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
  S.match = m; S.territoryLoaded = false; S.endShown = false; S.lobbyFormFilled = false;
  await reloadPlayers();
  if (!S.me) return toast('Du bist nicht in diesem Match.', 'err');
  const { data: ex } = await sb.from('match_players').select('explored_tiles').eq('id', S.me.id).single();
  M.decodeBits(ex?.explored_tiles || '', S.explored);
  await Promise.all([reloadBuildings(), reloadArmies(), reloadChat(), ensureTerrain()]);
  applyMatchTerritory(true);

  S.unsub = subscribeMatchRealtime(matchId, S.user.id, {
    onMatch: debounce(reloadMatch, 250),
    onPlayers: debounce(reloadPlayers, 400),
    onBuildings: debounce(reloadBuildings, 300),
    onArmies: debounce(reloadArmies, 200),
    onChat: debounce(reloadChat, 150),
    onPresence: (ids) => { S.online = ids; }
  });
  S.timers.push(setInterval(fullReload, 5000));
  routeByStatus(null);
}

async function fullReload() {
  if (S.match) await Promise.all([reloadMatch(), reloadPlayers(), reloadBuildings(), reloadArmies()]);
}

async function reloadMatch() {
  if (!S.match) return;
  const { data } = await sb.from('matches').select('*').eq('id', S.match.id).maybeSingle();
  if (!data) { toast('Das Match wurde gelöscht.', 'err'); return showMenu(); }
  const prev = S.match; S.match = data;
  if (prev.map_type !== data.map_type || prev.map_seed !== data.map_seed || prev.custom_map_id !== data.custom_map_id) {
    await ensureTerrain();
    if (S.match.status === 'lobby') drawLobbyPreview();
  }
  applyMatchTerritory(false);
  if (prev.status !== data.status) routeByStatus(prev.status);
  if (prev.season !== data.season) toast(data.season === 'winter' ? '❄️ Winter! Doppelter Nahrungsverbrauch.' : '☀️ Sommer kehrt zurück.');
  if (prev.global_banner !== data.global_banner && data.global_banner) playSfx('horn');
  updateBanners();
  if (S.match.status === 'lobby') renderLobby();
  refreshAdminPanel();
}

async function reloadPlayers() {
  if (!S.match) return;
  const { data } = await sb.from('match_players')
    .select('id,match_id,user_id,username,slot,kingdom_name,color,emblem,age,alliance,wood,stone,gold,raw_food,bread,food,morale,population,territory_percent,capital_x,capital_y,is_eliminated,created_at')
    .eq('match_id', S.match.id).order('slot');
  if (!data) return;
  S.players = data;
  const me = data.find((p) => p.user_id === S.user.id) || null;
  if (S.me && !me) { toast('Du wurdest entfernt.', 'err'); S.me = null; return showMenu(); }
  S.me = me; S.territoryVersion++;
  if (S.match.status === 'lobby') renderLobby();
  refreshAdminPanel();
}

async function reloadBuildings() {
  if (!S.match) return;
  const { data } = await sb.from('buildings').select('*').eq('match_id', S.match.id).eq('layer', 'world');
  if (!data) return;
  S.buildings = data;
  S.bridges = new Set(data.filter((b) => b.type === 'bridge').map((b) => M.idx(b.x, b.y)));
}

async function reloadArmies() {
  if (!S.match) return;
  const { data } = await sb.from('armies').select('*').eq('match_id', S.match.id);
  if (data) S.armies = data;
}

async function reloadChat() {
  if (!S.match) return;
  const { data } = await sb.from('chat_messages').select('*').eq('match_id', S.match.id).order('created_at', { ascending: false }).limit(60);
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
  const pd = M.generateProvinces(S.terrain, m.map_seed, m.map_type);
  S.provinces = pd.provinces;
  S.provOf = pd.provOf;
  S.provBorderCanvas = null;
}

function applyMatchTerritory(force) {
  if (!S.match) return;
  if (!force && amAuthority() && S.territoryLoaded) return;
  if (typeof S.match.territory === 'string' && S.match.territory.length === M.N) {
    M.decodeTerritory(S.match.territory, S.territory);
    S.territoryLoaded = true;
    S.territoryVersion++;
  } else if (force) S.territory.fill(-1);
}

function routeByStatus(prevStatus) {
  const st = S.match.status;
  if (st === 'lobby') { S.inGame = false; showLobby(); }
  else {
    if (!S.inGame) showGame();
    if (prevStatus === 'lobby') { playSfx('horn'); toast('⚔️ Das Spiel beginnt!', 'ok'); }
    $('paused-overlay').hidden = st !== 'paused';
    if (st === 'finished') showEnd();
  }
}

function leaveMatchState() {
  if (S.unsub) S.unsub();
  S.unsub = null; S.timers.forEach(clearInterval); S.timers = []; clearInterval(S.menuTimer);
  S.inGame = false; S.match = null; S.me = null; S.players = []; S.buildings = []; S.armies = []; S.chat = [];
  S.selectedArmyId = null; S.selectedTile = null; S.buildType = null; S.bridgeMode = false; S.fogOff = false;
  $('modal-end').hidden = true; $('modal-admin').hidden = true;
  if ($('tut-coach')) $('tut-coach').hidden = true;
}

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------
function showLobby() { showScreen('screen-lobby'); renderLobby(); drawLobbyPreview(); }

function renderLobby() {
  if (!S.match || !S.me) return;
  $('lobby-title').textContent = `🏰 ${S.match.name}`;
  $('lobby-count').textContent = S.players.length;
  const admin = isAdmin();
  $('btn-admin-lobby').hidden = !admin; $('lobby-host-box').hidden = !admin; $('lobby-wait').hidden = admin;

  const list = $('lobby-players'); list.innerHTML = '';
  for (const p of S.players) {
    const row = document.createElement('div');
    row.className = 'player-row'; row.style.borderLeftColor = p.color;
    row.appendChild(emblemCanvas(p.emblem, p.color, 24));
    const info = document.createElement('div'); info.className = 'grow';
    info.innerHTML = `<b>${esc(p.kingdom_name)}</b><br><small>${esc(p.username)}${p.user_id === S.match.host_id ? ' · 👑 Host' : ''}${S.online.includes(p.user_id) ? ' · 🟢' : ''}</small>`;
    row.appendChild(info); list.appendChild(row);
  }
  if (admin && document.activeElement?.tagName !== 'SELECT') {
    $('lobby-map').value = S.match.map_type; $('lobby-speed').value = String(S.match.game_speed);
    $('lobby-custom-wrap').hidden = S.match.map_type !== 'custom';
    if (S.match.custom_map_id) $('lobby-custom').value = S.match.custom_map_id;
  }
  if (!S.lobbyFormFilled) {
    S.lobbyFormFilled = true;
    $('my-kingdom').value = S.me.kingdom_name; $('my-color').value = S.me.color;
    S.myEmblem = S.me.emblem; renderEmblemPicker();
  }
  renderChat();
}

function renderEmblemPicker() {
  const box = $('emblem-picker'); box.innerHTML = '';
  for (const [key, label] of Object.entries(EMBLEMS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = label; b.className = key === S.myEmblem ? 'active' : '';
    b.appendChild(emblemCanvas(key, $('my-color').value, 32));
    b.onclick = () => { S.myEmblem = key; playSfx('click'); renderEmblemPicker(); };
    box.appendChild(b);
  }
}

async function saveKingdom() {
  const kingdom_name = $('my-kingdom').value.trim().slice(0, 24) || S.me.kingdom_name;
  const { error } = await sb.from('match_players').update({ kingdom_name, color: $('my-color').value, emblem: S.myEmblem }).eq('id', S.me.id);
  if (error) return toast(error.message, 'err');
  playSfx('coins'); toast('Königreich gespeichert!', 'ok'); reloadPlayers();
}

async function updateMatchSettings(patch) {
  const { error } = await sb.from('matches').update(patch).eq('id', S.match.id);
  if (error) toast(error.message, 'err'); else reloadMatch();
}

function drawLobbyPreview() {
  const c = $('lobby-preview');
  if (c && S.terrain) drawMiniMap(c, S.terrain, null);
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
      r = (r + pr * 2) / 3; g = (g + pg * 2) / 3; b = (b + pb * 2) / 3;
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = M.W; off.height = M.H;
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
// SPIELSTART
// ---------------------------------------------------------------------------
async function startMatch() {
  if (!S.match || S.match.status !== 'lobby') return toast('Spiel läuft bereits.', 'err');
  await reloadPlayers(); await ensureTerrain();
  if (!S.players.length) return toast('Keine Spieler in der Lobby.', 'err');
  toast('Welt wird erschaffen…');
  const t = S.terrain;
  const territory = new Int8Array(M.N).fill(-1);
  const spawns = M.findSpawns(t, S.players.length, S.match.map_seed);
  const armyRows = [];

  for (let k = 0; k < S.players.length; k++) {
    const p = S.players[k];
    const [cx, cy] = spawns[k];
    const pid = S.provOf ? S.provOf[M.idx(cx, cy)] : -1;
    if (pid >= 0 && S.provinces[pid]) {
      for (const ti of S.provinces[pid].tiles) territory[ti] = p.slot;
    } else {
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (M.inBounds(x, y) && dx * dx + dy * dy <= 36 && M.isLand(t[M.idx(x, y)])) territory[M.idx(x, y)] = p.slot;
      }
    }
    await sb.from('match_players').update({
      capital_x: cx, capital_y: cy, wood: 200, stone: 100, gold: 120, raw_food: 200, bread: 0,
      morale: 85, population: 5, age: 1, is_eliminated: false, territory_percent: 0
    }).eq('id', p.id);
    armyRows.push({ match_id: S.match.id, player_id: p.id, unit_type: 'swordsman', count: 10, x: cx, y: cy });
  }

  const r = M.rng(S.match.map_seed + 555);
  const far = (x, y) => spawns.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 12);
  let bandits = 0, ruins = 0;
  for (let tries = 0; tries < 6000 && (bandits < 24 || ruins < 12); tries++) {
    const x = Math.floor(r() * M.W), y = Math.floor(r() * M.H);
    if (!M.isPassable(t[M.idx(x, y)]) || !far(x, y)) continue;
    if (bandits < 24) { armyRows.push({ match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 6 + Math.floor(r() * 14), x, y }); bandits++; }
    else { armyRows.push({ match_id: S.match.id, player_id: null, unit_type: 'ruin', count: 0, x, y }); ruins++; }
  }

  await sb.from('buildings').delete().eq('match_id', S.match.id);
  await sb.from('armies').delete().eq('match_id', S.match.id);
  await sb.from('armies').insert(armyRows);
  const terrStr = M.encodeTerritory(territory);
  await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: 0, owners_data: terrStr });
  const { error } = await sb.from('matches').update({ status: 'running', territory: terrStr, winner_id: null }).eq('id', S.match.id);
  if (error) return toast('Start fehlgeschlagen: ' + error.message, 'err');
  S.territory.set(territory); S.territoryLoaded = true;
  await sysChat('📜 Das Zeitalter der Königreiche beginnt! Erobert 70% der Welt.');
  await fullReload();
}

// ---------------------------------------------------------------------------
// SPIEL STARTEN
// ---------------------------------------------------------------------------
function showGame() {
  showScreen('screen-game');
  S.inGame = true; S.lastSnapshot = now(); S.lastEvent = now();
  resizeCanvas(); centerOnCapital();
  updateBanners(); updatePvpBanner(); setActiveTab('build');
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
  if (localStorage.getItem('fk_it_done') !== '1') startInteractiveTut();
  if (!S.rafRunning) { S.rafRunning = true; requestAnimationFrame(frame); }
}

function centerOnCapital() {
  const c = $('game-canvas'), z = S.camW.z;
  const cx = S.me?.capital_x ?? 100, cy = S.me?.capital_y ?? 100;
  S.camW.x = cx * TILE + TILE / 2 - c.width / 2 / z;
  S.camW.y = cy * TILE + TILE / 2 - c.height / 2 / z;
}
function resizeCanvas() {
  const wrap = $('canvas-wrap'), c = $('game-canvas');
  c.width = Math.max(200, wrap.clientWidth); c.height = Math.max(200, wrap.clientHeight);
}

function updateModeHint() {
  const el = $('mode-hint'), cancelBtn = $('btn-cancel-mode');
  let txt = '';
  if (S.buildType) txt = `🔨 ${BUILDINGS[S.buildType].name} in deinem Gebiet antippen`;
  else if (S.bridgeMode) txt = '🌉 Wasser-Tile neben deinem Gebiet antippen';
  else if (S.selectedArmyId) txt = '⚔️ Ziel-Provinz antippen, um die Armee zu schicken';
  el.textContent = txt; el.hidden = !txt;
  if (cancelBtn) cancelBtn.hidden = !txt;
}

function updateBanners() {
  const gb = $('global-banner');
  if (!S.match) return;
  gb.textContent = S.match.global_banner || ''; gb.hidden = !S.match.global_banner;
  $('btn-admin').hidden = !isAdmin();
  $('paused-overlay').hidden = S.match.status !== 'paused';
}

function updateHud() {
  const me = S.me;
  if (!me || !S.match) return;
  $('res-wood').textContent = fmt(me.wood);
  $('res-gold').textContent = fmt(me.gold);
  $('res-raw').textContent = fmt(me.raw_food);
  $('res-pop').textContent = `${me.population}/${popCap()}`;
  $('res-territory').textContent = `${(me.territory_percent || 0).toFixed(1)}%`;
  $('res-age').textContent = `🏛️ ${AGE_NAMES[me.age]}`;
  $('res-season').textContent = `${S.match.season === 'winter' ? '❄️ Winter' : '☀️ Sommer'} · ${speed()}x`;
}

// ---------------------------------------------------------------------------
// EINFACHE WIRTSCHAFT (direkt auf der Weltkarte)
// ---------------------------------------------------------------------------
const myBuildings = () => (S.me ? S.buildings.filter((b) => b.player_id === S.me.id) : []);
const countType = (type, p = S.me) => (p ? S.buildings.filter((b) => b.player_id === p.id && b.type === type).length : 0);
const popCap = () => 5 + 5 * countType('house');

function estimateRates() {
  const me = S.me;
  if (!me) return { d: { wood: 0.6, gold: 0.3, raw_food: 0.8 }, mult: 1 };
  // Basis-Produktion der Hauptstadt + gebaute Gebäude auf der Weltkarte
  const mult = (0.8 + me.population * 0.04) * (S.match?.season === 'winter' ? 0.8 : 1);
  const d = { wood: 0.8, gold: 0.4, raw_food: 1.0 };
  for (const b of myBuildings()) {
    const def = BUILDINGS[b.type];
    if (!def?.prod) continue;
    const isGoldTile = S.terrain && S.terrain[M.idx(b.x, b.y)] === M.T.GOLD;
    for (const k in def.prod) d[k] += def.prod[k] * (k === 'gold' && isGoldTile ? 2 : 1);
  }
  for (const k in d) d[k] *= mult;
  return { d, mult };
}

async function clientTick() {
  const me = S.me;
  if (!me || !S.match || S.match.status !== 'running' || me.is_eliminated) return;
  const dt = 2 * speed();
  const { d } = estimateRates();
  const ints = {};
  let any = false;
  for (const k of ['wood', 'gold', 'raw_food']) {
    S.acc[k] += (d[k] || 0) * dt;
    ints[k] = Math.trunc(S.acc[k]);
    S.acc[k] -= ints[k];
    if (ints[k] !== 0) any = true;
  }
  if (any) {
    await rpcAdd(me.id, ints, true);
    for (const k in ints) me[k] = Math.max(0, me[k] + ints[k]);
  }
  const cap = popCap();
  if (me.population < cap) {
    S.popAcc += dt / 18;
    if (S.popAcc >= 1) {
      me.population = Math.min(cap, me.population + 1);
      S.popAcc -= 1;
      await sb.from('match_players').update({ population: me.population }).eq('id', me.id);
    }
  }
  if (S.exploredDirty && now() - S.lastExploredSave > 15000) {
    S.lastExploredSave = now(); S.exploredDirty = false;
    await sb.from('match_players').update({ explored_tiles: M.encodeBits(S.explored) }).eq('id', me.id);
  }
}

async function rpcAdd(playerId, d, clampMode) {
  const { data, error } = await sb.rpc('add_resources', {
    p_player: playerId, d_wood: Math.round(d.wood || 0), d_stone: Math.round(d.stone || 0),
    d_gold: Math.round(d.gold || 0), d_raw: Math.round(d.raw_food || 0), d_bread: 0, p_clamp: Boolean(clampMode)
  });
  return !error && data === true;
}

async function spend(cost, mult = 1) {
  const me = S.me; const neg = {};
  for (const k in cost) {
    const v = cost[k] * mult;
    if ((me[k] || 0) < v) { toast(`Nicht genug ${RES_NAME[k]}! (${fmt(me[k])}/${v})`, 'err'); return false; }
    neg[k] = -v;
  }
  if (!Object.keys(neg).length) return true;
  if (!(await rpcAdd(me.id, neg, false))) { toast('Nicht genug Ressourcen!', 'err'); return false; }
  for (const k in neg) me[k] += neg[k];
  return true;
}

async function sysChat(message) {
  if (S.match) await sb.from('chat_messages').insert({ match_id: S.match.id, player_id: null, sender_name: '📜 Chronik', message });
}

// ---------------------------------------------------------------------------
// AKTIONEN: Bauen auf der Weltkarte, Zeitalter, Truppen, Brücken
// ---------------------------------------------------------------------------
async function placeWorldBuilding(type, x, y) {
  if (!S.me || !S.match || S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  const i = M.idx(x, y);
  if (!M.isPassable(S.terrain[i])) return toast('Hier kann man nicht bauen!', 'err');
  if (S.territory[i] !== S.me.slot) return toast('Nur in deinem eigenen Gebiet bauen!', 'err');
  if (S.me.capital_x === x && S.me.capital_y === y) return toast('Auf der Hauptstadt steht schon deine Burg.', 'err');
  if (S.buildings.some((b) => b.x === x && b.y === y)) return toast('Hier steht bereits ein Gebäude.', 'err');
  const def = BUILDINGS[type];
  if (!def || !(await spend(def.cost))) return;
  const { data, error } = await sb.from('buildings')
    .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'world', type, x, y, construction_end_at: new Date().toISOString() })
    .select().single();
  if (error) { await rpcAdd(S.me.id, def.cost, true); return toast(error.message, 'err'); }
  if (data) S.buildings.push(data);
  playSfx('build');
  toast(`✅ ${def.name} gebaut!`, 'ok');
  advanceTut('world_built');
  S.buildType = null;
  updateModeHint();
  renderPanel();
}

async function demolishBuilding(b) {
  if (!b || b.player_id !== S.me?.id) return;
  await sb.from('buildings').delete().eq('id', b.id);
  S.buildings = S.buildings.filter((x) => x.id !== b.id);
  const refund = {};
  for (const k in BUILDINGS[b.type]?.cost || {}) refund[k] = Math.floor(BUILDINGS[b.type].cost[k] / 2);
  await rpcAdd(S.me.id, refund, true);
  playSfx('build');
  updateTileBar();
  renderPanel();
}

async function buildBridge(x, y) {
  const i = M.idx(x, y);
  if (S.terrain[i] !== M.T.WATER) return toast('Brücken nur auf Wasser!', 'err');
  if (S.bridges.has(i)) return toast('Hier ist schon eine Brücke.', 'err');
  let adj = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (M.inBounds(nx, ny) && (S.territory[M.idx(nx, ny)] === S.me.slot || S.bridges.has(M.idx(nx, ny)))) adj = true;
  }
  if (!adj) return toast('Brücke muss an dein Gebiet oder eine Brücke grenzen.', 'err');
  if (!(await spend({ wood: 50 }))) return;
  const { data } = await sb.from('buildings')
    .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'world', type: 'bridge', x, y, construction_end_at: new Date().toISOString() })
    .select().single();
  if (data) { S.buildings.push(data); S.bridges.add(i); }
  playSfx('build');
  advanceTut('world_built');
}

async function ageUp() {
  const me = S.me;
  if (me.age >= 4) return;
  if (!(await spend(AGE_COST[me.age + 1]))) return;
  me.age += 1;
  await sb.from('match_players').update({ age: me.age }).eq('id', me.id);
  playSfx('horn');
  toast(`🏛️ Neues Zeitalter: ${AGE_NAMES[me.age]}!`, 'ok');
  await sysChat(`🏛️ ${me.kingdom_name} erreicht die ${AGE_NAMES[me.age]}!`);
  renderPanel();
}

async function trainUnits(type) {
  const me = S.me, u = UNITS[type];
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if (countType('barracks') === 0) return toast('Baue zuerst eine ⚔️ Kaserne auf der Weltkarte!', 'err');
  if (me.age < u.age) return toast(`Benötigt ${AGE_NAMES[u.age]}.`, 'err');
  if (!(await spend(u.cost, BATCH))) return;
  const home = S.armies.find((a) => a.player_id === me.id && a.unit_type === type && a.target_x == null && a.x === me.capital_x && a.y === me.capital_y);
  if (home) {
    home.count += BATCH;
    await sb.from('armies').update({ count: home.count }).eq('id', home.id);
  } else {
    const { data } = await sb.from('armies')
      .insert({ match_id: S.match.id, player_id: me.id, unit_type: type, count: BATCH, x: me.capital_x, y: me.capital_y })
      .select().single();
    if (data) S.armies.push(data);
  }
  playSfx('build');
  toast(`${BATCH}× ${u.name} ausgebildet!`, 'ok');
  advanceTut('trained');
  renderPanel();
}

function travelMs(unitType, x0, y0, x1, y1) {
  return (Math.hypot(x1 - x0, y1 - y0) * (UNITS[unitType]?.speed || 2) * 1800) / speed();
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
  if (a.target_x != null) return toast('Armee ist bereits unterwegs.', 'err');
  if (a.x === tx && a.y === ty) return;
  const path = M.checkPath(S.terrain, S.bridges, a.x, a.y, tx, ty, a.unit_type);
  if (!path.ok) return toast(path.reason, 'err');
  const owner = S.territory[M.idx(tx, ty)];
  const ownerP = owner >= 0 ? playerBySlot(owner) : null;
  const enemyArmy = S.armies.find((e) => e.player_id && e.player_id !== a.player_id && e.target_x == null && Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 1 && !allied(e.player_id, a.player_id));
  const attacksPlayer = (ownerP && ownerP.id !== S.me.id && !allied(ownerP.id, S.me.id)) || enemyArmy;
  if (attacksPlayer && !pvpAllowed()) return toast('🕊️ Freizeit-Frieden! Angriffe auf Spieler sind gerade gesperrt.', 'err');
  const arrives = new Date(now() + travelMs(a.unit_type, a.x, a.y, tx, ty)).toISOString();
  a.target_x = tx; a.target_y = ty; a.arrives_at = arrives;
  await sb.from('armies').update({ target_x: tx, target_y: ty, arrives_at: arrives }).eq('id', a.id);
  playSfx(attacksPlayer ? 'horn' : 'click');
  advanceTut('army_moved');
  S.selectedArmyId = null;
  updateModeHint(); renderPanel();
}

async function splitArmy(a) {
  if (a.count < 2 || a.target_x != null) return;
  const half = Math.floor(a.count / 2); a.count -= half;
  await sb.from('armies').update({ count: a.count }).eq('id', a.id);
  const { data } = await sb.from('armies').insert({ match_id: S.match.id, player_id: a.player_id, unit_type: a.unit_type, count: half, x: a.x, y: a.y }).select().single();
  if (data) S.armies.push(data);
  playSfx('click'); renderPanel();
}

async function mergeArmies(a) {
  const others = S.armies.filter((o) => o.id !== a.id && o.player_id === a.player_id && o.unit_type === a.unit_type && o.target_x == null && o.x === a.x && o.y === a.y);
  if (!others.length) return toast('Keine gleiche Armee auf diesem Feld.', 'err');
  let total = a.count;
  for (const o of others) { total += o.count; await sb.from('armies').delete().eq('id', o.id); }
  a.count = total; await sb.from('armies').update({ count: total }).eq('id', a.id);
  S.armies = S.armies.filter((o) => !others.includes(o));
  playSfx('click'); renderPanel();
}

// ---------------------------------------------------------------------------
// DIPLOMATIE, HANDEL & CHAT
// ---------------------------------------------------------------------------
async function setAlliance(name) {
  const alliance = name.trim().slice(0, 20);
  await sb.from('match_players').update({ alliance }).eq('id', S.me.id);
  S.me.alliance = alliance; playSfx('coins');
  toast(alliance ? `🤝 Allianz „${alliance}“ beigetreten` : 'Allianz verlassen', 'ok');
  if (alliance) await sysChat(`🤝 ${S.me.kingdom_name} tritt der Allianz „${alliance}“ bei.`);
  reloadPlayers();
}

async function sendResources(p, res, amount) {
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
  const html = S.chat.map((m) => {
    const t = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const p = playerById(m.player_id);
    return m.player_id
      ? `<div class="msg"><time>${t}</time><b style="color:${p ? p.color : '#9fc6e8'}">${esc(m.sender_name)}:</b> ${esc(m.message)}</div>`
      : `<div class="msg sys"><time>${t}</time>${esc(m.message)}</div>`;
  }).join('');
  for (const id of ['chat-log', 'lobby-chat-log']) {
    const el = $(id); if (!el) continue;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    el.innerHTML = html;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// AUTHORITY (Kämpfe, Provinzen erobern, Events, Sieg)
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
    const t = now(), sp = speed();
    const arrived = S.armies.filter((a) => a.target_x != null && a.arrives_at && new Date(a.arrives_at).getTime() <= t);
    for (const a of arrived) if (S.armies.includes(a)) await resolveArrival(a);
    if (S.territoryDirty && t - S.lastTerritoryWrite > 2000) await writeTerritory();
    if (t - S.lastSnapshot > 60000) {
      S.lastSnapshot = t;
      await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: Math.floor(t / 1000), owners_data: M.encodeTerritory(S.territory) });
    }
    if (t - S.lastEvent > 180000 / sp) { S.lastEvent = t; await randomEvent(); }
    if (t - S.lastBanditCheck > 30000) { S.lastBanditCheck = t; await maintainBandits(); }
  } catch (e) { console.warn('authorityTick', e); }
  finally { S.authBusy = false; }
}

function armyPower(a, x, y) {
  const u = UNITS[a.unit_type];
  let pw = (u ? u.power : a.unit_type === 'bandit' ? 8 : 0) * a.count;
  const tile = S.terrain[M.idx(x, y)];
  if (a.unit_type === 'archer' && tile === M.T.HILL) pw *= 1.5;
  if (!a.player_id && tile === M.T.FOREST) pw *= 1.15;
  const p = playerById(a.player_id);
  if (p && S.territory[M.idx(x, y)] === p.slot) {
    pw *= 1 + Math.min(0.6, countType('tower', p) * 0.15);
  }
  return pw;
}

function fight(att, def) {
  const ap = armyPower(att, att.x, att.y), dp = armyPower(def, def.x, def.y);
  if (dp <= 0) return { attackerWins: true, remaining: att.count };
  if (ap <= 0) return { attackerWins: false, remaining: def.count };
  if (ap >= dp) return { attackerWins: true, remaining: Math.max(1, Math.ceil(att.count * (1 - (dp / ap) * 0.8))) };
  return { attackerWins: false, remaining: Math.max(1, Math.ceil(def.count * (1 - (ap / dp) * 0.8))) };
}

async function updateArmy(a, patch) { Object.assign(a, patch); await sb.from('armies').update(patch).eq('id', a.id); }
async function deleteArmy(a) { S.armies = S.armies.filter((x) => x.id !== a.id); await sb.from('armies').delete().eq('id', a.id); }

async function resolveArrival(a) {
  const tx = a.target_x, ty = a.target_y, pvp = pvpAllowed(), attacker = playerById(a.player_id);
  let count = a.count;
  const foes = S.armies.filter((e) => e.id !== a.id && e.target_x == null && Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 1 && e.player_id !== a.player_id && !allied(e.player_id, a.player_id));
  for (const e of foes) {
    if ((a.player_id && e.player_id && !pvp) || (!a.player_id && !e.player_id)) continue;
    const res = fight({ ...a, count, x: tx, y: ty }, e);
    const defender = playerById(e.player_id);
    if (res.attackerWins) {
      count = res.remaining; await deleteArmy(e);
      if (!e.player_id && attacker) await grantLoot(attacker, e);
      else if (defender) await sysChat(`⚔️ ${attacker ? attacker.kingdom_name : 'Barbaren'} besiegt eine Armee von ${defender.kingdom_name}!`);
    } else {
      await updateArmy(e, { count: res.remaining }); await deleteArmy(a);
      if (attacker) await sysChat(`🛡️ Armee von ${attacker.kingdom_name} wurde geschlagen!`);
      return;
    }
  }
  await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
  if (attacker) conquer(tx, ty, attacker, pvp);
}

async function grantLoot(p, e) {
  const ruin = e.unit_type === 'ruin';
  const gold = ruin ? 80 + Math.floor(Math.random() * 70) : 30 + e.count * 4;
  await rpcAdd(p.id, ruin ? { gold, wood: 50 } : { gold, raw_food: 40 }, true);
  await sysChat(`💰 ${p.kingdom_name} plündert ${ruin ? 'eine Ruine' : 'ein Banditenlager'} (+${gold} Gold)!`);
}

function conquer(tx, ty, p, pvp) {
  const pid = S.provOf && M.inBounds(tx, ty) ? S.provOf[M.idx(tx, ty)] : -1;
  if (pid >= 0 && S.provinces[pid]) {
    const prov = S.provinces[pid];
    let gained = 0;
    for (const i of prov.tiles) {
      const owner = S.territory[i];
      if (owner === p.slot) continue;
      if (owner === -1 || (pvp && !allied(playerBySlot(owner)?.id, p.id))) {
        S.territory[i] = p.slot; gained++;
      }
    }
    if (gained > 0) toast(`🏳️ Provinz „${prov.name}“ erobert!`, 'ok');
  }
  S.territoryDirty = true; S.territoryVersion++;
}

async function writeTerritory() {
  S.lastTerritoryWrite = now(); S.territoryDirty = false;
  const str = M.encodeTerritory(S.territory);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < M.N; i++) if (S.territory[i] >= 0) counts[S.territory[i]]++;
  await sb.from('matches').update({ territory: str }).eq('id', S.match.id);
  S.match.territory = str;
  const oldEnough = now() - new Date(S.match.created_at).getTime() > 30000;
  for (const p of S.players) {
    const pct = Math.round((counts[p.slot] / S.landTotal) * 1000) / 10;
    const patch = {};
    if (Math.abs(pct - (p.territory_percent || 0)) >= 0.1) patch.territory_percent = pct;
    if (counts[p.slot] === 0 && !p.is_eliminated && oldEnough && p.capital_x != null) {
      patch.is_eliminated = true; await sysChat(`☠️ ${p.kingdom_name} wurde vernichtet!`);
    }
    if (Object.keys(patch).length) { Object.assign(p, patch); await sb.from('match_players').update(patch).eq('id', p.id); }
    if (pct >= 70 && S.match.status === 'running') { await endMatch(p, str); return; }
  }
}

async function endMatch(p, terrStr) {
  await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: Math.floor(now() / 1000), owners_data: terrStr });
  await sb.from('matches').update({ status: 'finished', winner_id: p.user_id }).eq('id', S.match.id);
  const { data: prof } = await sb.from('profiles').select('wins').eq('id', p.user_id).maybeSingle();
  if (prof) await sb.from('profiles').update({ wins: (prof.wins || 0) + 1 }).eq('id', p.user_id);
  await sysChat(`👑 ${p.kingdom_name} hat 70% der Welt erobert und gewonnen!`);
  await reloadMatch();
}

async function randomEvent() {
  if (Math.random() < 0.5) {
    const season = S.match.season === 'summer' ? 'winter' : 'summer';
    await sb.from('matches').update({ season }).eq('id', S.match.id);
    await sysChat(season === 'winter' ? '❄️ Winter! Produktion etwas langsamer.' : '☀️ Sommer kehrt zurück.');
  } else await spawnBarbarians();
}

async function spawnBarbarians() {
  const sp = speed(), rows = [];
  for (const p of S.players) {
    if (p.is_eliminated || p.capital_x == null) continue;
    for (let tries = 0; tries < 80; tries++) {
      const ang = Math.random() * Math.PI * 2, dist = 10 + Math.random() * 6;
      const x = Math.round(p.capital_x + Math.cos(ang) * dist), y = Math.round(p.capital_y + Math.sin(ang) * dist);
      if (!M.inBounds(x, y) || !M.isPassable(S.terrain[M.idx(x, y)])) continue;
      rows.push({
        match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 8 + p.age * 5, x, y,
        target_x: p.capital_x, target_y: p.capital_y,
        arrives_at: new Date(now() + (Math.hypot(x - p.capital_x, y - p.capital_y) * 2000) / sp).toISOString()
      });
      break;
    }
  }
  if (rows.length) { await sb.from('armies').insert(rows); await sysChat('🪓 BARBAREN-ANGRIFF!'); await reloadArmies(); }
}

async function maintainBandits() {
  if (S.armies.filter((a) => !a.player_id && a.unit_type === 'bandit' && a.target_x == null).length >= 12) return;
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.floor(Math.random() * M.W), y = Math.floor(Math.random() * M.H), i = M.idx(x, y);
    if (!M.isPassable(S.terrain[i]) || S.territory[i] !== -1) continue;
    await sb.from('armies').insert({ match_id: S.match.id, player_id: null, unit_type: 'bandit', count: 8 + Math.floor(Math.random() * 14), x, y });
    return;
  }
}

// ---------------------------------------------------------------------------
// FOG OF WAR & RENDERING (nur Weltkarte)
// ---------------------------------------------------------------------------
function computeVisibility() {
  if (!S.me || !S.terrain) return;
  const vis = S.visible;
  if (S.fogOff || S.match?.status === 'finished') vis.fill(1);
  else {
    vis.fill(0);
    const friendly = new Set(S.players.filter((p) => p.id === S.me.id || allied(p.id, S.me.id)).map((p) => p.slot));
    const mark = (cx, cy, r) => {
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy; if (y < 0 || y >= M.H) continue;
        for (let dx = -r; dx <= r; dx++) { const x = cx + dx; if (x >= 0 && x < M.W) vis[y * M.W + x] = 1; }
      }
    };
    for (let i = 0; i < M.N; i++) if (friendly.has(S.territory[i])) mark(i % M.W, Math.floor(i / M.W), 2);
    for (const a of S.armies) {
      if (!a.player_id || !allied(a.player_id, S.me.id)) continue;
      const p = armyPos(a); mark(Math.round(p.x), Math.round(p.y), 4);
    }
    for (const b of S.buildings) {
      if (b.type === 'tower' && allied(b.player_id, S.me.id)) mark(b.x, b.y, 6);
    }
    if (S.me.capital_x != null) mark(S.me.capital_x, S.me.capital_y, 5);
  }
  for (let i = 0; i < M.N; i++) if (vis[i] && !S.explored[i]) { S.explored[i] = 1; S.exploredDirty = true; }
  S.fogVersion++;
}

function frame() {
  if (!S.inGame) { S.rafRunning = false; return; }
  try { render(); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}

function getTerrainCanvas() {
  const season = S.match?.season || 'summer';
  if (!S.terrainCanvases[season]) {
    const c = document.createElement('canvas'); c.width = M.W * TILE; c.height = M.H * TILE;
    const ctx = c.getContext('2d');
    for (let i = 0; i < M.N; i++) ctx.drawImage(getTerrainSprite(M.TERRAIN_KEYS[S.terrain[i]], season), (i % M.W) * TILE, Math.floor(i / M.W) * TILE);
    S.terrainCanvases[season] = c;
  }
  return S.terrainCanvases[season];
}

function rebuildTerritoryCanvas() {
  if (!S.terrCanvas) { S.terrCanvas = document.createElement('canvas'); S.terrCanvas.width = M.W; S.terrCanvas.height = M.H; }
  const ctx = S.terrCanvas.getContext('2d'), img = ctx.createImageData(M.W, M.H);
  const colors = {}; for (const p of S.players) colors[p.slot] = hexToRgb(p.color);
  const terr = S.territory;
  for (let i = 0; i < M.N; i++) {
    const o = terr[i]; if (o < 0) continue;
    const x = i % M.W, y = Math.floor(i / M.W);
    const border = (x > 0 && terr[i - 1] !== o) || (x < M.W - 1 && terr[i + 1] !== o) || (y > 0 && terr[i - M.W] !== o) || (y < M.H - 1 && terr[i + M.W] !== o);
    const [r, g, b] = colors[o] || hexToRgb(PLAYER_COLORS[o]);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = border ? 210 : 95;
  }
  ctx.putImageData(img, 0, 0); S.terrBuilt = S.territoryVersion;
}

function rebuildFogCanvas() {
  if (!S.fogCanvas) { S.fogCanvas = document.createElement('canvas'); S.fogCanvas.width = M.W; S.fogCanvas.height = M.H; }
  const ctx = S.fogCanvas.getContext('2d'), img = ctx.createImageData(M.W, M.H);
  for (let i = 0; i < M.N; i++) {
    img.data[i * 4 + 3] = S.visible[i] ? 0 : S.explored[i] ? 140 : 255;
    img.data[i * 4] = 8; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 16;
  }
  ctx.putImageData(img, 0, 0); S.fogBuilt = S.fogVersion;
}

function render() {
  const c = $('game-canvas'), ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  if (!S.terrain || !S.me) return;

  const cam = S.camW, z = cam.z;
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  const season = S.match.season;
  ctx.drawImage(getTerrainCanvas(), 0, 0);
  for (const i of S.bridges) ctx.drawImage(getTerrainSprite('bridge', season), (i % M.W) * TILE, Math.floor(i / M.W) * TILE);

  if (S.terrBuilt !== S.territoryVersion) rebuildTerritoryCanvas();
  ctx.drawImage(S.terrCanvas, 0, 0, M.W * TILE, M.H * TILE);

  if (S.provOf && !S.provBorderCanvas) {
    const bc = document.createElement('canvas'); bc.width = M.W; bc.height = M.H;
    const bctx = bc.getContext('2d'), bimg = bctx.createImageData(M.W, M.H), po = S.provOf;
    for (let i = 0; i < M.N; i++) {
      const pid = po[i]; if (pid < 0) continue;
      const x = i % M.W, y = Math.floor(i / M.W);
      if ((x < M.W - 1 && po[i + 1] !== pid) || (y < M.H - 1 && po[i + M.W] !== pid)) {
        bimg.data[i * 4] = 20; bimg.data[i * 4 + 1] = 15; bimg.data[i * 4 + 2] = 10; bimg.data[i * 4 + 3] = 115;
      }
    }
    bctx.putImageData(bimg, 0, 0); S.provBorderCanvas = bc;
  }
  if (S.provBorderCanvas) ctx.drawImage(S.provBorderCanvas, 0, 0, M.W * TILE, M.H * TILE);

  // Weltkarten-Gebäude direkt auf der Weltkarte
  for (const b of S.buildings) {
    if (b.type === 'bridge') continue;
    const i = M.idx(b.x, b.y);
    if (!S.explored[i] && !S.fogOff && b.player_id !== S.me.id) continue;
    const owner = playerById(b.player_id);
    ctx.drawImage(getBuildingSprite(b.type, owner ? owner.color : '#888'), b.x * TILE, b.y * TILE, TILE, TILE);
  }

  // Hauptstädte (Burg + Wappen)
  for (const p of S.players) {
    if (p.capital_x == null || p.is_eliminated) continue;
    const i = M.idx(p.capital_x, p.capital_y);
    if (!S.explored[i] && !S.fogOff) continue;
    ctx.drawImage(getBuildingSprite('castle', p.color), p.capital_x * TILE - 4, p.capital_y * TILE - 4, TILE + 8, TILE + 8);
    ctx.drawImage(getEmblemSprite(p.emblem, p.color), p.capital_x * TILE + 2, p.capital_y * TILE - 12, 12, 12);
  }

  // Armeen
  const tNow = now();
  ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
  for (const a of S.armies) {
    const pos = armyPos(a), ix = Math.round(pos.x), iy = Math.round(pos.y);
    if (!M.inBounds(ix, iy)) continue;
    const friendly = a.player_id && allied(a.player_id, S.me.id);
    if (!friendly && !S.visible[M.idx(ix, iy)]) continue;
    const owner = playerById(a.player_id);
    const sprite = !a.player_id
      ? getUnitSprite(a.unit_type === 'ruin' ? 'ruin' : pos.moving ? 'bandit' : 'camp', '#7a2c2c')
      : getUnitSprite(a.unit_type, owner ? owner.color : '#888');
    const px = pos.x * TILE, py = pos.y * TILE + (pos.moving ? Math.sin(tNow / 120) * 0.8 : 0);
    if (friendly && pos.moving) {
      ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 0.6; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(px + 8, py + 8); ctx.lineTo(a.target_x * TILE + 8, a.target_y * TILE + 8); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (a.id === S.selectedArmyId) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1; ctx.strokeRect(px - 1, py - 1, TILE + 2, TILE + 2); }
    ctx.drawImage(sprite, px, py);
    if (a.unit_type !== 'ruin') {
      ctx.fillStyle = '#000c'; ctx.fillRect(px + 2, py + TILE - 1, 12, 6);
      ctx.fillStyle = owner ? '#fff' : '#ff9a8a'; ctx.fillText(String(a.count), px + 8, py + TILE + 4);
    }
  }

  if (!S.fogOff) {
    if (S.fogBuilt !== S.fogVersion) rebuildFogCanvas();
    ctx.drawImage(S.fogCanvas, 0, 0, M.W * TILE, M.H * TILE);
  }

  // Bau-Vorschau auf der Weltkarte
  if (S.buildType && S.hoverTile && M.inBounds(S.hoverTile.x, S.hoverTile.y)) {
    const { x, y } = S.hoverTile, i = M.idx(x, y);
    const ok = S.territory[i] === S.me.slot && M.isPassable(S.terrain[i]) && !S.buildings.some((b) => b.x === x && b.y === y);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(getBuildingSprite(S.buildType, S.me.color), x * TILE, y * TILE, TILE, TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#7dff7a' : '#ff4040'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x * TILE, y * TILE, TILE, TILE);
  } else if (S.hoverTile) {
    ctx.strokeStyle = S.bridgeMode ? '#4fc3f7' : '#ffffffcc';
    ctx.lineWidth = (1 / z) * 1.5;
    ctx.strokeRect(S.hoverTile.x * TILE, S.hoverTile.y * TILE, TILE, TILE);
  }
}

// ---------------------------------------------------------------------------
// INPUT (Maus + iPad Touch / Pinch-to-Zoom)
// ---------------------------------------------------------------------------
function screenToTile(mx, my) {
  return { x: Math.floor((S.camW.x + mx / S.camW.z) / TILE), y: Math.floor((S.camW.y + my / S.camW.z) / TILE) };
}
function zoomAt(mx, my, factor) {
  const cam = S.camW, nz = clamp(cam.z * factor, 0.35, 6);
  const wx = cam.x + mx / cam.z, wy = cam.y + my / cam.z;
  cam.z = nz; cam.x = wx - mx / nz; cam.y = wy - my / nz;
}

function bindCanvas() {
  const c = $('game-canvas');
  const pos = (e) => { const r = c.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; };
  const activePts = new Map();
  let pinchDist = 0;

  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomAt(p.mx, p.my, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

  c.addEventListener('pointerdown', (e) => {
    const p = pos(e); activePts.set(e.pointerId, p); c.setPointerCapture(e.pointerId);
    if (activePts.size === 2) {
      const [p1, p2] = [...activePts.values()];
      pinchDist = Math.hypot(p2.mx - p1.mx, p2.my - p1.my);
      S.drag = null; return;
    }
    if (e.button === 2) {
      S.buildType = null; S.bridgeMode = false; S.selectedArmyId = null;
      updateModeHint(); renderPanel(); return;
    }
    S.drag = { sx: p.mx, sy: p.my, cx: S.camW.x, cy: S.camW.y, moved: false };
  });

  c.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (activePts.has(e.pointerId)) activePts.set(e.pointerId, p);
    if (activePts.size === 2) {
      const [p1, p2] = [...activePts.values()];
      const nd = Math.hypot(p2.mx - p1.mx, p2.my - p1.my);
      if (pinchDist > 10 && nd > 10) zoomAt((p1.mx + p2.mx) / 2, (p1.my + p2.my) / 2, nd / pinchDist);
      pinchDist = nd; return;
    }
    S.hoverTile = screenToTile(p.mx, p.my);
    const d = S.drag; if (!d) return;
    if (Math.abs(p.mx - d.sx) + Math.abs(p.my - d.sy) > 5) d.moved = true;
    if (d.moved) { S.camW.x = d.cx - (p.mx - d.sx) / S.camW.z; S.camW.y = d.cy - (p.my - d.sy) / S.camW.z; }
  });

  const endPtr = (e) => { activePts.delete(e.pointerId); if (activePts.size < 2) pinchDist = 0; };
  c.addEventListener('pointerup', (e) => {
    endPtr(e);
    const d = S.drag; S.drag = null;
    if (!d || d.moved) return;
    const p = pos(e);
    onCanvasClick(screenToTile(p.mx, p.my));
  });
  c.addEventListener('pointercancel', endPtr);
  c.addEventListener('pointerleave', () => { S.hoverTile = null; });
}

function onCanvasClick(t) {
  if (!S.me || !S.match || !M.inBounds(t.x, t.y)) return;
  if (S.buildType) { placeWorldBuilding(S.buildType, t.x, t.y); return; }
  if (S.bridgeMode) { buildBridge(t.x, t.y); return; }

  const own = S.armies.find((a) => a.player_id === S.me.id && a.target_x == null && a.x === t.x && a.y === t.y && a.id !== S.selectedArmyId);
  const sel = S.armies.find((a) => a.id === S.selectedArmyId);
  if (sel) {
    if (own && own.x === sel.x && own.y === sel.y) { S.selectedArmyId = own.id; return renderPanel(); }
    moveArmy(sel, t.x, t.y); return;
  }
  if (own) {
    S.selectedArmyId = own.id; playSfx('click');
    updateModeHint(); setActiveTab('army'); return;
  }
  S.selectedTile = t;
  advanceTut('tile_clicked');
  updateTileBar();
}

function updateTileBar() {
  const bar = $('tile-bar');
  if (!bar || !S.selectedTile || !S.terrain) { if (bar) bar.hidden = true; return; }
  const { x, y } = S.selectedTile, i = M.idx(x, y);
  const known = S.explored[i] || S.fogOff;
  const owner = S.territory[i] >= 0 ? playerBySlot(S.territory[i]) : null;
  const pid = S.provOf ? S.provOf[i] : -1;
  const prov = pid >= 0 ? S.provinces[pid] : null;
  const bld = S.buildings.find((b) => b.x === x && b.y === y);

  bar.innerHTML = '';
  bar.appendChild(h(`<b>${known && prov ? `🏰 Provinz ${esc(prov.name)}` : `Feld (${x}, ${y})`}</b> · ` +
    `${known ? M.TERRAIN_LABELS[S.terrain[i]] : '???'} · ` +
    `${known ? (owner ? `<span style="color:${owner.color}">${esc(owner.kingdom_name)}</span>` : 'Neutral') : '???'}` +
    (bld && known ? ` · ${BUILDINGS[bld.type]?.name || 'Brücke'}` : '')));
  if (bld && bld.player_id === S.me?.id && bld.type !== 'bridge') {
    bar.appendChild(btn('🪓 Abreißen', () => demolishBuilding(bld), 'btn small danger'));
  }
  bar.hidden = false;
}

function bindKeys() {
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { S.buildType = null; S.bridgeMode = false; S.selectedArmyId = null; updateModeHint(); renderPanel(); }
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  setInterval(() => {
    if (!S.inGame) return;
    const step = 12 / S.camW.z;
    if (keys.has('w') || keys.has('arrowup')) S.camW.y -= step;
    if (keys.has('s') || keys.has('arrowdown')) S.camW.y += step;
    if (keys.has('a') || keys.has('arrowleft')) S.camW.x -= step;
    if (keys.has('d') || keys.has('arrowright')) S.camW.x += step;
  }, 16);
}

// ---------------------------------------------------------------------------
// SIDEBAR-PANELS (3 einfache Tabs + Chat)
// ---------------------------------------------------------------------------
function setActiveTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('panel').hidden = tab === 'chat';
  $('panel-chat').hidden = tab !== 'chat';
  if (tab === 'chat') { $('chat-badge').hidden = true; renderChat(); $('chat-log').scrollTop = $('chat-log').scrollHeight; }
  renderPanel();
}

function renderPanel() {
  if (!S.inGame || !S.me || S.activeTab === 'chat') return;
  const el = $('panel'), scroll = el.scrollTop;
  el.innerHTML = '';
  const fn = { build: panelBuild, army: panelArmy, diplo: panelDiplo }[S.activeTab];
  if (fn) fn(el);
  el.scrollTop = scroll;
}

function h(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }
function btn(label, onClick, cls = 'btn small', disabled = false, title = '') {
  const b = document.createElement('button');
  b.className = cls; b.innerHTML = label; b.disabled = disabled; if (title) b.title = title;
  b.onclick = (e) => { e.preventDefault(); playSfx('click'); onClick(); };
  return b;
}

function panelBuild(el) {
  const me = S.me;
  const { d } = estimateRates();
  el.appendChild(h(`<div class="info-box"><h3>📊 Produktion / Sek.</h3>
    <div class="stat"><span>🪵 Holz</span><b>+${d.wood.toFixed(1)}</b></div>
    <div class="stat"><span>💰 Gold</span><b>+${d.gold.toFixed(1)}</b></div>
    <div class="stat"><span>🌾 Nahrung</span><b>+${d.raw_food.toFixed(1)}</b></div>
    <div class="stat"><span>👥 Einwohner</span><b>${me.population}/${popCap()}</b></div></div>`));

  const ageBox = h(`<div class="info-box"><h3>🏛️ ${AGE_NAMES[me.age]}</h3></div>`);
  if (me.age < 4) {
    ageBox.firstChild.appendChild(h(`<p class="muted">Nächstes: <b>${AGE_NAMES[me.age + 1]}</b> (${costText(AGE_COST[me.age + 1])})</p>`));
    ageBox.firstChild.appendChild(btn('⬆️ Zeitalter aufsteigen', ageUp, 'btn small gold'));
  } else ageBox.firstChild.appendChild(h('<p class="muted">Höchstes Zeitalter erreicht!</p>'));
  el.appendChild(ageBox);

  el.appendChild(h('<h3>🔨 Auf Weltkarte bauen</h3><p class="muted">Gebäude wählen, dann in deinem Gebiet antippen.</p>'));
  const grid = document.createElement('div'); grid.className = 'grid2';
  for (const [type, def] of Object.entries(BUILDINGS)) {
    const afford = Object.entries(def.cost).every(([k, v]) => (me[k] || 0) >= v);
    const b = document.createElement('button');
    b.className = `bcard${S.buildType === type ? ' active' : ''}`;
    b.title = def.desc; b.disabled = !afford;
    b.innerHTML = `<img src="${spriteUrl(getBuildingSprite(type, me.color), 'b' + type + me.color)}" alt=""><div><div class="name">${def.name}</div><div class="cost">${costText(def.cost)}</div></div>`;
    b.onclick = () => {
      playSfx('click'); S.buildType = S.buildType === type ? null : type; S.bridgeMode = false;
      updateModeHint(); renderPanel();
    };
    grid.appendChild(b);
  }
  el.appendChild(grid);

  el.appendChild(h('<div style="margin-top:8px"></div>'));
  el.appendChild(btn(S.bridgeMode ? '❌ Brückenbau beenden' : '🌉 Brücke über Wasser (🪵50)', () => {
    S.bridgeMode = !S.bridgeMode; S.buildType = null; updateModeHint(); renderPanel();
  }, `btn small${S.bridgeMode ? ' active' : ''}`));
}

function panelArmy(el) {
  const me = S.me, hasBarracks = countType('barracks') > 0;
  el.appendChild(h(`<h3>🛡️ Truppen (${BATCH}er Trupps)</h3>${hasBarracks ? '' : '<p class="muted">⚠️ Baue zuerst eine <b>⚔️ Kaserne</b> unter Bauen.</p>'}`));
  for (const [type, u] of Object.entries(UNITS)) {
    const locked = me.age < u.age;
    const row = document.createElement('div'); row.className = 'army-row';
    const total = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, v * BATCH]));
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(type, me.color), 'u' + type + me.color)}" alt=""><div class="grow"><b>${u.name}</b> · ⚔️${u.power}<br><span class="muted">${costText(total)}${u.note ? ' · ' + u.note : ''}${locked ? ' · 🔒 ' + AGE_NAMES[u.age] : ''}</span></div>`;
    row.appendChild(btn('+5', () => trainUnits(type), 'btn small primary', !hasBarracks || locked));
    el.appendChild(row);
  }

  el.appendChild(h('<h3>⚔️ Deine Armeen</h3><p class="muted">Armee antippen → Provinz antippen zum Erobern.</p>'));
  const mine = S.armies.filter((a) => a.player_id === me.id);
  if (!mine.length) el.appendChild(h('<p class="muted">Keine Armeen.</p>'));
  for (const a of mine) {
    const p = armyPos(a);
    const row = document.createElement('div'); row.className = `army-row${a.id === S.selectedArmyId ? ' sel' : ''}`;
    const eta = a.arrives_at ? Math.max(0, Math.ceil((new Date(a.arrives_at).getTime() - now()) / 1000)) : 0;
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(a.unit_type, me.color), 'u' + a.unit_type + me.color)}" alt=""><div class="grow"><b>${a.count}× ${UNITS[a.unit_type]?.name || a.unit_type}</b><br><span class="muted">${p.moving ? `🚶 → (${a.target_x},${a.target_y}) ${eta}s` : `📍 (${a.x},${a.y})`}</span></div>`;
    row.appendChild(btn(a.id === S.selectedArmyId ? '✔' : 'Wählen', () => {
      S.selectedArmyId = a.id === S.selectedArmyId ? null : a.id;
      S.camW.x = p.x * TILE - $('game-canvas').width / 2 / S.camW.z;
      S.camW.y = p.y * TILE - $('game-canvas').height / 2 / S.camW.z;
      updateModeHint(); renderPanel();
    }, 'btn small', p.moving));
    el.appendChild(row);
    if (a.id === S.selectedArmyId && !p.moving) {
      const actions = document.createElement('div'); actions.className = 'row'; actions.style.marginBottom = '8px';
      actions.appendChild(btn('✂️ Teilen', () => splitArmy(a), 'btn small', a.count < 2));
      actions.appendChild(btn('🔗 Vereinen', () => mergeArmies(a)));
      el.appendChild(actions);
    }
  }
}

function panelDiplo(el) {
  const me = S.me;
  const allyBox = h(`<div class="info-box"><h3>🤝 Allianz</h3><p class="muted">Gleicher Name = verbündet (kein Angriff, geteilte Sicht).</p></div>`);
  const form = document.createElement('form'); form.className = 'row';
  form.innerHTML = `<input id="ally-input" maxlength="20" placeholder="Allianz-Name" value="${esc(me.alliance)}"><button class="btn small">OK</button>`;
  form.onsubmit = (e) => { e.preventDefault(); setAlliance($('ally-input').value); };
  allyBox.firstChild.appendChild(form); el.appendChild(allyBox);

  el.appendChild(h('<h3>👑 Königreiche (Ziel: 70%)</h3>'));
  for (const p of [...S.players].sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0))) {
    const isMe = p.id === me.id, ally = !isMe && allied(p.id, me.id);
    const box = document.createElement('div'); box.className = 'info-box'; box.style.borderLeft = `5px solid ${p.color}`;
    const head = document.createElement('div'); head.className = 'row';
    head.appendChild(emblemCanvas(p.emblem, p.color, 24));
    head.appendChild(h(`<div><b>${esc(p.kingdom_name)}</b>${isMe ? ' (Du)' : ''}${ally ? ' 🤝' : ''}${p.is_eliminated ? ' ☠️' : ''}<br><span class="muted">${AGE_NAMES[p.age]} · 🗺️ ${(p.territory_percent || 0).toFixed(1)}%${p.alliance ? ' · „' + esc(p.alliance) + '“' : ''}</span></div>`));
    box.appendChild(head);
    if (!isMe && !p.is_eliminated) {
      const actions = document.createElement('div'); actions.className = 'row'; actions.style.marginTop = '6px';
      const sel = document.createElement('select'); sel.style.width = '80px'; sel.style.display = 'inline-block';
      sel.innerHTML = ['wood', 'gold', 'raw_food'].map((r) => `<option value="${r}">${RES_ICON[r]}</option>`).join('');
      const amt = document.createElement('input'); amt.type = 'number'; amt.value = '50'; amt.min = '1'; amt.style.width = '70px'; amt.style.display = 'inline-block';
      actions.append(sel, amt, btn('📦 Senden', () => sendResources(p, sel.value, Number(amt.value))));
      box.appendChild(actions);
    }
    el.appendChild(box);
  }
}

// ---------------------------------------------------------------------------
// SIEG & ZEITRAFFER-REPLAY
// ---------------------------------------------------------------------------
async function showEnd() {
  if (S.endShown) return; S.endShown = true;
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
  const canvas = $('replay-canvas'), arr = new Int8Array(M.N);
  let k = 0;
  const timer = setInterval(() => {
    if ($('modal-end').hidden) return clearInterval(timer);
    M.decodeTerritory(snaps[k], arr); drawMiniMap(canvas, S.terrain, arr);
    $('replay-info').textContent = `⏳ Zeitraffer: ${k + 1}/${snaps.length}`;
    k = (k + 1) % snaps.length;
  }, Math.max(150, 4000 / snaps.length));
}

// ---------------------------------------------------------------------------
// INTERAKTIVES TUTORIAL (4 einfache Schritte auf der Weltkarte)
// ---------------------------------------------------------------------------
const TUT_STEPS = [
  { trigger: 'tile_clicked', title: '1/4 · Weltkarte & Provinzen', text: 'Tippe auf ein beliebiges Feld auf der Weltkarte, um den Namen der Provinz und ihren Besitzer zu sehen.' },
  { trigger: 'world_built', title: '2/4 · Direkt auf der Karte bauen', text: 'Wähle rechts unter „🔨 Bauen“ einen Bauernhof, Holzfäller oder eine Kaserne und tippe auf ein freies Feld in deinem Gebiet!' },
  { trigger: 'trained', title: '3/4 · Truppen ausbilden', text: 'Öffne den Tab „⚔️ Armee“ (falls nötig erst eine Kaserne bauen) und bilde mit „+5“ Truppen aus!' },
  { trigger: 'army_moved', title: '4/4 · Provinz erobern!', text: 'Tippe deine Armee an (oder auf „Wählen“) und tippe dann auf eine neutrale Nachbar-Provinz, um sie zu erobern!' }
];

function startInteractiveTut() { if (S.inGame) { S.tutStep = 0; renderTut(); } }
function renderTut() {
  const box = $('tut-coach'); if (!box) return;
  if (S.tutStep < 0 || S.tutStep >= TUT_STEPS.length || !S.inGame) { box.hidden = true; return; }
  $('tut-title').textContent = `📖 ${TUT_STEPS[S.tutStep].title}`;
  $('tut-text').textContent = TUT_STEPS[S.tutStep].text;
  box.hidden = false;
}
function advanceTut(trigger) {
  if (S.tutStep < 0 || S.tutStep >= TUT_STEPS.length || TUT_STEPS[S.tutStep].trigger !== trigger) return;
  S.tutStep++; playSfx('coins');
  if (S.tutStep >= TUT_STEPS.length) {
    S.tutStep = -1; localStorage.setItem('fk_it_done', '1');
    toast('🎉 Tutorial geschafft! +25 Gold Bonus!', 'ok');
    if (S.me) rpcAdd(S.me.id, { gold: 25 }, true);
  } else toast('✅ Schritt geschafft!', 'ok');
  renderTut();
}

// ---------------------------------------------------------------------------
// EVENT-BINDINGS & START
// ---------------------------------------------------------------------------
function toggleMute() {
  setMuted(!isMuted());
  const icon = isMuted() ? '🔇' : '🔊';
  $('btn-mute').textContent = icon; $('btn-mute-global').textContent = icon;
  localStorage.setItem('fk_muted', isMuted() ? '1' : '0');
}

function bindStatic() {
  $('btn-login').onclick = () => doLogin('login');
  $('btn-register').onclick = () => doLogin('register');
  $('btn-guest').onclick = () => doLogin('guest');
  $('login-pw').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin('login'));
  $('btn-logout').onclick = () => { logoutUser(); S.user = null; leaveMatchState(); showScreen('screen-login'); };
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
    const v = $('lobby-map').value; $('lobby-custom-wrap').hidden = v !== 'custom';
    const patch = { map_type: v };
    if (v === 'custom') {
      if (!$('lobby-custom').value) return toast('Keine eigene Karte vorhanden.', 'err');
      patch.custom_map_id = $('lobby-custom').value;
    }
    updateMatchSettings(patch);
  };
  $('lobby-custom').onchange = () => updateMatchSettings({ custom_map_id: $('lobby-custom').value });
  $('lobby-speed').onchange = () => updateMatchSettings({ game_speed: Number($('lobby-speed').value) });
  $('lobby-chat-form').onsubmit = (e) => { e.preventDefault(); sendChat($('lobby-chat-input').value); $('lobby-chat-input').value = ''; };

  $('chat-form').onsubmit = (e) => { e.preventDefault(); sendChat($('chat-input').value); $('chat-input').value = ''; };
  $('btn-tutorial-menu').onclick = () => { playSfx('click'); $('modal-tutorial').hidden = false; };
  $('btn-tutorial').onclick = () => { playSfx('click'); $('modal-tutorial').hidden = false; };
  $('btn-start-tut').onclick = () => {
    $('modal-tutorial').hidden = true;
    if (S.inGame) startInteractiveTut(); else toast('Starte ein Spiel, dann startet das interaktive Tutorial!', 'ok');
  };
  $('tut-next').onclick = () => { if (S.tutStep >= 0 && S.tutStep < TUT_STEPS.length) advanceTut(TUT_STEPS[S.tutStep].trigger); };
  $('tut-skip').onclick = () => { S.tutStep = -1; localStorage.setItem('fk_it_done', '1'); renderTut(); };
  $('btn-cancel-mode').onclick = () => { S.buildType = null; S.bridgeMode = false; S.selectedArmyId = null; updateModeHint(); renderPanel(); };
  $('btn-admin').onclick = openAdminPanel;
  $('btn-mute').onclick = toggleMute; $('btn-mute-global').onclick = toggleMute;
  $('btn-leave-game').onclick = () => { if (confirm('Zurück zum Menü?')) showMenu(); };
  $('btn-zoom-in').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 1.25); };
  $('btn-zoom-out').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 0.8); };
  $('btn-center').onclick = centerOnCapital;
  $('btn-end-menu').onclick = showMenu;
  document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { playSfx('click'); setActiveTab(b.dataset.tab); }; });
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { $(b.dataset.close).hidden = true; }; });
  window.addEventListener('resize', () => S.inGame && resizeCanvas());
  bindCanvas(); bindKeys();
}

setupAdmin({
  S, sb, M, toast, rpcAdd, sysChat, startMatch, spawnBarbarians,
  triggerFire: async () => toast('Feuer-Events sind im vereinfachten Modus deaktiviert.'),
  fullReload, isAdmin,
  onFogChange: () => { S.fogVersion++; computeVisibility(); },
  onCustomMapsChanged: loadCustomMapOptions
});

function boot() {
  bindStatic();
  if (localStorage.getItem('fk_muted') === '1') toggleMute();
  const saved = getSavedUser();
  if (saved) {
    S.user = saved; showMenu();
    if (localStorage.getItem('fk_tut_seen') !== '1') { localStorage.setItem('fk_tut_seen', '1'); $('modal-tutorial').hidden = false; }
  } else showScreen('screen-login');
}
boot();
