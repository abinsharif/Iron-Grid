"""
IRON GRID V3 - turn-based tactics, server-authoritative.

Flask owns the state, validates every move, runs the (fog-bound, non-cheating)
AI, and persists saves + the Hall of Fame in SQLite (irongrid.db).

Run:  pip install flask  &&  python app.py  ->  http://127.0.0.1:5000
"""
import heapq
import json
import os
import random
import secrets
import sqlite3
import threading
import time
import uuid
from collections import Counter
from contextlib import closing

from flask import Flask, jsonify, render_template, request, session

app = Flask(__name__)
app.secret_key = os.environ.get("IRON_GRID_SECRET_KEY") or secrets.token_hex(32)
LOCK = threading.RLock()
GAMES = {}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "irongrid.db")
LEGACY_RECORDS = os.path.join(BASE_DIR, "records.json")
SAVE_VERSION = 3

# ======================================================================
# map & terrain
# ======================================================================
W, H = 14, 10
TERRAIN = [
    "....====......",
    ".FF........FF.",
    "..F.SM..MS.F..",
    "....MM..MM....",
    "..====WW...=..",
    "..=...WW====..",
    "....MM..MM....",
    "..F.SM..MS.F..",
    ".FF........FF.",
    "......====....",
]
assert len(TERRAIN) == H and all(len(r) == W for r in TERRAIN)

# movement cost per tile entered. >=90 means impassable.
STEP = {
    "foot":  {".": 1, "=": 0.5, "F": 2, "M": 3,  "W": 99, "S": 2},
    "tread": {".": 1, "=": 0.5, "F": 2, "M": 99, "W": 99, "S": 3},
    "air":   {".": 1, "=": 1,   "F": 1, "M": 1,  "W": 1,  "S": 1},
}
DEF_MULT = {".": 1.0, "=": 1.0, "F": 0.8, "M": 0.7, "W": 1.0, "S": 0.95}
B_DEF = {"city": 0.85, "factory": 0.85, "HQ": 0.7}
TINFO = {
    ".": ("Plains",   "Open ground. Baseline movement."),
    "=": ("Road",     "Fast lane: ground units pay only 0.5 movement per tile."),
    "F": ("Forest",   "-20% damage taken (ground). Slows all ground units."),
    "M": ("Mountain", "-30% damage taken. Only foot infantry and aircraft can cross."),
    "W": ("River",    "Impassable to ground units. Aircraft fly over."),
    "S": ("Swamp",    "Very slow going; tiny defense bonus."),
}

# ======================================================================
# economy
# ======================================================================
BASE_INCOME = {"HQ": 200, "factory": 200, "city": 100}
HEAL = {"city": 2, "factory": 3, "HQ": 4}      # HP restored per turn (+1 per building level above 1)
REPAIR_RATE = 0.6                               # credits per HP = unit_cost / unit_hp * REPAIR_RATE
MAX_B_LEVEL = 3
UPGRADE_BASE = 500
FOUND_COST = 1500
UNIT_CAP = 20
COUNTER_FACTOR = 0.75
FOUND_TERRAIN = {".", "="}
START_CREDITS = 600


def upgrade_cost(lvl):
    return UPGRADE_BASE * lvl


# ======================================================================
# units: 4 categories x 2 units
# ======================================================================
def _u(name, code, cat, cls, hp, move, cost, rng, vis, capture, indirect, desc, full=None,
       move_fire=None):
    return dict(name=name, full=full or name, code=code, cat=cat, cls=cls, hp=hp, move=move,
                cost=cost, rng=tuple(rng), vis=vis, capture=capture, indirect=indirect,
                move_fire=not indirect if move_fire is None else move_fire, desc=desc)


UNITS = {
    "inf":  _u("Infantry", "INF", "Infantry", "foot", 10, 3, 150, (1, 1), 3, True, False,
               "Cheap foot soldiers. Capture buildings, found factories, climb mountains.",
               "Infantry"),
    "ifv":  _u("IFV", "IFV", "Infantry", "tread", 12, 4, 300, (1, 1), 3, True, False,
               "Tracked infantry carrier with autocannon. Captures, kills infantry and helicopters.",
               "Mechanized Infantry (IFV)"),
    "afv":  _u("AFV", "AFV", "Armor", "tread", 10, 6, 250, (1, 1), 5, False, False,
               "Fast armored recon vehicle. Sees far, raids artillery, hits weakly.",
               "Armored Fighting Vehicle"),
    "mbt":  _u("MBT", "MBT", "Armor", "tread", 16, 4, 500, (1, 1), 3, False, False,
               "Heavy main battle tank. Devastating against ground targets; blind to aircraft.",
               "Main Battle Tank"),
    "mrl":  _u("MRL", "MRL", "Fire Support", "tread", 10, 3, 550, (2, 4), 2, False, True,
               "Mobile rocket artillery, range 2-4. Can move and fire, never counters, can't hit helicopters.",
               "Multiple Rocket Launcher", move_fire=True),
    "sam":  _u("SAM", "SAM", "Fire Support", "tread", 10, 4, 450, (1, 3), 4, False, False,
               "Anti-air missiles, range 1-3. Moves and fires. Helpless against ground targets.",
               "Surface-to-Air Missile"),
    "heli": _u("Helicopter", "HEL", "Air", "air", 12, 6, 750, (1, 1), 5, False, False,
               "Gunship. Flies over anything; tank-killer. Repairs only at HQ/factory.",
               "Attack Helicopter"),
    "jet":  _u("Fighter", "FTR", "Air", "air", 14, 8, 900, (1, 1), 6, False, False,
               "Air-superiority jet. Fast, attacks all target classes and excels against aircraft.",
               "Fighter Aircraft"),
}
ORDER = list(UNITS)
CATEGORIES = ["Infantry", "Armor", "Fire Support", "Air"]

# Base damage by target class; IFVs are armored, not soft targets.
TARGET_CLASS = {
    "inf": "soft", "ifv": "armor", "afv": "armor", "mbt": "armor",
    "mrl": "hard", "sam": "hard", "heli": "air", "jet": "air",
}
ATTACK = {
    "inf":  dict(soft=5, armor=2, hard=4, air=1),
    "ifv":  dict(soft=7, armor=4, hard=6, air=3),
    "afv":  dict(soft=5, armor=2, hard=6, air=1),
    "mbt":  dict(soft=7, armor=6, hard=7, air=2),
    "mrl":  dict(soft=9, armor=6, hard=6, air=0),
    "sam":  dict(soft=0, armor=0, hard=0, air=9),
    "heli": dict(soft=7, armor=8, hard=7, air=4),
    "jet":  dict(soft=6, armor=5, hard=5, air=8),
}
FIGHTER_MIN_DAMAGE = 1


def attack_base(atype, dtype):
    base = ATTACK[atype][TARGET_CLASS[dtype]]
    return max(FIGHTER_MIN_DAMAGE, base) if dtype == "jet" else base


def atk_summary(tp):
    return ATTACK[tp]


# Per-unit entries are generated from the four target classes for API clients.
DMG = {a: {d: attack_base(a, d) for d in UNITS} for a in UNITS}


