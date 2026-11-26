// ============================================================================
// js/game.js – Vereinfachtes Hauptspiel: Alles auf einer 200x200 Weltkarte
// ============================================================================
import {
  sb, isAdminUser, getSavedUser, loginWithNamePassword, loginAsGuest, logoutUser, subscribeMatchRealtime
} from './supabase.js';
import {
  getTerrainSprite, getBuildingSprite, getEmblemSprite, getUnitSprite, getConnectedSprite, drawFlagBg, playSfx, setMuted, isMuted
} from './sprites.js';
import * as M from './map.js';
import { setupAdmin, openAdminPanel, openMapEditor, refreshAdminPanel } from './admin.js';

const $ = (id) => document.getElementById(id);
const TILE = 16;
const CHUNK = 64;
const PLAYER_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#9b5de5', '#f15bb5', '#00bbf9', '#fb8500', '#8ac926', '#adb5bd'];
const EMBLEMS = { crown: 'Krone', lion: 'Löwe', dragon: 'Drache', sword: 'Schwert' };
const AGE_NAMES = ['', 'Dunkles Zeitalter', 'Feudalzeit', 'Ritterzeit', 'Kaiserzeit'];
const AGE_COST = {
  2: { gold: 250 },
  3: { gold: 550 },
  4: { gold: 1000 }
};
const RES_ICON = { gold: '💰' };
const RES_NAME = { gold: 'Gold' };

// Control-Europe-Stil: Jede Provinz kann direkt ausgebaut werden (einzige Währung: Gold)
const BUILDINGS = {
  house:    { name: 'Haus',       cost: { gold: 35 }, buildTime: 6,  desc: '+15 Arbeitskraft-Limit (für neue Truppen).' },
  market:   { name: 'Marktplatz', cost: { gold: 50 }, buildTime: 8,  desc: '+2.0 💰 Gold/Sek. in dieser Provinz (2× auf Gold-Land).' },
  fort:     { name: 'Festung',    cost: { gold: 60 }, buildTime: 10, desc: '+80 Provinz-Verteidigung & +25% Kampfbonus.' },
  barracks: { name: 'Kaserne',    cost: { gold: 50 }, buildTime: 8,  desc: 'Ermöglicht Truppen-Rekrutierung in dieser Provinz.' },
  harbor:   { name: 'Hafen',      cost: { gold: 65 }, buildTime: 10, desc: 'Nur Küste: +3.0 💰 Gold/Sek. & Schiffe bauen.' }
};

const UNITS = {
  swordsman: { name: 'Schwertkämpfer', age: 1, power: 10, speed: 1.3, trainTime: 7,  cost: { gold: 8 } },
  archer:    { name: 'Bogenschütze',   age: 2, power: 13, speed: 1.3, trainTime: 9,  cost: { gold: 11 }, note: '+50% auf Hügeln' },
  ship:      { name: 'Schiff',         age: 2, power: 12, speed: 1.0, trainTime: 10, cost: { gold: 16 }, note: 'Startet im Hafen' },
  warship:   { name: 'Kriegsschiff',   age: 3, power: 30, speed: 1.1, trainTime: 14, cost: { gold: 32 }, note: 'Stark auf See' },
  spy:       { name: 'Spion',          age: 2, power: 1,  speed: 0.7, trainTime: 8,  cost: { gold: 12 }, note: 'Späht Gegner aus' },
  knight:    { name: 'Ritter',         age: 3, power: 26, speed: 0.9, trainTime: 13, cost: { gold: 20 } },
  catapult:  { name: 'Katapult',       age: 4, power: 42, speed: 1.8, trainTime: 17, cost: { gold: 30 }, note: '2.5× gegen Festungen' },
  king:      { name: 'König',          age: 9, power: 35, speed: 1.1, trainTime: 0,  cost: {}, note: '+25% Kraft im Umkreis' }
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
  selectedArmyId: null, selectedTile: null, selectedProvId: -1, buildType: null, bridgeMode: false, hoverTile: null,
  online: [], spied: {}, fogOff: false, unsub: null, timers: [], menuTimer: null, inGame: false,
  acc: { gold: 0 }, popAcc: 0,
  lastTerritoryWrite: 0, lastSnapshot: 0, lastEvent: Date.now(), lastExploredSave: 0,
  authBusy: false, endShown: false, activeTab: 'build', drag: null,
  lobbyFormFilled: false, myEmblem: 'crown', rafRunning: false, tutStep: -1,
  quests: { built: 0, conquered: 0, trade: 0, fort: 0, done: {} },
  alertedArmies: new Set(), provCooldown: {}, fx: [], trainQueue: [], pendingBuilds: [], chatFilter: 'all',
  reconUntil: 0, frontPush: false, frontlineMode: false, frontTarget: null, entrench: {}, armyRanks: {}, supplied: new Uint8Array(M.N), peakPct: {},
  armyRoutes: {}, provHp: {}, armyVis: {}
};
const isDone = (b) => !b.construction_end_at || new Date(b.construction_end_at).getTime() <= now();

// ---------------------------------------------------------------------------
// HILFSFUNKTIONEN
// ---------------------------------------------------------------------------
const provName = (prov) => (prov ? (S.match?.prov_names?.[prov.id] || prov.name) : '');
function flashEvent(msg, cls = '', dur = 4000) {
  const el = $('event-flash'); if (!el) return;
  el.textContent = msg;
  el.className = `event-flash ${cls}`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, dur);
}
function addFx(kind, x, y, extra = {}) {
  S.fx.push({ kind, x, y, start: now(), dur: extra.dur || 1400, ...extra });
}
const napKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
function hasNap(idA, idB) {
  if (!idA || !idB || idA === idB) return false;
  const naps = S.match?.naps || {};
  return (naps[napKey(idA, idB)] || 0) > now();
}
async function makeNap(p) {
  if (!S.match || !S.me) return;
  const naps = { ...(S.match.naps || {}), [napKey(S.me.id, p.id)]: now() + 600000 };
  const { error } = await sb.from('matches').update({ naps }).eq('id', S.match.id);
  if (error) return toast(error.message, 'err');
  S.match.naps = naps;
  playSfx('coins');
  flashEvent(`📜 10-Minuten-Nichtangriffspakt mit ${p.kingdom_name}!`, '', 3500);
  await sysChat(`📜 ${S.me.kingdom_name} & ${p.kingdom_name} schließen einen 10-Minuten-Nichtangriffspakt (NAP)!`);
  renderPanel();
}
function warState(idA, idB) {
  if (!idA || !idB || idA === idB) return 'none';
  const t = (S.match?.wars || {})[napKey(idA, idB)];
  if (!t) return 'none';
  return now() >= t ? 'active' : 'countdown';
}
function warLeftSec(idA, idB) {
  const t = (S.match?.wars || {})[napKey(idA, idB)] || 0;
  return Math.max(0, Math.ceil((t - now()) / 1000));
}
async function declareWar(p) {
  if (!S.match || !S.me) return;
  if (hasNap(S.me.id, p.id)) return toast('📜 Ihr habt noch einen aktiven NAP!', 'err');
  if (allied(S.me.id, p.id)) return toast('Ihr seid verbündet!', 'err');
  const wars = { ...(S.match.wars || {}), [napKey(S.me.id, p.id)]: now() + 30000 };
  const { error } = await sb.from('matches').update({ wars }).eq('id', S.match.id);
  if (error) return toast(error.message, 'err');
  S.match.wars = wars;
  playSfx('horn');
  flashEvent(`📣 KRIEGSERKLÄRUNG! Krieg gegen ${p.kingdom_name} beginnt in 30s!`, 'alarm', 4500);
  await sysChat(`📣 ${S.me.kingdom_name} erklärt ${p.kingdom_name} den Krieg! Kampfbeginn in 30 Sekunden!`);
  renderPanel();
}
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
function emblemCanvas(emblem, color, size = 32, pattern = 'solid', frame = 'gold') {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawFlagBg(ctx, pattern, color, size);
  ctx.drawImage(getEmblemSprite(emblem, '#ffffff'), 0, 0, size, size);
  const fColor = frame === 'gold' ? '#f5c542' : frame === 'silver' ? '#d0d7e2' : frame === 'iron' ? '#6c757d' : null;
  if (fColor) {
    ctx.strokeStyle = fColor;
    ctx.lineWidth = Math.max(2, Math.floor(size / 10));
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }
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
  if (!a || !b) return false;
  if (a.vassal_of === b.id || b.vassal_of === a.id) return true;
  return Boolean(a.alliance && a.alliance === b.alliance);
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
      : '🕊️ FREIZEIT-FRIEDEN (Bauen & Handeln gehen!)';
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
  const { data: lb } = await sb.from('profiles').select('username,wins,medal').order('wins', { ascending: false }).limit(10);
  $('leaderboard').innerHTML = (lb || []).length
    ? lb.map((p) => `<li><span>${esc(p.username)}${p.medal ? ` <small class="muted">(${esc(p.medal)})</small>` : ''}</span><b>${p.wins} 🏆</b></li>`).join('')
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
  if (prev.season !== data.season) {
    flashEvent(data.season === 'winter' ? '❄️ DER WINTER BRICHT HEREIN! Flüsse frieren zu!' : '☀️ DER SOMMER KEHRT ZURÜCK!', data.season === 'winter' ? 'winter' : '', 4500);
    playSfx('horn');
  }
  if (prev.global_banner !== data.global_banner && data.global_banner) playSfx('horn');
  updateBanners();
  if (S.match.status === 'lobby') renderLobby();
  refreshAdminPanel();
}

async function reloadPlayers() {
  if (!S.match) return;
  const { data } = await sb.from('match_players')
    .select('id,match_id,user_id,username,slot,kingdom_name,color,emblem,flag_pattern,shield_frame,age,alliance,vassal_of,capital_level,wood,stone,gold,raw_food,bread,food,morale,population,territory_percent,capital_x,capital_y,is_eliminated,created_at')
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
  if (data) {
    S.armies = data;
    checkIncomingAttacks();
  }
}

function checkIncomingAttacks() {
  if (!S.me || !S.inGame) return;
  for (const a of S.armies) {
    if (!a.player_id || a.player_id === S.me.id || allied(a.player_id, S.me.id) || a.target_x == null) continue;
    const ti = M.inBounds(a.target_x, a.target_y) ? M.idx(a.target_x, a.target_y) : -1;
    if (ti >= 0 && S.territory[ti] === S.me.slot && !S.alertedArmies.has(a.id)) {
      S.alertedArmies.add(a.id);
      playSfx('horn');
      const att = playerById(a.player_id);
      flashEvent(`🚨 ANGRIFF! ${att ? att.kingdom_name : 'Ein Feind'} greift dein Gebiet an!`, 'alarm', 4500);
      toast('🚨 ANGRIFF! Feindliche Truppen marschieren auf dein Gebiet!', 'err');
    }
  }
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
    row.appendChild(emblemCanvas(p.emblem, p.color, 24, p.flag_pattern || 'solid', p.shield_frame || 'gold'));
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
    if ($('my-pattern')) $('my-pattern').value = S.me.flag_pattern || 'solid';
    if ($('my-frame')) $('my-frame').value = S.me.shield_frame || 'gold';
    S.myEmblem = S.me.emblem; renderEmblemPicker();
  }
  renderChat();
}

function renderEmblemPicker() {
  const box = $('emblem-picker'); box.innerHTML = '';
  const pat = $('my-pattern') ? $('my-pattern').value : 'solid';
  const frm = $('my-frame') ? $('my-frame').value : 'gold';
  for (const [key, label] of Object.entries(EMBLEMS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = label; b.className = key === S.myEmblem ? 'active' : '';
    b.appendChild(emblemCanvas(key, $('my-color').value, 32, pat, frm));
    b.onclick = () => { S.myEmblem = key; playSfx('click'); renderEmblemPicker(); };
    box.appendChild(b);
  }
}

async function saveKingdom() {
  const kingdom_name = $('my-kingdom').value.trim().slice(0, 24) || S.me.kingdom_name;
  const flag_pattern = $('my-pattern') ? $('my-pattern').value : 'solid';
  const shield_frame = $('my-frame') ? $('my-frame').value : 'gold';
  const { error } = await sb.from('match_players').update({ kingdom_name, color: $('my-color').value, emblem: S.myEmblem, flag_pattern, shield_frame }).eq('id', S.me.id);
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
    let [cx, cy] = spawns[k];
    const pid = S.provOf ? S.provOf[M.idx(cx, cy)] : -1;
    if (pid >= 0 && S.provinces[pid]) {
      cx = S.provinces[pid].cx;
      cy = S.provinces[pid].cy;
      for (const ti of S.provinces[pid].tiles) territory[ti] = p.slot;
    } else {
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (M.inBounds(x, y) && dx * dx + dy * dy <= 36 && M.isLand(t[M.idx(x, y)])) territory[M.idx(x, y)] = p.slot;
      }
    }
    await sb.from('match_players').update({
      capital_x: cx, capital_y: cy, wood: 0, stone: 0, gold: 300, raw_food: 0, bread: 0,
      morale: 85, population: 25, age: 1, is_eliminated: false, territory_percent: 0
    }).eq('id', p.id);
    armyRows.push(
      { match_id: S.match.id, player_id: p.id, unit_type: 'swordsman', count: 10, x: cx, y: cy },
      { match_id: S.match.id, player_id: p.id, unit_type: 'king', count: 1, x: cx, y: cy }
    );
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
  S.timers.push(setInterval(renderMinimap, 500));
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
  const cx = S.me?.capital_x ?? 320, cy = S.me?.capital_y ?? 320;
  S.camW.x = cx * TILE + TILE / 2 - c.width / 2 / z;
  S.camW.y = cy * TILE + TILE / 2 - c.height / 2 / z;
}
function renderMinimap() {
  const mm = $('minimap');
  if (!mm || !S.terrain || !S.inGame) return;
  // Zeige Karte + eigenes/verbündetes Gebiet, aber KEINE Gegner auf der Minimap!
  const friendlySlots = new Set(S.players.filter((p) => p.id === S.me?.id || allied(p.id, S.me?.id)).map((p) => p.slot));
  if (!S._mmTerr) S._mmTerr = new Int8Array(M.N);
  for (let i = 0; i < M.N; i++) {
    const o = S.territory[i];
    S._mmTerr[i] = (S.fogOff || friendlySlots.has(o)) ? o : -1;
  }
  drawMiniMap(mm, S.terrain, S._mmTerr);
  const ctx = mm.getContext('2d'), c = $('game-canvas');
  const sx = mm.width / (M.W * TILE), sy = mm.height / (M.H * TILE);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.strokeRect(S.camW.x * sx, S.camW.y * sy, (c.width / S.camW.z) * sx, (c.height / S.camW.z) * sy);
}
function resizeCanvas() {
  const wrap = $('canvas-wrap'), c = $('game-canvas');
  c.width = Math.max(200, wrap.clientWidth); c.height = Math.max(200, wrap.clientHeight);
}

