// ============================================================================
// js/admin.js – Admin-Konsole (👑) & einfacher Map-Editor (100x100)
// ============================================================================
import { getTerrainSprite, playSfx } from './sprites.js';

let api = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function setupAdmin(a) {
  api = a;
}

// ---------------------------------------------------------------------------
// ADMIN-KONSOLE
// ---------------------------------------------------------------------------
export function openAdminPanel() {
  if (!api.isAdmin()) return api.toast('Nur für Admins.', 'err');
  playSfx('click');
  $('modal-admin').hidden = false;
  renderAdmin();
}

/** Wird vom Spiel nach Datenänderungen aufgerufen (nur wenn offen & kein Eingabefeld aktiv). */
export function refreshAdminPanel() {
  if (!api || $('modal-admin').hidden) return;
  const a = document.activeElement;
  if (a && $('admin-body').contains(a) && ['INPUT', 'SELECT'].includes(a.tagName)) return;
  renderAdmin();
}

async function updateMatch(patch, msg) {
  const { S, sb, toast, fullReload } = api;
  const { error } = await sb.from('matches').update(patch).eq('id', S.match.id);
  if (error) return toast(error.message, 'err');
  if (msg) toast(msg, 'ok');
  await fullReload();
  renderAdmin();
}

function renderAdmin() {
  const { S } = api;
  const m = S.match;
  if (!m) return;
  const body = $('admin-body');
  const statusTxt = { lobby: '🟢 Lobby', running: '⚔️ Läuft', paused: '⏸️ Pausiert', finished: '🏁 Beendet' }[m.status];

  body.innerHTML = `
  <div class="admin-grid">
    <section>
      <h3>🎮 Spielsteuerung</h3>
      <div class="stat"><span>Status</span><b>${statusTxt}</b></div>
      <div class="row" id="adm-status-btns"></div>
      <label>Geschwindigkeit
        <select id="adm-speed">${[1, 2, 5, 10].map((v) => `<option value="${v}" ${m.game_speed === v ? 'selected' : ''}>${v}x</option>`).join('')}</select>
      </label>
      <label>Schulzeit-Schutz (PvP)
        <select id="adm-pvp">
          <option value="school_schedule" ${m.pvp_mode === 'school_schedule' ? 'selected' : ''}>🏫 Automatik (Schulzeit = Krieg)</option>
          <option value="always_war" ${m.pvp_mode === 'always_war' ? 'selected' : ''}>⚔️ 24/7 Krieg</option>
          <option value="peace" ${m.pvp_mode === 'peace' ? 'selected' : ''}>🕊️ Frieden</option>
        </select>
      </label>
      <div class="row">
        <span>Jahreszeit: <b>${m.season === 'winter' ? '❄️ Winter' : '☀️ Sommer'}</b></span>
        <button class="btn small" id="adm-season">Wechseln</button>
      </div>
      <label><input type="checkbox" id="adm-fog" ${S.fogOff ? 'checked' : ''}> 👁️ Fog of War für mich ausschalten</label>
    </section>

    <section>
      <h3>⚡ Live-Events</h3>
      <div class="row">
        <button class="btn small gold" id="adm-goldrush">💰 Goldrausch</button>
        <button class="btn small danger" id="adm-barb">🪓 Barbaren-Angriff</button>
        <button class="btn small danger" id="adm-fire">🔥 Feuer</button>
      </div>
      <label>Globaler Banner-Text
        <input id="adm-banner" maxlength="120" value="${esc(m.global_banner)}" placeholder="z.B. Turnier endet um 15 Uhr!">
      </label>
      <div class="row">
        <button class="btn small" id="adm-banner-set">📢 Anzeigen</button>
        <button class="btn small ghost" id="adm-banner-clear">Entfernen</button>
      </div>
      <h3>🗺️ Karten</h3>
      <button class="btn small" id="adm-editor">Map-Editor öffnen</button>
    </section>

    <section style="grid-column: 1 / -1">
      <h3>👥 Spieler (${S.players.length})</h3>
      <div id="adm-players"></div>
    </section>
  </div>`;

  // Status-Buttons
  const sb2 = $('adm-status-btns');
  const addBtn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = `btn small ${cls}`;
    b.textContent = label;
    b.onclick = fn;
    sb2.appendChild(b);
  };
  if (m.status === 'lobby') addBtn('▶️ Spiel starten', 'primary', async () => { await api.startMatch(); renderAdmin(); });
  if (m.status === 'running') addBtn('⏸️ Pausieren', '', () => updateMatch({ status: 'paused' }, 'Spiel pausiert'));
  if (m.status === 'paused') addBtn('▶️ Fortsetzen', 'primary', () => updateMatch({ status: 'running' }, 'Spiel läuft weiter'));
  if (m.status === 'running' || m.status === 'paused') {
    addBtn('🏁 Beenden', 'danger', async () => {
      if (!confirm('Spiel ohne Sieger beenden?')) return;
      await updateMatch({ status: 'finished' }, 'Spiel beendet');
    });
  }

  $('adm-speed').onchange = (e) => updateMatch({ game_speed: Number(e.target.value) }, `Tempo: ${e.target.value}x`);
  $('adm-pvp').onchange = (e) => updateMatch({ pvp_mode: e.target.value }, 'PvP-Modus geändert');
  $('adm-season').onclick = () => updateMatch({ season: m.season === 'winter' ? 'summer' : 'winter' }, 'Jahreszeit gewechselt');
  $('adm-fog').onchange = (e) => {
    S.fogOff = e.target.checked;
    api.onFogChange();
  };

  $('adm-goldrush').onclick = async () => {
    for (const p of S.players.filter((x) => !x.is_eliminated)) await api.rpcAdd(p.id, { gold: 150 }, true);
    await api.sysChat('💰 GOLDRAUSCH! Jedes Königreich erhält 150 Gold!');
    playSfx('coins');
    await updateMatch({ global_banner: '💰 GOLDRAUSCH! Alle Königreiche erhalten 150 Gold!' }, 'Goldrausch ausgelöst');
  };
  $('adm-barb').onclick = async () => {
    if (m.status !== 'running') return api.toast('Nur während das Spiel läuft.', 'err');
    await api.spawnBarbarians();
    playSfx('horn');
    await updateMatch({ global_banner: '🪓 BARBAREN-ANGRIFF! Verteidigt eure Hauptstädte!' }, 'Barbaren losgeschickt');
  };
  $('adm-fire').onclick = async () => {
    await api.triggerFire(1, true);
    playSfx('fire');
    api.toast('Feuer gelegt!', 'ok');
    await api.fullReload();
  };
  $('adm-banner-set').onclick = () => updateMatch({ global_banner: $('adm-banner').value.trim() }, 'Banner gesetzt');
  $('adm-banner-clear').onclick = () => updateMatch({ global_banner: '' }, 'Banner entfernt');
  $('adm-editor').onclick = openMapEditor;

  // Spielerliste
  const list = $('adm-players');
  for (const p of S.players) {
    const div = document.createElement('div');
    div.className = 'admin-player';
    div.innerHTML = `<b style="color:${p.color}">${esc(p.kingdom_name)}</b> (${esc(p.username)})${p.is_eliminated ? ' ☠️' : ''}
      — 🪵${p.wood} 🪨${p.stone} 💰${p.gold} 🌾${p.raw_food} 🍞${p.bread} 👥${p.population} 😊${p.morale} 🗺️${(p.territory_percent || 0).toFixed(1)}%`;
    const row = document.createElement('div');
    row.className = 'row';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="gold">💰 Gold</option><option value="wood">🪵 Holz</option><option value="stone">🪨 Stein</option><option value="raw_food">🌾 Nahrung</option><option value="bread">🍞 Brot</option>';
    const amt = document.createElement('input');
    amt.type = 'number';
    amt.value = '200';
    const gift = document.createElement('button');
    gift.className = 'btn small gold';
    gift.textContent = '🎁 Schenken';
    gift.onclick = async () => {
      const n = Math.floor(Number(amt.value));
      if (!n) return;
      await api.rpcAdd(p.id, { [sel.value]: n }, true);
      playSfx('coins');
      api.toast(`${n} an ${p.kingdom_name} geschenkt`, 'ok');
      await api.fullReload();
    };
    const kick = document.createElement('button');
    kick.className = 'btn small danger';
    kick.textContent = '👢 Kicken';
    kick.disabled = p.user_id === S.user.id;
    kick.onclick = async () => {
      if (!confirm(`${p.kingdom_name} wirklich aus dem Spiel werfen?`)) return;
      const { error } = await api.sb.from('match_players').delete().eq('id', p.id);
      if (error) return api.toast(error.message, 'err');
      await api.sysChat(`👢 ${p.kingdom_name} wurde vom Admin entfernt.`);
      await api.fullReload();
      renderAdmin();
    };
    row.append(sel, amt, gift, kick);
    div.appendChild(row);
    list.appendChild(div);
  }
}

