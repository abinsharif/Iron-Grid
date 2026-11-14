"""Generate static/assets/2d/manifest.json and docs/2d-asset-checklist.md from the real game data.
Run from the project root:   python tools/gen_2d_assets.py        (safe to re-run; it also reports which images already exist)"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from gamedata import UNITS, ORDER, B_TIER, TIERS

EXT = "png"; PPT = 128                      # sprites are authored at 128 px per board tile
A2D = os.path.join(ROOT, "static/assets/2d")
exists = lambda rel: os.path.isfile(os.path.join(A2D, rel))
r8 = lambda v: int(-(-v // 8) * 8)

TERRAIN = [("=", "road_ground", "Ground UNDER roads (plain grass/earth). The road itself comes from the network pieces below."),
           ("R", "railway_ground", "Ground UNDER railways (gravel/earth). Rails come from the network pieces."),
           ("B", "bridge_water", "Water UNDER bridges. Bridge decks come from `bridge_straight`."),
           (".", "plains", "Open ground. Optional variants: set \"variants\": 4 in the manifest and supply plains_0..plains_3."),
           ("F", "forest", "Forest floor (dark grass/leaf litter). Trees are drawn live by the game so they can sway; a finished tree-covered tile also works (it just won't sway)."),
           ("M", "mountain", "Mountain tile with visible height (peaks, shading, rock). Seamless to itself."),
           ("W", "river", "Shallow/river water. Optional animation: a horizontal sheet, set frames/frame_ms/loop in the manifest."),
           ("O", "ocean", "Deep water. Same animation option as river."),
           ("S", "swamp", "Marsh ground. Reeds and bubbles are drawn live."),
           ("U", "village", "Ground with houses."),
           ("~", "beach", "Sand. The game adds wet-sand/foam where it meets water.")]
NETWORK = [("road", "Road", 38), ("railway", "Railway", 30)]
PIECES = [("isolated", "short centred stub, east-west"), ("end", "connected segment, EAST-WEST, edge to edge"), ("straight", "straight piece, EAST-WEST, edge to edge"),
          ("corner", "curve joining the NORTH and EAST edges"), ("t", "T-junction joining EAST, WEST and SOUTH edges"), ("cross", "crossing joining all four edges")]
STRUCT_FOOT = {"HQ": 120, "factory": 112, "city": 112, "barracks": 112, "fort": 112, "radar": 96, "training": 104, "harbor": 120, "port": 120, "shipyard": 120,
               "airbase": 120, "airfield": 120, "battery": 88}
STRUCT_NOTE = {"HQ": "Largest, most important building.", "factory": "Sawtooth roof, chimneys (the game adds production smoke).", "city": "Cluster of civilian buildings.",
               "barracks": "Long hut plus tents.", "fort": "Walled bastion.", "radar": "Radar dish/tower (the game does not rotate supplied art).", "training": "Training ground (in the data, rarely used).",
               "harbor": "Quay + crane; water at the bottom edge.", "port": "Container quay + gantry crane.", "shipyard": "Slipway, hull on stocks, gantry crane.",
               "airbase": "Runway + hangar + tower.", "airfield": "Small strip + hangar.", "battery": "Coastal gun emplacement."}
STRUCTS = list(B_TIER.keys()) + ["battery"]
FOOT = {"inf": (44, 44), "at": (60, 44), "eng": (52, 46), "mortar": (60, 52), "sf": (50, 46),
        "afv": (88, 60), "ifv": (92, 62), "mbt": (96, 66), "ht": (104, 72), "cv": (96, 66), "mrl": (100, 66), "how": (112, 66), "sam": (96, 64), "aa": (92, 64), "bl": (112, 66),
        "heli": (100, 100), "ah": (104, 96), "th": (108, 100), "drone": (68, 68), "uav": (80, 100), "td": (72, 64), "jet": (100, 72), "intr": (104, 76), "sb": (116, 106),
        "cor": (96, 40), "fr": (104, 42), "dd": (112, 44), "ca": (120, 50), "sub": (104, 32), "ls": (112, 52)}
assert set(FOOT) == set(UNITS)
ANGLE = {"foot": "top-down, facing east", "tread": "top-down, facing east, hull along the east-west axis", "air": "top-down, facing east; NO ground shadow (the game draws it); rotors/props may be painted as a blur or left off (helicopter rotors are drawn live only for procedural art)",
         "sea": "top-down, facing east, bow right; NO wake (the game draws it)"}
# effect id -> (label, frame w, frame h, frames, anchor, description)
EFFECTS = [
    ("muzzle_infantry", "Infantry muzzle flash", 32, 32, 3, [0.1, 0.5], "Small rifle flash pointing EAST; origin at the left edge."),
    ("muzzle_tank", "Tank / armoured-vehicle muzzle blast", 64, 64, 5, [0.1, 0.5], "Bright cannon blast with smoke, pointing EAST."),
    ("muzzle_artillery", "Artillery / rocket launcher muzzle blast", 80, 80, 6, [0.1, 0.5], "Big blast with a smoke ring, pointing EAST."),
    ("muzzle_air", "Aircraft gun / pod flash", 48, 48, 4, [0.1, 0.5], "Short double flash from wings/nose, pointing EAST."),
    ("muzzle_naval", "Naval gun blast", 96, 96, 6, [0.1, 0.5], "Large flash and smoke cloud, pointing EAST."),
    ("muzzle_aa", "AA gun / SAM launch flash", 48, 48, 4, [0.1, 0.5], "Rapid flash with a backblast puff, pointing EAST."),
    ("shell", "Artillery / naval shell in flight", 32, 16, 1, [0.5, 0.5], "Shell pointing EAST; rotated along its arc. Loop 1-4 frames."),
    ("rocket", "Rocket in flight", 32, 16, 2, [0.5, 0.5], "Rocket with a flame tail pointing EAST."),
    ("missile", "Missile (SAM / aircraft) in flight", 40, 16, 2, [0.5, 0.5], "Missile with exhaust pointing EAST."),
    ("impact_ground", "Ground impact", 96, 96, 7, [0.5, 0.5], "Dust/flash burst centred on the target."),
    ("impact_air", "Flak burst / air hit", 96, 96, 6, [0.5, 0.5], "Dark flak puff with an orange core."),
    ("impact_water", "Water splash", 96, 96, 7, [0.5, 0.5], "Splash column and rings."),
    ("explosion_ground", "Ground unit destroyed", 128, 128, 10, [0.5, 0.5], "Fireball and smoke."),
    ("explosion_air", "Aircraft destroyed", 128, 128, 10, [0.5, 0.5], "Fireball with falling debris/smoke trail."),
    ("explosion_naval", "Ship destroyed", 128, 128, 10, [0.5, 0.5], "Fireball with a water ring."),
    ("capture", "Building captured", 96, 96, 6, [0.5, 0.5], "Flag / ring pulse.")]

man = {"version": 2, "format": EXT, "px_per_tile": PPT, "units": {}, "terrain": {}, "network": {}, "structures": {}, "effects": {}, "env": {}}
for k in ORDER: man["units"][k] = {"file": f"units/{k}.{EXT}", "name": UNITS[k]["name"], "scale": 1}
for c, n, _ in TERRAIN:
    e = {"file": f"terrain/{n}.{EXT}", "name": n}
    if c in "WO": e.update({"frames": 1, "frame_ms": 140, "loop": True})
    man["terrain"][c] = e
for kind, _, _ in NETWORK:
    for pn, _ in PIECES: man["network"][f"{kind}_{pn}"] = {"file": f"terrain/{kind}_{pn}.{EXT}"}
man["network"]["bridge_straight"] = {"file": f"terrain/bridge_straight.{EXT}"}
for s in STRUCTS:
    man["structures"][s] = {"file": f"structures/{s}.{EXT}"}
    for side in ("P", "A"): man["structures"][f"{s}_{side}"] = {"file": f"structures/{s}_{side}.{EXT}"}
    for lv in (2, 3):
        man["structures"][f"{s}_L{lv}"] = {"file": f"structures/{s}_L{lv}.{EXT}"}
        for side in ("P", "A"): man["structures"][f"{s}_{side}_L{lv}"] = {"file": f"structures/{s}_{side}_L{lv}.{EXT}"}
for e, _, fw, fh, n, an, _ in EFFECTS:
    man["effects"][e] = {"file": f"effects/{e}.{EXT}", "frames": 1, "frame_ms": 60, "loop": False, "fw": fw, "fh": fh, "anchor": an}
man["env"]["cloud"] = {"file": f"env/cloud_shadow.{EXT}"}
json.dump(man, open(os.path.join(A2D, "manifest.json"), "w"), indent=1)
for d in ("units", "terrain", "structures", "effects", "env"): os.makedirs(os.path.join(A2D, d), exist_ok=True)

def st(rel): return "SUPPLIED" if exists(rel) else "procedural"
rows = {"units": [], "terrain": [], "network": [], "structures": [], "effects": [], "env": []}
new_in = {}
for t, d in TIERS.items():
    for u in d["units"]: new_in.setdefault(u, t)
L = ["# IRON GRID - 2D asset checklist", "",
     "Every image is **optional**: anything you do not supply is drawn procedurally by the game (terrain, structures, units and effects all have full procedural versions), so you can add files one at a time.",
     "Generated from the real game data by `tools/gen_2d_assets.py` (re-run it after adding files: the Status column is recomputed from what is actually in `static/assets/2d/`).", "",
     "## Conventions", "",
     f"- **Scale:** sprites are authored at **{PPT} px per board tile** (the board draws a tile at 64 px on screen, 2x headroom for zoom). The game reads each image's real size, so images do NOT need to be tile-sized: a 64x64 infantry sprite is drawn half a tile wide. Canvas = visible footprint + ~8 px padding on each side, rounded up to a multiple of 8, square for units (they rotate around the centre).",
     "- **Format:** PNG or WebP (to use WebP change the extension in `manifest.json`). Terrain base tiles are opaque; everything else needs an alpha channel.",
     "- **View / light:** straight top-down, light from the top-left, soft short shadows baked into terrain and structures only. Units: NO baked ground shadow; the game draws one (and a team ring, team marker, health bar and HP number, so never paint those). Keep unit bodies in neutral military colours.",
     "- **Orientation:** units/effects face EAST (right). The game rotates them to the direction of travel. Structures and terrain are not rotated (except road/rail pieces, see below).",
     "- **Style:** one rendering style for everything; terrain calmer and slightly less saturated than units.",
     "- **Tuning:** `\"scale\"` in a manifest entry draws that image larger/smaller without re-exporting it.", "",
     "## Animation support (what the game animates for you)", "",
     "- **Water** waves, foam, sparkles; **trees** swaying; **swamp reeds/bubbles**; **cloud shadows**; **radar dishes, flags, windsocks, beacons, production gears/smoke** (procedural art only).",
     "- All of it follows the Animation Speed setting (0% = frozen, 100% normal, 200% double).",
     "- **Sprite sheets you can supply:** every effect (`effects/*`), and the water tiles. A sheet is a single image with frames laid out left-to-right. In the manifest entry set `frames` (count), `frame_ms` (ms per frame at 100% speed), `loop` (true/false), `fw`/`fh` (frame size; default image width / frames), `anchor` ([0..1, 0..1] origin inside a frame) and `scale`. If the image holds fewer frames than `frames`, the last available frame is held. With `frames` = 1 the image is shown as a single fading/growing frame.", ""]
def section(title, intro, header, rowlist):
    L.extend([f"## {title}", "", intro, "", header[0], header[1]] + rowlist + [""])
# terrain
tr = []
for c, n, note in TERRAIN:
    tr.append(f"| `terrain/{n}.{EXT}` | `{c}` | {n} | 128 x 128 | opaque | {st(f'terrain/{n}.{EXT}')} | {note} |")
section("Terrain base tiles", "Seamless: tiled 3x3 the tile must show no seams. Ground only (no roads/rails on it).",
        ("| File | Game id | Terrain | Size | Alpha | Status | Notes |", "|---|---|---|---|---|---|---|"), tr)
nw = []
for kind, lab, wpx in NETWORK:
    for pn, desc in PIECES:
        nw.append(f"| `terrain/{kind}_{pn}.{EXT}` | {lab} | {pn} | 128 x 128 | yes | {st(f'terrain/{kind}_{pn}.{EXT}')} | {desc}; {lab.lower()} about {wpx} px wide, centred, meeting the edge midpoints exactly |")
nw.append(f"| `terrain/bridge_straight.{EXT}` | Bridge | straight | 128 x 128 | yes | {st(f'terrain/bridge_straight.{EXT}')} | deck EAST-WEST about 46 px wide with rails/posts; water is drawn underneath by the game |")
section("Roads, railways and bridges (connections)", "The game builds each tile's shape from its neighbours and picks one of these pieces, rotating it in 90-degree steps. All pieces are drawn on a transparent tile; the canonical orientation is given in Notes. Roads also connect to bridges, villages and buildings; rails to bridges, factories, ports, harbours, shipyards and airbases.",
        ("| File | Network | Piece | Size | Alpha | Status | Notes |", "|---|---|---|---|---|---|---|"), nw)
# structures
sr = []
for s in STRUCTS:
    c = r8(STRUCT_FOOT[s] + 16)
    sr.append(f"| `structures/{s}.{EXT}` | `{s}` | {c} x {c} | {STRUCT_FOOT[s]} x {STRUCT_FOOT[s]} | {st(f'structures/{s}.{EXT}')} | {STRUCT_NOTE.get(s, '')} |")
section("Structures", "One neutral image per type is enough (the game adds an owner stripe). Transparent, top-down, not rotated, on a small ground pad. Draw no text/levels/health/capture progress.",
        ("| File | Id | Canvas | Visible footprint | Status | Notes |", "|---|---|---|---|---|---|"), sr)
L.extend(["### Optional owner and level variants of every structure", "",
          "The game picks the most specific image that exists: `<id>_<P|A>_L<level>` -> `<id>_L<level>` -> `<id>_<P|A>` -> `<id>`. With no level images the procedural art adds visible detail per level instead (fence and floodlights at L2, plus gold trim and extra parts at L3). Make level images clearly richer than level 1 (extra floors, wings, antennas, defences) but keep the same silhouette and canvas size.",
          "", "- Owner art: `structures/<id>_P.png` (player) and `structures/<id>_A.png` (enemy), same canvas as the neutral image.",
          "- Level art: `structures/<id>_L2.png`, `structures/<id>_L3.png` and owner versions `structures/<id>_P_L2.png`, `structures/<id>_A_L3.png` ... (all listed in the manifest).", ""])
# units
ur = []
for k in ORDER:
    u = UNITS[k]; w, h = FOOT[k]; c = r8(max(w, h) + 16)
    ur.append(f"| `units/{k}.{EXT}` | `{k}` | {u['name']} | {u['cls']} | {new_in.get(k, '-')} | {c} x {c} | {w} x {h} | {st(f'units/{k}.{EXT}')} | {ANGLE[u['cls']]} |")
section("Unit sprites", "Transparent, centred, facing east. The game draws the shadow, team ring/marker, health bar and HP number.",
        ("| File | Id | Unit | Class | First tier | Canvas | Visible footprint | Status | View |", "|---|---|---|---|---|---|---|---|---|"), ur)
# effects
er = []
for e, lab, fw, fh, n, an, desc in EFFECTS:
    er.append(f"| `effects/{e}.{EXT}` | {lab} | {fw} x {fh} per frame, {n} frames ({fw * n} x {fh} sheet) | {an} | {st(f'effects/{e}.{EXT}')} | {desc} |")
section("Effects (sprite sheets)", "Only effects the game really produces: they are picked from the attacker's weapon category (infantry, tank, artillery/rocket, aircraft, naval, anti-air/SAM) and the target (ground, air, water). Frame counts above are suggestions; set the real number in `manifest.json`.",
        ("| File | Effect | Recommended size | Anchor | Status | Notes |", "|---|---|---|---|---|---|"), er)
L.extend(["## Environment", "", "| File | Use | Size | Status | Notes |", "|---|---|---|---|---|",
          f"| `env/cloud_shadow.{EXT}` | Drifting cloud shadow | 256 x 128, alpha | {st(f'env/cloud_shadow.{EXT}')} | Soft dark blob; drawn at low opacity and scrolled slowly across the board. |", ""])
# totals
allrel = [r for r in ([f"terrain/{n}.{EXT}" for _, n, _ in TERRAIN] + [f"terrain/{k}_{p}.{EXT}" for k, _, _ in NETWORK for p, _ in PIECES] + [f"terrain/bridge_straight.{EXT}"] +
          [f"structures/{s}.{EXT}" for s in STRUCTS] + [f"units/{k}.{EXT}" for k in ORDER] + [f"effects/{e[0]}.{EXT}" for e in EFFECTS] + [f"env/cloud_shadow.{EXT}"])]
sup = sum(1 for r in allrel if exists(r))
L.extend(["## Totals", "", f"Core images: **{len(allrel)}** ({len(ORDER)} units, {len(TERRAIN)} terrain tiles, {len(NETWORK) * len(PIECES) + 1} road/rail/bridge pieces, {len(STRUCTS)} structures, {len(EFFECTS)} effects, 1 environment). Supplied: **{sup}**. Still procedural: **{len(allrel) - sup}**. Optional extras: owner/level structure variants and terrain variants.", "",
          "## Fog of war", "", "Never paint hidden-information hints into art. The game only draws images for what the server says the player can see."])
open(os.path.join(ROOT, "docs/2d-asset-checklist.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
open(os.path.join(A2D, "README.md"), "w").write("Place your 2D images here (see docs/2d-asset-checklist.md). Missing images are drawn procedurally. Re-run `python tools/gen_2d_assets.py` to refresh manifest.json and the checklist status.\n")
print("core images", len(allrel), "supplied", sup)