# ======================================================================
# AI levels - none of them gets income bonuses or free units.
# ======================================================================
AI_LEVELS = {
    "beginner": dict(desc="Beginner - erratic and passive; barely looks at danger.",
                     rand=0.45, build_gate=800, dmg_w=0.9, kill=0.4, counter_w=1.8, danger_w=0.15,
                     terrain_w=2.0, goal_w=1.0, retreat=0.0, stealth=0, flank=0, tactics=False,
                     memory=0, max_builds=1, counters=False, found=False, upgrades=False,
                     bait=False, withdraw=0, press=0),
    "easy":     dict(desc="Easy - hesitant, short memory, simple targeting.",
                     rand=0.15, build_gate=350, dmg_w=1.2, kill=0.5, counter_w=1.4, danger_w=0.5,
                     terrain_w=3.0, goal_w=1.1, retreat=0.0, stealth=0, flank=0, tactics=False,
                     memory=1, max_builds=1, counters=False, found=False, upgrades=False,
                     bait=False, withdraw=0, press=0),
    "normal":   dict(desc="Normal - competent brawler; pulls badly hurt units back to repair.",
                     rand=0.0, build_gate=0, dmg_w=1.3, kill=0.7, counter_w=1.1, danger_w=0.9,
                     terrain_w=4.0, goal_w=1.2, retreat=0.25, stealth=0, flank=0, tactics=False,
                     memory=2, max_builds=2, counters=False, found=False, upgrades=False,
                     bait=False, withdraw=0, press=0),
    "hard":     dict(desc="Hard - fog-bound tactician: retreats to repair, ambushes from the "
                          "fog, lures you in and flanks. No resource bonuses.",
                     rand=0.0, build_gate=0, dmg_w=1.4, kill=0.8, counter_w=1.1, danger_w=1.2,
                     terrain_w=5.0, goal_w=1.3, retreat=0.4, stealth=3, flank=4, tactics=True,
                     memory=4, max_builds=3, counters=True, found=True, upgrades=True,
                     bait=True, withdraw=0.8, press=1.1),
    "extreme":  dict(desc="Extreme - hard tactics, tighter coordination, longer memory. "
                          "Still no cheats.",
                     rand=0.0, build_gate=0, dmg_w=1.5, kill=1.0, counter_w=1.0, danger_w=1.4,
                     terrain_w=6.0, goal_w=1.4, retreat=0.35, stealth=4, flank=6, tactics=True,
                     memory=6, max_builds=4, counters=True, found=True, upgrades=True,
                     bait=True, withdraw=0.75, press=1.2),
}


def building_defs():
    return [
        {"type": "HQ",      "x": 11, "y": 1, "side": "A", "level": 1},
        {"type": "factory", "x": 11, "y": 3, "side": "A", "level": 1},
        {"type": "city",    "x": 10, "y": 2, "side": "A", "level": 1},
        {"type": "HQ",      "x": 2,  "y": 8, "side": "P", "level": 1},
        {"type": "factory", "x": 2,  "y": 6, "side": "P", "level": 1},
        {"type": "city",    "x": 3,  "y": 7, "side": "P", "level": 1},
        {"type": "city",    "x": 5,  "y": 4, "side": None, "level": 1},
        {"type": "city",    "x": 8,  "y": 5, "side": None, "level": 1},
    ]


# ======================================================================
# helpers
# ======================================================================
DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def in_bounds(x, y):
    return 0 <= x < W and 0 <= y < H


def man(ax, ay, bx, by):
    return abs(ax - bx) + abs(ay - by)