// ---------------------------------------------------------------------------
// MAP-EDITOR
// ---------------------------------------------------------------------------
const ED = { grid: null, brush: 1, size: 3, painting: false, bound: false };
const EDITOR_PX = 1;

export async function openMapEditor() {
  const { M } = api;
  playSfx('click');
  if (!ED.grid) ED.grid = new Uint8Array(M.N).fill(M.T.GRASS);
  $('modal-editor').hidden = false;
  renderEditorTools();
  drawEditor();
  if (!ED.bound) bindEditorCanvas();
  await loadMapList();
}

function renderEditorTools() {
  const { M } = api;
  const tools = $('editor-tools');
  const brushes = [M.T.GRASS, M.T.WATER, M.T.MOUNTAIN, M.T.FOREST, M.T.GOLD, M.T.HILL, M.T.DESERT];
  tools.innerHTML = `
    <h3>🖌️ Pinsel</h3>
    <div class="brushes" id="ed-brushes"></div>
    <label>Pinselgröße
      <select id="ed-size">${[1, 3, 5, 9].map((s) => `<option value="${s}" ${ED.size === s ? 'selected' : ''}>${s}×${s}</option>`).join('')}</select>
    </label>
    <h3>📄 Neu</h3>
    <div class="row">
      <button class="btn small" id="ed-fill-grass">Alles Gras</button>
      <button class="btn small" id="ed-fill-water">Alles Wasser</button>
    </div>
    <div class="row">
      <select id="ed-gen" style="width:auto;flex:1">
        <option value="continents">Kontinente</option><option value="world">Weltkarte</option>
        <option value="europe">Europa</option><option value="germany">Deutschland</option>
        <option value="turkey">Türkei</option><option value="rome">Römisches Reich</option>
        <option value="ottoman">Osmanisches Reich</option><option value="archipelago">Inseln</option>
        <option value="valley">Tal</option><option value="desert">Wüste</option>
      </select>
      <button class="btn small" id="ed-generate">🎲 Generieren</button>
    </div>
    <h3>💾 Speichern / Laden</h3>
    <label>Kartenname<input id="ed-name" maxlength="40" placeholder="Meine Karte"></label>
    <button class="btn small primary" id="ed-save">💾 Speichern</button>
    <label>Gespeicherte Karten<select id="ed-list"></select></label>
    <div class="row">
      <button class="btn small" id="ed-load">📂 Laden</button>
      <button class="btn small danger" id="ed-delete">🗑️ Löschen</button>
    </div>
    <p class="muted">Gespeicherte Karten können beim Erstellen eines Spiels als „Eigene Karte“ gewählt werden.</p>`;

  const bwrap = $('ed-brushes');
  for (const t of brushes) {
    const b = document.createElement('button');
    b.className = `bcard${ED.brush === t ? ' active' : ''}`;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    c.getContext('2d').drawImage(getTerrainSprite(M.TERRAIN_KEYS[t]), 0, 0);
    c.style.width = '24px';
    c.style.height = '24px';
    b.appendChild(c);
    b.appendChild(document.createTextNode(M.TERRAIN_LABELS[t]));
    b.onclick = () => {
      ED.brush = t;
      playSfx('click');
      renderEditorTools();
      loadMapList();
    };
    bwrap.appendChild(b);
  }
  $('ed-size').onchange = (e) => { ED.size = Number(e.target.value); };
  $('ed-fill-grass').onclick = () => { ED.grid.fill(M.T.GRASS); drawEditor(); };
  $('ed-fill-water').onclick = () => { ED.grid.fill(M.T.WATER); drawEditor(); };
  $('ed-generate').onclick = () => {
    ED.grid = M.generateMap($('ed-gen').value, Math.floor(Math.random() * 999999));
    drawEditor();
  };
  $('ed-save').onclick = saveMap;
  $('ed-load').onclick = loadSelectedMap;
  $('ed-delete').onclick = deleteSelectedMap;
}

