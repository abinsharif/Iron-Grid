# IRON GRID V3 — Turn-Based Tactics (Flask + canvas + SQLite)

Server-authoritative strategy game in the spirit of Advance Wars. Flask owns the state,
validates every action and runs a fog-bound AI. Saves and the Hall of Fame live in SQLite.

## Run

    pip install flask
    python app.py          # then open http://127.0.0.1:5000

Folder layout (Flask needs this):

    app.py
    templates/index.html
    static/css/style.css
    static/js/game.js
    irongrid.db            # created automatically on first run

## Units — 4 categories x 2

| Category     | Unit | Move type | HP | Cost | Move | Range | Notes |
|--------------|------|-----------|----|------|------|-------|-------|
| Infantry     | INF  | FOOT      | 10 | 150  | 3    | 1     | Captures, founds factories, crosses mountains |
| Infantry     | IFV  | TREAD     | 12 | 300  | 4    | 1     | Mechanized infantry. Captures, strong vs infantry/helis |
| Armor        | AFV  | TREAD     | 10 | 250  | 6    | 1     | Fast recon, vision 5, raids artillery |
| Armor        | MBT  | TREAD     | 16 | 500  | 4    | 1     | Heavy ground unit, can't hit aircraft |
| Fire support | MRL  | TREAD     | 10 | 550  | 3    | 2-4   | Mobile indirect fire: can move and fire, never counters, can't hit helicopters |
| Fire support | SAM  | TREAD     | 10 | 450  | 4    | 1-3   | Anti-air only; moves and fires |
| Air          | HEL  | AIR       | 12 | 750  | 6    | 1     | Tank-killer; repairs only at HQ/factory |
| Air          | FTR  | AIR       | 14 | 900  | 8    | 1     | Air superiority; strongest against aircraft |

Each unit's four ATK values are shown in the in-game **Manual** tab: soft (INF), armor
(IFV/AFV/MBT), hard (MRL/SAM), and air (HEL/FTR). Damage scales with attacker HP and terrain;
the manual includes a compact attacker-by-target-class table. All units can deal at least
1 damage to Fighters.

## Rules

- **Terrain** (movement points per tile): road costs 0.5 for ground units, plains 1, forest 2,
  swamp 2 (foot) / 3 (tread). Mountains: foot only (3). Rivers block ground units.
- **Combat**: damage = base(attacker vs target class) x attacker HP/max x terrain. Direct-fire defenders
  counter for 75%. All units can deal at least 1 damage to Fighters. Hover or cursor over an enemy with a unit selected to see the forecast.
- **Repair**: units on a friendly city (+2 HP), factory (+3) or HQ (+4) heal at the start of your turn,
  +1 per building level above 1, for credits (60% of the HP's value). Aircraft can't repair in cities.
- **Economy**: HQ +200, factory +200, city +100 per turn (+50% per level). Founding a new factory costs
  **1500**; upgrades cost 500 x level.
- **Fog of war**: you only see what your units/buildings see. Walking into an unseen enemy
  triggers an **ambush** and halts the move. The AI is bound by the same fog.
- **Win**: capture the enemy HQ with INF/IFV, or destroy every enemy unit.

## AI

No level gets extra income or free units. Levels differ only in decisions:

- **Beginner/Easy**: erratic or hesitant, short memory.
- **Normal**: solid brawler, pulls badly hurt units back to repair.
- **Hard**: remembers units it lost sight of, retreats to repair, hides outside your vision and strikes
  from the fog, falls back to lure you into its kill zone then counterattacks, flanks from different sides,
  and counter-builds (SAMs vs your air, helis/MRLs vs your armor).
- **Extreme**: Hard with tighter coordination and longer memory.

## Configuration

For local development, Flask generates a temporary session secret when the app starts.
Set `IRON_GRID_SECRET_KEY` to a stable, private value when hosting the app so sessions
survive restarts. Never commit this secret. To enable Flask's development debugger locally,
set `FLASK_DEBUG=1`; leave it unset when hosting publicly.

## Saves, records, settings

- **Save / Load** (S): named saves plus one rolling autosave, stored in `irongrid.db`.
- **Hall of Fame**: built from the server's copy of your finished game — you cannot submit made-up wins.
- **Save board image** (P): downloads the current board as a PNG.
- **Settings** (O): keyboard control, theme, default AI level, animation speed, autosave, confirm end turn,
  colorblind palette, larger text, sound.

## Keyboard (Settings -> Keyboard control)

Arrows move the cursor · Enter/Space select, move, attack · Esc cancel · Tab/Shift+Tab next/previous ready unit ·
T cycle targets · W wait · F found factory · 1-8 build (building selected) · U upgrade · H jump to HQ ·
E end turn · S saves · N new operation · O settings · ? help · I/L/M/R panels · P board image.

## Contact

For advice, bug reports, or fixes: [a.binsharif1@gmail.com](mailto:a.binsharif1@gmail.com).

## Hosting

GitHub stores this source code but does not run the Flask game. To make the game playable
online, deploy it to a Python-compatible hosting service with a persistent disk for
`irongrid.db`, and configure `IRON_GRID_SECRET_KEY` as a private environment variable.