function updateModeHint() {
  const el = $('mode-hint'), bar = $('build-confirm-bar'), cbtn = $('btn-confirm-build');
  let txt = '';
  if (S.frontlineMode) txt = '🏹 Angriffsziel-Provinz auf der Karte antippen';
  else if (S.selectedArmyId) txt = '⚔️ Ziel-Provinz antippen (Armeen bewegen sich Provinz-zu-Provinz)';
  el.textContent = txt; el.hidden = !txt;
  if (bar) bar.hidden = true;
  if (cbtn) cbtn.hidden = true;
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
  const { d } = estimateRates();
  $('res-gold').textContent = `${fmt(me.gold)} (+${d.gold.toFixed(1)}/s)`;
  $('res-pop').textContent = `${fmt(me.population)}/${popCap()}`;
  $('res-territory').textContent = `${(me.territory_percent || 0).toFixed(1)}%`;
  $('res-age').textContent = `🏛️ ${AGE_NAMES[me.age]}`;
  $('res-season').textContent = `${S.match.season === 'winter' ? '❄️ Winter' : '☀️ Sommer'} · ${speed()}x`;
}

// ---------------------------------------------------------------------------
// CONTROL-EUROPA WIRTSCHAFT (Einzige Währung: Gold + Arbeitskraft aus Häusern)
// ---------------------------------------------------------------------------
const myBuildings = () => (S.me ? S.buildings.filter((b) => b.player_id === S.me.id) : []);
const countType = (type, p = S.me) => (p ? S.buildings.filter((b) => b.player_id === p.id && b.type === type && isDone(b)).length : 0);
const popCap = () => 20 + 15 * countType('house');

function provBuildings(pid) {
  const prov = S.provinces?.[pid];
  if (!prov) return [];
  return S.buildings.filter((b) => b.type !== 'bridge' && b.x === prov.cx && b.y === prov.cy && isDone(b));
}
function provDefense(pid) {
  const prov = S.provinces?.[pid];
  if (!prov) return 80;
  const ownerSlot = S.territory[M.idx(prov.cx, prov.cy)];
  const ownerP = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;
  if (!ownerP) {
    const t = S.terrain[M.idx(prov.cx, prov.cy)];
    return t === M.T.GOLD ? 120 : (t === M.T.HILL || t === M.T.FOREST) ? 100 : 80;
  }
  const blds = provBuildings(pid);
  const forts = blds.filter((b) => b.type === 'fort').length;
  const guardBonus = S.match?.prov_guards?.[pid] || 0;
  const isCap = ownerP.capital_x === prov.cx && ownerP.capital_y === prov.cy;
  const capBonus = isCap ? ((ownerP.capital_level || 1) * 70) : 0;
  return 110 + forts * 80 + guardBonus + capBonus;
}
function provGoldRate(pid) {
  const prov = S.provinces?.[pid];
  if (!prov || prov.isSea) return 0;
  const blds = provBuildings(pid);
  const isGoldTile = S.terrain && S.terrain[M.idx(prov.cx, prov.cy)] === M.T.GOLD;
  let g = 0.35 + (prov.goldBonus ? 0.5 : 0);
  for (const b of blds) {
    if (b.type === 'market') g += isGoldTile ? 4.0 : 2.0;
    if (b.type === 'harbor') g += 3.0;
  }
  return g;
}
function isCoastalProv(pid) {
  const prov = S.provinces?.[pid];
  if (!prov || prov.isSea) return false;
  return prov.adj.some((nid) => S.provinces[nid]?.isSea);
}

function estimateRates() {
  const me = S.me;
  if (!me) return { d: { gold: 0.5 }, mult: 1 };
  const capLv = me.capital_level || 1;
  const mult = S.match?.season === 'winter' ? 0.85 : 1;
  let gold = 1.0 * capLv;
  for (const prov of S.provinces) {
    if (prov.isSea) continue;
    if (S.territory[M.idx(prov.cx, prov.cy)] === me.slot) {
      gold += provGoldRate(prov.id);
    }
  }
  return { d: { gold: gold * mult }, mult };
}

function isHarborBlockaded(h) {
  return S.armies.some((a) =>
    a.unit_type === 'ship' && a.player_id && a.player_id !== h.player_id &&
    !allied(a.player_id, h.player_id) && !hasNap(a.player_id, h.player_id) &&
    Math.hypot(armyPos(a).x - h.x, armyPos(a).y - h.y) <= 3.5
  );
}

async function processTrainQueue() {
  const me = S.me;
  if (!me || !S.trainQueue.length) return;
  const ready = S.trainQueue.filter((q) => now() >= q.readyAt);
  if (!ready.length) return;
  S.trainQueue = S.trainQueue.filter((q) => now() < q.readyAt);
  for (const q of ready) {
    let sx = me.capital_x, sy = me.capital_y;
    if (q.provId != null && S.provinces[q.provId] && S.territory[M.idx(S.provinces[q.provId].cx, S.provinces[q.provId].cy)] === me.slot) {
      sx = S.provinces[q.provId].cx; sy = S.provinces[q.provId].cy;
    } else if (q.unitType === 'ship' || q.unitType === 'warship') {
      const h = myBuildings().find((b) => b.type === 'harbor' && isDone(b));
      if (h) {
        const hp = S.provOf ? S.provOf[M.idx(h.x, h.y)] : -1;
        const seaNb = hp >= 0 ? S.provinces[hp]?.adj.map((id) => S.provinces[id]).find((p) => p?.isSea) : null;
        if (seaNb) { sx = seaNb.cx; sy = seaNb.cy; } else { sx = h.x; sy = h.y; }
      }
    } else {
      const bk = myBuildings().find((b) => b.type === 'barracks' && isDone(b));
      if (bk) { sx = bk.x; sy = bk.y; }
    }
    const home = S.armies.find((a) => a.player_id === me.id && a.unit_type === q.unitType && a.target_x == null && a.x === sx && a.y === sy);
    if (home) {
      home.count += BATCH;
      await sb.from('armies').update({ count: home.count }).eq('id', home.id);
    } else {
      const { data } = await sb.from('armies')
        .insert({ match_id: S.match.id, player_id: me.id, unit_type: q.unitType, count: BATCH, x: sx, y: sy })
        .select().single();
      if (data) S.armies.push(data);
    }
    playSfx('build');
    toast(`✅ ${BATCH}× ${UNITS[q.unitType]?.name} ausgebildet!`, 'ok');
    advanceTut('trained');
  }
  renderPanel();
}

function computeSupply() {
  if (!S.me || !S.terrain) return;
  S.supplied.fill(0);
  const q = new Int32Array(M.N);
  let head = 0, tail = 0;
  const seedTile = (x, y) => {
    if (!M.inBounds(x, y)) return;
    const i = M.idx(x, y);
    if (!S.supplied[i]) { S.supplied[i] = 1; q[tail++] = i; }
  };
  if (S.me.capital_x != null) seedTile(S.me.capital_x, S.me.capital_y);
  for (const b of myBuildings()) if (b.type === 'caravan' && isDone(b)) seedTile(b.x, b.y);
  const friendly = new Set(S.players.filter((p) => p.id === S.me.id || allied(p.id, S.me.id)).map((p) => p.slot));
  while (head < tail) {
    const cur = q[head++], x = cur % M.W, y = (cur - x) / M.W;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (!M.inBounds(nx, ny)) continue;
      const ni = M.idx(nx, ny);
      if (S.supplied[ni]) continue;
      if (friendly.has(S.territory[ni]) || S.bridges.has(ni)) {
        S.supplied[ni] = 1; q[tail++] = ni;
      }
    }
  }
}

function getBorderProvinces() {
  if (!S.me || !S.provinces || !S.provOf) return [];
  const res = [];
  for (const prov of S.provinces) {
    if (prov.isSea) continue;
    const pi = M.idx(prov.cx, prov.cy);
    if (S.territory[pi] !== S.me.slot) continue;
    // Prüfe ob Nachbar-Tile anderem Spieler oder Neutral gehört
    let isBorder = false;
    for (const ti of prov.tiles) {
      const x = ti % M.W, y = (ti - x) / M.W;
      if ((x > 0 && S.territory[ti - 1] !== S.me.slot && M.isLand(S.terrain[ti - 1])) ||
          (x < M.W - 1 && S.territory[ti + 1] !== S.me.slot && M.isLand(S.terrain[ti + 1])) ||
          (y > 0 && S.territory[ti - M.W] !== S.me.slot && M.isLand(S.terrain[ti - M.W])) ||
          (y < M.H - 1 && S.territory[ti + M.W] !== S.me.slot && M.isLand(S.terrain[ti + M.W]))) {
        isBorder = true; break;
      }
    }
    if (isBorder) res.push(prov);
  }
  return res;
}

async function assignFrontline() {
  const borders = getBorderProvinces();
  if (!borders.length) return toast('Keine Grenzprovinzen gefunden.', 'err');
  if (S.frontTarget) {
    borders.sort((a, b) => Math.hypot(a.cx - S.frontTarget.x, a.cy - S.frontTarget.y) - Math.hypot(b.cx - S.frontTarget.x, b.cy - S.frontTarget.y));
  }
  const activeBorders = borders.slice(0, 12);
  const idle = S.armies.filter((a) => a.player_id === S.me.id && a.target_x == null && a.unit_type !== 'ship' && a.unit_type !== 'warship' && a.unit_type !== 'king' && a.unit_type !== 'spy');
  if (!idle.length) return toast('Keine freien Land-Armeen zum Verteilen.', 'err');
  let moved = 0;
  for (let k = 0; k < idle.length; k++) {
    const target = activeBorders[k % activeBorders.length];
    if (idle[k].x !== target.cx || idle[k].y !== target.cy) {
      await moveArmy(idle[k], target.cx, target.cy);
      moved++;
    }
  }
  playSfx('horn');
  toast(`🛡️ ${moved} Armee(n) an die Frontlinie verteilt!`, 'ok');
}

async function runFrontPush() {
  if (!S.frontPush || !S.me || !pvpAllowed()) return;
  const idle = S.armies.filter((a) => a.player_id === S.me.id && a.target_x == null && a.unit_type !== 'ship' && a.unit_type !== 'warship' && a.unit_type !== 'king' && a.unit_type !== 'spy');
  for (const a of idle.slice(0, 4)) {
    const pid = S.provOf ? S.provOf[M.idx(a.x, a.y)] : -1;
    const curProv = pid >= 0 ? S.provinces[pid] : null;
    if (!curProv) continue;
    const cands = curProv.adj.map((id) => S.provinces[id]).filter((pr) =>
      pr && !pr.isSea &&
      S.territory[M.idx(pr.cx, pr.cy)] !== S.me.slot &&
      !allied(playerBySlot(S.territory[M.idx(pr.cx, pr.cy)])?.id, S.me.id) &&
      !hasNap(S.me.id, playerBySlot(S.territory[M.idx(pr.cx, pr.cy)])?.id)
    );
    if (!cands.length) continue;
    if (S.frontTarget) {
      cands.sort((p1, p2) => Math.hypot(p1.cx - S.frontTarget.x, p1.cy - S.frontTarget.y) - Math.hypot(p2.cx - S.frontTarget.x, p2.cy - S.frontTarget.y));
    }
    await moveArmy(a, cands[0].cx, cands[0].cy);
  }
}

