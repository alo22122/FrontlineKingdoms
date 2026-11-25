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
const TILE = 6;
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
  house:      { name: 'Haus',       cost: { wood: 25 },           desc: '+5 Einwohner-Limit (mehr Truppen & Produktion).' },
  farm:       { name: 'Bauernhof',  cost: { wood: 30 },           prod: { raw_food: 2.0 }, desc: 'Produziert 🌾 Nahrung für Truppen.' },
  lumberjack: { name: 'Holzfäller', cost: { wood: 20 },           prod: { wood: 2.0 },     desc: 'Produziert 🪵 Holz für Gebäude & Schiffe.' },
  goldmine:   { name: 'Goldmine',   cost: { wood: 40 },           prod: { gold: 1.5 },     desc: 'Produziert 💰 Gold (2× auf Gold-Feldern).' },
  barracks:   { name: 'Kaserne',    cost: { wood: 50, gold: 20 }, desc: 'Ermöglicht Truppen auszubilden.' },
  tower:      { name: 'Wachturm',   cost: { wood: 40, gold: 20 }, desc: 'Deckt Sicht auf & +15% Verteidigung.' },
  fort:       { name: 'Festung',    cost: { wood: 60, gold: 40 }, desc: '+30% Verteidigung & starke Provinz-Garnison.' },
  wall:       { name: 'Mauer',      cost: { wood: 10 },           desc: '+25 Garnison-Schutz in der Provinz.' },
  blacksmith: { name: 'Schmiede',   cost: { wood: 45, gold: 30 }, desc: '+10% Angriffskraft für alle Truppen (max +50%).' },
  market:     { name: 'Marktplatz', cost: { wood: 50, gold: 25 }, desc: 'Tausche Holz/Nahrung gegen Gold im Diplo-Tab.' },
  harbor:     { name: 'Hafen',      cost: { wood: 45, gold: 20 }, desc: 'An der Küste bauen! Seehandel-Gold steigt mit Entfernung.' },
  caravan:    { name: 'Karawane',   cost: { wood: 40, gold: 25 }, desc: 'Landhandel! Gold steigt mit Entfernung zu Verbündeten.' }
};

const UNITS = {
  swordsman: { name: 'Schwertkämpfer', age: 1, power: 10, speed: 1.5, trainTime: 8,  cost: { gold: 8, raw_food: 15 } },
  archer:    { name: 'Bogenschütze',   age: 2, power: 9,  speed: 1.5, trainTime: 10, cost: { wood: 15, gold: 10 }, note: '+50% auf Hügeln' },
  ship:      { name: 'Schiff',         age: 2, power: 6,  speed: 1.0, trainTime: 14, cost: { wood: 40 }, note: 'Fährt über Wasser & blockiert Häfen' },
  spy:       { name: 'Spion',          age: 2, power: 1,  speed: 0.8, trainTime: 10, cost: { gold: 25 }, note: 'Späht Gegner & Karte aus' },
  knight:    { name: 'Ritter',         age: 3, power: 24, speed: 1.0, trainTime: 16, cost: { gold: 30, raw_food: 20 } },
  catapult:  { name: 'Katapult',       age: 4, power: 40, speed: 2.5, trainTime: 20, cost: { wood: 60, gold: 30 } }
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
  lastTerritoryWrite: 0, lastSnapshot: 0, lastEvent: Date.now(), lastExploredSave: 0,
  authBusy: false, endShown: false, activeTab: 'build', drag: null,
  lobbyFormFilled: false, myEmblem: 'crown', rafRunning: false, tutStep: -1,
  quests: { built: 0, conquered: 0, trade: 0, fort: 0, done: {} },
  alertedArmies: new Set(), provCooldown: {}, fx: [], trainQueue: []
};

// ---------------------------------------------------------------------------
// HILFSFUNKTIONEN
// ---------------------------------------------------------------------------
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
function emblemCanvas(emblem, color, size = 32, pattern = 'solid') {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawFlagBg(ctx, pattern, color, size);
  ctx.drawImage(getEmblemSprite(emblem, '#ffffff'), 0, 0, size, size);
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
    .select('id,match_id,user_id,username,slot,kingdom_name,color,emblem,flag_pattern,age,alliance,vassal_of,capital_level,wood,stone,gold,raw_food,bread,food,morale,population,territory_percent,capital_x,capital_y,is_eliminated,created_at')
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
    row.appendChild(emblemCanvas(p.emblem, p.color, 24, p.flag_pattern || 'solid'));
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
    S.myEmblem = S.me.emblem; renderEmblemPicker();
  }
  renderChat();
}