function drawEditor() {
  const { M } = api;
  const c = $('editor-canvas');
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < M.N; i++) drawEditorTile(ctx, i);
}

function drawEditorTile(ctx, i) {
  const { M } = api;
  ctx.drawImage(getTerrainSprite(M.TERRAIN_KEYS[ED.grid[i]]), (i % M.W) * EDITOR_PX, Math.floor(i / M.W) * EDITOR_PX, EDITOR_PX, EDITOR_PX);
}

function paintAt(e) {
  const { M } = api;
  const c = $('editor-canvas');
  const r = c.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * M.W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * M.H);
  const half = Math.floor(ED.size / 2);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!M.inBounds(nx, ny)) continue;
      const i = M.idx(nx, ny);
      if (ED.grid[i] !== ED.brush) {
        ED.grid[i] = ED.brush;
        drawEditorTile(ctx, i);
      }
    }
  }
}

function bindEditorCanvas() {
  ED.bound = true;
  const c = $('editor-canvas');
  c.addEventListener('pointerdown', (e) => {
    ED.painting = true;
    c.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  c.addEventListener('pointermove', (e) => ED.painting && paintAt(e));
  c.addEventListener('pointerup', () => { ED.painting = false; });
  c.addEventListener('pointercancel', () => { ED.painting = false; });
}

async function loadMapList() {
  const { data } = await api.sb.from('custom_maps').select('id,name,created_at').order('created_at', { ascending: false }).limit(50);
  const sel = $('ed-list');
  if (!sel) return;
  sel.innerHTML = (data || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('') || '<option value="">(keine)</option>';
}

async function saveMap() {
  const { M, sb, toast } = api;
  const name = $('ed-name').value.trim();
  if (!name) return toast('Bitte einen Kartennamen eingeben.', 'err');
  let land = 0;
  for (let i = 0; i < M.N; i++) if (M.isPassable(ED.grid[i])) land++;
  if (land < 300) return toast('Zu wenig begehbares Land (mind. 300 Tiles).', 'err');
  const { error } = await sb.from('custom_maps').insert({ name, grid_data: M.gridToString(ED.grid) });
  if (error) return toast(error.message, 'err');
  playSfx('coins');
  toast(`Karte „${name}“ gespeichert!`, 'ok');
  await loadMapList();
  api.onCustomMapsChanged();
}

async function loadSelectedMap() {
  const { M, sb, toast } = api;
  const id = $('ed-list').value;
  if (!id) return;
  const { data, error } = await sb.from('custom_maps').select('name,grid_data').eq('id', id).single();
  if (error) return toast(error.message, 'err');
  ED.grid = M.parseGrid(data.grid_data);
  $('ed-name').value = data.name;
  drawEditor();
  toast('Karte geladen', 'ok');
}

async function deleteSelectedMap() {
  const { sb, toast } = api;
  const id = $('ed-list').value;
  if (!id || !confirm('Karte wirklich löschen?')) return;
  const { error } = await sb.from('custom_maps').delete().eq('id', id);
  if (error) return toast(error.message, 'err');
  toast('Karte gelöscht', 'ok');
  await loadMapList();
  api.onCustomMapsChanged();
}