async function clientTick() {
  const me = S.me;
  if (!me || !S.match || S.match.status !== 'running' || me.is_eliminated) return;
  await processTrainQueue();
  computeSupply();
  for (const a of S.armies) {
    if (a.player_id === me.id && a.target_x == null) S.entrench[a.id] = Math.min(15, (S.entrench[a.id] || 0) + 1);
    else delete S.entrench[a.id];
  }
  await runFrontPush();
  const dt = 2 * speed();
  const { d } = estimateRates();
  S.acc.gold = (S.acc.gold || 0) + (d.gold || 0) * dt;
  const gainGold = Math.trunc(S.acc.gold);
  S.acc.gold -= gainGold;
  if (gainGold > 0) {
    let myGold = gainGold;
    if (me.vassal_of) {
      const tax = Math.max(1, Math.floor(myGold * 0.25));
      myGold -= tax;
      await rpcAdd(me.vassal_of, { gold: tax }, true);
    }
    await rpcAdd(me.id, { gold: myGold }, true);
    me.gold = Math.max(0, (me.gold || 0) + myGold);
  }
  const cap = popCap();
  if (me.population < cap) {
    const regenRate = (1 + countType('house') * 0.35) * dt / 6;
    S.popAcc += regenRate;
    const addPop = Math.floor(S.popAcc);
    if (addPop >= 1) {
      me.population = Math.min(cap, me.population + addPop);
      S.popAcc -= addPop;
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
// CONTROL-EUROPA PROVINZ-AUSBAU, ZEITALTER, TRUPPEN, PROVINZ-BEWEGUNG
// ---------------------------------------------------------------------------
async function buildInProvince(pid, type) {
  if (!S.me || !S.match || S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  const prov = S.provinces?.[pid];
  if (!prov || prov.isSea) return toast('Wähle zuerst eine eigene Land-Provinz!', 'err');
  if (S.territory[M.idx(prov.cx, prov.cy)] !== S.me.slot) return toast('Du kannst nur eigene Provinzen ausbauen!', 'err');
  if (type === 'harbor' && !isCoastalProv(pid)) return toast('🚢 Ein Hafen braucht eine Küsten-Provinz!', 'err');
  const def = BUILDINGS[type];
  if (!def || !(await spend(def.cost))) return;
  const endAt = new Date(now() + ((def.buildTime || 6) * 1000) / speed()).toISOString();
  const { data, error } = await sb.from('buildings')
    .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'world', type, x: prov.cx, y: prov.cy, construction_end_at: endAt })
    .select().single();
  if (error) { await rpcAdd(S.me.id, def.cost, true); return toast(error.message, 'err'); }
  if (data) S.buildings.push(data);
  playSfx('build');
  toast(`✅ ${def.name} in „${provName(prov)}“ im Bau (${Math.ceil(def.buildTime / speed())}s)!`, 'ok');
  trackQuest('built', 1);
  if (type === 'fort') trackQuest('fort', 1);
  if (type === 'harbor') trackQuest('trade', 1);
  advanceTut('world_built');
  renderPanel();
  updateTileBar();
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

const armyCap = () => (S.me ? S.me.population * 3 : 15);
const totalArmyCount = () => (S.me ? S.armies.filter((a) => a.player_id === S.me.id).reduce((s, a) => s + a.count, 0) + S.trainQueue.length * BATCH : 0);

async function trainUnits(type) {
  const me = S.me, u = UNITS[type];
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if ((type === 'ship' || type === 'warship') && countType('harbor') === 0) return toast('Schiffe brauchen einen fertigen ⚓ Hafen!', 'err');
  if (type !== 'ship' && type !== 'warship' && countType('barracks') === 0) return toast('Baue zuerst eine fertige ⚔️ Kaserne in einer Provinz!', 'err');
  if (me.age < u.age) return toast(`Benötigt ${AGE_NAMES[u.age]}.`, 'err');
  if ((me.population || 0) < BATCH) return toast(`Nicht genug 👷 Arbeitskraft (${me.population}/${BATCH})! Baue mehr 🏠 Häuser.`, 'err');
  if (!(await spend(u.cost, BATCH))) return;
  me.population = Math.max(0, (me.population || 0) - BATCH);
  await sb.from('match_players').update({ population: me.population }).eq('id', me.id);
  const ms = ((u.trainTime || 8) * 1000) / speed();
  const lastEnd = S.trainQueue.length ? Math.max(now(), S.trainQueue[S.trainQueue.length - 1].readyAt) : now();
  const spawnPid = S.selectedProvId >= 0 && provBuildings(S.selectedProvId).some((b) => b.type === 'barracks') ? S.selectedProvId : null;
  S.trainQueue.push({ unitType: type, readyAt: lastEnd + ms, totalMs: ms, provId: spawnPid });
  playSfx('click');
  toast(`⏳ ${BATCH}× ${u.name} in Ausbildung (${Math.ceil(ms / 1000)}s)`, 'ok');
  renderPanel();
}

function travelMs(unitType, x0, y0, x1, y1) {
  const winterMult = S.match?.season === 'winter' ? 1.2 : 1;
  return (Math.max(14, Math.hypot(x1 - x0, y1 - y0)) * (UNITS[unitType]?.speed || 1.3) * 650 * winterMult) / speed();
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
  const startPid = S.provOf ? S.provOf[M.idx(a.x, a.y)] : -1;
  const targetPid = S.provOf ? S.provOf[M.idx(tx, ty)] : -1;
  if (startPid < 0 || targetPid < 0 || !S.provinces[startPid] || !S.provinces[targetPid]) {
    return toast('Wähle eine gültige Provinz als Ziel!', 'err');
  }
  if (startPid === targetPid) return;

  const isBoat = a.unit_type === 'ship' || a.unit_type === 'warship';
  const targetProv = S.provinces[targetPid];
  if (isBoat && !targetProv.isSea && !isCoastalProv(targetPid)) return toast('Schiffe können nur über See-Provinzen fahren!', 'err');
  if (!isBoat && targetProv.isSea) return toast('Landtruppen können nicht ins tiefe Meer! Nutze Schiffe.', 'err');

  const path = M.findProvPath(S.provinces, startPid, targetPid, (pr) => {
    if (isBoat) return pr.isSea || isCoastalProv(pr.id);
    return !pr.isSea;
  });
  if (!path || path.length < 2) return toast('Kein Provinz-Pfad dorthin verfügbar!', 'err');

  const nextPid = path[1];
  const nextProv = S.provinces[nextPid];
  const owner = S.territory[M.idx(nextProv.cx, nextProv.cy)];
  const ownerP = owner >= 0 ? playerBySlot(owner) : null;
  if (ownerP && hasNap(S.me.id, ownerP.id)) return toast('📜 Aktiver Nichtangriffspakt (NAP) mit diesem Spieler!', 'err');
  if (ownerP && ownerP.id !== S.me.id && !allied(ownerP.id, S.me.id) && pvpAllowed()) {
    const ws = warState(S.me.id, ownerP.id);
    if (ws === 'none') {
      await declareWar(ownerP);
      return toast('📣 Krieg erklärt! Angriff in 30 Sekunden möglich!', 'ok');
    }
    if (ws === 'countdown') {
      return toast(`⏳ Kriegserklärung läuft noch ${warLeftSec(S.me.id, ownerP.id)}s!`, 'err');
    }
  }
  const attacksPlayer = ownerP && ownerP.id !== S.me.id && !allied(ownerP.id, S.me.id);
  if (attacksPlayer && !pvpAllowed()) return toast('🕊️ Freizeit-Frieden! Angriffe auf Spieler sind gerade gesperrt.', 'err');

  // Restliche Route speichern (Provinz-zu-Provinz)
  if (path.length > 2) S.armyRoutes[a.id] = path.slice(2);
  else delete S.armyRoutes[a.id];

  const curProv = S.provinces[startPid];
  const arrives = new Date(now() + travelMs(a.unit_type, curProv.cx, curProv.cy, nextProv.cx, nextProv.cy)).toISOString();
  a.x = curProv.cx; a.y = curProv.cy; a.target_x = nextProv.cx; a.target_y = nextProv.cy; a.arrives_at = arrives;
  await sb.from('armies').update({ x: a.x, y: a.y, target_x: a.target_x, target_y: a.target_y, arrives_at: arrives }).eq('id', a.id);
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

async function sendChat(text, allyOnly = false) {
  const raw = text.trim().slice(0, 180);
  if (!raw || !S.match || !S.me) return;
  const message = allyOnly && S.me.alliance ? `[ALLY:${S.me.alliance}] ${raw}` : raw;
  await sb.from('chat_messages').insert({ match_id: S.match.id, player_id: S.me.id, sender_name: S.me.kingdom_name, message });
  reloadChat();
}

async function sendPing(x, y) {
  if (!S.match || !S.me) return;
  const pings = [...(S.match.pings || []).filter((p) => p.until > now()), {
    x, y, alliance: S.me.alliance || '', playerId: S.me.id, sender: S.me.kingdom_name, color: S.me.color, until: now() + 30000
  }];
  S.match.pings = pings;
  await sb.from('matches').update({ pings }).eq('id', S.match.id);
  playSfx('coins');
  toast(`📍 Ping bei (${x}, ${y}) gesetzt!`, 'ok');
}

function renderChat() {
  const html = S.chat.filter((m) => {
    const match = m.message.match(/^\[ALLY:([^\]]+)\]\s*/);
    if (match && !(S.me && S.me.alliance && S.me.alliance === match[1])) return false;
    if (S.chatFilter === 'players' && !m.player_id) return false;
    if (S.chatFilter === 'events' && m.player_id) return false;
    return true;
  }).map((m) => {
    const t = new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const p = playerById(m.player_id);
    const allyTag = m.message.startsWith('[ALLY:') ? '🤝 ' : '';
    const cleanMsg = m.message.replace(/^\[ALLY:[^\]]+\]\s*/, '');
    return m.player_id
      ? `<div class="msg"><time>${t}</time>${allyTag}<b style="color:${p ? p.color : '#9fc6e8'}">${esc(m.sender_name)}:</b> ${esc(cleanMsg)}</div>`
      : `<div class="msg sys"><time>${t}</time>${esc(cleanMsg)}</div>`;
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
    await runCombatTick(pvpAllowed());
    if (S.territoryDirty && t - S.lastTerritoryWrite > 2000) await writeTerritory();
    if (t - S.lastSnapshot > 60000) {
      S.lastSnapshot = t;
      await sb.from('map_snapshots').insert({ match_id: S.match.id, tick: Math.floor(t / 1000), owners_data: M.encodeTerritory(S.territory) });
    }
    if (t - S.lastEvent > 180000 / sp) { S.lastEvent = t; await randomEvent(); }
  } catch (e) { console.warn('authorityTick', e); }
  finally { S.authBusy = false; }
}

function armyPower(a, x, y) {
  const u = UNITS[a.unit_type];
  let pw = (u ? u.power : 0) * a.count;
  const tile = S.terrain[M.idx(x, y)];
  if (a.unit_type === 'archer' && tile === M.T.HILL) pw *= 1.5;
  const p = playerById(a.player_id);
  if (p) {
    pw *= 1 + Math.min(0.3, (S.armyRanks[a.id] || 0) * 0.15); // General-Rang
    if (a.target_x == null) pw *= 1 + Math.min(0.3, (S.entrench[a.id] || 0) * 0.02); // Eingraben
    if (p.id === S.me?.id && S.supplied && !S.supplied[M.idx(x, y)] && a.unit_type !== 'ship' && a.unit_type !== 'warship') {
      pw *= 0.65; // Kein Nachschub
    }
    const hasKing = S.armies.some((k) => k.player_id === p.id && k.unit_type === 'king' && Math.hypot(armyPos(k).x - x, armyPos(k).y - y) <= 5);
    if (hasKing) pw *= 1.25;
    const pid = S.provOf && M.inBounds(x, y) ? S.provOf[M.idx(x, y)] : -1;
    if (pid >= 0 && S.territory[M.idx(x, y)] === p.slot) {
      const forts = provBuildings(pid).filter((b) => b.type === 'fort').length;
      pw *= 1.15 + Math.min(0.75, forts * 0.25);
    }
  }
  return pw;
}

async function updateArmy(a, patch) { Object.assign(a, patch); await sb.from('armies').update(patch).eq('id', a.id); }
async function deleteArmy(a) { S.armies = S.armies.filter((x) => x.id !== a.id); delete S.armyRoutes[a.id]; await sb.from('armies').delete().eq('id', a.id); }

async function runCombatTick(pvp) {
  const battles = new Map();
  for (const a of S.armies) {
    if (!a.player_id || a.count <= 0 || a.target_x == null || a.arrives_at != null) continue;
    const tpid = S.provOf && M.inBounds(a.target_x, a.target_y) ? S.provOf[M.idx(a.target_x, a.target_y)] : -1;
    if (tpid < 0 || !S.provinces[tpid]) continue;
    if (!battles.has(tpid)) battles.set(tpid, []);
    battles.get(tpid).push(a);
  }
  for (const [tpid, attackers] of battles.entries()) {
    const prov = S.provinces[tpid];
    const ownerSlot = S.territory[M.idx(prov.cx, prov.cy)];
    const ownerP = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;
    const mainAtt = playerById(attackers[0].player_id);
    if (!mainAtt) continue;
    if (ownerP && !pvp) {
      for (const a of attackers) await updateArmy(a, { target_x: null, target_y: null, arrives_at: null });
      delete S.provHp[tpid]; continue;
    }
    if (ownerSlot === mainAtt.slot || (ownerP && (allied(ownerP.id, mainAtt.id) || hasNap(mainAtt.id, ownerP.id)))) {
      for (const a of attackers) await updateArmy(a, { x: prov.cx, y: prov.cy, target_x: null, target_y: null, arrives_at: null });
      delete S.provHp[tpid]; continue;
    }
    const defenders = S.armies.filter((d) =>
      d.player_id && d.count > 0 && d.target_x == null &&
      S.provOf?.[M.idx(d.x, d.y)] === tpid &&
      d.player_id !== mainAtt.id && !allied(d.player_id, mainAtt.id)
    );
    if (S.provHp[tpid] == null) S.provHp[tpid] = provDefense(tpid);
    let attPow = attackers.reduce((s, a) => s + armyPower(a, a.x, a.y), 0);
    const hasCatapult = attackers.some((a) => a.unit_type === 'catapult');
    let defPow = defenders.reduce((s, d) => s + armyPower(d, prov.cx, prov.cy), 0) + Math.max(0, S.provHp[tpid]) * (hasCatapult ? 0.45 : 0.85);
    const bx = (attackers[0].x + prov.cx) / 2, by = (attackers[0].y + prov.cy) / 2;
    addFx('boom', bx, by, { dur: 650 });

    const totalAttCount = attackers.reduce((s, a) => s + a.count, 0);
    const attLossTotal = Math.max(0, Math.round(totalAttCount * clamp((defPow / Math.max(1, attPow)) * 0.055, 0.015, 0.085)));
    if (attLossTotal > 0) {
      let remLoss = attLossTotal;
      for (const a of attackers) {
        if (remLoss <= 0) break;
        const take = Math.min(a.count, Math.max(1, Math.round((a.count / Math.max(1, totalAttCount)) * attLossTotal)));
        a.count -= take; remLoss -= take;
        if (a.count <= 0) await deleteArmy(a); else await updateArmy(a, { count: a.count });
      }
    }

    if (defenders.length > 0) {
      const totalDefCount = defenders.reduce((s, d) => s + d.count, 0);
      const defLossTotal = Math.max(1, Math.round(totalDefCount * clamp((attPow / Math.max(1, defPow)) * 0.065, 0.02, 0.095)));
      addFx('text', prov.cx, prov.cy, { label: `-${defLossTotal}`, color: '#ff6b6b', dur: 850 });
      for (const d of defenders) {
        const take = Math.min(d.count, Math.max(1, Math.round((d.count / Math.max(1, totalDefCount)) * defLossTotal)));
        d.count -= take;
        if (d.count <= 0) await deleteArmy(d); else await updateArmy(d, { count: d.count });
      }
    } else {
      const wallDmg = Math.max(6, Math.round((attPow / Math.max(25, defPow)) * (hasCatapult ? 24 : 11)));
      S.provHp[tpid] = Math.max(0, S.provHp[tpid] - wallDmg);
      addFx('text', prov.cx, prov.cy, { label: `🛡️-${wallDmg}`, color: '#ffd23f', dur: 850 });
    }

    const aliveAtt = attackers.filter((a) => a.count > 0 && S.armies.includes(a));
    const aliveDef = defenders.filter((d) => d.count > 0 && S.armies.includes(d));
    if (aliveAtt.length > 0 && aliveDef.length === 0 && (S.provHp[tpid] || 0) <= 0) {
      delete S.provHp[tpid];
      for (const a of aliveAtt) {
        S.armyRanks[a.id] = (S.armyRanks[a.id] || 0) + 1;
        await updateArmy(a, { x: prov.cx, y: prov.cy, target_x: null, target_y: null, arrives_at: null });
      }
      await conquer(prov.cx, prov.cy, mainAtt, pvp);
    } else if (aliveAtt.length === 0) {
      delete S.provHp[tpid];
    }
  }
}

async function resolveArrival(a) {
  const tx = a.target_x, ty = a.target_y, pvp = pvpAllowed(), attacker = playerById(a.player_id);
  const tpid = S.provOf && M.inBounds(tx, ty) ? S.provOf[M.idx(tx, ty)] : -1;
  const targetProv = tpid >= 0 ? S.provinces[tpid] : null;
  if (!attacker || !targetProv) {
    await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null });
    return;
  }
  if (a.unit_type === 'spy') {
    await updateArmy(a, { x: targetProv.cx, y: targetProv.cy, target_x: null, target_y: null, arrives_at: null });
    const ownerSlot = S.territory[M.idx(targetProv.cx, targetProv.cy)];
    const op = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;
    if (op && op.id !== attacker.id) S.spied[op.id] = now() + 120000;
    toast('🕵️ Spion hat die Provinz ausgekundschaftet!', 'ok');
    return;
  }

  const ownerSlot = S.territory[M.idx(targetProv.cx, targetProv.cy)];
  const ownerP = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;
  const isEnemyOrNeutral = ownerSlot !== attacker.slot && (!ownerP || (!allied(ownerP.id, attacker.id) && !hasNap(attacker.id, ownerP.id)));

  if (isEnemyOrNeutral && (!ownerP || pvp)) {
    // HOI4-Schlacht an der Provinzgrenze starten!
    if (S.provHp[tpid] == null) S.provHp[tpid] = provDefense(tpid);
    await updateArmy(a, { target_x: targetProv.cx, target_y: targetProv.cy, arrives_at: null });
    addFx('boom', (a.x + targetProv.cx) / 2, (a.y + targetProv.cy) / 2, { dur: 900 });
    return;
  }

  // Freundliche Provinz erreicht -> einmarschieren & nächste Etappe prüfen
  await updateArmy(a, { x: targetProv.cx, y: targetProv.cy, target_x: null, target_y: null, arrives_at: null });
  const route = S.armyRoutes[a.id];
  if (route && route.length > 0 && a.player_id === S.me?.id) {
    const nextPid = route.shift();
    if (!route.length) delete S.armyRoutes[a.id];
    const nextProv = S.provinces[nextPid];
    if (nextProv) await moveArmy(a, nextProv.cx, nextProv.cy);
  }
}

async function conquer(tx, ty, p, pvp) {
  const pid = S.provOf && M.inBounds(tx, ty) ? S.provOf[M.idx(tx, ty)] : -1;
  if (pid >= 0 && S.provinces[pid]) {
    const prov = S.provinces[pid];
    const tileSet = new Set(prov.tiles);
    let gained = 0;
    const affectedOwners = new Set();
    for (const i of prov.tiles) {
      const owner = S.territory[i];
      if (owner === p.slot) continue;
      const op = owner >= 0 ? playerBySlot(owner) : null;
      if (owner === -1 || (pvp && !allied(op?.id, p.id))) {
        if (op) affectedOwners.add(op);
        S.territory[i] = p.slot; gained++;
      }
    }
    if (gained > 0) {
      toast(`🏳️ Provinz „${prov.name}“ erobert!`, 'ok');
      addFx('text', prov.cx, prov.cy, { label: `🏳️ ${prov.name}`, color: '#ffd23f', dur: 1800 });
      if (p.id === S.me?.id) trackQuest('conquered', 1);
      if (prov.goldBonus > 0) rpcAdd(p.id, { gold: 25 }, true);
      // Belagerung: Gebäude in der eroberten Provinz übernehmen
      for (const b of S.buildings) {
        if (b.type !== 'bridge' && b.player_id !== p.id && tileSet.has(M.idx(b.x, b.y))) {
          b.player_id = p.id;
          sb.from('buildings').update({ player_id: p.id }).eq('id', b.id);
        }
      }
      // Vasallen-System: Wenn Hauptstadt eines Gegners in der Provinz lag -> Vasall!
      for (const op of affectedOwners) {
        if (op.capital_x != null && tileSet.has(M.idx(op.capital_x, op.capital_y)) && !op.vassal_of) {
          op.vassal_of = p.id;
          S.territory[M.idx(op.capital_x, op.capital_y)] = op.slot;
          await sb.from('match_players').update({ vassal_of: p.id }).eq('id', op.id);
          await sysChat(`👑 ${op.kingdom_name} hat die Hauptstadt verloren und ist jetzt Vasall von ${p.kingdom_name} (25% Gold-Steuer)!`);
        }
      }
    }
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
    S.peakPct[p.id] = Math.max(S.peakPct[p.id] || pct, pct);
    const patch = {};
    if (Math.abs(pct - (p.territory_percent || 0)) >= 0.1) patch.territory_percent = pct;
    // Kapitulation bei 60% Verlust der Spitzengröße
    if (oldEnough && !p.vassal_of && !p.is_eliminated && S.peakPct[p.id] >= 3 && pct <= S.peakPct[p.id] * 0.4) {
      const top = [...S.players].filter((x) => x.id !== p.id && !x.is_eliminated).sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0))[0];
      if (top) {
        patch.vassal_of = top.id;
        await sysChat(`🏳️ ${p.kingdom_name} hat 60% seines Gebiets verloren und kapituliert als Vasall vor ${top.kingdom_name}!`);
      }
    }
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
  const mt = S.match.map_type;
  const medal = mt === 'europe' ? 'Eroberer Europas' : mt === 'world' ? 'Weltenherrscher' : mt === 'archipelago' ? 'Meister der See' : mt === 'rome' ? 'Imperator' : mt === 'ottoman' ? 'Sultan' : countType('harbor', p) + countType('caravan', p) >= 2 ? 'Handelsfürst' : 'Reichskanzler';
  if (prof) await sb.from('profiles').update({ wins: (prof.wins || 0) + 1, medal }).eq('id', p.user_id);
  await sysChat(`👑 ${p.kingdom_name} hat 70% der Welt erobert und den Titel „${medal}“ gewonnen!`);
  await reloadMatch();
}

