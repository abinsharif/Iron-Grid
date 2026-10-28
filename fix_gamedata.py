"""One-off repair for a stale gamedata.py. Run once: python fix_gamedata.py, then delete."""
import sys, py_compile
sys.path.insert(0, ".")
import gamedata
g = gamedata

g.BASE_INCOME = {"HQ": 300, "factory": -40, "city": 200, "barracks": 80, "fort": 0,
                 "radar": 0, "airbase": 0, "harbor": 200, "shipyard": 0, "battery": 0}
g.HEAL = {"city": 2, "factory": 3, "HQ": 4, "barracks": 2, "fort": 1,
          "radar": 0, "airbase": 3, "harbor": 3, "shipyard": 2, "battery": 1}
g.B_DEF = {"city": 0.85, "factory": 0.85, "HQ": 0.7, "barracks": 0.85, "fort": 0.6,
           "radar": 0.85, "airbase": 0.85, "harbor": 0.85, "shipyard": 0.85, "battery": 0.7}
g.TINFO["U"] = ("Village", "A small settlement. -25% damage taken; easy going for infantry, slows vehicles.")
for m in g.MAPS:
    if "blds" in m:
        m["blds"] = [b for b in m["blds"] if b["type"] != "battery"]

HDR = '"""IRON GRID static game data. All behaviour lives in app.py / helpers.py / tiers/.""' + '"\n\n'
body = []
for v in ["UNITS", "ORDER", "CATEGORIES", "TARGET_CLASS", "ATTACK", "FIGHTER_MIN_DAMAGE",
          "TERRAIN", "STEP", "DEF_MULT", "B_DEF", "TINFO", "BASE_INCOME", "HEAL", "B_TIER",
          "MAPS", "TIERS", "TIER_ORDER", "TIER1_TERRAIN_XLAT", "LEGACY_LEVELS",
          "AI_LEVELS", "AI_LEVEL_ORDER", "DOCTRINES", "DOCTRINE_ORDER", "PROD_SITES",
          "BUILD_TIMES", "RANK_LADDER"]:
    body.append(v + " = " + repr(getattr(g, v)) + "\n")
body.append("W, H = 14, 10\n")
open("gamedata.py", "w").write(HDR + "\n".join(body))
py_compile.compile("gamedata.py", doraise=True)

import importlib, gamedata as g2
importlib.reload(g2)
assert g2.BASE_INCOME["HQ"] == 300 and g2.BASE_INCOME["city"] == 200
assert g2.BASE_INCOME["harbor"] == 200 and g2.BASE_INCOME["factory"] == -40
assert g2.TINFO["U"][0] == "Village"
assert not any(b["type"] == "battery" for m in g2.MAPS for b in m.get("blds", []))
print("gamedata fixed: economy HQ300/city200/harbor200, village, batteries player-built")