function renderEmblemPicker() {
  const box = $('emblem-picker'); box.innerHTML = '';
  const pat = $('my-pattern') ? $('my-pattern').value : 'solid';
  for (const [key, label] of Object.entries(EMBLEMS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = label; b.className = key === S.myEmblem ? 'active' : '';
    b.appendChild(emblemCanvas(key, $('my-color').value, 32, pat));
    b.onclick = () => { S.myEmblem = key; playSfx('click'); renderEmblemPicker(); };
    box.appendChild(b);
  }
}

async function saveKingdom() {
  const kingdom_name = $('my-kingdom').value.trim().slice(0, 24) || S.me.kingdom_name;
  const flag_pattern = $('my-pattern') ? $('my-pattern').value : 'solid';
  const { error } = await sb.from('match_players').update({ kingdom_name, color: $('my-color').value, emblem: S.myEmblem, flag_pattern }).eq('id', S.me.id);
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
  const cx = S.me?.capital_x ?? 240, cy = S.me?.capital_y ?? 240;
  S.camW.x = cx * TILE + TILE / 2 - c.width / 2 / z;
  S.camW.y = cy * TILE + TILE / 2 - c.height / 2 / z;
}
function renderMinimap() {
  const mm = $('minimap');
  if (!mm || !S.terrain || !S.inGame) return;
  drawMiniMap(mm, S.terrain, S.territory);
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
  // Basis-Produktion der Hauptstadt (steigt mit Hauptstadt-Stufe) + Gebäude
  const capLv = me.capital_level || 1;
  const mult = (0.8 + me.population * 0.04) * (S.match?.season === 'winter' ? 0.8 : 1);
  const d = { wood: 0.8 * capLv, gold: 0.4 * capLv, raw_food: 1.0 * capLv };
  for (const b of myBuildings()) {
    const def = BUILDINGS[b.type];
    if (!def?.prod) continue;
    const isGoldTile = S.terrain && S.terrain[M.idx(b.x, b.y)] === M.T.GOLD;
    for (const k in def.prod) d[k] += def.prod[k] * (k === 'gold' && isGoldTile ? 2 : 1);
  }
  // Seehandel durch Häfen (Gold steigt mit Entfernung zu anderen Häfen, außer blockiert durch feindliche Schiffe)
  const myHarbors = myBuildings().filter((b) => b.type === 'harbor');
  const otherHarbors = S.buildings.filter((b) => b.type === 'harbor' && allied(b.player_id, me.id));
  for (const h1 of myHarbors) {
    if (isHarborBlockaded(h1)) continue;
    let maxDist = 0;
    for (const h2 of otherHarbors) {
      if (h2.id !== h1.id) maxDist = Math.max(maxDist, Math.hypot(h2.x - h1.x, h2.y - h1.y));
    }
    d.gold += 1.2 + Math.min(4.5, maxDist * 0.03);
  }
  // Karawanen-Handel über Land
  const myCaravans = myBuildings().filter((b) => b.type === 'caravan');
  const otherCaravans = S.buildings.filter((b) => b.type === 'caravan' && allied(b.player_id, me.id));
  for (const c1 of myCaravans) {
    let maxDist = 0;
    for (const c2 of otherCaravans) {
      if (c2.id !== c1.id) maxDist = Math.max(maxDist, Math.hypot(c2.x - c1.x, c2.y - c1.y));
    }
    d.gold += 1.0 + Math.min(4.0, maxDist * 0.025);
  }
  for (const k in d) d[k] *= mult;
  return { d, mult };
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
    const home = S.armies.find((a) => a.player_id === me.id && a.unit_type === q.unitType && a.target_x == null && a.x === me.capital_x && a.y === me.capital_y);
    if (home) {
      home.count += BATCH;
      await sb.from('armies').update({ count: home.count }).eq('id', home.id);
    } else {
      const { data } = await sb.from('armies')
        .insert({ match_id: S.match.id, player_id: me.id, unit_type: q.unitType, count: BATCH, x: me.capital_x, y: me.capital_y })
        .select().single();
      if (data) S.armies.push(data);
    }
    playSfx('build');
    toast(`✅ ${BATCH}× ${UNITS[q.unitType]?.name} ausgebildet!`, 'ok');
    advanceTut('trained');
  }
  renderPanel();
}