async function randomEvent() {
  const season = S.match.season === 'summer' ? 'winter' : 'summer';
  await sb.from('matches').update({ season }).eq('id', S.match.id);
  await sysChat(season === 'winter' ? '❄️ Winter! Produktion etwas langsamer.' : '☀️ Sommer kehrt zurück.');
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

function getTerrainChunk(cx, cy, season) {
  const key = `${season}_${cx}_${cy}`;
  if (!S.terrainCanvases[key]) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const w = Math.min(CHUNK, M.W - x0), h = Math.min(CHUNK, M.H - y0);
    const c = document.createElement('canvas'); c.width = w * TILE; c.height = h * TILE;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    for (let dy = 0; dy < h; dy++) {
      const y = y0 + dy;
      for (let dx = 0; dx < w; dx++) {
        const x = x0 + dx, i = M.idx(x, y), t = S.terrain[i];
        const v = ((x * 73856093 ^ y * 19349663) >>> 0) % 4;
        ctx.drawImage(getTerrainSprite(M.TERRAIN_KEYS[t], season, v), dx * TILE, dy * TILE, TILE, TILE);
        if (t === M.T.WATER && ((x > 0 && M.isLand(S.terrain[i - 1])) || (x < M.W - 1 && M.isLand(S.terrain[i + 1])) || (y > 0 && M.isLand(S.terrain[i - M.W])) || (y < M.H - 1 && M.isLand(S.terrain[i + M.W])))) {
          ctx.fillStyle = 'rgba(130, 210, 255, 0.28)'; ctx.fillRect(dx * TILE, dy * TILE, TILE, TILE);
        } else if ((t === M.T.MOUNTAIN || t === M.T.HILL) && dx < w - 1 && dy < h - 1) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; ctx.fillRect((dx + 1) * TILE, (dy + 1) * TILE, TILE, TILE);
        }
      }
    }
    S.terrainCanvases[key] = c;
  }
  return S.terrainCanvases[key];
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
  // Nur sichtbare 1024x1024 Terrain-Chunks zeichnen (volle 16x16 Pixel-Auflösung!)
  const cX0 = Math.max(0, Math.floor(cam.x / (CHUNK * TILE)));
  const cY0 = Math.max(0, Math.floor(cam.y / (CHUNK * TILE)));
  const cX1 = Math.min(Math.ceil(M.W / CHUNK) - 1, Math.floor((cam.x + c.width / z) / (CHUNK * TILE)));
  const cY1 = Math.min(Math.ceil(M.H / CHUNK) - 1, Math.floor((cam.y + c.height / z) / (CHUNK * TILE)));
  for (let cy = cY0; cy <= cY1; cy++) {
    for (let cx = cX0; cx <= cX1; cx++) {
      ctx.drawImage(getTerrainChunk(cx, cy, season), cx * CHUNK * TILE, cy * CHUNK * TILE);
    }
  }
  // Verbundene Brücken
  for (const i of S.bridges) {
    const x = i % M.W, y = Math.floor(i / M.W);
    const mask = (y > 0 && S.bridges.has(i - M.W) ? 1 : 0) | (x < M.W - 1 && S.bridges.has(i + 1) ? 2 : 0) | (y < M.H - 1 && S.bridges.has(i + M.W) ? 4 : 0) | (x > 0 && S.bridges.has(i - 1) ? 8 : 0);
    ctx.drawImage(getConnectedSprite('bridge', mask), x * TILE, y * TILE, TILE, TILE);
  }

  if (S.terrBuilt !== S.territoryVersion) rebuildTerritoryCanvas();
  ctx.drawImage(S.terrCanvas, 0, 0, M.W * TILE, M.H * TILE);

  // HOI4 Frontlinien + Angriffspfeil
  if (pvpAllowed()) {
    ctx.fillStyle = `rgba(255, 65, 55, ${0.7 + 0.25 * Math.sin(now() / 220)})`;
    const terr = S.territory;
    for (let i = 0; i < M.N; i += 2) {
      const o = terr[i]; if (o < 0) continue;
      const x = i % M.W, y = (i - x) / M.W;
      const right = x < M.W - 1 ? terr[i + 1] : -1;
      const down = y < M.H - 1 ? terr[i + M.W] : -1;
      if (right >= 0 && right !== o && !allied(playerBySlot(o)?.id, playerBySlot(right)?.id)) ctx.fillRect((x + 1) * TILE - 1.5, y * TILE, 3, TILE);
      if (down >= 0 && down !== o && !allied(playerBySlot(o)?.id, playerBySlot(down)?.id)) ctx.fillRect(x * TILE, (y + 1) * TILE - 1.5, TILE, 3);
    }
  }
  if (S.frontTarget) {
    const sx = (S.me.capital_x || 320) * TILE + TILE / 2, sy = (S.me.capital_y || 320) * TILE + TILE / 2;
    const tx = S.frontTarget.x * TILE + TILE / 2, ty = S.frontTarget.y * TILE + TILE / 2;
    ctx.strokeStyle = S.frontPush ? 'rgba(255, 90, 60, 0.85)' : 'rgba(255, 210, 63, 0.75)';
    ctx.lineWidth = 4; ctx.setLineDash(S.frontPush ? [] : [8, 6]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(ty - sy, tx - sx);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - Math.cos(ang - 0.5) * 18, ty - Math.sin(ang - 0.5) * 18);
    ctx.lineTo(tx - Math.cos(ang + 0.5) * 18, ty - Math.sin(ang + 0.5) * 18);
    ctx.closePath(); ctx.fill();
  }

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

  // Provinz-Namen direkt auf der Karte beim Hineinzoomen
  if (z >= 0.7 && S.provinces) {
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 248, 225, 0.62)';
    for (const prov of S.provinces) {
      const pi = M.idx(prov.cx, prov.cy);
      if (!S.explored[pi] && !S.fogOff) continue;
      ctx.fillText(provName(prov), prov.cx * TILE + TILE / 2, prov.cy * TILE + TILE / 2);
    }
  }

  // Provinz-Gebäude (Control Europe: alle Gebäude einer Provinz am Provinz-Zentrum)
  const groupedBlds = new Map();
  for (const b of S.buildings) {
    if (b.type === 'bridge') continue;
    const key = `${b.x}_${b.y}_${b.type}`;
    if (!groupedBlds.has(key)) groupedBlds.set(key, { ...b, cnt: 1, allDone: isDone(b) });
    else { const g = groupedBlds.get(key); g.cnt++; if (isDone(b)) g.allDone = true; }
  }
  const slotCounters = new Map();
  for (const g of groupedBlds.values()) {
    const i = M.idx(g.x, g.y);
    if (!S.explored[i] && !S.fogOff && g.player_id !== S.me.id) continue;
    const owner = playerById(g.player_id);
    const posKey = `${g.x}_${g.y}`;
    const idxInProv = slotCounters.get(posKey) || 0;
    slotCounters.set(posKey, idxInProv + 1);
    const ox = (idxInProv % 3 - 1) * 10, oy = Math.floor(idxInProv / 3) * 10 - 4;
    const bx = g.x * TILE + ox, by = g.y * TILE + oy;
    ctx.globalAlpha = g.allDone ? 1 : 0.55;
    ctx.drawImage(getBuildingSprite(g.type, owner ? owner.color : '#888'), bx, by, 12, 12);
    ctx.globalAlpha = 1;
    if (g.cnt > 1) {
      ctx.fillStyle = '#000c'; ctx.fillRect(bx + 6, by + 6, 8, 7);
      ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
      ctx.fillText(String(g.cnt), bx + 10, by + 12);
    }
  }

  // Hauptstädte (Burg + Flagge mit Rahmen)
  for (const p of S.players) {
    if (p.capital_x == null || p.is_eliminated) continue;
    const i = M.idx(p.capital_x, p.capital_y);
    if (!S.explored[i] && !S.fogOff) continue;
    ctx.drawImage(getBuildingSprite('castle', p.color), p.capital_x * TILE - 3, p.capital_y * TILE - 3, TILE + 6, TILE + 6);
    ctx.drawImage(emblemCanvas(p.emblem, p.color, 10, p.flag_pattern || 'solid', p.shield_frame || 'gold'), p.capital_x * TILE - 2, p.capital_y * TILE - 12);
  }

  // Allianz-Pings auf der Karte
  const tNow = now();
  for (const ping of (S.match.pings || [])) {
    if (ping.until <= tNow) continue;
    if (ping.playerId !== S.me.id && !(S.me.alliance && ping.alliance === S.me.alliance)) continue;
    const r = 4 + 4 * Math.abs(Math.sin(tNow / 250));
    ctx.strokeStyle = ping.color || '#ffd23f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ping.x * TILE + TILE / 2, ping.y * TILE + TILE / 2, r, 0, Math.PI * 2); ctx.stroke();
  }

  // Armeen (immer groß & gut sichtbar, auch beim Herauszoomen, mit weicher Bewegung)
  const uSize = Math.max(TILE * 1.5, Math.min(54, 28 / z));
  const fSize = Math.max(7, Math.round(11 / z));
  ctx.font = `bold ${fSize}px monospace`; ctx.textAlign = 'center';
  for (const a of S.armies) {
    if (!a.player_id) continue;
    const pos = armyPos(a), ix = Math.round(pos.x), iy = Math.round(pos.y);
    if (!M.inBounds(ix, iy)) continue;
    const friendly = allied(a.player_id, S.me.id);
    const recon = S.reconUntil > tNow;
    if (!friendly && !recon && !S.visible[M.idx(ix, iy)]) continue;

    // Weiche Interpolation gegen visuelles Teleportieren + Kampf-Vorstoß
    const vis = S.armyVis[a.id] || { x: pos.x, y: pos.y };
    const dist = Math.hypot(pos.x - vis.x, pos.y - vis.y);
    if (dist > 35) { vis.x = pos.x; vis.y = pos.y; }
    else { vis.x += (pos.x - vis.x) * 0.22; vis.y += (pos.y - vis.y) * 0.22; }
    S.armyVis[a.id] = vis;

    let vx = vis.x, vy = vis.y;
    if (a.target_x != null && !a.arrives_at) {
      const lunge = Math.max(0, Math.sin(tNow / 180)) * 2.4;
      const ang = Math.atan2(a.target_y - a.y, a.target_x - a.x);
      vx += Math.cos(ang) * lunge; vy += Math.sin(ang) * lunge;
    }

    const owner = playerById(a.player_id);
    const sprite = getUnitSprite(a.unit_type, owner ? owner.color : '#888');
    const cx = vx * TILE + TILE / 2, cy = vy * TILE + TILE / 2 + (pos.moving ? Math.sin(tNow / 120) * 1.2 : 0);
    const px = cx - uSize / 2, py = cy - uSize / 2;

    if (friendly && pos.moving) {
      ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = Math.max(1.2, 2 / z); ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(a.target_x * TILE + TILE / 2, a.target_y * TILE + TILE / 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (!friendly && pos.moving && M.inBounds(a.target_x, a.target_y) && S.territory[M.idx(a.target_x, a.target_y)] === S.me.slot) {
      ctx.strokeStyle = `rgba(255, 70, 70, ${0.55 + 0.4 * Math.sin(tNow / 150)})`; ctx.lineWidth = Math.max(1.5, 2.5 / z); ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(a.target_x * TILE + TILE / 2, a.target_y * TILE + TILE / 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (a.unit_type === 'king') {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(1.2, 2 / z);
      ctx.beginPath(); ctx.arc(cx, cy, uSize * 0.65, 0, Math.PI * 2); ctx.stroke();
    }
    if (a.id === S.selectedArmyId) {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(1.6, 2.6 / z);
      ctx.strokeRect(px - 2 / z, py - 2 / z, uSize + 4 / z, uSize + 4 / z);
      // Zeige erreichbare Nachbar-Provinzen (Provinz-zu-Provinz Bewegung)
      const curPid = S.provOf && M.inBounds(a.x, a.y) ? S.provOf[M.idx(a.x, a.y)] : -1;
      const curPr = curPid >= 0 ? S.provinces[curPid] : null;
      if (curPr) {
        ctx.strokeStyle = 'rgba(255, 220, 90, 0.55)'; ctx.lineWidth = Math.max(1.2, 2 / z); ctx.setLineDash([4 / z, 4 / z]);
        for (const nid of curPr.adj) {
          const nb = S.provinces[nid];
          if (!nb) continue;
          ctx.beginPath(); ctx.moveTo(curPr.cx * TILE + TILE / 2, curPr.cy * TILE + TILE / 2);
          ctx.lineTo(nb.cx * TILE + TILE / 2, nb.cy * TILE + TILE / 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(nb.cx * TILE + TILE / 2, nb.cy * TILE + TILE / 2, Math.max(6, 9 / z), 0, Math.PI * 2); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    // HOI4-Angriffspfeil für aktiv kämpfende Armeen (arrives_at == null && target_x != null)
    if (a.target_x != null && !a.arrives_at) {
      const txp = a.target_x * TILE + TILE / 2, typ = a.target_y * TILE + TILE / 2;
      ctx.strokeStyle = 'rgba(255, 65, 65, 0.9)'; ctx.lineWidth = Math.max(2.4, 3.8 / z);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(txp, typ); ctx.stroke();
      const ang = Math.atan2(typ - cy, txp - cx);
      const headLen = Math.max(7, 11 / z);
      ctx.fillStyle = '#ff4646';
      ctx.beginPath(); ctx.moveTo(txp, typ);
      ctx.lineTo(txp - headLen * Math.cos(ang - 0.5), typ - headLen * Math.sin(ang - 0.5));
      ctx.lineTo(txp - headLen * Math.cos(ang + 0.5), typ - headLen * Math.sin(ang + 0.5));
      ctx.closePath(); ctx.fill();
    }
    ctx.drawImage(sprite, px, py, uSize, uSize);
    const rank = S.armyRanks[a.id] || 0;
    const badge = (rank >= 2 ? '⭐⭐' : rank === 1 ? '⭐' : '') + ((S.entrench[a.id] || 0) >= 8 ? '🛡️' : '');
    if (badge) { ctx.fillStyle = '#ffd23f'; ctx.fillText(badge, cx, py - 2 / z); }
    const bw = Math.max(16, uSize * 0.8), bh = fSize + 3 / z;
    ctx.fillStyle = '#000d'; ctx.fillRect(cx - bw / 2, py + uSize - bh * 0.4, bw, bh);
    ctx.strokeStyle = owner ? owner.color : '#fff'; ctx.lineWidth = Math.max(0.8, 1.2 / z);
    ctx.strokeRect(cx - bw / 2, py + uSize - bh * 0.4, bw, bh);
    ctx.fillStyle = '#fff'; ctx.fillText(String(a.count), cx, py + uSize + bh * 0.45);
  }

  // HOI4 Battle Bubbles (🟢/🟡/🔴 %) + Fortschrittsbalken & Schild-HP
  const seenBattles = new Set();
  const bRad = Math.max(11, 16 / z);
  for (const a of S.armies) {
    if (!a.player_id || a.count <= 0 || a.target_x == null || a.arrives_at != null) continue;
    const tpid = S.provOf && M.inBounds(a.target_x, a.target_y) ? S.provOf[M.idx(a.target_x, a.target_y)] : -1;
    if (tpid < 0 || seenBattles.has(tpid)) continue;
    seenBattles.add(tpid);
    const prov = S.provinces[tpid];
    if (!prov) continue;
    const atts = S.armies.filter((x) => x.player_id && x.count > 0 && x.target_x === a.target_x && x.target_y === a.target_y && !x.arrives_at);
    const defs = S.armies.filter((d) => d.player_id && d.count > 0 && !d.target_x && S.provOf?.[M.idx(d.x, d.y)] === tpid && !allied(d.player_id, a.player_id));
    const ap = atts.reduce((s, x) => s + armyPower(x, x.x, x.y), 0);
    const hp = Math.max(0, Math.round(S.provHp[tpid] ?? provDefense(tpid)));
    const dp = defs.reduce((s, d) => s + armyPower(d, prov.cx, prov.cy), 0) + hp * 0.85;
    const pct = Math.round((ap / Math.max(1, ap + dp)) * 100);
    const bx = ((a.x + prov.cx) / 2) * TILE + TILE / 2, by = ((a.y + prov.cy) / 2) * TILE;
    // Kampf-Blase
    ctx.fillStyle = pct >= 55 ? '#2e9e44' : pct >= 45 ? '#d4a72c' : '#c93b32';
    ctx.beginPath(); ctx.arc(bx, by, bRad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, 2 / z); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(8, Math.round(12 / z))}px monospace`; ctx.textAlign = 'center';
    ctx.fillText(`${pct}%`, bx, by + 3 / z);
    // HOI4 Fortschrittsbalken + Verteidigungs-HP unter der Blase
    const barW = bRad * 2.4, barH = Math.max(3, 4 / z);
    ctx.fillStyle = '#c93b32'; ctx.fillRect(bx - barW / 2, by + bRad + 2 / z, barW, barH);
    ctx.fillStyle = '#2e9e44'; ctx.fillRect(bx - barW / 2, by + bRad + 2 / z, barW * (pct / 100), barH);
    ctx.fillStyle = '#ffd23f'; ctx.font = `bold ${Math.max(6, Math.round(9 / z))}px monospace`;
    ctx.fillText(`🛡️${hp}`, bx, by + bRad + barH + Math.max(8, 10 / z));
  }

  if (S.selectedProvId >= 0 && S.provinces[S.selectedProvId]) {
    const sp = S.provinces[S.selectedProvId];
    ctx.strokeStyle = `rgba(232, 182, 76, ${0.7 + 0.3 * Math.sin(tNow / 200)})`;
    ctx.lineWidth = (1 / z) * 2.2;
    ctx.beginPath(); ctx.arc(sp.cx * TILE + TILE / 2, sp.cy * TILE + TILE / 2, 11, 0, Math.PI * 2); ctx.stroke();
  }
  if (!S.fogOff) {
    if (S.fogBuilt !== S.fogVersion) rebuildFogCanvas();
    ctx.drawImage(S.fogCanvas, 0, 0, M.W * TILE, M.H * TILE);
  }

  // Partikel- & Belagerungs-Effekte (S.fx)
  S.fx = S.fx.filter((f) => tNow - f.start < f.dur);
  for (const f of S.fx) {
    const p = (tNow - f.start) / f.dur;
    if (f.kind === 'boulder') {
      const bx = (f.x + (f.tx - f.x) * p) * TILE + 6;
      const by = (f.y + (f.ty - f.y) * p) * TILE + 6 - Math.sin(p * Math.PI) * 16;
      ctx.fillStyle = '#5a5f66'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
    } else if (f.kind === 'boom') {
      ctx.strokeStyle = `rgba(255, 120, 40, ${1 - p})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x * TILE + 6, f.y * TILE + 6, 4 + p * 14, 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'text') {
      ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = f.color || '#fff'; ctx.globalAlpha = 1 - p;
      ctx.fillText(f.label, f.x * TILE + 6, f.y * TILE - p * 14);
      ctx.globalAlpha = 1;
    }
  }

  // Winter-Schneefall im Viewport
  if (season === 'winter') {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(235, 248, 255, 0.55)';
    for (let k = 0; k < 70; k++) {
      ctx.fillRect((k * 137 + tNow / 25) % c.width, (k * 89 + tNow / 14) % c.height, 2, 2);
    }
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  }

  // Geplante Mehrfach-Bauten (Pending Queue)
  for (const pb of S.pendingBuilds) {
    ctx.globalAlpha = 0.72;
    ctx.drawImage(getBuildingSprite(pb.type, S.me.color), pb.x * TILE, pb.y * TILE, TILE, TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#7dff7a'; ctx.lineWidth = 1.2;
    ctx.strokeRect(pb.x * TILE, pb.y * TILE, TILE, TILE);
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
  const cam = S.camW, nz = clamp(cam.z * factor, 0.2, 4);
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
    onCanvasClick(screenToTile(p.mx, p.my), p);
  });
  c.addEventListener('pointercancel', endPtr);
  c.addEventListener('pointerleave', () => { S.hoverTile = null; });
}

function queueBuild(type, x, y) {
  if (!S.me || !S.match || S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  const existingIdx = S.pendingBuilds.findIndex((b) => b.x === x && b.y === y);
  if (existingIdx >= 0) {
    S.pendingBuilds.splice(existingIdx, 1);
    playSfx('click'); updateModeHint(); return;
  }
  const i = M.idx(x, y);
  if (type === 'bridge') {
    if (S.terrain[i] !== M.T.WATER) return toast('Brücken nur auf Wasser!', 'err');
    if (S.bridges.has(i)) return toast('Hier ist schon eine Brücke.', 'err');
  } else {
    if (!M.isPassable(S.terrain[i])) return toast('Hier kann man nicht bauen!', 'err');
    if (S.territory[i] !== S.me.slot) return toast('Nur in deinem eigenen Gebiet bauen!', 'err');
    if (S.me.capital_x === x && S.me.capital_y === y) return toast('Auf der Hauptstadt steht schon deine Burg.', 'err');
    if (S.buildings.some((b) => b.x === x && b.y === y)) return toast('Hier steht bereits ein Gebäude.', 'err');
    if (type === 'harbor') {
      const nearWater = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => M.inBounds(x+dx, y+dy) && S.terrain[M.idx(x+dx, y+dy)] === M.T.WATER);
      if (!nearWater) return toast('🚢 Ein Hafen muss direkt an Wasser (Küste) gebaut werden!', 'err');
    }
  }
  S.pendingBuilds.push({ type, x, y });
  playSfx('click');
  updateModeHint();
}

async function confirmPendingBuilds() {
  if (!S.pendingBuilds.length || !S.me) return;
  const totalCost = { wood: 0, gold: 0, raw_food: 0 };
  for (const pb of S.pendingBuilds) {
    const cost = pb.type === 'bridge' ? { wood: 50 } : (BUILDINGS[pb.type]?.cost || {});
    for (const k in cost) totalCost[k] = (totalCost[k] || 0) + cost[k];
  }
  if (!(await spend(totalCost))) return;
  const rows = S.pendingBuilds.map((pb) => {
    const bt = pb.type === 'bridge' ? 6 : (BUILDINGS[pb.type]?.buildTime || 8);
    return {
      match_id: S.match.id, player_id: S.me.id, layer: 'world', type: pb.type, x: pb.x, y: pb.y,
      construction_end_at: new Date(now() + (bt * 1000) / speed()).toISOString()
    };
  });
  const { data, error } = await sb.from('buildings').insert(rows).select();
  if (error) { await rpcAdd(S.me.id, totalCost, true); return toast(error.message, 'err'); }
  if (data) {
    S.buildings.push(...data);
    for (const b of data) if (b.type === 'bridge') S.bridges.add(M.idx(b.x, b.y));
  }
  playSfx('build');
  toast(`✅ ${rows.length} Gebäude gebaut!`, 'ok');
  trackQuest('built', rows.length);
  if (rows.some((r) => r.type === 'fort')) trackQuest('fort', 1);
  if (rows.some((r) => r.type === 'harbor' || r.type === 'caravan')) trackQuest('trade', 1);
  advanceTut('world_built');
  S.pendingBuilds = []; S.buildType = null; S.bridgeMode = false;
  updateModeHint(); renderPanel();
}

async function reinforceProvince(pid) {
  if (!S.match || !S.me || pid < 0) return;
  if (!(await spend({ gold: 40 }))) return;
  const guards = { ...(S.match.prov_guards || {}), [pid]: ((S.match.prov_guards?.[pid] || 0) + 50) };
  S.match.prov_guards = guards;
  await sb.from('matches').update({ prov_guards: guards }).eq('id', S.match.id);
  playSfx('coins');
  toast('🛡️ +50 Garnison für diese Provinz aufgestellt!', 'ok');
  updateTileBar();
}

async function renameProvince(pid) {
  if (!S.match || !S.me || pid < 0) return;
  const cur = provName(S.provinces[pid]);
  const next = prompt('Neuer Name für diese Provinz:', cur);
  if (!next || !next.trim()) return;
  const names = { ...(S.match.prov_names || {}), [pid]: next.trim().slice(0, 24) };
  S.match.prov_names = names;
  await sb.from('matches').update({ prov_names: names }).eq('id', S.match.id);
  playSfx('click');
  toast(`🏳️ Provinz umbenannt in „${names[pid]}“`, 'ok');
  updateTileBar();
}

async function gatherAllArmies() {
  const me = S.me;
  if (!me || me.capital_x == null) return;
  const idle = S.armies.filter((a) => a.player_id === me.id && a.target_x == null && a.unit_type !== 'ship' && a.unit_type !== 'warship' && (a.x !== me.capital_x || a.y !== me.capital_y));
  if (!idle.length) return toast('Keine freien Land-Armeen außerhalb der Hauptstadt.', 'err');
  let moved = 0;
  for (const a of idle) {
    await moveArmy(a, me.capital_x, me.capital_y);
    moved++;
  }
  playSfx('horn');
  toast(`⚡ ${moved} Armee(n) marschieren Provinz-zu-Provinz zur Hauptstadt!`, 'ok');
  renderPanel();
}

function onCanvasClick(t, screenPt = null) {
  if (!S.me || !S.match || !M.inBounds(t.x, t.y)) return;
  const pid = S.provOf ? S.provOf[M.idx(t.x, t.y)] : -1;
  if (S.frontlineMode) {
    S.frontTarget = { x: t.x, y: t.y };
    S.frontlineMode = false;
    playSfx('horn');
    toast(`🏹 Angriffsziel gesetzt! Starte jetzt „▶️ Angriff“!`, 'ok');
    updateModeHint(); renderPanel(); return;
  }

  // Bildschirm-basierte Treffererkennung (funktioniert bei jedem Zoom!)
  let own = null, bestD = 30;
  for (const a of S.armies) {
    if (a.player_id !== S.me.id || a.id === S.selectedArmyId) continue;
    const vis = S.armyVis[a.id] || armyPos(a);
    if (screenPt) {
      const sx = (vis.x * TILE + TILE / 2 - S.camW.x) * S.camW.z;
      const sy = (vis.y * TILE + TILE / 2 - S.camW.y) * S.camW.z;
      const d = Math.hypot(sx - screenPt.mx, sy - screenPt.my);
      if (d <= bestD) { bestD = d; own = a; }
    } else if (Math.hypot(vis.x - t.x, vis.y - t.y) <= 3.5) {
      own = a; break;
    }
  }

  const sel = S.armies.find((a) => a.id === S.selectedArmyId);
  if (sel) {
    const selPid = S.provOf ? S.provOf[M.idx(sel.x, sel.y)] : -1;
    if (pid === selPid) {
      if (own && S.provOf?.[M.idx(own.x, own.y)] === selPid) {
        S.selectedArmyId = own.id; playSfx('click'); updateModeHint(); renderPanel(); return;
      }
      S.selectedArmyId = null; updateModeHint(); renderPanel(); return;
    }
    moveArmy(sel, t.x, t.y); return;
  }

  if (own) {
    S.selectedArmyId = own.id;
    if (pid >= 0) S.selectedProvId = pid;
    S.selectedTile = t;
    playSfx('click');
    updateModeHint(); updateTileBar(); renderPanel(); return;
  }

  S.selectedTile = t;
  if (pid >= 0) S.selectedProvId = pid;
  advanceTut('tile_clicked');
  updateTileBar();
  if (pid >= 0 && S.provinces[pid] && !S.provinces[pid].isSea && S.territory[M.idx(S.provinces[pid].cx, S.provinces[pid].cy)] === S.me.slot) {
    if (S.activeTab === 'build') renderPanel();
  }
}

function updateTileBar() {
  const bar = $('tile-bar');
  if (!bar || !S.selectedTile || !S.terrain) { if (bar) bar.hidden = true; return; }
  const { x, y } = S.selectedTile, i = M.idx(x, y);
  const known = S.explored[i] || S.fogOff;
  const pid = S.provOf ? S.provOf[i] : -1;
  const prov = pid >= 0 ? S.provinces[pid] : null;
  const ownerSlot = prov ? S.territory[M.idx(prov.cx, prov.cy)] : S.territory[i];
  const owner = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;

  bar.innerHTML = '';
  const defVal = prov ? provDefense(pid) : 0;
  const goldVal = prov ? provGoldRate(pid).toFixed(1) : '0';
  bar.appendChild(h(`<b>${known && prov ? `🏛️ ${esc(provName(prov))}` : `Feld (${x}, ${y})`}</b> · ` +
    `${known ? (owner ? `<span style="color:${owner.color}">${esc(owner.kingdom_name)}</span>` : 'Neutral') : '???'}` +
    (known && prov && !prov.isSea ? ` · 🛡️${defVal} · +${goldVal}💰/s` : '')));
  if (owner && owner.id === S.me?.id && pid >= 0 && !prov?.isSea) {
    bar.appendChild(btn('🔨 Ausbauen', () => { S.selectedProvId = pid; setActiveTab('build'); }, 'btn small primary'));
    bar.appendChild(btn('🛡️ +50 (40💰)', () => reinforceProvince(pid), 'btn small gold'));
    bar.appendChild(btn('✏️ Name', () => renameProvince(pid), 'btn small'));
  }
  // Zeige stationierte eigene Armeen in dieser Provinz zum leichten Auswählen
  if (pid >= 0 && S.me) {
    const here = S.armies.filter((a) => a.player_id === S.me.id && S.provOf?.[M.idx(a.x, a.y)] === pid);
    for (const a of here) {
      bar.appendChild(btn(`⚔️ ${a.count}× ${UNITS[a.unit_type]?.name || ''}`, () => {
        S.selectedArmyId = S.selectedArmyId === a.id ? null : a.id;
        updateModeHint(); updateTileBar(); renderPanel();
      }, `btn small${S.selectedArmyId === a.id ? ' gold' : ''}`));
    }
  }
  bar.appendChild(btn('📍 Ping', () => sendPing(x, y), 'btn small'));
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

const QUESTS = [
  { id: 'built', label: 'Baue 2 Gebäude', goal: 2, reward: 40 },
  { id: 'conquered', label: 'Erobere 2 Provinzen', goal: 2, reward: 60 },
  { id: 'trade', label: 'Baue Hafen oder Karawane', goal: 1, reward: 50 },
  { id: 'fort', label: 'Baue eine Festung', goal: 1, reward: 80 }
];
function trackQuest(id, inc) {
  if (!S.me || S.quests.done[id]) return;
  S.quests[id] = (S.quests[id] || 0) + inc;
  const q = QUESTS.find((x) => x.id === id);
  if (q && S.quests[id] >= q.goal) {
    S.quests.done[id] = true;
    rpcAdd(S.me.id, { gold: q.reward }, true);
    playSfx('coins');
    toast(`🎯 Mission „${q.label}“ erfüllt! +${q.reward}💰`, 'ok');
  }
}

async function upgradeCapital() {
  const me = S.me, lv = me.capital_level || 1;
  if (lv >= 3) return;
  const cost = lv === 1 ? { gold: 150 } : { gold: 350 };
  if (!(await spend(cost))) return;
  me.capital_level = lv + 1;
  await sb.from('match_players').update({ capital_level: me.capital_level }).eq('id', me.id);
  playSfx('horn');
  toast(`🏰 Hauptstadt auf Stufe ${me.capital_level} ausgebaut!`, 'ok');
  renderPanel();
}

function panelBuild(el) {
  const me = S.me;
  const { d } = estimateRates();
  el.appendChild(h(`<div class="info-box"><h3>💰 Reichs-Wirtschaft</h3>
    <div class="stat"><span>💰 Gold-Einkommen</span><b>+${d.gold.toFixed(1)}/s</b></div>
    <div class="stat"><span>👷 Arbeitskraft</span><b>${fmt(me.population)}/${popCap()}</b></div>
    <p class="muted" style="margin-top:4px">Baue 🏠 Häuser für mehr Arbeitskraft, 💰 Märkte für Gold & 🏰 Festungen für Verteidigung!</p></div>`));

  // Aktuelle ausgewählte Provinz (Standard: Hauptstadt-Provinz)
  let pid = S.selectedProvId;
  let prov = pid >= 0 ? S.provinces[pid] : null;
  if (!prov || prov.isSea || S.territory[M.idx(prov.cx, prov.cy)] !== me.slot) {
    pid = S.provOf && me.capital_x != null ? S.provOf[M.idx(me.capital_x, me.capital_y)] : -1;
    prov = pid >= 0 ? S.provinces[pid] : null;
  }

  if (prov) {
    const blds = provBuildings(pid);
    const pending = S.buildings.filter((b) => b.x === prov.cx && b.y === prov.cy && !isDone(b));
    const counts = {};
    for (const b of blds) counts[b.type] = (counts[b.type] || 0) + 1;
    const pbox = h(`<div class="info-box" style="border-left:4px solid ${me.color}">
      <h3>🏛️ Provinz: ${esc(provName(prov))}</h3>
      <div class="stat"><span>🛡️ Verteidigung</span><b>${provDefense(pid)}</b></div>
      <div class="stat"><span>💰 Provinz-Gold</span><b>+${provGoldRate(pid).toFixed(1)}/s</b></div>
      <div class="stat"><span>🏗️ Gebäude</span><b>${Object.entries(counts).map(([k, v]) => `${BUILDINGS[k]?.name || k}×${v}`).join(', ') || 'Keine'}</b></div>
      ${pending.length ? `<p class="muted">⏳ ${pending.length} Gebäude im Bau…</p>` : ''}
    </div>`);
    const pRow = document.createElement('div'); pRow.className = 'row'; pRow.style.marginTop = '6px';
    pRow.appendChild(btn('🛡️ +50 Def (40💰)', () => reinforceProvince(pid), 'btn small gold'));
    pRow.appendChild(btn('✏️ Umbenennen', () => renameProvince(pid), 'btn small'));
    pbox.firstChild.appendChild(pRow);
    el.appendChild(pbox);

    el.appendChild(h(`<h3>🔨 In „${esc(provName(prov))}“ bauen</h3><p class="muted">Tippe eine andere Provinz auf der Karte an, um sie auszubauen.</p>`));
    const grid = document.createElement('div'); grid.className = 'grid2';
    for (const [type, def] of Object.entries(BUILDINGS)) {
      if (type === 'harbor' && !isCoastalProv(pid)) continue;
      const afford = (me.gold || 0) >= (def.cost.gold || 0);
      const b = document.createElement('button');
      b.className = 'bcard';
      b.title = def.desc; b.disabled = !afford;
      b.innerHTML = `<img src="${spriteUrl(getBuildingSprite(type, me.color), 'b' + type + me.color)}" alt=""><div><div class="name">${def.name} (${counts[type] || 0})</div><div class="cost">${costText(def.cost)}</div></div>`;
      b.onclick = () => buildInProvince(pid, type);
      grid.appendChild(b);
    }
    el.appendChild(grid);
  } else {
    el.appendChild(h('<p class="muted">Tippe eine deiner Provinzen auf der Karte an, um sie auszubauen.</p>'));
  }

  const capLv = me.capital_level || 1;
  const capBox = h(`<div class="info-box" style="margin-top:8px"><h3>🏰 Hauptstadt (Stufe ${capLv}/3)</h3></div>`);
  if (capLv < 3) {
    const cCost = capLv === 1 ? { gold: 150 } : { gold: 350 };
    capBox.firstChild.appendChild(h(`<p class="muted">+50 Verteidigung & +1💰/s (${costText(cCost)})</p>`));
    capBox.firstChild.appendChild(btn(`⬆️ Hauptstadt Stufe ${capLv + 1}`, upgradeCapital, 'btn small primary'));
  } else capBox.firstChild.appendChild(h('<p class="muted">Maximale Stufe erreicht!</p>'));
  el.appendChild(capBox);

  const ageBox = h(`<div class="info-box"><h3>🏛️ ${AGE_NAMES[me.age]}</h3></div>`);
  if (me.age < 4) {
    ageBox.firstChild.appendChild(h(`<p class="muted">Nächstes: <b>${AGE_NAMES[me.age + 1]}</b> (${costText(AGE_COST[me.age + 1])})</p>`));
    ageBox.firstChild.appendChild(btn('⬆️ Zeitalter aufsteigen', ageUp, 'btn small gold'));
  } else ageBox.firstChild.appendChild(h('<p class="muted">Höchstes Zeitalter erreicht!</p>'));
  el.appendChild(ageBox);
}

function panelArmy(el) {
  const me = S.me, hasBarracks = countType('barracks') > 0;
  el.appendChild(h(`<h3>⚔️ Rekrutierung (👷 ${fmt(me.population)}/${popCap()})</h3>${hasBarracks ? '' : '<p class="muted">⚠️ Baue zuerst eine <b>⚔️ Kaserne</b> in einer Provinz!</p>'}`));
  for (const [type, u] of Object.entries(UNITS)) {
    if (type === 'king') continue;
    const locked = me.age < u.age;
    const needBld = (type === 'ship' || type === 'warship') ? countType('harbor') === 0 : !hasBarracks;
    const row = document.createElement('div'); row.className = 'army-row';
    const total = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, v * BATCH]));
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(type, me.color), 'u' + type + me.color)}" alt=""><div class="grow"><b>${u.name}</b> · ⚔️${u.power} · ⏳${u.trainTime}s<br><span class="muted">${costText(total)} + ${BATCH}👷${u.note ? ' · ' + u.note : ''}${locked ? ' · 🔒 ' + AGE_NAMES[u.age] : ''}</span></div>`;
    row.appendChild(btn('+5', () => trainUnits(type), 'btn small primary', needBld || locked));
    el.appendChild(row);
  }
  el.appendChild(btn('⚡ Alle zur Hauptstadt sammeln', gatherAllArmies, 'btn small gold'));
  el.appendChild(btn('🛡️ An Frontlinie verteilen', assignFrontline, 'btn small primary'));
  el.appendChild(btn(S.frontlineMode ? '❌ Zielwahl abbrechen' : '🏹 Angriffsziel setzen', () => {
    S.frontlineMode = !S.frontlineMode; updateModeHint(); renderPanel();
  }, `btn small${S.frontlineMode ? ' active' : ''}`));
  el.appendChild(btn(S.frontPush ? '⏸️ Angriff pausieren' : '▶️ Angriff starten', () => {
    S.frontPush = !S.frontPush;
    playSfx('horn');
    toast(S.frontPush ? '⚔️ HOI4-Angriff gestartet! Frontlinie rückt Provinz-zu-Provinz vor.' : '⏸️ Front-Angriff pausiert.', 'ok');
    renderPanel();
  }, `btn small${S.frontPush ? ' danger' : ' gold'}`));
  el.appendChild(btn('✈️ Aufklärung 30s (35💰)', async () => {
    if (!(await spend({ gold: 35 }))) return;
    S.reconUntil = now() + 30000;
    playSfx('coins');
    toast('✈️ Aufklärungs-Ballon gestartet! Alle Feinde 30s sichtbar.', 'ok');
  }, 'btn small'));

  if (S.trainQueue.length) {
    const qbox = h('<h3>⏳ In Ausbildung</h3>');
    for (const q of S.trainQueue) {
      const left = Math.max(0, Math.ceil((q.readyAt - now()) / 1000));
      const pct = clamp(100 - ((q.readyAt - now()) / q.totalMs) * 100, 0, 100);
      qbox.appendChild(h(`<div class="info-box"><div class="stat"><span>${BATCH}× ${UNITS[q.unitType]?.name}</span><b>${left}s</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`));
    }
    el.appendChild(qbox);
  }
  el.appendChild(h('<h3>⚔️ Deine Armeen</h3><p class="muted">Armee wählen → Provinz antippen (Provinz-zu-Provinz).</p>'));
  const mine = S.armies.filter((a) => a.player_id === me.id);
  if (!mine.length) el.appendChild(h('<p class="muted">Keine Armeen.</p>'));
  for (const a of mine) {
    const p = armyPos(a);
    const pid = S.provOf && M.inBounds(a.x, a.y) ? S.provOf[M.idx(a.x, a.y)] : -1;
    const pName = pid >= 0 && S.provinces[pid] ? provName(S.provinces[pid]) : `(${a.x},${a.y})`;
    const row = document.createElement('div'); row.className = `army-row${a.id === S.selectedArmyId ? ' sel' : ''}`;
    const eta = a.arrives_at ? Math.max(0, Math.ceil((new Date(a.arrives_at).getTime() - now()) / 1000)) : 0;
    const statusTxt = a.target_x != null
      ? (a.arrives_at ? `🚶 → ${eta}s` : '⚔️ In HOI4-Schlacht!')
      : `📍 ${esc(pName)}`;
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(a.unit_type, me.color), 'u' + a.unit_type + me.color)}" alt=""><div class="grow"><b>${a.count}× ${UNITS[a.unit_type]?.name || a.unit_type}</b><br><span class="muted">${statusTxt}</span></div>`;
    row.appendChild(btn(a.id === S.selectedArmyId ? '✔' : 'Wählen', () => {
      S.selectedArmyId = a.id === S.selectedArmyId ? null : a.id;
      S.camW.x = p.x * TILE - $('game-canvas').width / 2 / S.camW.z;
      S.camW.y = p.y * TILE - $('game-canvas').height / 2 / S.camW.z;
      updateModeHint(); renderPanel();
    }, 'btn small', false));
    el.appendChild(row);
    if (a.id === S.selectedArmyId && a.target_x == null) {
      const actions = document.createElement('div'); actions.className = 'row'; actions.style.marginBottom = '8px';
      actions.appendChild(btn('✂️ Teilen', () => splitArmy(a), 'btn small', a.count < 2));
      actions.appendChild(btn('🔗 Vereinen', () => mergeArmies(a)));
      el.appendChild(actions);
    }
  }
}

