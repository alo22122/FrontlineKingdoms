-- ============================================================================
-- FRONTLINE KINGDOMS – "Realms of Iron & Crown"  |  Supabase PostgreSQL Schema
-- ============================================================================
-- SO RICHTEST DU DIE DATENBANK EIN:
--   1. Supabase Dashboard öffnen -> Projekt "FrontlineKingdoms"
--      (https://cirrukyshvepkpylbwap.supabase.co)
--   2. Links "SQL Editor" -> "New query"
--   3. Dieses komplette Skript einfügen -> "Run"  (kann gefahrlos mehrfach laufen)
--
-- KEYS:
--   SUPABASE_URL und SUPABASE_ANON_KEY (Publishable Key) stehen ganz oben in
--   `js/supabase.js` und sind bereits eingetragen.
--
-- ADMIN:
--   Der Account "alo22122" (Passwort: alo22122) wird unten automatisch angelegt
--   und ist in jedem Match Admin (👑). Zusätzlich ist jeder Match-Ersteller Admin
--   seines eigenen Matches.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. PROFILES  (Accounts + Bestenliste)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key default gen_random_uuid(),
    username    text not null unique,
    pw_hash     text,                       -- SHA-256 (null = Gast)
    wins        integer not null default 0,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. CUSTOM MAPS  (Admin Map-Editor, 100x100 als Zeichenkette)
-- ---------------------------------------------------------------------------
create table if not exists public.custom_maps (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    grid_data   jsonb not null,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. MATCHES
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
    id             uuid primary key default gen_random_uuid(),
    name           text not null,
    host_id        uuid not null,
    status         text not null default 'lobby'
                   check (status in ('lobby','running','paused','finished')),
    map_type       text not null default 'continents'
                   check (map_type in ('continents','archipelago','valley','desert','world','europe','germany','turkey','rome','ottoman','custom')),
    map_seed       integer not null default 12345,
    custom_map_id  uuid references public.custom_maps(id) on delete set null,
    game_speed     integer not null default 1 check (game_speed in (1,2,5,10)),
    season         text not null default 'summer' check (season in ('summer','winter')),
    pvp_mode       text not null default 'school_schedule'
                   check (pvp_mode in ('school_schedule','always_war','peace')),
    territory      text not null default '',  -- 10.000 Zeichen: '.' = neutral, 'A'..'J' = Spieler-Slot
    global_banner  text not null default '',
    winner_id      uuid,
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. MATCH PLAYERS  (Königreiche)
-- ---------------------------------------------------------------------------
create table if not exists public.match_players (
    id                 uuid primary key default gen_random_uuid(),
    match_id           uuid not null references public.matches(id) on delete cascade,
    user_id            uuid not null,
    username           text not null,
    slot               integer not null default 0 check (slot between 0 and 9),
    kingdom_name       text not null,
    color              text not null default '#e63946',
    emblem             text not null default 'crown' check (emblem in ('crown','lion','dragon','sword')),
    age                integer not null default 1 check (age between 1 and 4),
    alliance           text not null default '',
    vassal_of          uuid,
    wood               integer not null default 250,
    stone              integer not null default 150,
    gold               integer not null default 120,
    raw_food           integer not null default 200,
    bread              integer not null default 40,
    food               integer generated always as (raw_food + bread) stored,
    morale             integer not null default 80 check (morale between 0 and 100),
    population         integer not null default 5,
    territory_percent  real not null default 0,
    capital_x          integer,
    capital_y          integer,
    explored_tiles     jsonb not null default '""'::jsonb,
    is_eliminated      boolean not null default false,
    created_at         timestamptz not null default now(),
    unique (match_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. BUILDINGS  (layer 'village' = 40x40 Dorf, layer 'world' = Brücken auf Weltkarte)
-- ---------------------------------------------------------------------------
create table if not exists public.buildings (
    id                   uuid primary key default gen_random_uuid(),
    match_id             uuid not null references public.matches(id) on delete cascade,
    player_id            uuid not null references public.match_players(id) on delete cascade,
    layer                text not null default 'village' check (layer in ('village','world')),
    type                 text not null,
    x                    integer not null,
    y                    integer not null,
    hp                   integer not null default 100,
    on_fire              boolean not null default false,
    construction_end_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. ARMIES (player_id NULL = Banditen / Ruinen), CHAT, MAP SNAPSHOTS
-- ---------------------------------------------------------------------------
create table if not exists public.armies (
    id          uuid primary key default gen_random_uuid(),
    match_id    uuid not null references public.matches(id) on delete cascade,
    player_id   uuid references public.match_players(id) on delete cascade,
    unit_type   text not null default 'swordsman',
    count       integer not null default 10,
    x           integer not null,
    y           integer not null,
    target_x    integer,
    target_y    integer,
    arrives_at  timestamptz
);

create table if not exists public.chat_messages (
    id           uuid primary key default gen_random_uuid(),
    match_id     uuid not null references public.matches(id) on delete cascade,
    player_id    uuid references public.match_players(id) on delete set null,
    sender_name  text not null,
    message      text not null,
    created_at   timestamptz not null default now()
);

create table if not exists public.map_snapshots (
    id           uuid primary key default gen_random_uuid(),
    match_id     uuid not null references public.matches(id) on delete cascade,
    tick         integer not null default 0,
    owners_data  jsonb not null,
    created_at   timestamptz not null default now()
);

-- Indizes
create index if not exists idx_mp_match    on public.match_players(match_id);
create index if not exists idx_bld_match   on public.buildings(match_id);
create index if not exists idx_army_match  on public.armies(match_id);
create index if not exists idx_chat_match  on public.chat_messages(match_id, created_at);
create index if not exists idx_snap_match  on public.map_snapshots(match_id, created_at);

-- ---------------------------------------------------------------------------
-- ATOMARE RESSOURCEN-FUNKTION (verhindert Race-Conditions zwischen Clients)
--   p_clamp = false -> "Bezahlen": schlägt fehl (false), wenn etwas negativ würde
--   p_clamp = true  -> "Produktion/Verbrauch/Geschenk": Werte werden bei 0 gekappt
-- ---------------------------------------------------------------------------
create or replace function public.add_resources(
    p_player uuid,
    d_wood   integer default 0,
    d_stone  integer default 0,
    d_gold   integer default 0,
    d_raw    integer default 0,
    d_bread  integer default 0,
    p_clamp  boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_clamp then
        update match_players set
            wood     = greatest(0, wood + d_wood),
            stone    = greatest(0, stone + d_stone),
            gold     = greatest(0, gold + d_gold),
            raw_food = greatest(0, raw_food + d_raw),
            bread    = greatest(0, bread + d_bread)
        where id = p_player;
    else
        update match_players set
            wood     = wood + d_wood,
            stone    = stone + d_stone,
            gold     = gold + d_gold,
            raw_food = raw_food + d_raw,
            bread    = bread + d_bread
        where id = p_player
          and wood + d_wood >= 0
          and stone + d_stone >= 0
          and gold + d_gold >= 0
          and raw_food + d_raw >= 0
          and bread + d_bread >= 0;
    end if;
    return found;
end;
$$;

grant execute on function public.add_resources(uuid, integer, integer, integer, integer, integer, boolean) to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY  (offenes Schul-/Freundesspiel: alle dürfen lesen & schreiben)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['profiles','custom_maps','matches','match_players','buildings','armies','chat_messages','map_snapshots']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists "open_%s" on public.%I', t, t);
        execute format('create policy "open_%s" on public.%I for all to anon, authenticated using (true) with check (true)', t, t);
    end loop;
end $$;

-- Volle Zeilendaten bei UPDATE/DELETE für Realtime
alter table public.matches       replica identity full;
alter table public.match_players replica identity full;
alter table public.buildings     replica identity full;
alter table public.armies        replica identity full;

-- ---------------------------------------------------------------------------
-- REALTIME aktivieren
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['matches','match_players','buildings','armies','chat_messages']
    loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ADMIN-ACCOUNT  alo22122 / nur.2233
-- ---------------------------------------------------------------------------
insert into public.profiles (username, pw_hash, wins)
values ('alo22122', '28de7708107d08c72c145feb195f89891f6f3cf87eefbf8202b191a54d0ec4d0', 0)
on conflict (username) do update set pw_hash = excluded.pw_hash;