async function clientTick() {
  const me = S.me;
  if (!me || !S.match || S.match.status !== 'running' || me.is_eliminated) return;
  await processTrainQueue();
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
    // Vasallen-Steuer: 25% des Gold-Einkommens an den Lehnsherrn
    if (me.vassal_of && ints.gold > 0) {
      const tax = Math.max(1, Math.floor(ints.gold * 0.25));
      ints.gold -= tax;
      await rpcAdd(me.vassal_of, { gold: tax }, true);
    }
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
  if (type === 'harbor') {
    const nearWater = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => M.inBounds(x+dx, y+dy) && S.terrain[M.idx(x+dx, y+dy)] === M.T.WATER);
    if (!nearWater) return toast('🚢 Ein Hafen muss direkt an Wasser (Küste) gebaut werden!', 'err');
  }
  const def = BUILDINGS[type];
  if (!def || !(await spend(def.cost))) return;
  const { data, error } = await sb.from('buildings')
    .insert({ match_id: S.match.id, player_id: S.me.id, layer: 'world', type, x, y, construction_end_at: new Date().toISOString() })
    .select().single();
  if (error) { await rpcAdd(S.me.id, def.cost, true); return toast(error.message, 'err'); }
  if (data) S.buildings.push(data);
  playSfx('build');
  toast(`✅ ${def.name} gebaut!`, 'ok');
  trackQuest('built', 1);
  if (type === 'fort') trackQuest('fort', 1);
  if (type === 'harbor' || type === 'caravan') trackQuest('trade', 1);
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

const armyCap = () => (S.me ? S.me.population * 3 : 15);
const totalArmyCount = () => (S.me ? S.armies.filter((a) => a.player_id === S.me.id).reduce((s, a) => s + a.count, 0) + S.trainQueue.length * BATCH : 0);

async function trainUnits(type) {
  const me = S.me, u = UNITS[type];
  if (S.match.status !== 'running') return toast('Spiel läuft nicht.', 'err');
  if (countType('barracks') === 0) return toast('Baue zuerst eine ⚔️ Kaserne auf der Weltkarte!', 'err');
  if (me.age < u.age) return toast(`Benötigt ${AGE_NAMES[u.age]}.`, 'err');
  if (totalArmyCount() + BATCH > armyCap()) return toast(`Truppen-Limit (${armyCap()}) erreicht! Baue mehr 🏠 Häuser.`, 'err');
  if (!(await spend(u.cost, BATCH))) return;
  const ms = ((u.trainTime || 10) * 1000) / speed();
  const lastEnd = S.trainQueue.length ? Math.max(now(), S.trainQueue[S.trainQueue.length - 1].readyAt) : now();
  S.trainQueue.push({ unitType: type, readyAt: lastEnd + ms, totalMs: ms });
  playSfx('click');
  toast(`⏳ ${BATCH}× ${u.name} in Ausbildung (${Math.ceil(ms / 1000)}s)`, 'ok');
  renderPanel();
}

