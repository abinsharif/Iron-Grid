# IRON GRID

**Current version: v4.7.3** — tiered turn-based tactics for your LAN. One account, six complete games: pick a ruleset,
pick a battlefield, pick an enemy — from the 4-unit Skirmish to combined-arms, engineers,
doctrines, air power, and full naval war. Server-authoritative Flask + canvas, SQLite
persistence, LAN multiplayer with in-game chat.

![Python](https://img.shields.io/badge/python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-green)

## Screenshots

<!-- Drop images into an `images/` folder and update these paths -->

![Battlefield](images/battlefield.png)

## Why IRON GRID

Most tactics games give you one ruleset and a difficulty slider. IRON GRID gives you **six
games that share one account and one lobby**, each with its own competitive rating — start
with four units and instant captures, end with carriers-in-waiting, submarine stealth,
shore bombardment, and beach assaults. Every tier is a complete, standalone ruleset; a
tier-1 duel and a tier-6 naval war barely resemble each other.

Everything is **server-authoritative**: Flask validates every move, attack, production
order, and fuel expenditure. Clients preview; the server decides. No client-side cheating,
in singleplayer or LAN PvP.

## Feature tour

### Six tiers — six complete games

| Tier | Name | Units | What defines it |
|------|------|-------|-----------------|
| 1 | **Skirmish** | 4 | The original ruleset. No roads, no swamp, instant captures. Learn the fundamentals. |
| 2 | **Combined Arms** | 8 | Counters, repairs, upgrades, fog-of-war ambushes, and the full 10-doctrine AI ladder. |
| 3 | **Engineers** | 13 | Two-step captures. Engineers lay roads, railways, fortifications and airfields; bridgelayers cross rivers; barracks train infantry. |
| 4 | **Doctrine** | 18 | Pre-battle doctrines (Mechanized / Firepower / Reconnaissance / Territorial), radar coverage, unit upkeep, and bridge demolition. |
| 5 | **Sky** | 24 | Aircraft with real fuel budgets, airfields vs airbases, transport helicopters, and two helicopter doctrines: gunship and tank hunter. |
| 6 | **Sea** | 31 | Warships with heavy hulls, submarine stealth, manual coastal batteries, shore bombardment, and landing ships that lift armor across the beach. |

Each tier keeps its **own competitive rating** on a 20-rank military ladder (Cadet → Field
Marshal; Iron Marshal at 1000). Tiers 4+ add unit upkeep — armies cost money to hold, not
just to build.

### Economy that fights back

- **HQs and cities are money.** Factories build armor and guns but cost 40/turn in upkeep;
  barracks train infantry at −50/turn; harbors and ports *earn* trade income (+200/+1234).
- **Buildings have HP.** Everything can be bombarded — income scales with structural
  health, past-half buildings stop producing, overkill destroys, and you choose: repair or
  upgrade (which also hardens and heals the structure to full). Forward structures you
  built yourself - airfields, ports, batteries, radars - and bridges can be demolished
  to deny them to the enemy.
- **Production takes time.** Infantry, drones and corvettes roll out in a turn; MBTs,
  fighters and destroyers take two; heavy tanks, howitzers, bombers, cruisers and
  submarines take three. Buildings upgrade in one turn, then two. One order per production
  site — no double-booking the shipyard.

### Combat with real texture

- **Seven attack classes** — soft, armor, hard, rotary-wing, fixed-wing, sea, and buildings
  — so matchups read like doctrine: AA guns shred helicopters but barely scratch jets,
  SAMs (and frigates) are the fixed-wing killers, infantry plinks rotaries and can't touch
  bombers, and warships level coastal cities.
- **Fog of war with teeth.** Per-side logbooks ("Contact: enemy corvette spotted at V9"),
  hidden submarines (revealed by destroyer sonar or close spotting), ambushes, and
  movement that **re-routes around the unseen** — an order either completes or is cancelled
  with a reason, never abandoned midway.
- **Combined arms on one tile.** Stacked units cycle with a click; a move-vs-select chooser
  (M / 1-9 / B / Esc) resolves genuine conflicts; right-click deselects. Aircraft refuel at
  airfields; transports show their cargo manifest and share damage with it proportionally.

### Ten AI doctrines — zero cheats

Beginner → Very Easy → Easy → Medium → Hard → Very Hard → Extreme → Relentless → Merciless
→ **Apocalypse**. Higher doctrines plan better (artillery hunters, base raiders, HQ
garrisons, counter-building, sonar screens) — none gets free units or income. Your rating
climbs a band curve: weak AIs stop paying as you outgrow them; upsets against far stronger
AIs pay big.

### 28 battlefields, four sizes

Fourteen classic duel maps, eight mirror-symmetric channels, wide naval theaters, and grand
32×20 boards — or roll the dice with 🎲 Random. Tier-filtered map picks, per-map starting
credits scaled to theater size, and machine-validated symmetry and connectivity on every
board.

### LAN multiplayer

The lobby is a wizard: **tier → map → enemy**. Challenge anyone on the network; battles
show whose move it is, auto-refresh while you wait, carry the tier you picked, and include
per-side fog-correct logbooks and in-game chat. Accounts are hashed-password logins in the
same SQLite file; the Hall of Fame shows the top three verified wins per AI doctrine across
all players.

## Quickstart

```bash
pip install flask
python app.py
```

Open `http://127.0.0.1:5000` on this machine. Other devices on the network open
`http://<this-PC's-LAN-IP>:5000` and land in the lobby to register or log in.

```
app.py            the game engine and API (behaviour only)
gamedata.py       ALL static data: 31 units, seven-class attack matrix, 28 maps, tiers,
                  doctrines, AI ladders, production rules
helpers.py        shared pure functions
tiers/            tier1.py … tier8.py — per-tier rule modules
templates/        battlefield + lobby (Bootstrap-styled, dark/light themes)
static/           canvas renderer, lobby wizard, sounds
irongrid.db       created automatically on first run (accounts, saves, records)
```

## Rules in sixty seconds

Move, then attack or wait. Capture income buildings; repair on friendly ones; take the
enemy HQ or destroy everything. Terrain matters — forests and villages soften blows,
mountains block vehicles, rivers need bridges, roads and rails speed ground movement.
Aircraft watch their fuel; ships keep to open water; everyone pays upkeep from tier 4.
Full details live in the in-game **Manual** and **Units** tabs — searchable, per-tier,
with every stat, matchup chip, and production rule.

## Configuration

- `IRON_GRID_SECRET_KEY` — set it so logins survive restarts (never commit it).
- `IRON_GRID_HOST` / `IRON_GRID_PORT` — default `0.0.0.0` / `5000`.
- `FLASK_DEBUG=1` — development debugger; leave unset when hosting.

## Roadmap

More tiers, campaigns, and balance patches — the ruleset-per-tier architecture is built to
grow.

## Contributing

Issues and pull requests welcome — especially balance feedback from real matches. Run the
game, play a tier, and tell us what the AI did wrong.

## License

Copyright (c) 2026 a.binsharif1. All rights reserved. Public source: you may view, fork,
and run IRON GRID for personal, non-commercial use; improvements, bug reports, and
feature discussions via issues and pull requests are very welcome. Commercial use
(including paid hosting) requires written permission — the author may offer commercial
licensing in the future. See [LICENSE](LICENSE).

## Contact

Built by a.binsharif1 — [a.binsharif1@gmail.com](mailto:a.binsharif1@gmail.com).
