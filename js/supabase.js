// ============================================================================
// js/supabase.js – Supabase Client, Login (Name + Passwort / Gast) & Realtime
// ============================================================================

// >>> HIER SUPABASE-ZUGANGSDATEN EINTRAGEN <<<
export const SUPABASE_URL = 'https://cirrukyshvepkpylbwap.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_3WX-57RHD1h2oYSUpn06ow__g5aiu0G';

// Dieser Account ist in jedem Match Admin
export const ADMIN_USERNAME = 'alo22122';

if (!window.supabase || !window.supabase.createClient) {
  throw new Error('Supabase-Bibliothek konnte nicht geladen werden (CDN).');
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } }
});

const LOCAL_KEY = 'frontline_kingdoms_user_v1';

async function hashPassword(username, password) {
  const data = new TextEncoder().encode(`ric:${username.toLowerCase()}:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toUser(profile, isGuest) {
  return {
    id: profile.id,
    username: profile.username,
    wins: profile.wins || 0,
    isGuest,
    isGlobalAdmin: profile.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()
  };
}

export function getSavedUser() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUser(user) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(user));
}

/** Login bzw. Registrierung mit Name + Passwort. */
export async function loginWithNamePassword(username, password, isRegister) {
  const name = (username || '').trim().slice(0, 20);
  if (name.length < 2) throw new Error('Name muss mindestens 2 Zeichen haben.');
  if (!/^[A-Za-z0-9_äöüÄÖÜß-]+$/.test(name)) throw new Error('Name: nur Buchstaben, Zahlen, _ und -');
  if (!password || password.length < 4) throw new Error('Passwort muss mindestens 4 Zeichen haben.');

  const hash = await hashPassword(name, password);
  const { data: existing, error: selErr } = await sb
    .from('profiles')
    .select('*')
    .eq('username', name)
    .maybeSingle();
  if (selErr) throw new Error('Datenbankfehler: ' + selErr.message + ' (schema.sql ausgeführt?)');

  if (isRegister) {
    if (existing) throw new Error('Dieser Name ist bereits vergeben.');
    const { data, error } = await sb
      .from('profiles')
      .insert({ username: name, pw_hash: hash })
      .select()
      .single();
    if (error) throw new Error('Registrierung fehlgeschlagen: ' + error.message);
    const user = toUser(data, false);
    saveUser(user);
    return user;
  }

  if (!existing) throw new Error('Account nicht gefunden – bitte zuerst registrieren.');
  if (!existing.pw_hash) throw new Error('Das ist ein Gast-Name. Bitte einen anderen Namen registrieren.');
  if (existing.pw_hash !== hash) throw new Error('Falsches Passwort.');
  const user = toUser(existing, false);
  saveUser(user);
  return user;
}

/** Gast-Login ohne Passwort. */
export async function loginAsGuest() {
  for (let i = 0; i < 5; i++) {
    const name = `Gast_${Math.floor(1000 + Math.random() * 9000)}`;
    const { data, error } = await sb.from('profiles').insert({ username: name, pw_hash: null }).select().single();
    if (!error && data) {
      const user = toUser(data, true);
      saveUser(user);
      return user;
    }
    if (error && !String(error.message).toLowerCase().includes('duplicate')) {
      throw new Error('Gast-Login fehlgeschlagen: ' + error.message);
    }
  }
  throw new Error('Gast-Login fehlgeschlagen, bitte erneut versuchen.');
}

export function logoutUser() {
  localStorage.removeItem(LOCAL_KEY);
}

export function isAdminUser(user, match) {
  if (!user) return false;
  if (user.username && user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) return true;
  return Boolean(match && match.host_id === user.id);
}

/**
 * Realtime-Abo für ein Match: Postgres-Änderungen + Presence (wer ist online).
 * handlers: onMatch, onPlayers, onBuildings, onArmies, onChat, onPresence(userIds[])
 */
export function subscribeMatchRealtime(matchId, userId, handlers) {
  const channel = sb.channel(`match_${matchId}`, { config: { presence: { key: userId } } });

  const table = (name, cb, filterCol = 'match_id') =>
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: name, filter: `${filterCol}=eq.${matchId}` },
      (payload) => cb && cb(payload)
    );

  table('matches', handlers.onMatch, 'id');
  table('match_players', handlers.onPlayers);
  table('buildings', handlers.onBuildings);
  table('armies', handlers.onArmies);
  table('chat_messages', handlers.onChat);

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    handlers.onPresence && handlers.onPresence(Object.keys(state));
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try {
        await channel.track({ user_id: userId, at: Date.now() });
      } catch (e) {
        console.warn('Presence track fehlgeschlagen', e);
      }
    }
  });

  return () => {
    sb.removeChannel(channel);
  };
}