function travelMs(unitType, x0, y0, x1, y1) {
  const winterMult = S.match?.season === 'winter' ? 1.25 : 1;
  return (Math.hypot(x1 - x0, y1 - y0) * (UNITS[unitType]?.speed || 2) * 2400 * winterMult) / speed();
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
  const cur = armyPos(a);
  const sx = a.target_x != null ? Math.round(cur.x) : a.x;
  const sy = a.target_y != null ? Math.round(cur.y) : a.y;
  if (sx === tx && sy === ty) return;
  const enemyWalls = new Set(
    S.buildings.filter((b) => b.type === 'wall' && b.player_id !== S.me.id && !allied(b.player_id, S.me.id)).map((b) => M.idx(b.x, b.y))
  );
  const path = M.checkPath(S.terrain, S.bridges, sx, sy, tx, ty, a.unit_type, S.match.season, enemyWalls);
  if (!path.ok) return toast(path.reason, 'err');
  const owner = S.territory[M.idx(tx, ty)];
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

  // Katapult-Belagerung aus der Ferne (bis 3,5 Tiles Entfernung)
  if (a.unit_type === 'catapult' && Math.hypot(tx - sx, ty - sy) <= 3.5 && pvpAllowed()) {
    const targetBld = S.buildings.find((b) =>
      ['wall', 'fort', 'tower'].includes(b.type) &&
      b.player_id !== S.me.id && !allied(b.player_id, S.me.id) && !hasNap(S.me.id, b.player_id) &&
      Math.max(Math.abs(b.x - tx), Math.abs(b.y - ty)) <= 1
    );
    if (targetBld) {
      addFx('boulder', sx, sy, { tx: targetBld.x, ty: targetBld.y, dur: 650 });
      setTimeout(() => { addFx('boom', targetBld.x, targetBld.y, { dur: 800 }); addFx('text', targetBld.x, targetBld.y, { label: '💥 Zerstört!', color: '#ff8a65' }); }, 600);
      S.buildings = S.buildings.filter((x) => x.id !== targetBld.id);
      await sb.from('buildings').delete().eq('id', targetBld.id);
      playSfx('fire');
      toast(`💣 Katapult hat ${BUILDINGS[targetBld.type]?.name || 'Gebäude'} aus der Ferne zerstört!`, 'ok');
      S.selectedArmyId = null; updateModeHint(); renderPanel();
      return;
    }
  }
  const enemyArmy = S.armies.find((e) => e.player_id && e.player_id !== a.player_id && e.target_x == null && Math.max(Math.abs(e.x - tx), Math.abs(e.y - ty)) <= 1 && !allied(e.player_id, a.player_id));
  const attacksPlayer = (ownerP && ownerP.id !== S.me.id && !allied(ownerP.id, S.me.id)) || enemyArmy;
  if (attacksPlayer && !pvpAllowed()) return toast('🕊️ Freizeit-Frieden! Angriffe auf Spieler sind gerade gesperrt.', 'err');
  const arrives = new Date(now() + travelMs(a.unit_type, sx, sy, tx, ty)).toISOString();
  a.x = sx; a.y = sy; a.target_x = tx; a.target_y = ty; a.arrives_at = arrives;
  await sb.from('armies').update({ x: sx, y: sy, target_x: tx, target_y: ty, arrives_at: arrives }).eq('id', a.id);
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
    if (!match) return true;
    return S.me && S.me.alliance && S.me.alliance === match[1];
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
    pw *= 1 + Math.min(0.5, countType('blacksmith', p) * 0.1);
    if (S.territory[M.idx(x, y)] === p.slot) {
      pw *= 1.2 + Math.min(0.6, countType('tower', p) * 0.15) + Math.min(0.9, countType('fort', p) * 0.3);
    }
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
    if ((a.player_id && e.player_id && (!pvp || hasNap(a.player_id, e.player_id))) || (!a.player_id && !e.player_id)) continue;
    addFx('boom', tx, ty, { dur: 900 });
    const res = fight({ ...a, count, x: tx, y: ty }, e);
    const defender = playerById(e.player_id);
    if (res.attackerWins) {
      count = res.remaining; await deleteArmy(e);
      if (defender) await sysChat(`⚔️ ${attacker ? attacker.kingdom_name : 'Gegner'} besiegt eine Armee von ${defender.kingdom_name}!`);
    } else {
      await updateArmy(e, { count: res.remaining }); await deleteArmy(a);
      if (attacker) await sysChat(`🛡️ Armee von ${attacker.kingdom_name} wurde geschlagen!`);
      return;
    }
  }
  if (attacker) {
    if (a.unit_type === 'spy') {
      await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
      const ownerSlot = S.territory[M.idx(tx, ty)];
      const op = ownerSlot >= 0 ? playerBySlot(ownerSlot) : null;
      if (op && op.id !== attacker.id) S.spied[op.id] = now() + 120000;
      toast('🕵️ Spion hat das Gebiet ausgekundschaftet!', 'ok');
      return;
    }
    const tileOwnerSlot = S.territory[M.idx(tx, ty)];
    if (tileOwnerSlot !== attacker.slot) {
      const tile = S.terrain[M.idx(tx, ty)];
      const ownerP = tileOwnerSlot >= 0 ? playerBySlot(tileOwnerSlot) : null;
      if ((ownerP && allied(ownerP.id, attacker.id)) || (ownerP && hasNap(attacker.id, ownerP.id))) {
        await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
        return;
      }
      if (ownerP && !pvp) {
        await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
        return;
      }
      if (ownerP && S.provCooldown[ownerP.id] && now() < S.provCooldown[ownerP.id]) {
        await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
        toast(`🛡️ ${ownerP.kingdom_name} hat noch kurzen Eroberungs-Schutz!`, 'err');
        return;
      }
      const garrison = ownerP
        ? 160 + ((ownerP.capital_level || 1) - 1) * 90 + countType('fort', ownerP) * 90 + countType('tower', ownerP) * 45 + countType('wall', ownerP) * 40
        : (tile === M.T.GOLD ? 180 : tile === M.T.HILL || tile === M.T.FOREST ? 140 : 100);
      const ap = armyPower({ ...a, count }, tx, ty);
      if (ap < garrison) {
        await deleteArmy(a);
        await sysChat(`🛡️ Angriff von ${attacker.kingdom_name} scheiterte an der Provinz-Garnison (Kraft ${Math.round(ap)} < ${garrison})!`);
        return;
      }
      if (ownerP) S.provCooldown[ownerP.id] = now() + 45000 / speed();
      count = Math.max(1, Math.ceil(count * (1 - (garrison / ap) * 0.55)));
    }
    await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
    conquer(tx, ty, attacker, pvp);
  } else {
    await updateArmy(a, { x: tx, y: ty, target_x: null, target_y: null, arrives_at: null, count });
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
  // Verbundene Brücken
  for (const i of S.bridges) {
    const x = i % M.W, y = Math.floor(i / M.W);
    const mask = (y > 0 && S.bridges.has(i - M.W) ? 1 : 0) | (x < M.W - 1 && S.bridges.has(i + 1) ? 2 : 0) | (y < M.H - 1 && S.bridges.has(i + M.W) ? 4 : 0) | (x > 0 && S.bridges.has(i - 1) ? 8 : 0);
    ctx.drawImage(getConnectedSprite('bridge', mask), x * TILE, y * TILE, TILE, TILE);
  }

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

  // Provinz-Namen direkt auf der Karte beim Hineinzoomen
  if (z >= 1.05 && S.provinces) {
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 248, 225, 0.58)';
    for (const prov of S.provinces) {
      const pi = M.idx(prov.cx, prov.cy);
      if (!S.explored[pi] && !S.fogOff) continue;
      ctx.fillText(prov.name, prov.cx * TILE + TILE / 2, prov.cy * TILE + TILE / 2);
    }
  }

  // Weltkarten-Gebäude (inkl. verbundener Mauern & Hafen-Blockaden)
  const wallSet = new Set(S.buildings.filter((b) => b.type === 'wall').map((b) => M.idx(b.x, b.y)));
  for (const b of S.buildings) {
    if (b.type === 'bridge') continue;
    const i = M.idx(b.x, b.y);
    if (!S.explored[i] && !S.fogOff && b.player_id !== S.me.id) continue;
    const owner = playerById(b.player_id);
    if (b.type === 'wall') {
      const mask = (b.y > 0 && wallSet.has(i - M.W) ? 1 : 0) | (b.x < M.W - 1 && wallSet.has(i + 1) ? 2 : 0) | (b.y < M.H - 1 && wallSet.has(i + M.W) ? 4 : 0) | (b.x > 0 && wallSet.has(i - 1) ? 8 : 0);
      ctx.drawImage(getConnectedSprite('wall', mask), b.x * TILE, b.y * TILE, TILE, TILE);
    } else {
      ctx.drawImage(getBuildingSprite(b.type, owner ? owner.color : '#888'), b.x * TILE, b.y * TILE, TILE, TILE);
      if (b.type === 'harbor' && isHarborBlockaded(b)) {
        ctx.fillStyle = '#ff5252'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('⚓', b.x * TILE + TILE / 2, b.y * TILE - 1);
      }
    }
  }

  // Hauptstädte (Burg + Flagge)
  for (const p of S.players) {
    if (p.capital_x == null || p.is_eliminated) continue;
    const i = M.idx(p.capital_x, p.capital_y);
    if (!S.explored[i] && !S.fogOff) continue;
    ctx.drawImage(getBuildingSprite('castle', p.color), p.capital_x * TILE - 3, p.capital_y * TILE - 3, TILE + 6, TILE + 6);
    drawFlagBg(ctx, p.flag_pattern || 'solid', p.color, 10);
    ctx.drawImage(emblemCanvas(p.emblem, p.color, 10, p.flag_pattern || 'solid'), p.capital_x * TILE - 2, p.capital_y * TILE - 12);
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

  // Armeen
  ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
  for (const a of S.armies) {
    if (!a.player_id) continue;
    const pos = armyPos(a), ix = Math.round(pos.x), iy = Math.round(pos.y);
    if (!M.inBounds(ix, iy)) continue;
    const friendly = allied(a.player_id, S.me.id);
    if (!friendly && !S.visible[M.idx(ix, iy)]) continue;
    const owner = playerById(a.player_id);
    const sprite = getUnitSprite(a.unit_type, owner ? owner.color : '#888');
    const px = pos.x * TILE, py = pos.y * TILE + (pos.moving ? Math.sin(tNow / 120) * 0.8 : 0);
    if (friendly && pos.moving) {
      ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 0.6; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(px + TILE / 2, py + TILE / 2); ctx.lineTo(a.target_x * TILE + TILE / 2, a.target_y * TILE + TILE / 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (!friendly && pos.moving && M.inBounds(a.target_x, a.target_y) && S.territory[M.idx(a.target_x, a.target_y)] === S.me.slot) {
      ctx.strokeStyle = `rgba(255, 70, 70, ${0.5 + 0.4 * Math.sin(tNow / 150)})`; ctx.lineWidth = 1.2; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(px + TILE / 2, py + TILE / 2); ctx.lineTo(a.target_x * TILE + TILE / 2, a.target_y * TILE + TILE / 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (a.id === S.selectedArmyId) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1; ctx.strokeRect(px - 1, py - 1, TILE + 2, TILE + 2); }
    ctx.drawImage(sprite, px, py);
    ctx.fillStyle = '#000c'; ctx.fillRect(px + 1, py + TILE - 1, 12, 6);
    ctx.fillStyle = '#fff'; ctx.fillText(String(a.count), px + 7, py + TILE + 4);
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

  const own = S.armies.find((a) => {
    if (a.player_id !== S.me.id || a.id === S.selectedArmyId) return false;
    const pos = armyPos(a);
    return Math.abs(pos.x - t.x) <= 0.8 && Math.abs(pos.y - t.y) <= 0.8;
  });
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
  const cost = lv === 1 ? { wood: 120, gold: 80 } : { wood: 250, gold: 180 };
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
  el.appendChild(h(`<div class="info-box"><h3>🎯 Missionen</h3>` +
    QUESTS.map((q) => {
      const done = S.quests.done[q.id];
      const cur = Math.min(q.goal, S.quests[q.id] || 0);
      return `<div class="stat"><span>${done ? '✅' : '⬜'} ${q.label}</span><b>${done ? `+${q.reward}💰` : `${cur}/${q.goal}`}</b></div>`;
    }).join('') + `</div>`));

  el.appendChild(h(`<div class="info-box"><h3>📊 Produktion / Sek.</h3>
    <div class="stat"><span>🪵 Holz</span><b>+${d.wood.toFixed(1)}</b></div>
    <div class="stat"><span>💰 Gold</span><b>+${d.gold.toFixed(1)}</b></div>
    <div class="stat"><span>🌾 Nahrung</span><b>+${d.raw_food.toFixed(1)}</b></div>
    <div class="stat"><span>👥 Einwohner</span><b>${me.population}/${popCap()}</b></div></div>`));

  const capLv = me.capital_level || 1;
  const capBox = h(`<div class="info-box"><h3>🏰 Hauptstadt (Stufe ${capLv}/3)</h3></div>`);
  if (capLv < 3) {
    const cCost = capLv === 1 ? { wood: 120, gold: 80 } : { wood: 250, gold: 180 };
    capBox.firstChild.appendChild(h(`<p class="muted">Mehr Basis-Produktion & Verteidigung (${costText(cCost)})</p>`));
    capBox.firstChild.appendChild(btn(`⬆️ Hauptstadt Stufe ${capLv + 1}`, upgradeCapital, 'btn small primary'));
  } else capBox.firstChild.appendChild(h('<p class="muted">Maximale Stufe erreicht!</p>'));
  el.appendChild(capBox);

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
  el.appendChild(h(`<h3>🛡️ Truppen (${totalArmyCount()}/${armyCap()})</h3>${hasBarracks ? '' : '<p class="muted">⚠️ Baue zuerst eine <b>⚔️ Kaserne</b> unter Bauen.</p>'}`));
  for (const [type, u] of Object.entries(UNITS)) {
    const locked = me.age < u.age;
    const row = document.createElement('div'); row.className = 'army-row';
    const total = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, v * BATCH]));
    row.innerHTML = `<img src="${spriteUrl(getUnitSprite(type, me.color), 'u' + type + me.color)}" alt=""><div class="grow"><b>${u.name}</b> · ⚔️${u.power}<br><span class="muted">${costText(total)}${u.note ? ' · ' + u.note : ''}${locked ? ' · 🔒 ' + AGE_NAMES[u.age] : ''}</span></div>`;
    row.appendChild(btn('+5', () => trainUnits(type), 'btn small primary', !hasBarracks || locked));
    el.appendChild(row);
  }

  if (S.trainQueue.length) {
    const qbox = h('<h3>⏳ In Ausbildung</h3>');
    for (const q of S.trainQueue) {
      const left = Math.max(0, Math.ceil((q.readyAt - now()) / 1000));
      const pct = clamp(100 - ((q.readyAt - now()) / q.totalMs) * 100, 0, 100);
      qbox.appendChild(h(`<div class="info-box"><div class="stat"><span>${BATCH}× ${UNITS[q.unitType]?.name}</span><b>${left}s</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`));
    }
    el.appendChild(qbox);
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
    }, 'btn small', false));
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
  const allyBox = h(`<div class="info-box"><h3>🤝 Allianz</h3><p class="muted">Gleicher Name = verbündet (kein Angriff, geteilte Sicht).</p></div>`);
  const form = document.createElement('form'); form.className = 'row';
  form.innerHTML = `<input id="ally-input" maxlength="20" placeholder="Allianz-Name" value="${esc(me.alliance)}"><button class="btn small">OK</button>`;
  form.onsubmit = (e) => { e.preventDefault(); setAlliance($('ally-input').value); };
  allyBox.firstChild.appendChild(form); el.appendChild(allyBox);

  const hasMarket = countType('market') > 0;
  const mk = h(`<div class="info-box"><h3>⚖️ Marktplatz</h3>${hasMarket ? '<p class="muted">100 Waren → 35💰 oder 50💰 → 100 Waren.</p>' : '<p class="muted">Baue einen <b>⚖️ Marktplatz</b> zum Handeln.</p>'}</div>`);
  if (hasMarket) {
    for (const r of ['wood', 'raw_food']) {
      const row = document.createElement('div'); row.className = 'row'; row.style.margin = '4px 0';
      row.appendChild(h(`<span style="width:75px;display:inline-block">${RES_ICON[r]} ${RES_NAME[r]}</span>`));
      row.appendChild(btn('Verkaufen', async () => { if (await spend({ [r]: 100 })) { await rpcAdd(me.id, { gold: 35 }, true); me.gold += 35; playSfx('coins'); } }));
      row.appendChild(btn('Kaufen', async () => { if (await spend({ gold: 50 })) { await rpcAdd(me.id, { [r]: 100 }, true); me[r] += 100; playSfx('coins'); } }));
      mk.firstChild.appendChild(row);
    }
  }
  el.appendChild(mk);

  el.appendChild(h('<h3>👑 Königreiche (Ziel: 70%)</h3>'));
  for (const p of [...S.players].sort((a, b) => (b.territory_percent || 0) - (a.territory_percent || 0))) {
    const isMe = p.id === me.id, ally = !isMe && allied(p.id, me.id);
    const lord = p.vassal_of ? playerById(p.vassal_of) : null;
    const box = document.createElement('div'); box.className = 'info-box'; box.style.borderLeft = `5px solid ${p.color}`;
    const head = document.createElement('div'); head.className = 'row';
    head.appendChild(emblemCanvas(p.emblem, p.color, 24, p.flag_pattern || 'solid'));
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
      }
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
