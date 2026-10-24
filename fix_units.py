"""IRON GRID v4.6.5 -> v4.6.6 unit rebalance. Run once from the project folder:
    python fix_units.py
Then delete this file and restart Flask."""
import sys, py_compile, re

sys.path.insert(0, ".")
import gamedata as g

# ---- naval firepower: the cruiser outguns the destroyer; the frigate is the fleet's SAM ----
g.ATTACK["ca"]["sea"] = 10          # heavy naval gunnery, clearly above the destroyer
g.ATTACK["dd"]["sea"] = 8
g.ATTACK["fr"]["fix"] = 9           # frigate = the SAM of the seas
g.ATTACK["fr"]["rot"] = 4
for k in ("cor", "dd", "ca", "sub", "ls"):
    g.ATTACK[k]["fix"] = {"cor": 2, "dd": 3, "ca": 2, "sub": 0, "ls": 1}[k]
    g.ATTACK[k]["rot"] = {"cor": 2, "dd": 2, "ca": 2, "sub": 0, "ls": 1}[k]

# ---- two helicopters from tier 5: gunship vs tank-hunter ----
# gunship: soft-target specialist
g.UNITS["heli"]["desc"] = "Gunship. Shreds infantry and soft targets; light against armor."
g.ATTACK["heli"] = {"soft": 7, "armor": 3, "hard": 2, "sea": 0, "bld": 2, "rot": 3, "fix": 1}
# ah: attack helicopter - anti-tank and anti-rotary specialist
g.UNITS["ah"] = {"name": "Tank Hunter", "full": "Attack Helicopter (Tank Hunter)",
                 "code": "AH", "cat": "Air", "cls": "air", "hp": 12, "move": 6,
                 "cost": 800, "rng": (1, 1), "vis": 5, "capture": False, "indirect": False,
                 "move_fire": True,
                 "desc": "Attack helicopter. Tank-killer: strong vs armor and against other "
                         "helicopters; weak against soft targets and fixed-wing.",
                 "sites": ("airfield", "airbase"), "tech": 1}
g.ATTACK["ah"] = {"soft": 4, "armor": 8, "hard": 5, "sea": 0, "bld": 1, "rot": 6, "fix": 0}
g.TARGET_CLASS["ah"] = "rot"
g.PROD_SITES["ah"] = (("airfield", "airbase"), 1)
g.BUILD_TIMES["ah"] = 2
g.FUEL_TABLE["ah"] = 85
if "ah" not in g.ORDER:
    g.ORDER.insert(g.ORDER.index("heli") + 1, "ah")
for t in (5, 6):
    if "ah" not in g.TIERS[t]["units"]:
        g.TIERS[t]["units"].append("ah")

# the AI needs a build weight for the new helicopter
try:
    s = open("app.py").read()
    marker = '"heli": 0.8 if cnt["mbt"] >= 2 else 0.2,'
    if '"ah":' not in s:
        s = s.replace(marker, marker + '\n         "ah": 1.6 if armor >= 2 else 0.4,')
        open("app.py", "w").write(s)
        py_compile.compile("app.py", doraise=True)
except OSError:
    pass

NL = chr(10); Q = chr(34)
body = []
for v in ["UNITS", "ORDER", "CATEGORIES", "TARGET_CLASS", "ATTACK", "FIGHTER_MIN_DAMAGE",
          "TERRAIN", "STEP", "DEF_MULT", "B_DEF", "TINFO", "BASE_INCOME", "HEAL", "B_TIER",
          "MAPS", "TIERS", "TIER_ORDER", "TIER1_TERRAIN_XLAT", "LEGACY_LEVELS",
          "AI_LEVELS", "AI_LEVEL_ORDER", "DOCTRINES", "DOCTRINE_ORDER", "PROD_SITES",
          "BUILD_TIMES", "RANK_LADDER", "BLD_HP", "FUEL_TABLE", "UPKEEP"]:
    body.append(v + " = " + repr(getattr(g, v, None)) + NL)
body.append("W, H = 14, 10" + NL)
header = Q*3 + "IRON GRID static game data. All behaviour lives in app.py / helpers.py / tiers/." + Q*3 + NL + NL
open("gamedata.py", "w").write(header + NL.join(body))
py_compile.compile("gamedata.py", doraise=True)

# bump the version badge
try:
    s = open("app.py").read()
    open("app.py", "w").write(re.sub(r'APP_VERSION = "[^"]+"', 'APP_VERSION = "4.6.6"', s))
    s = open("README.md").read()
    open("README.md", "w").write(re.sub(r"# IRON GRID V4 \([^)]+\)", "# IRON GRID V4 (4.6.6)", s))
except OSError:
    pass

# ---- self-checks ----
import importlib
import gamedata as g2
importlib.reload(g2)
assert g2.ATTACK["ca"]["sea"] == 10 and g2.ATTACK["dd"]["sea"] == 8
assert g2.ATTACK["fr"]["fix"] == 9 and g2.ATTACK["ca"]["fix"] == 2
assert g2.ATTACK["heli"]["soft"] == 7 and g2.ATTACK["ah"]["armor"] == 8
assert g2.ATTACK["ah"]["rot"] == 6 and g2.TARGET_CLASS["ah"] == "rot"
assert "ah" in g2.ORDER and "ah" in g2.TIERS[5]["units"] and "ah" in g2.TIERS[6]["units"]
assert len(g2.UNITS) == 31
print("fix_units: cruiser 10 > destroyer 8; frigate fix 9; gunship + tank hunter (AH) live - v4.6.6")
