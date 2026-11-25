# Frontline Kingdoms – Realms of Iron & Crown

Mittelalterliches Browser-Multiplayer-Strategiespiel (inspiriert von Age of Empires & OpenFront.io).
Reines HTML/CSS/Vanilla-JS (ES-Module), gehostet auf **GitHub Pages**, Backend **Supabase**.

## Setup (einmalig)
1. Supabase → SQL Editor → Inhalt von `schema.sql` ausführen.
2. GitHub → Settings → Pages → Branch `main` / Ordner `/ (root)` → Save.
3. Spiel öffnen: `https://alo22122.github.io/FrontlineKingdoms/`

Supabase-URL und Publishable Key stehen in `js/supabase.js`.
Admin-Account: **alo22122** (wird von `schema.sql` angelegt).

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche (Login, Menü, Lobby, Spiel, Modals) |
| `style.css` | Mittelalter-Pixel-Look |
| `schema.sql` | Datenbank, RLS, Realtime, Ressourcen-Funktion |
| `js/supabase.js` | Client, Login, Realtime |
| `js/sprites.js` | Pixel-Art-Generator & 8-Bit-Sounds |
| `js/map.js` | Kartengenerator & Terrain-Regeln |
| `js/game.js` | Spiellogik, Dorf, Weltkarte, Kampf |
| `js/admin.js` | Admin-Konsole & Map-Editor |

## Spielregeln (Kurz)
- **Ziel:** 70 % des Landes erobern.
- **Dorf (40×40):** Gebäude frei platzieren, Bewohner arbeiten automatisch.
- **Nahrung:** Bauernhof → Rohnahrung, Bäckerei → Brot (+Moral), Kornspeicher gegen Verderb.
- **Zeitalter 1–4** über die Schmiede → bessere Truppen.
- **Schulzeit-PvP (Europe/Berlin):** Mo/Mi/Do 08:00–15:30, Di/Fr 08:00–13:30 Krieg, sonst Frieden.