function panelDiplo(el) {
  const me = S.me;
  const incTribute = S.match?.tributes?.[me.id];
  if (incTribute && incTribute.from) {
    const fromP = playerById(incTribute.from);
    const tbox = h(`<div class="info-box"><h3>🕊️ Tribut-Forderung</h3><p class="muted"><b>${fromP ? esc(fromP.kingdom_name) : 'Ein König'}</b> fordert ${incTribute.amount}💰 für einen 10-Minuten-NAP.</p></div>`);
    const row = document.createElement('div'); row.className = 'row';
    row.appendChild(btn(`💰 Zahlen (${incTribute.amount}💰)`, async () => {
      if (!(await spend({ gold: incTribute.amount }))) return;
      if (fromP) await rpcAdd(fromP.id, { gold: incTribute.amount }, true);
      const tributes = { ...(S.match.tributes || {}) }; delete tributes[me.id];
      const naps = { ...(S.match.naps || {}), [napKey(me.id, incTribute.from)]: now() + 600000 };
      await sb.from('matches').update({ tributes, naps }).eq('id', S.match.id);
      playSfx('coins');
      await sysChat(`🕊️ ${me.kingdom_name} zahlt ${incTribute.amount}💰 Tribut an ${fromP ? fromP.kingdom_name : 'den Forderer'} (10m NAP)!`);
      renderPanel();
    }, 'btn small primary'));
    row.appendChild(btn('✖ Ablehnen', async () => {
      const tributes = { ...(S.match.tributes || {}) }; delete tributes[me.id];
      await sb.from('matches').update({ tributes }).eq('id', S.match.id);
      renderPanel();
    }, 'btn small danger'));
    tbox.firstChild.appendChild(row); el.appendChild(tbox);
  }
  if (me.vassal_of) {
    const lord = playerById(me.vassal_of);
    const vbox = h(`<div class="info-box"><h3>👑 Du bist Vasall von ${lord ? esc(lord.kingdom_name) : 'einem König'}</h3><p class="muted">Du zahlst 25% Gold-Steuer. Kaufe dich frei oder starte eine Rebellion!</p></div>`);
    const row = document.createElement('div'); row.className = 'row';
    row.appendChild(btn('💰 Freikaufen (250💰)', async () => {
      if (!(await spend({ gold: 250 }))) return;
      if (lord) await rpcAdd(lord.id, { gold: 250 }, true);
      me.vassal_of = null;
      await sb.from('match_players').update({ vassal_of: null }).eq('id', me.id);
      playSfx('coins');
      await sysChat(`🕊️ ${me.kingdom_name} hat sich für 250 Gold freigekauft!`);
      renderPanel();
    }, 'btn small gold'));
    row.appendChild(btn('🏴 Rebellion ausrufen!', async () => {
      if (!confirm('Wirklich gegen deinen Lehnsherrn rebellieren? (+10 Rebellen-Truppen!)')) return;
      me.vassal_of = null;
      await sb.from('match_players').update({ vassal_of: null }).eq('id', me.id);
      if (me.capital_x != null) {
        const { data } = await sb.from('armies').insert({ match_id: S.match.id, player_id: me.id, unit_type: 'swordsman', count: 10, x: me.capital_x, y: me.capital_y }).select().single();
        if (data) S.armies.push(data);
      }
      playSfx('horn');
      await sysChat(`🏴 REBELLION! ${me.kingdom_name} erhebt sich gegen ${lord ? lord.kingdom_name : 'seinen Lehnsherrn'}!`);
      renderPanel();
    }, 'btn small danger'));
    vbox.firstChild.appendChild(row);
    el.appendChild(vbox);
  }
  const maxGold = Math.max(1, ...S.players.map((p) => p.gold || 0));
  const statsBox = h(`<div class="info-box"><h3>📈 Reichs-Vergleich</h3>` +
    S.players.map((p) => {
      const units = S.armies.filter((a) => a.player_id === p.id).reduce((s, a) => s + a.count, 0);
      const wPct = Math.min(100, ((p.territory_percent || 0) / 70) * 100);
      return `<div style="margin:4px 0"><div class="stat"><span style="color:${p.color}">${esc(p.kingdom_name)}</span><b>${(p.territory_percent || 0).toFixed(1)}% · ${fmt(p.gold)}💰 · ${units}⚔️</b></div><div class="bar"><i style="width:${wPct}%;background:${p.color}"></i></div></div>`;
    }).join('') + `</div>`);
  el.appendChild(statsBox);

  const allyBox = h(`<div class="info-box"><h3>🤝 Allianz</h3><p class="muted">Gleicher Name = verbündet (kein Angriff, geteilte Sicht).</p></div>`);
  const form = document.createElement('form'); form.className = 'row';
  form.innerHTML = `<input id="ally-input" maxlength="20" placeholder="Allianz-Name" value="${esc(me.alliance)}"><button class="btn small">OK</button>`;
  form.onsubmit = (e) => { e.preventDefault(); setAlliance($('ally-input').value); };
  allyBox.firstChild.appendChild(form); el.appendChild(allyBox);

  el.appendChild(h('<h3>👑 Königreiche (Ziel: 70%)</h3>'));
  for (const p of [...S.players].sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0))) {
    const isMe = p.id === me.id, ally = !isMe && allied(p.id, me.id);
    const lord = p.vassal_of ? playerById(p.vassal_of) : null;
    const box = document.createElement('div'); box.className = 'info-box'; box.style.borderLeft = `5px solid ${p.color}`;
    const head = document.createElement('div'); head.className = 'row';
    head.appendChild(emblemCanvas(p.emblem, p.color, 24, p.flag_pattern || 'solid', p.shield_frame || 'gold'));
    head.appendChild(h(`<div><b>${esc(p.kingdom_name)}</b>${isMe ? ' (Du)' : ''}${ally ? ' 🤝' : ''}${p.is_eliminated ? ' ☠️' : ''}<br><span class="muted">${AGE_NAMES[p.age]} · 🗺️ ${(p.territory_percent || 0).toFixed(1)}%${lord ? ' · 👑 Vasall von ' + esc(lord.kingdom_name) : ''}${p.alliance ? ' · „' + esc(p.alliance) + '“' : ''}</span></div>`));
    box.appendChild(head);
    if (!isMe && !p.is_eliminated) {
      const actions = document.createElement('div'); actions.className = 'row'; actions.style.marginTop = '6px';
      const napLeft = Math.max(0, Math.ceil(((S.match?.naps?.[napKey(me.id, p.id)] || 0) - now()) / 60000));
      actions.appendChild(btn(napLeft > 0 ? `📜 NAP (${napLeft}m)` : '📜 10m NAP', () => makeNap(p), 'btn small', napLeft > 0));
      const ws = warState(me.id, p.id);
      if (!ally && napLeft === 0) {
        actions.appendChild(btn(
          ws === 'active' ? '⚔️ Im Krieg' : ws === 'countdown' ? `⏳ ${warLeftSec(me.id, p.id)}s` : '📣 Krieg (30s)',
          () => declareWar(p),
          'btn small danger',
          ws !== 'none'
        ));
        if (ws === 'active') {
          actions.appendChild(btn('⏱️ Waffenstillstand', async () => {
            const naps = { ...(S.match.naps || {}), [napKey(me.id, p.id)]: now() + 300000 };
            const wars = { ...(S.match.wars || {}) }; delete wars[napKey(me.id, p.id)];
            await sb.from('matches').update({ naps, wars }).eq('id', S.match.id);
            playSfx('coins');
            await sysChat(`⏱️ ${me.kingdom_name} & ${p.kingdom_name} schließen einen 5-Minuten-Waffenstillstand!`);
            renderPanel();
          }, 'btn small'));
        }
        actions.appendChild(btn('🕊️ Tribut (60💰)', async () => {
          const tributes = { ...(S.match.tributes || {}), [p.id]: { from: me.id, amount: 60 } };
          await sb.from('matches').update({ tributes }).eq('id', S.match.id);
          playSfx('coins');
          toast(`🕊️ Tribut-Forderung an ${p.kingdom_name} gesendet!`, 'ok');
        }, 'btn small'));
      }
      const amt = document.createElement('input'); amt.type = 'number'; amt.value = '50'; amt.min = '1'; amt.style.width = '70px'; amt.style.display = 'inline-block';
      actions.append(amt, btn('💰 Gold senden', () => sendResources(p, 'gold', Number(amt.value))));
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
  const byTerr = [...S.players].sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0))[0];
  const byGold = [...S.players].sort((a, b) => (b.gold || 0) - (a.gold || 0))[0];
  const byBld = [...S.players].sort((a, b) => S.buildings.filter((x) => x.player_id === b.id).length - S.buildings.filter((x) => x.player_id === a.id).length)[0];
  const byArmy = [...S.players].sort((a, b) => S.armies.filter((x) => x.player_id === b.id).reduce((s, x) => s + x.count, 0) - S.armies.filter((x) => x.player_id === a.id).reduce((s, x) => s + x.count, 0))[0];
  $('end-stats').innerHTML = `<h3>📊 Kriegs-Statistik</h3>
    <div class="stat"><span>🗺️ Größtes Reich</span><b>${byTerr ? `${esc(byTerr.kingdom_name)} (${(byTerr.territory_percent || 0).toFixed(1)}%)` : '-'}</b></div>
    <div class="stat"><span>🏰 Meiste Gebäude</span><b>${byBld ? `${esc(byBld.kingdom_name)} (${S.buildings.filter((x) => x.player_id === byBld.id).length})` : '-'}</b></div>
    <div class="stat"><span>⚔️ Stärkste Armee</span><b>${byArmy ? `${esc(byArmy.kingdom_name)} (${S.armies.filter((x) => x.player_id === byArmy.id).reduce((s, x) => s + x.count, 0)})` : '-'}</b></div>
    <div class="stat"><span>💰 Reichster König</span><b>${byGold ? `${esc(byGold.kingdom_name)} (${fmt(byGold.gold)})` : '-'}</b></div>`;
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
  if ($('my-pattern')) $('my-pattern').onchange = renderEmblemPicker;
  if ($('my-frame')) $('my-frame').onchange = renderEmblemPicker;
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

  $('chat-form').onsubmit = (e) => { e.preventDefault(); sendChat($('chat-input').value, Boolean($('chat-ally')?.checked)); $('chat-input').value = ''; };
  $('btn-tutorial-menu').onclick = () => { playSfx('click'); $('modal-tutorial').hidden = false; };
  $('btn-tutorial').onclick = () => { playSfx('click'); $('modal-tutorial').hidden = false; };
  $('btn-start-tut').onclick = () => {
    $('modal-tutorial').hidden = true;
    if (S.inGame) startInteractiveTut(); else toast('Starte ein Spiel, dann startet das interaktive Tutorial!', 'ok');
  };
  $('tut-next').onclick = () => { if (S.tutStep >= 0 && S.tutStep < TUT_STEPS.length) advanceTut(TUT_STEPS[S.tutStep].trigger); };
  $('tut-skip').onclick = () => { S.tutStep = -1; localStorage.setItem('fk_it_done', '1'); renderTut(); };
  $('btn-confirm-build').onclick = confirmPendingBuilds;
  $('btn-cancel-mode').onclick = () => { S.buildType = null; S.bridgeMode = false; S.selectedArmyId = null; S.pendingBuilds = []; updateModeHint(); renderPanel(); };
  $('btn-admin').onclick = openAdminPanel;
  $('btn-fullscreen').onclick = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  };
  document.querySelectorAll('[data-cfilter]').forEach((b) => {
    b.onclick = () => {
      S.chatFilter = b.dataset.cfilter;
      document.querySelectorAll('[data-cfilter]').forEach((x) => x.classList.toggle('active', x === b));
      renderChat();
    };
  });
  $('btn-mute').onclick = toggleMute; $('btn-mute-global').onclick = toggleMute;
  $('btn-leave-game').onclick = () => { if (confirm('Zurück zum Menü?')) showMenu(); };
  $('btn-zoom-in').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 1.25); };
  $('btn-zoom-out').onclick = () => { const c = $('game-canvas'); zoomAt(c.width / 2, c.height / 2, 0.8); };
  $('btn-center').onclick = centerOnCapital;
  $('btn-end-menu').onclick = showMenu;
  document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => { playSfx('click'); setActiveTab(b.dataset.tab); }; });
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { $(b.dataset.close).hidden = true; }; });
  window.addEventListener('resize', () => S.inGame && resizeCanvas());
  const mm = $('minimap');
  if (mm) {
    const jump = (e) => {
      const r = mm.getBoundingClientRect(), c = $('game-canvas');
      const wx = clamp((e.clientX - r.left) / r.width, 0, 1) * M.W * TILE;
      const wy = clamp((e.clientY - r.top) / r.height, 0, 1) * M.H * TILE;
      S.camW.x = wx - c.width / 2 / S.camW.z;
      S.camW.y = wy - c.height / 2 / S.camW.z;
    };
    mm.addEventListener('pointerdown', (e) => { mm._drag = true; mm.setPointerCapture(e.pointerId); jump(e); });
    mm.addEventListener('pointermove', (e) => { if (mm._drag) jump(e); });
    mm.addEventListener('pointerup', () => { mm._drag = false; });
    mm.addEventListener('pointercancel', () => { mm._drag = false; });
  }
  bindCanvas(); bindKeys();
}

setupAdmin({
  S, sb, M, toast, rpcAdd, sysChat, startMatch,
  spawnBarbarians: async () => toast('Banditen sind deaktiviert.'),
  triggerFire: async () => toast('Feuer-Events sind deaktiviert.'),
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
