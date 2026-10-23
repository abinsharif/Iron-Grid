# IRON GRID V4 (4.3.1) — Tiered Turn-Based Tactics (Flask + canvas + SQLite, LAN multiplayer)

Server-authoritative military tactics in the spirit of Advance Wars — **six complete games
under one account**. Pick a tier (each is its own standalone ruleset), pick a battlefield,
pick an enemy, and fight. Saves, accounts, per-tier ratings and the Hall of Fame live in
one SQLite file (`irongrid.db`).

## Versioning

Releases bump the subversion (v4.1, v4.2, …); the running version is shown in the
header of every page and served at `/api/meta`.

## Run

    pip install flask
    python app.py          # serves on 0.0.0.0:5000

Open `http://127.0.0.1:5000` on this PC; other devices on the network open
`http://<this-PC's-LAN-IP>:5000` and land in the lobby, where they register/login.
Set `IRON_GRID_SECRET_KEY` so logins survive restarts.

    app.py            the game engine and API (behaviour only)
    gamedata.py       ALL static data: 30 units (complete stat blocks + production
                      rules), attack matrix, terrain, 28 maps, tiers, doctrines, AI ladders
    helpers.py        shared pure functions (no Flask dependency)
    tiers/            tier1.py … tier8.py — one rule module per tier (7/8 reserved)
    templates/        index.html (battlefield), lobby.html (wizard + multiplayer)
    static/           css + js

Every match loads only its own tier's slice of the database: starting forces, the AI's
production, and the client's build menu are all restricted to the tier roster, so a
tier-1 game can never field (or even see stats for) a tier-3+ unit.

## The flow

**Tier → Map → Enemy.** Tier cards describe each ruleset; the map list is filtered to your
tier's battlefield sizes (🎲 Random deals one); enemy cards are the ten AI doctrines, one
click to launch. Doctrine selection appears only at tier 4+. Multiplayer challenges carry
the tier you picked. Each tier keeps its **own competitive rating** (20-band ladder:
Cadet → Field Marshal, Iron Marshal at 1000); the Hall of Fame is shared, showing the top
3 verified wins per AI doctrine across all players.

## Tiers

| Tier | Name | Units | What's new | Maps | Buildings unlocked |
|------|------|-------|------------|------|--------------------|
| 1 | Skirmish | 4 | Movement, direct combat, terrain, instant capture. No roads, no swamp. | 14×10 | HQ, factory, city |
| 2 | Combined Arms | 8 | Counters, repairs, upgrades, fog ambushes, 10 AI doctrines | 14×10 | — |
| 3 | Engineers | 13 | Two-step captures (HQ: 3), roads/railways/forts/bridges, urban terrain | 14×10 | Barracks, fortifications |
| 4 | Doctrine | 18 | Pre-battle doctrines, radar stations, training camps | +24×16 | Radar, training camp |
| 5 | Sky | 24 | Aircraft fuel, airfields, transport helis | +28×18 | Airfield |
| 6 | Sea | 30 | Warships, submarine stealth, shore bombardment, beach landings | +32×20 | Harbor, shipyard, coastal battery |
| 7 | Logistics | — | *reserved* | — | — |
| 8 | Grand Strategy | — | *reserved* (campaigns; command aura & veterancy return here) | — | — |

A match spawns only the buildings its tier supports, and **starting credits scale with the
theater**: 600 on 14×10, 1000 on 24×16, 1500 on 28×18, 2000 on 32×20 (per-map override
possible). **Enemy and neutral buildings are hidden until scouted.**

## Production & build times

HQs and cities produce **money only**. Factories build armour and ground fire support
(**−40 cr/turn upkeep**); barracks build infantry and support; airbases build aircraft;
shipyards and harbors berth ships (harbors also heal them and earn **+200 cr/turn** trade;
airbases and shipyards are money-neutral). Bigger machines take longer: infantry, drones,
helicopters, basic tanks and the corvette take **1 turn**; MBT, MRL, SAM, AA, fighters,
frigates, destroyers and landing ships take **2**; heavy tanks, howitzers, bombers,
cruisers and submarines take **3**. Building upgrades take time too — **1 turn** for the
first level, **2** for the second. The unit cap is effectively unlimited (99). Every unit's
production site, tech level and build time is shown in the in-game manual.

## Defenses and terrain

Coastal batteries (20 HP, +10/level) and fortifications can be **attacked and destroyed by
any unit** — they show HP bars, appear in attack forecasts, and collapse when their HP
reaches zero. Radar coverage grows with upgrades (6/8/10) and radars never heal. Ships
sail open water and may pass beneath bridges; beaches are for docking only. Rails, roads
and bridges built by engineers appear on the map immediately. The in-game **unit
database** (sidebar manual) is searchable and lists every unit's full stats, production
site, tech level, build time and all five attack classes including naval.

## Navy quick reference (tier 6)

Ships are built at **shipyards and harbors** (submarines and cruisers need a level-2 shipyard), berthing in an open sea tile beside them. Warships are tough: corvette 20 HP, frigate 25, submarine 25, landing ship 30, destroyer 30, cruiser 40. Ships keep to open water — beaches are for docking, not passing. Rocket artillery and howitzers can hit ships.
Corvette: cheap patrol, close shore shelling. Frigate: anti-air escort, range 1-3, light
bombardment. Destroyer: submarine hunter — sonar reveals subs at range 4 (everyone else
spots at 2). Cruiser: range 2-4 naval gunnery and shore bombardment. Submarine: invisible
torpedo attacker. Landing ship: carries two ground units, unloads onto beaches. **Coastal
batteries** (power 8, range 2-4, detection 2) automatically fire at the strongest spotted
enemy ship at the start of your turn. **Radar stations** sweep a detection circle of 6.

## Interface

Zoom/pan/fit controls (wheel + drag), ready-unit counter, hover combat forecasts, disabled
actions that explain themselves (⛔ + reason), a per-tier field manual in the sidebar
(rebuilds itself for the current tier), battle log with fog-correct per-player perspective,
in-game chat for multiplayer, and a settings panel with per-channel sound volumes (master
slider + loudness per action), animation-speed slider, and toggles for every convenience.
Bootstrap-styled controls with a dark/light theme.

## Accounts & ratings

Hashed passwords (Werkzeug) in the same SQLite file. Rank vs AI uses a band curve (each AI
doctrine teaches up to rating 100×level; weaker AIs stop paying as you outgrow them; big
upsets pay big). PvP uses K=64 Elo per tier.

## Configuration

- `IRON_GRID_SECRET_KEY` — stable session secret for LAN hosting (never commit it).
- `FLASK_DEBUG=1` — development debugger locally; unset when hosting.
- `IRON_GRID_HOST` / `IRON_GRID_PORT` — default `0.0.0.0` / `5000`.

## Contact

For advice, bug reports, or fixes: [a.binsharif1@gmail.com](mailto:a.binsharif1@gmail.com).