def manu(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def label(x, y):
    return f"{chr(65 + x)}{y + 1}"


def uname(s):
    return f"{'Our' if s['side'] == 'P' else 'Enemy'} {UNITS[s['type']]['code']}-{s['id']}"


def bname(b):
    return {"HQ": "HQ", "factory": "Factory", "city": "City"}[b["type"]]


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


def building_income(b):
    return int(BASE_INCOME[b["type"]] * (1 + 0.5 * (b.get("level", 1) - 1)))


def income_of(game, side):
    return sum(building_income(b) for b in game["buildings"] if b["side"] == side)


def heal_amount(b):
    return HEAL[b["type"]] + (b.get("level", 1) - 1)


def tile_def(game, x, y):
    m = DEF_MULT[TERRAIN[y][x]]
    b = building_at(game, x, y)
    if b:
        m = min(m, B_DEF[b["type"]])
    return m


def in_rng(utype, dist):
    r = UNITS[utype]["rng"]
    return r[0] <= dist <= r[1]


def dmg_calc(game, atype, ahp, dtype, dx, dy, scale=1.0):
    base = attack_base(atype, dtype)
    if base <= 0:
        return 0
    m = 1.0 if UNITS[dtype]["cls"] == "air" else tile_def(game, dx, dy)
    return max(1, int(base * ahp / UNITS[atype]["hp"] * m * scale + 0.5))


def counter_calc(game, dtype, dhp, atype, ax, ay, dist):
    """Damage the defender (dtype, dhp after taking the hit) deals back."""
    if dhp <= 0 or UNITS[dtype]["indirect"] or not in_rng(dtype, dist):
        return 0
    return dmg_calc(game, dtype, dhp, atype, ax, ay, COUNTER_FACTOR)


def calc_damage(game, att, dfn):
    return dmg_calc(game, att["type"], att["hp"], dfn["type"], dfn["x"], dfn["y"])


# ---------------- log ----------------
def glog(game, cat, tone, text, x=None, y=None):
    e = {"i": game["log_seq"], "turn": game["turn"], "cat": cat, "tone": tone,
         "text": text, "pos": [x, y] if x is not None else None}
    game["log_seq"] += 1
    game["log"].append(e)
    if len(game["log"]) > 400:
        del game["log"][:100]
    return e


# ---------------- pathing ----------------
def dijkstra(game, cls, sx, sy, budget=None, blocked=frozenset()):
    step = STEP[cls]
    dist = {(sx, sy): 0.0}
    par = {}
    heap = [(0.0, sx, sy)]
    while heap:
        d, x, y = heapq.heappop(heap)
        if d > dist.get((x, y), 1e9):
            continue
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if not in_bounds(nx, ny) or (nx, ny) in blocked:
                continue
            c = step[TERRAIN[ny][nx]]
            if c >= 90:
                continue
            nd = d + c
            if budget is not None and nd > budget + 1e-9:
                continue
            if nd < dist.get((nx, ny), 1e9):
                dist[(nx, ny)] = nd
                par[(nx, ny)] = (x, y)
                heapq.heappush(heap, (nd, nx, ny))
    return dist, par


def move_dest(game, unit, known_block):
    """Tiles a unit may end on. Enemy units it does not know about don't block (ambush)."""
    t = UNITS[unit["type"]]
    dist, par = dijkstra(game, t["cls"], unit["x"], unit["y"], t["move"], known_block)
    friends = {(u["x"], u["y"]) for u in game["units"]
               if u["side"] == unit["side"] and u["id"] != unit["id"]}
    start = (unit["x"], unit["y"])
    dests = {c: d for c, d in dist.items() if c != start and c not in friends}
    return dests, par


def path_to(par, start, dest):
    path = [dest]
    while path[-1] != start:
        path.append(par[path[-1]])
    path.reverse()
    return path


def walk(game, unit, path):
    """Follow a path; stop before any (hidden) enemy. Returns (final_tile, ambusher)."""
    last_ok = path[0]
    for tile in path[1:]:
        occ = unit_at(game, tile[0], tile[1])
        if occ is not None and occ["side"] != unit["side"]:
            return last_ok, occ
        if occ is None:
            last_ok = tile
    return last_ok, None


# ---------------- vision ----------------
def vision(game, side):
    vis = set()

    def add(cx, cy, r):
        for dx in range(-r, r + 1):
            rem = r - abs(dx)
            for dy in range(-rem, rem + 1):
                x, y = cx + dx, cy + dy
                if in_bounds(x, y):
                    vis.add((x, y))

    for u in game["units"]:
        if u["side"] == side:
            add(u["x"], u["y"], UNITS[u["type"]]["vis"])
    for b in game["buildings"]:
        if b["side"] == side:
            add(b["x"], b["y"], 3 if b["type"] == "HQ" else 2)
    return vis


def visible_enemies(game, side):
    vis = vision(game, side)
    return [u for u in game["units"] if u["side"] != side and (u["x"], u["y"]) in vis]


def attack_options(game, unit, enemies):
    out = []
    for e in enemies:
        if e["side"] == unit["side"]:
            continue
        if not in_rng(unit["type"], manu(unit, e)):
            continue
        if attack_base(unit["type"], e["type"]) <= 0:
            continue
        out.append(e)
    return out


# ======================================================================
# combat
# ======================================================================
def emit_combat(game, events, pv, a0, d0, a_hp1, d_hp1, dmg, counter, dk, ak):
    def seen(s):
        return s["side"] == "P" or (s["x"], s["y"]) in pv

    a_seen, d_seen = seen(a0), seen(d0)
    if not (a_seen or d_seen):
        return
    entries = []
    an, dn = uname(a0), uname(d0)
    ind = UNITS[a0["type"]]["indirect"]
    al, dl = label(a0["x"], a0["y"]), label(d0["x"], d0["y"])
    tone = "good" if a0["side"] == "P" else "bad"
    if a_seen:
        txt = f"{an} ({al}) {'shelled' if ind else 'hit'} {dn} ({dl}): -{dmg} HP ({d0['hp']}→{d_hp1})"
        if counter:
            txt += f" · counter -{counter} ({a0['hp']}→{a_hp1})"
    else:
        txt = f"{dn} ({dl}) hit by unseen enemy fire: -{dmg} HP ({d0['hp']}→{d_hp1})"
    entries.append(glog(game, "combat", tone, txt, d0["x"], d0["y"]))
    if dk:
        by = f"{an} (from {al})" if a_seen else "unseen enemy fire"
        entries.append(glog(game, "kill", "good" if d0["side"] == "A" else "bad",
                            f"✖ {dn} destroyed at {dl} by {by}.", d0["x"], d0["y"]))
    if ak:
        entries.append(glog(game, "kill", "good" if a0["side"] == "A" else "bad",
                            f"✖ {an} destroyed at {al} by counter-fire from {dn} ({dl}).",
                            a0["x"], a0["y"]))
    events.append({"t": "combat", "a": a0 if a_seen else None, "d": d0,
                   "a_hp1": a_hp1, "d_hp1": d_hp1, "dmg": dmg, "counter": counter,
                   "dk": dk, "ak": ak, "ind": ind, "log": entries})


def resolve_attack(game, att, dfn, events):
    pv = vision(game, "P")
    a0, d0 = snap(att), snap(dfn)
    dmg = calc_damage(game, att, dfn)
    eff = min(dmg, dfn["hp"])
    dfn["hp"] -= eff
    d_killed = dfn["hp"] <= 0
    counter, a_killed = 0, False
    if not d_killed:
        counter = counter_calc(game, dfn["type"], dfn["hp"], att["type"],
                               att["x"], att["y"], manu(att, dfn))
        counter = min(counter, att["hp"])
        att["hp"] -= counter
        a_killed = att["hp"] <= 0
    st = game["stats"]
    if att["side"] == "P":
        st["dealt"] += eff
        st["taken"] += counter
        st["kills"] += int(d_killed)
        st["losses"] += int(a_killed)
    else:
        st["taken"] += eff
        st["dealt"] += counter
        st["losses"] += int(d_killed)
        st["kills"] += int(a_killed)
    a_hp1, d_hp1 = att["hp"], dfn["hp"]
    if d_killed:
        game["units"] = [u for u in game["units"] if u["id"] != dfn["id"]]
    if a_killed:
        game["units"] = [u for u in game["units"] if u["id"] != att["id"]]
    att["moved"] = att["acted"] = True
    emit_combat(game, events, pv, a0, d0, a_hp1, d_hp1, eff, counter, d_killed, a_killed)
    check_annihilation(game)
    return d_killed


def maybe_capture(game, unit, events):
    if not UNITS[unit["type"]]["capture"]:
        return
    b = building_at(game, unit["x"], unit["y"])
    if not b or b["side"] == unit["side"]:
        return
    prev = b["side"]
    pv = vision(game, "P")
    nm = uname(unit)
    if b["type"] == "HQ":
        if unit["side"] == "P":
            game["result"] = {"winner": "P", "reason": "Enemy HQ captured"}
            tone, txt = "good", f"⚑ {nm} captured the enemy HQ at {label(b['x'], b['y'])}. Operation complete."
        else:
            game["result"] = {"winner": "A", "reason": "Your HQ was captured"}
            tone, txt = "bad", f"⚑ {nm} captured our HQ at {label(b['x'], b['y'])}!"
        events.append({"t": "win", "side": unit["side"], "x": b["x"], "y": b["y"],
                       "log": [glog(game, "capture", tone, txt, b["x"], b["y"])]})
        return
    b["side"] = unit["side"]
    bn = bname(b).lower()
    if unit["side"] == "P":
        txt, tone = f"⚑ {nm} captured a {bn} at {label(b['x'], b['y'])}.", "good"
    elif prev == "P":
        txt, tone = f"⚑ {nm} captured our {bn} at {label(b['x'], b['y'])}!", "bad"
    elif (b["x"], b["y"]) in pv:
        txt, tone = f"⚑ {nm} captured a neutral {bn} at {label(b['x'], b['y'])}.", "bad"
    else:
        return
    events.append({"t": "capture", "x": b["x"], "y": b["y"], "side": unit["side"],
                   "btype": b["type"], "level": b.get("level", 1),
                   "log": [glog(game, "capture", tone, txt, b["x"], b["y"])]})


def check_annihilation(game):
    if game["result"]:
        return
    p = any(u["side"] == "P" for u in game["units"])
    a = any(u["side"] == "A" for u in game["units"])
    if not a:
        game["result"] = {"winner": "P", "reason": "Enemy forces destroyed"}
    elif not p:
        game["result"] = {"winner": "A", "reason": "Your forces were destroyed"}


# ======================================================================
# turn structure & healing
# ======================================================================
def heal_units(game, side, events):
    for u in game["units"]:
        if u["side"] != side:
            continue
        t = UNITS[u["type"]]
        b = building_at(game, u["x"], u["y"])
        if not b or b["side"] != side or u["hp"] >= t["hp"]:
            continue
        if t["cls"] == "air" and b["type"] == "city":
            continue                      # no airstrip in a city
        per = max(1, round(t["cost"] / t["hp"] * REPAIR_RATE))
        amt = min(heal_amount(b), t["hp"] - u["hp"], game["credits"][side] // per)
        if amt <= 0:
            if side == "P":
                events.append({"t": "note", "log": [glog(
                    game, "repair", "bad",
                    f"✚ {uname(u)} could not be repaired at {label(u['x'], u['y'])}: not enough credits.",
                    u["x"], u["y"])]})
            continue
        hp0 = u["hp"]
        u["hp"] += amt
        game["credits"][side] -= amt * per
        if side == "P":
            game["stats"]["repaired"] += amt
            events.append({"t": "heal", "id": u["id"], "x": u["x"], "y": u["y"], "amt": amt,
                           "hp": u["hp"],
                           "log": [glog(game, "repair", "good",
                                        f"✚ {uname(u)} repaired +{amt} HP at {bname(b)} "
                                        f"({label(u['x'], u['y'])}): {hp0}→{u['hp']}, -{amt * per} cr.",
                                        u["x"], u["y"])]})


def begin_turn(game, side, events=None):
    events = events if events is not None else []
    inc = income_of(game, side)
    game["credits"][side] += inc
    for u in game["units"]:
        if u["side"] == side:
            u["moved"] = u["acted"] = False
    heal_units(game, side, events)
    if side == "P":
        glog(game, "system", "info", f"Turn {game['turn']} begins. Income +{inc} cr "
                                      f"(credits: {game['credits']['P']}).")
    return events


def new_game(level="normal"):
    if level not in AI_LEVELS:
        level = "normal"
    game = {"v": SAVE_VERSION, "id": uuid.uuid4().hex[:10], "turn": 1, "ai_level": level,
            "credits": {"P": START_CREDITS, "A": START_CREDITS}, "buildings": building_defs(),
            "units": [], "next_uid": 1, "result": None, "log": [], "log_seq": 1,
            "stats": {"kills": 0, "losses": 0, "dealt": 0, "taken": 0, "repaired": 0},
            "ai_mem": {}, "p_seen": [], "p_known_b": {}, "record_saved": False,
            "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    start = [("inf", "P", 2, 7), ("ifv", "P", 3, 8), ("mbt", "P", 3, 6),
             ("inf", "A", 11, 2), ("ifv", "A", 10, 1), ("mbt", "A", 10, 3)]
    for t, s, x, y in start:
        game["units"].append({"id": game["next_uid"], "type": t, "side": s, "x": x, "y": y,
                              "hp": UNITS[t]["hp"], "moved": False, "acted": False})
        game["next_uid"] += 1
    for b in game["buildings"]:
        game["p_known_b"][f"{b['x']},{b['y']}"] = dict(b)
    glog(game, "system", "info",
         f"Operation begins ({level}). Capture income, repair at cities, take their HQ.")
    glog(game, "system", "info", f"Turn 1 begins. Credits: {START_CREDITS}.")
    return game


def update_known_buildings(game, visk):
    pk = game["p_known_b"]
    for b in game["buildings"]:
        k = f"{b['x']},{b['y']}"
        if b["side"] == "P" or k in visk or pk.get(k, {}).get("side") == "P":
            pk[k] = {"type": b["type"], "x": b["x"], "y": b["y"],
                     "side": b["side"], "level": b.get("level", 1)}


def public_state(game):
    vis = vision(game, "P")
    visk = {f"{x},{y}" for x, y in vis}
    seen = set(game["p_seen"]) | visk
    game["p_seen"] = sorted(seen)
    update_known_buildings(game, visk)
    units = []
    for u in game["units"]:
        if u["side"] == "P" or (u["x"], u["y"]) in vis:
            d = {k: u[k] for k in ("id", "type", "side", "x", "y", "hp", "moved", "acted")}
            d["mhp"] = UNITS[u["type"]]["hp"]
            units.append(d)
    blds = []
    for k, b in sorted(game["p_known_b"].items()):
        d = dict(b)
        d["visible"] = k in visk
        blds.append(d)
    res = game["result"]
    return {"turn": game["turn"], "over": bool(res), "result": res,
            "credits": game["credits"]["P"], "income": income_of(game, "P"),
            "units": units, "buildings": blds, "visible": sorted(visk),
            "seen": game["p_seen"], "unit_cap": UNIT_CAP, "level": game["ai_level"],
            "log": game["log"][-250:], "stats": game["stats"],
            "can_record": bool(res and res["winner"] == "P" and not game["record_saved"]),
            "id": game["id"]}


# ======================================================================
# AI
# ======================================================================
def ai_cfg(game):
    return AI_LEVELS[game.get("ai_level", "normal")]


def ai_update_memory(game, cfg):
    vis = vision(game, "A")
    mem = game["ai_mem"]
    for u in game["units"]:
        if u["side"] == "P" and (u["x"], u["y"]) in vis:
            mem[str(u["id"])] = {"x": u["x"], "y": u["y"], "type": u["type"],
                                 "hp": u["hp"], "turn": game["turn"]}
    for sid in list(mem):
        m = mem[sid]
        u = get_unit(game, int(sid))
        stale = game["turn"] - m["turn"] > cfg["memory"]
        if u is None or stale or ((m["x"], m["y"]) in vis and (u["x"], u["y"]) != (m["x"], m["y"])):
            del mem[sid]


_ring_cache = {}


def ring(cx, cy, rmin, rmax):
    k = (cx, cy, rmin, rmax)
    r = _ring_cache.get(k)
    if r is None:
        r = [(x, y) for x in range(W) for y in range(H) if rmin <= man(cx, cy, x, y) <= rmax]
        _ring_cache[k] = r
    return r


def build_threat(game, known):
    tm = {}
    for e in known:
        t = UNITS[e["type"]]
        w = 0.6 if e.get("ghost") else 1.0
        tiles = set()
        if t["indirect"]:
            tiles.update(ring(e["x"], e["y"], t["rng"][0], t["rng"][1]))
        else:
            dist, _ = dijkstra(game, t["cls"], e["x"], e["y"], t["move"])
            for (x, y) in dist:
                tiles.update(ring(x, y, t["rng"][0], t["rng"][1]))
        for tile in tiles:
            tm.setdefault(tile, []).append((e, w))
    return tm


def power(u, w=1.0):
    t = UNITS[u["type"]]
    return t["cost"] * u["hp"] / t["hp"] * w


def ai_posture(game, cfg, a_units, known, hq):
    if not cfg["tactics"] or game["turn"] > 30:
        return "advance"
    en_pow = sum(power(e, 0.7 if e.get("ghost") else 1.0) for e in known)
    if en_pow <= 0:
        return "advance"
    ratio = sum(power(u) for u in a_units) / en_pow
    if ratio >= cfg["press"]:
        return "advance"
    if ratio >= cfg["withdraw"]:
        return "probe"
    local_en = sum(power(e) for e in known if man(e["x"], e["y"], hq[0], hq[1]) <= 7)
    local_ai = sum(power(u) for u in a_units if man(u["x"], u["y"], hq[0], hq[1]) <= 8)
    if local_en > 0 and local_ai / local_en >= 1.25:
        return "counter"
    return "withdraw"


def ai_build_ctx(game, cfg):
    vis_a = vision(game, "A")
    real = [u for u in game["units"] if u["side"] == "P" and (u["x"], u["y"]) in vis_a]
    real_ids = {u["id"] for u in real}
    known = list(real)
    for sid, m in game["ai_mem"].items():
        uid = int(sid)
        if uid in real_ids or get_unit(game, uid) is None:
            continue
        known.append({"id": uid, "type": m["type"], "side": "P", "x": m["x"], "y": m["y"],
                      "hp": m["hp"], "ghost": True})
    a_units = [u for u in game["units"] if u["side"] == "A"]
    hqb = next((b for b in game["buildings"] if b["type"] == "HQ" and b["side"] == "A"), None)
    hq = (hqb["x"], hqb["y"]) if hqb else (11, 1)
    ehq = next((b for b in game["buildings"] if b["type"] == "HQ" and b["side"] == "P"), None)
    ehq = (ehq["x"], ehq["y"]) if ehq else (2, 8)
    pvis = set()
    for e in known:
        r = UNITS[e["type"]]["vis"]
        for dx in range(-r, r + 1):
            rem = r - abs(dx)
            for dy in range(-rem, rem + 1):
                x, y = e["x"] + dx, e["y"] + dy
                if in_bounds(x, y):
                    pvis.add((x, y))
    threats = [e for e in real if man(e["x"], e["y"], hq[0], hq[1]) <= 5]
    hq_threat = min(threats, key=lambda e: man(e["x"], e["y"], hq[0], hq[1])) if threats else None
    posture = ai_posture(game, cfg, a_units, known, hq)
    ctx = {"vis": real, "known": known, "hq": hq, "ehq": ehq, "pvis": pvis,
           "posture": posture, "hq_threat": hq_threat, "dead": set(), "dm": {},
           "block": {(e["x"], e["y"]) for e in real}, "bait": None,
           "threat": build_threat(game, known)}
    if cfg["bait"] and posture == "withdraw":
        cands = [u for u in a_units if u["hp"] / UNITS[u["type"]]["hp"] > 0.6
                 and UNITS[u["type"]]["cost"] <= 400 and UNITS[u["type"]]["cls"] != "air"
                 and not UNITS[u["type"]]["indirect"]]
        if cands:
            ctx["bait"] = max(cands, key=lambda u: UNITS[u["type"]]["move"])["id"]
    return ctx


def gdist(game, ctx, cls, tile, goal):
    if cls == "air":
        return man(tile[0], tile[1], goal[0], goal[1])
    key = (cls, goal)
    dm = ctx["dm"].get(key)
    if dm is None:
        dm, _ = dijkstra(game, cls, goal[0], goal[1])
        ctx["dm"][key] = dm
    d = dm.get(tile)
    if d is None:
        d = man(tile[0], tile[1], goal[0], goal[1]) * 2 + 20
    return d


def ai_heal_site(game, ctx, u):
    t = UNITS[u["type"]]
    best = None
    for b in game["buildings"]:
        if b["side"] != "A" or (t["cls"] == "air" and b["type"] == "city"):
            continue
        occ = unit_at(game, b["x"], b["y"])
        if occ is not None and occ["id"] != u["id"]:
            continue
        d = gdist(game, ctx, t["cls"], (u["x"], u["y"]), (b["x"], b["y"]))
        if best is None or d < best[0]:
            best = (d, (b["x"], b["y"]))
    return best[1] if best else None


def ai_goal(game, cfg, ctx, u):
    t = UNITS[u["type"]]
    hr = u["hp"] / t["hp"]
    known = ctx["known"]
    if cfg["retreat"] and hr <= cfg["retreat"]:
        h = ai_heal_site(game, ctx, u)
        if h:
            return {"tile": h, "mode": "heal"}
    if ctx["hq_threat"] is not None and u["type"] != "sam":
        e = ctx["hq_threat"]
        return {"tile": (e["x"], e["y"]), "mode": "attack", "hold": 0}
    post = ctx["posture"]
    is_bait = ctx["bait"] == u["id"]
    if post == "withdraw" and not is_bait:
        return {"tile": ctx["hq"], "mode": "rally", "hold": 3}
    if u["type"] == "sam":
        allies = [a for a in game["units"] if a["side"] == "A" and a["id"] != u["id"]
                  and UNITS[a["type"]]["cls"] != "air" and a["type"] != "sam"]
        if allies:
            def front(a):
                return min((manu(a, e) for e in known), default=man(a["x"], a["y"], *ctx["ehq"]))
            a = min(allies, key=front)
            return {"tile": (a["x"], a["y"]), "mode": "escort", "hold": 2}
        return {"tile": ctx["hq"], "mode": "rally", "hold": 2}
    if t["capture"]:
        targets = [b for b in game["buildings"] if b["side"] != "A" and b["type"] != "HQ"]
        if post in ("advance", "counter") or not targets:
            targets += [b for b in game["buildings"] if b["type"] == "HQ" and b["side"] == "P"]
        if targets:
            b = min(targets, key=lambda b: (b["side"] is not None, man(u["x"], u["y"], b["x"], b["y"])))
            return {"tile": (b["x"], b["y"]), "mode": "capture", "hold": 0}
    if known:
        pool = known
        if u["type"] == "afv":
            soft = [e for e in known if e["type"] in ("mrl", "sam")]
            pool = soft or known
        e = min(pool, key=lambda e: man(u["x"], u["y"], e["x"], e["y"]))
        hold = t["rng"][1] + 1 if t["indirect"] else 0
        return {"tile": (e["x"], e["y"]), "mode": "attack", "hold": hold}
    return {"tile": ctx["ehq"], "mode": "attack", "hold": 0}


def ai_attack_eval(game, cfg, u, dest, e, kb=1.0):
    ut, et = UNITS[u["type"]], UNITS[e["type"]]
    dist = man(e["x"], e["y"], dest[0], dest[1])
    if not in_rng(u["type"], dist):
        return None
    dmg = dmg_calc(game, u["type"], u["hp"], e["type"], e["x"], e["y"])
    if dmg <= 0:
        return None
    eff = min(dmg, e["hp"])
    val = cfg["dmg_w"] * eff / et["hp"] * et["cost"] / 25.0
    kill = eff >= e["hp"]
    if kill:
        val += cfg["kill"] * kb * et["cost"] / 25.0
    else:
        c = counter_calc(game, e["type"], e["hp"] - eff, u["type"], dest[0], dest[1], dist)
        c = min(c, u["hp"])
        val -= cfg["counter_w"] * c / ut["hp"] * ut["cost"] / 25.0
    return val, kill


def ai_danger(game, ctx, u, dest, skip_id=None):
    tot = 0.0
    for e, w in ctx["threat"].get(dest, ()):
        if e["id"] in ctx["dead"] or e["id"] == skip_id:
            continue
        tot += w * dmg_calc(game, e["type"], e["hp"], u["type"], dest[0], dest[1])
    ut = UNITS[u["type"]]
    return min(tot, u["hp"]) / ut["hp"] * ut["cost"] / 25.0


def sector(cx, cy, x, y):
    dx, dy = x - cx, y - cy
    if abs(dx) >= abs(dy):
        return "E" if dx > 0 else "W"
    return "S" if dy > 0 else "N"


STRIKERS = {"afv", "heli", "jet"}
POST_DANGER = {"advance": 0.8, "probe": 1.1, "withdraw": 1.3, "counter": 0.5}


def ai_score_dest(game, cfg, ctx, u, dest, cur, goal, focus, occ_sec):
    t = UNITS[u["type"]]
    hr = u["hp"] / t["hp"]
    post = ctx["posture"]
    s = 0.0
    tgt_val, kill_id = 0.0, None
    if not (not t["move_fire"] and dest != cur):
        kb = 1.3 if post == "counter" else 1.0
        for e in ctx["vis"]:
            if e["id"] in ctx["dead"]:
                continue
            r = ai_attack_eval(game, cfg, u, dest, e, kb)
            if r is not None and r[0] > tgt_val:
                tgt_val = r[0]
                kill_id = e["id"] if r[1] else None
    attacking = tgt_val > 0
    s += tgt_val
    if t["cls"] != "air":
        s += (1 - tile_def(game, dest[0], dest[1])) * cfg["terrain_w"]
    b = building_at(game, dest[0], dest[1])
    if b:
        if b["side"] != "A" and t["capture"]:
            s += 1000.0 if b["type"] == "HQ" else 45.0
        elif b["side"] == "A":
            can_heal = not (t["cls"] == "air" and b["type"] == "city")
            if hr < 1 and can_heal:
                s += (1 - hr) * (18 if hr <= cfg["retreat"] else 4)
            elif hr >= 0.99 and b["type"] in ("HQ", "factory") and dest != cur:
                s -= 3.0                      # don't clog production tiles
    pm = POST_DANGER[post] * (1.6 if hr <= cfg["retreat"] else 1.0)
    s -= cfg["danger_w"] * pm * ai_danger(game, ctx, u, dest, kill_id)
    is_bait = ctx["bait"] == u["id"]
    if goal:
        g = goal["tile"]
        hold = goal.get("hold", 0)
        dc = gdist(game, ctx, t["cls"], cur, g)
        dd = gdist(game, ctx, t["cls"], dest, g)
        prog = max(dc - hold, 0) - max(dd - hold, 0)
        w = cfg["goal_w"] * (1.5 if goal["mode"] in ("heal", "capture") else 1.0)
        if post == "probe" and goal["mode"] == "attack":
            w *= 0.6
        s += prog * w
    if cfg["stealth"] and not attacking and dest in ctx["pvis"]:
        if is_bait:
            if man(dest[0], dest[1], *ctx["hq"]) <= 7:
                s += 6.0
        else:
            s -= cfg["stealth"] * (0.5 if post == "advance" else 1.0)
    if cfg["stealth"] and not attacking and u["type"] in STRIKERS and post != "counter" \
            and dest not in ctx["pvis"]:
        reach = t["move"] + t["rng"][1] + 1
        if any(UNITS[e["type"]]["cost"] >= 250 and man(dest[0], dest[1], e["x"], e["y"]) <= reach
               for e in ctx["known"]):
            s += cfg["stealth"] * 1.2          # lurk in the fog, strike from out of sight
    if cfg["flank"] and focus is not None and dest != (focus["x"], focus["y"]) \
            and man(dest[0], dest[1], focus["x"], focus["y"]) <= 3:
        if sector(focus["x"], focus["y"], dest[0], dest[1]) not in occ_sec:
            s += cfg["flank"]
    if t["indirect"] and not attacking:
        lo, hi = t["rng"]
        if any(lo <= man(dest[0], dest[1], e["x"], e["y"]) <= hi + 1 for e in ctx["known"]):
            s += 6.0                           # set up so next turn's volley is ready
    if cfg["tactics"]:
        s += 0.4 * sum(1 for a in game["units"] if a["side"] == "A" and a["id"] != u["id"]
                       and man(a["x"], a["y"], dest[0], dest[1]) <= 2)
    return s


def ai_move(game, unit, dest, par, events):
    start = (unit["x"], unit["y"])
    final, amb = walk(game, unit, path_to(par, start, dest))
    pv = vision(game, "P")
    unit["x"], unit["y"] = final
    unit["moved"] = True
    from_vis, to_vis = start in pv, final in pv
    if from_vis or to_vis:
        ev = {"t": "move", "u": snap(unit), "from": list(start), "to": list(final),
              "from_vis": from_vis, "to_vis": to_vis}
        if to_vis and not from_vis:
            ev["log"] = [glog(game, "contact", "bad",
                              f"◉ Contact: {uname(unit)} spotted at {label(*final)}.", *final)]
        events.append(ev)
    if amb is not None and amb["side"] == "P":
        events.append({"t": "ambush", "x": amb["x"], "y": amb["y"], "log": [glog(
            game, "contact", "good",
            f"◉ {uname(unit)} blundered into {uname(amb)} at {label(amb['x'], amb['y'])} and halted.",
            amb["x"], amb["y"])]})
    maybe_capture(game, unit, events)


def ai_act_unit(game, unit, cfg, ctx, events):
    t = UNITS[unit["type"]]
    cur = (unit["x"], unit["y"])
    dests, par = move_dest(game, unit, ctx["block"])
    options = [cur] + list(dests)
    if cfg["rand"] and random.random() < cfg["rand"]:
        dest = random.choice(options)
    else:
        goal = ai_goal(game, cfg, ctx, unit)
        focus, occ_sec = None, set()
        if cfg["flank"] and ctx["vis"]:
            near = min(ctx["vis"], key=lambda e: manu(unit, e))
            if manu(unit, near) <= 8:
                focus = near
                occ_sec = {sector(near["x"], near["y"], a["x"], a["y"]) for a in game["units"]
                           if a["side"] == "A" and a["id"] != unit["id"]
                           and manu(a, near) <= 3 and manu(a, near) > 0}
        best = None
        for d in options:
            sc = ai_score_dest(game, cfg, ctx, unit, d, cur, goal, focus, occ_sec)
            if best is None or sc > best[0]:
                best = (sc, d)
        dest = best[1]
    if dest != cur:
        ai_move(game, unit, dest, par, events)
        if game["result"] or get_unit(game, unit["id"]) is None:
            return
    if not t["move_fire"] and unit["moved"]:
        unit["acted"] = True
        return
    vis_now = visible_enemies(game, "A")
    opts = attack_options(game, unit, vis_now)
    best = None
    kb = 1.3 if ctx["posture"] == "counter" else 1.0
    for e in opts:
        r = ai_attack_eval(game, cfg, unit, (unit["x"], unit["y"]), e, kb)
        if r is not None and (best is None or r[0] > best[0]):
            best = (r[0], e)
    floor = -3.0 if cfg["rand"] else 0.0
    if best and best[0] > floor:
        if resolve_attack(game, unit, best[1], events):
            ctx["dead"].add(best[1]["id"])
    unit["moved"] = unit["acted"] = True


def ai_spawn(game, utype, b):
    game["credits"]["A"] -= UNITS[utype]["cost"]
    game["units"].append({"id": game["next_uid"], "type": utype, "side": "A", "x": b["x"],
                          "y": b["y"], "hp": UNITS[utype]["hp"], "moved": True, "acted": True})
    game["next_uid"] += 1


def ai_build_weights(game, cfg, ctx, a_units, cred, threatened):
    cnt = Counter(u["type"] for u in a_units)
    ek = Counter(e["type"] for e in ctx["known"])
    air = ek["heli"] + ek["jet"]
    armor = ek["mbt"] + ek["afv"] + ek["ifv"]
    w = {"inf": 1.0, "ifv": 1.3, "afv": 0.4 if cnt["afv"] >= 1 else 0.9, "mbt": 1.8,
         "mrl": 1.2 if (cnt["mrl"] < max(1, len(a_units) // 4) and game["turn"] > 2) else 0.1,
         "sam": 0.0, "heli": 0.8 if cnt["mbt"] >= 2 else 0.2,
         "jet": 0.5 if cred > 1500 else 0.0}
    if air:
        w["sam"] = 2.5 if cnt["sam"] <= air else 0.6
        if cfg["counters"]:
            w["jet"] = 2.2 if cnt["jet"] < air else 0.8
    if cfg["counters"]:
        if armor >= 3:
            w["heli"] *= 2.5
            w["mrl"] *= 1.8
        if ek["inf"] >= 4:
            w["ifv"] *= 1.8
            w["mrl"] *= 1.4
        if ek["mrl"]:
            w["afv"] *= 2.2
            w["heli"] *= 1.5
            w["jet"] *= 1.5
    if threatened:
        w["inf"] *= 2.0
        w["ifv"] *= 1.5
        for k in ("mrl", "heli", "jet", "sam"):
            w[k] *= 0.5
    return w


def ai_produce(game, cfg, ctx):
    hq = ctx["hq"]
    threatened = ctx["hq_threat"] is not None
    for _ in range(cfg["max_builds"]):
        a_units = [u for u in game["units"] if u["side"] == "A"]
        if len(a_units) >= UNIT_CAP:
            return
        prod = [b for b in game["buildings"] if b["side"] == "A" and b["type"] in ("HQ", "factory")
                and unit_at(game, b["x"], b["y"]) is None]
        if not prod:
            return
        cred = game["credits"]["A"]
        if cred < cfg["build_gate"]:
            return
        w = ai_build_weights(game, cfg, ctx, a_units, cred, threatened)
        cands = [k for k in ORDER if UNITS[k]["cost"] <= cred and w[k] > 0]
        if not cands:
            return
        if cfg["counters"]:
            pick = max(cands, key=lambda k: w[k] * (1 + 0.15 * random.random()))
        else:
            pick = random.choices(cands, weights=[w[k] for k in cands])[0]
        b = min(prod, key=lambda b: man(b["x"], b["y"], *ctx["ehq"]))
        ai_spawn(game, pick, b)


def ai_found_upgrade(game, cfg, ctx):
    cred = game["credits"]["A"]
    if cfg["upgrades"] and cred >= 1800:
        cand = [b for b in game["buildings"] if b["side"] == "A" and b["type"] in ("HQ", "factory")
                and b.get("level", 1) < MAX_B_LEVEL]
        if cand:
            b = min(cand, key=lambda b: b.get("level", 1))
            cost = upgrade_cost(b["level"])
            if game["credits"]["A"] >= cost + 800:
                game["credits"]["A"] -= cost
                b["level"] += 1
    cred = game["credits"]["A"]
    if cfg["found"] and cred >= FOUND_COST + 700:
        nf = sum(1 for b in game["buildings"] if b["side"] == "A" and b["type"] == "factory")
        if nf >= 3:
            return
        hq = ctx["hq"]
        for u in game["units"]:
            if u["side"] != "A" or not UNITS[u["type"]]["capture"] or u["acted"]:
                continue
            if man(u["x"], u["y"], hq[0], hq[1]) > 5 or TERRAIN[u["y"]][u["x"]] not in FOUND_TERRAIN:
                continue
            if building_at(game, u["x"], u["y"]) is not None:
                continue
            game["credits"]["A"] -= FOUND_COST
            game["buildings"].append({"type": "factory", "x": u["x"], "y": u["y"],
                                      "side": "A", "level": 1})
            u["moved"] = u["acted"] = True
            return


def ai_turn(game):
    events = []
    cfg = ai_cfg(game)
    begin_turn(game, "A", [])
    ai_update_memory(game, cfg)
    ctx = ai_build_ctx(game, cfg)
    ai_found_upgrade(game, cfg, ctx)
    order = sorted([u for u in game["units"] if u["side"] == "A"],
                   key=lambda u: (not UNITS[u["type"]]["indirect"], -UNITS[u["type"]]["cost"]))
    for u in order:
        if game["result"]:
            break
        if get_unit(game, u["id"]) is None:
            continue
        ai_act_unit(game, u, cfg, ctx, events)
    if not game["result"]:
        ai_produce(game, cfg, ctx)
        check_annihilation(game)
    return events


# ======================================================================
# SQLite: saves + hall of fame
# ======================================================================
def db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with closing(db()) as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS saves(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'manual', created TEXT NOT NULL,
            turn INTEGER, level TEXT, credits INTEGER, units INTEGER, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, turns INTEGER NOT NULL,
            units_left INTEGER NOT NULL, kills INTEGER NOT NULL DEFAULT 0,
            level TEXT NOT NULL, date TEXT NOT NULL);
        """)
        empty = c.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 0
        if empty and os.path.exists(LEGACY_RECORDS):
            try:
                with open(LEGACY_RECORDS, "r", encoding="utf-8") as f:
                    for r in json.load(f):
                        c.execute("INSERT INTO records(name,turns,units_left,kills,level,date) "
                                  "VALUES(?,?,?,?,?,?)",
                                  (str(r.get("name", "Anon"))[:12], int(r.get("turns", 99)),
                                   int(r.get("units_left", 0)), 0,
                                   str(r.get("level", "normal")), str(r.get("date", ""))))
            except (OSError, ValueError, TypeError):
                pass
        c.commit()


init_db()


def save_game(game, name, kind="manual"):
    data = json.dumps(game)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    nunits = sum(1 for u in game["units"] if u["side"] == "P")
    with closing(db()) as c:
        if kind == "auto":
            c.execute("DELETE FROM saves WHERE kind='auto'")
        else:
            c.execute("DELETE FROM saves WHERE kind='manual' AND id NOT IN "
                      "(SELECT id FROM saves WHERE kind='manual' ORDER BY id DESC LIMIT 29)")
        cur = c.execute("INSERT INTO saves(name,kind,created,turn,level,credits,units,data) "
                        "VALUES(?,?,?,?,?,?,?,?)",
                        (name, kind, now, game["turn"], game["ai_level"],
                         game["credits"]["P"], nunits, data))
        c.commit()
        return cur.lastrowid


# ======================================================================
# HTTP API
# ======================================================================
def current_game(create=False):
    game = GAMES.get(session.get("gid"))
    if game is None and create:
        game = new_game()
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
    return game


def fail(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


def player_unit(game, uid):
    u = get_unit(game, uid)
    return u if (u and u["side"] == "P") else None


def active_game():
    game = current_game()
    if game is None or game["result"]:
        return None
    return game


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/meta")
def api_meta():
    units = {}
    for k, t in UNITS.items():
        d = dict(t)
        d["rng"] = list(t["rng"])
        d["atk"] = atk_summary(k)
        d["dmg"] = DMG[k]
        units[k] = d
    terrain = {}
    for ch, (nm, ds) in TINFO.items():
        terrain[ch] = {"name": nm, "desc": ds, "def": DEF_MULT[ch],
                       "foot": STEP["foot"][ch], "tread": STEP["tread"][ch], "air": STEP["air"][ch]}
    return jsonify({"ok": True, "units": units, "order": ORDER, "cats": CATEGORIES,
                    "terrain": terrain, "map": TERRAIN, "w": W, "h": H,
                    "income": BASE_INCOME, "heal": HEAL, "repair_rate": REPAIR_RATE,
                    "found_cost": FOUND_COST, "upgrade_base": UPGRADE_BASE,
                    "max_level": MAX_B_LEVEL, "unit_cap": UNIT_CAP,
                    "b_def": B_DEF, "counter": COUNTER_FACTOR,
                    "levels": {k: v["desc"] for k, v in AI_LEVELS.items()}})


@app.route("/api/state")
def api_state():
    with LOCK:
        game = current_game(create=True)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/new", methods=["POST"])
def api_new():
    with LOCK:
        d = request.get_json(force=True, silent=True) or {}
        game = new_game(d.get("level", "normal"))
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/ranges", methods=["POST"])
def api_ranges():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None:
            return fail("not your unit")
        vis_e = visible_enemies(game, "P")
        moves = []
        if not u["moved"]:
            dests, _ = move_dest(game, u, {(e["x"], e["y"]) for e in vis_e})
            moves = [list(c) for c in dests]
        attacks = []
        t = UNITS[u["type"]]
        if not u["acted"] and (not u["moved"] or t["move_fire"]):
            for e in attack_options(game, u, vis_e):
                dmg = min(calc_damage(game, u, e), e["hp"])
                ctr = 0
                if dmg < e["hp"]:
                    ctr = min(counter_calc(game, e["type"], e["hp"] - dmg, u["type"],
                                           u["x"], u["y"], manu(u, e)), u["hp"])
                attacks.append({"id": e["id"], "dmg": dmg, "counter": ctr, "kill": dmg >= e["hp"]})
        return jsonify({"ok": True, "moves": moves, "attacks": attacks})


@app.route("/api/move", methods=["POST"])
def api_move():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        d = request.get_json(force=True, silent=True) or {}
        u = player_unit(game, d.get("unit"))
        try:
            x, y = int(d.get("x", -1)), int(d.get("y", -1))
        except (TypeError, ValueError):
            return fail("bad destination")
        if u is None:
            return fail("not your unit")
        if u["moved"]:
            return fail("unit already moved")
        vis_e = visible_enemies(game, "P")
        dests, par = move_dest(game, u, {(e["x"], e["y"]) for e in vis_e})
        if (x, y) not in dests:
            return fail("illegal destination")
        start = (u["x"], u["y"])
        final, amb = walk(game, u, path_to(par, start, (x, y)))
        u["x"], u["y"] = final
        u["moved"] = True
        if not UNITS[u["type"]]["move_fire"]:
            u["acted"] = True
        events = []
        if final != start:
            events.append({"t": "move", "u": snap(u), "from": list(start), "to": list(final),
                           "from_vis": True, "to_vis": True})
            glog(game, "move", "info",
                 f"{uname(u)} moved {label(*start)} → {label(*final)}.", *final)
        if amb is not None:
            events.append({"t": "ambush", "x": amb["x"], "y": amb["y"], "log": [glog(
                game, "contact", "bad",
                f"◉ AMBUSH! {uname(u)} halted at {label(*final)} by an unseen enemy at "
                f"{label(amb['x'], amb['y'])}.", amb["x"], amb["y"])]})
        maybe_capture(game, u, events)
        check_annihilation(game)
        return jsonify({"ok": True, "state": public_state(game), "events": events})


@app.route("/api/attack", methods=["POST"])
def api_attack():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        d = request.get_json(force=True, silent=True) or {}
        att = player_unit(game, d.get("attacker"))
        dfn = get_unit(game, d.get("target"))
        if att is None or att["acted"]:
            return fail("cannot attack")
        if att["moved"] and not UNITS[att["type"]]["move_fire"]:
            return fail("this unit cannot move and fire")
        if dfn is None or dfn["side"] != "A":
            return fail("invalid target")
        if dfn not in attack_options(game, att, visible_enemies(game, "P")):
            return fail("target out of range or cannot be hit by this unit")
        events = []
        resolve_attack(game, att, dfn, events)
        return jsonify({"ok": True, "state": public_state(game), "events": events})


@app.route("/api/wait", methods=["POST"])
def api_wait():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None:
            return fail("not your unit")
        u["moved"] = u["acted"] = True
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/build", methods=["POST"])
def api_build():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        d = request.get_json(force=True, silent=True) or {}
        try:
            x, y = int(d.get("x", -1)), int(d.get("y", -1))
        except (TypeError, ValueError):
            return fail("bad tile")
        utype = d.get("type")
        b = building_at(game, x, y)
        if b is None or b["side"] != "P" or b["type"] not in ("HQ", "factory"):
            return fail("cannot build here")
        if unit_at(game, x, y) is not None:
            return fail("tile occupied")
        if utype not in UNITS:
            return fail("unknown unit")
        if sum(1 for u in game["units"] if u["side"] == "P") >= UNIT_CAP:
            return fail("unit cap reached")
        cost = UNITS[utype]["cost"]
        if game["credits"]["P"] < cost:
            return fail("not enough credits")
        game["credits"]["P"] -= cost
        nu = {"id": game["next_uid"], "type": utype, "side": "P", "x": x, "y": y,
              "hp": UNITS[utype]["hp"], "moved": True, "acted": True}
        game["units"].append(nu)
        game["next_uid"] += 1
        glog(game, "build", "info", f"⚙ Produced {uname(nu)} at {bname(b)} ({label(x, y)}), -{cost} cr.", x, y)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/upgrade", methods=["POST"])
def api_upgrade():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        d = request.get_json(force=True, silent=True) or {}
        try:
            b = building_at(game, int(d.get("x", -1)), int(d.get("y", -1)))
        except (TypeError, ValueError):
            return fail("bad tile")
        if b is None or b["side"] != "P":
            return fail("not your building")
        lvl = b.get("level", 1)
        if lvl >= MAX_B_LEVEL:
            return fail("already at max level")
        cost = upgrade_cost(lvl)
        if game["credits"]["P"] < cost:
            return fail("not enough credits")
        game["credits"]["P"] -= cost
        b["level"] = lvl + 1
        glog(game, "build", "info", f"⚙ Upgraded {bname(b)} at {label(b['x'], b['y'])} to L{b['level']}, -{cost} cr.",
             b["x"], b["y"])
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/found", methods=["POST"])
def api_found():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None or not UNITS[u["type"]]["capture"]:
            return fail("only infantry and IFVs can found a factory")
        if u["acted"]:
            return fail("unit already acted")
        if TERRAIN[u["y"]][u["x"]] not in FOUND_TERRAIN:
            return fail("needs open ground (plains or road)")
        if building_at(game, u["x"], u["y"]) is not None:
            return fail("site occupied")
        if game["credits"]["P"] < FOUND_COST:
            return fail(f"not enough credits ({FOUND_COST} needed)")
        game["credits"]["P"] -= FOUND_COST
        game["buildings"].append({"type": "factory", "x": u["x"], "y": u["y"], "side": "P", "level": 1})
        u["moved"] = u["acted"] = True
        glog(game, "build", "info", f"⚙ {uname(u)} founded a factory at {label(u['x'], u['y'])}, -{FOUND_COST} cr.",
             u["x"], u["y"])
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/end_turn", methods=["POST"])
def api_end_turn():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        d = request.get_json(force=True, silent=True) or {}
        glog(game, "system", "info", f"— Turn {game['turn']} ended. Enemy phase. —")
        pre = public_state(game)
        events = ai_turn(game)
        if not game["result"]:
            game["turn"] += 1
            begin_turn(game, "P", events)
            if d.get("autosave"):
                save_game(game, f"Autosave T{game['turn']}", "auto")
        return jsonify({"ok": True, "state": pre, "final": public_state(game), "events": events})


# ---------------- saves ----------------
@app.route("/api/saves")
def api_saves():
    with closing(db()) as c:
        rows = c.execute("SELECT id,name,kind,created,turn,level,credits,units FROM saves "
                         "ORDER BY id DESC").fetchall()
    return jsonify({"ok": True, "saves": [dict(r) for r in rows]})


@app.route("/api/saves", methods=["POST"])
def api_save_create():
    with LOCK:
        game = current_game()
        if game is None:
            return fail("no game to save")
        d = request.get_json(force=True, silent=True) or {}
        name = str(d.get("name", "")).strip()[:40] or f"Turn {game['turn']} ({game['ai_level']})"
        sid = save_game(game, name)
        return jsonify({"ok": True, "id": sid})


@app.route("/api/saves/<int:sid>/load", methods=["POST"])
def api_save_load(sid):
    with LOCK:
        with closing(db()) as c:
            row = c.execute("SELECT data FROM saves WHERE id=?", (sid,)).fetchone()
        if row is None:
            return fail("save not found", 404)
        try:
            game = json.loads(row["data"])
            if game.get("v") != SAVE_VERSION:
                return fail("save is from an incompatible version")
            game["id"] = uuid.uuid4().hex[:10]
        except (ValueError, TypeError):
            return fail("save is corrupt")
        if game.get("result"):
            game["record_saved"] = True       # finished games can't be re-submitted to the Hall of Fame
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/saves/<int:sid>", methods=["DELETE"])
def api_save_delete(sid):
    with closing(db()) as c:
        c.execute("DELETE FROM saves WHERE id=?", (sid,))
        c.commit()
    return jsonify({"ok": True})


# ---------------- hall of fame ----------------
def load_records():
    with closing(db()) as c:
        rows = c.execute("SELECT name,turns,units_left,kills,level,date FROM records "
                         "ORDER BY turns ASC, units_left DESC, kills DESC, id ASC LIMIT 15").fetchall()
    return [dict(r) for r in rows]


@app.route("/api/records")
def api_records():
    return jsonify({"ok": True, "records": load_records()})


@app.route("/api/records", methods=["POST"])
def api_add_record():
    """Records are built from the server-side game, never from client-supplied numbers."""
    with LOCK:
        game = current_game()
        res = game["result"] if game else None
        if not res or res["winner"] != "P":
            return fail("no victory to record")
        if game["record_saved"]:
            return fail("this victory is already recorded")
        d = request.get_json(force=True, silent=True) or {}
        name = str(d.get("name", "Anon")).strip()[:12] or "Anon"
        left = sum(1 for u in game["units"] if u["side"] == "P")
        with closing(db()) as c:
            c.execute("INSERT INTO records(name,turns,units_left,kills,level,date) VALUES(?,?,?,?,?,?)",
                      (name, game["turn"], left, game["stats"]["kills"], game["ai_level"],
                       time.strftime("%Y-%m-%d")))
            c.commit()
        game["record_saved"] = True
        return jsonify({"ok": True, "records": load_records()})


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")