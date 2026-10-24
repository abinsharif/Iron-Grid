'''IRON GRID shared helpers: pure functions with no Flask dependency.'''

from gamedata import *

AIR_FUEL = {"th": 55, "heli": 45, "drone": 55, "uav": 60, "td": 60,
            "jet": 70, "asf": 70, "intr": 70, "sb": 85}
FUEL_MAX = 32


def fuel_for(game, utype):
    """Aircraft fuel by type (helicopters workhorses, bombers farthest) plus theater scaling."""
    w, h = dims(game)
    base = FUEL_TABLE.get(utype, FUEL_MAX)
    return base + max(0, (w * h - W * H)) // 16

DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))

def in_bounds(x, y):
    return 0 <= x < W and 0 <= y < H



def dims(game):
    """Per-game board dimensions (tier 4+ uses larger battlefields)."""
    return game.get("w", W), game.get("h", H)



def in_b(game, x, y):
    w, h = dims(game)
    return 0 <= x < w and 0 <= y < h



def man(ax, ay, bx, by):
    return abs(ax - bx) + abs(ay - by)



def manu(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])



def label(x, y):
    return f"{chr(65 + x)}{y + 1}"



def uname(s, viewer=None):
    ref = viewer if viewer is not None else "P"
    return f"{'Our' if s['side'] == ref else 'Enemy'} {UNITS[s['type']]['code']}-{s['id']}"



def bname(b):
    return {"HQ": "HQ", "factory": "Factory", "city": "City",
            "barracks": "Barracks", "fort": "Fortification",
            "radar": "Radar Station", "training": "Training Camp",
            "airbase": "Airbase", "harbor": "Harbor",
            "shipyard": "Shipyard", "battery": "Coastal Battery"}[b["type"]]



def building_at(game, x, y):
    for b in game["buildings"]:
        if b["x"] == x and b["y"] == y:
            return b
    return None



def unit_at(game, x, y):
    for u in game["units"]:
        if u["x"] == x and u["y"] == y:
            return u
    return None



def get_unit(game, uid):
    for u in game["units"]:
        if u["id"] == uid:
            return u
    return None



def snap(u):
    return {"id": u["id"], "type": u["type"], "side": u["side"],
            "x": u["x"], "y": u["y"], "hp": u["hp"]}



def building_functional(b):
    return not b.get("max_hp") or b["hp"] > b["max_hp"] // 2


def building_income(b):
    base = BASE_INCOME.get(b["type"], 0) * (1 + 0.5 * (b.get("level", 1) - 1))
    if b.get("max_hp"):
        base *= b["hp"] / b["max_hp"]           # income tracks structural health, never zero
    return int(base)



def income_of(game, side):
    return sum(building_income(b) for b in game["buildings"] if b["side"] == side)



def heal_amount(b):
    return HEAL.get(b["type"], 0) + (b.get("level", 1) - 1)



def tile_def(game, x, y):
    m = DEF_MULT[game["ter"][y][x]]
    b = building_at(game, x, y)
    if b:
        m = min(m, B_DEF[b["type"]])
    return m



def in_rng(utype, dist):
    r = UNITS[utype]["rng"]
    if dist == 0:
        return r[0] == 1          # direct-fire units can hit an enemy stacked on their tile
    return r[0] <= dist <= r[1]



def attack_base(atype, dtype):
    return ATTACK[atype][TARGET_CLASS[dtype]]


def building_attack(atype):
    """Dedicated building-damage value (the sixth attack class)."""
    return ATTACK[atype].get("bld", 0)



def rank_title(r):
    r = max(0, min(1000, int(r or 0)))
    if r >= 1000:
        return "Iron Marshal"
    return RANK_LADDER[r // 50]



def dom_of(u):
    """Movement domain: aircraft pass over ground units, ships keep to water."""
    c = UNITS[u["type"]]["cls"]
    return "a" if c == "air" else ("s" if c == "sea" else "g")



def sector(cx, cy, x, y):
    dx, dy = x - cx, y - cy
    if abs(dx) >= abs(dy):
        return "E" if dx > 0 else "W"
    return "S" if dy > 0 else "N"


STRIKERS = {"afv", "heli", "jet"}
POST_DANGER = {"advance": 0.8, "probe": 1.1, "withdraw": 1.3, "counter": 0.5}



def fuel_max(u):
    return AIR_FUEL.get(u["type"], FUEL_MAX)



def doctrine_of(game, side):
    d = game.get("doctrine") or {}
    return d.get(side, "territ")



def power(u, w=1.0):
    t = UNITS[u["type"]]
    return t["cost"] * u["hp"] / t["hp"] * w


