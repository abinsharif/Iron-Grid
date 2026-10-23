"""
IRON GRID V4 - turn-based tactics, server-authoritative.

Flask owns the state, validates every move, runs the (fog-bound, non-cheating)
AI, and persists saves, accounts, ranks and the Hall of Fame in SQLite (irongrid.db).

V4 additions:
  * Six AI doctrines in fixed order: beginner, easy, normal, medium, hard, extreme.
  * Accounts (register/login, hashed passwords) in the same irongrid.db.
  * Rank 0..1000 per player: 0-99 Beginner, 100-199 INF ... 800-899 FTR,
    900-999 Legend, 1000 Iron Marshal. Ranks move with every result vs AI or players.
  * LAN lobby page (/lobby): play vs AI, challenge other players on the network.
  * Hall of Fame: one best verified win per AI level, across all players.

Run:  pip install flask  &&  python app.py  ->  serves on 0.0.0.0:5000 (LAN visible)
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
from functools import wraps
from typing import TypedDict, cast

from flask import Flask, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from gamedata import *
from helpers import *
from tiers import tier1, tier2, tier3, tier4, tier5, tier6

app = Flask(__name__)
app.secret_key = os.environ.get("IRON_GRID_SECRET_KEY") or secrets.token_hex(32)
LOCK = threading.RLock()
GAMES = {}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "irongrid.db")
LEGACY_RECORDS = os.path.join(BASE_DIR, "records.json")
SAVE_VERSION = 4
APP_VERSION = "4.3.1"

# ========================================================================
# map & terrain
# ========================================================================
W, H = 14, 10
assert len(TERRAIN) == H and all(len(r) == W for r in TERRAIN)

# buildings introduced per tier - a match only spawns the ones its tier supports
# 12 selectable battlefields (all 180-degree symmetric, bases connected).
# ---------------------------------------------------------------------
# Tiers: selectable rulesets on one account. Tier 1 = Skirmish (4 units,
# no roads/swamp); Tier 2 = Combined Arms (the full 8-unit ruleset).
# ---------------------------------------------------------------------
          # tier 1: no roads, no swamp


def tier_terrain(tier, rows):
    """Delegates to the tier rule modules: tier 1 strips roads/swamp, tier 3+ adds urban districts."""
    out = tier1.terrain(rows) if tier == 1 else list(rows)
    if tier >= 3:
        out = tier3.urban(out)
    return out


def force_tile(game, x, y, c):
    row = list(game["ter"][y])
    row[x] = c
    game["ter"][y] = "".join(row)

# movement cost per tile entered. >=90 means impassable.
# ========================================================================
# economy
# ========================================================================
   # (+1 per building level above 1)
REPAIR_RATE = 0.6                               # credits per HP = unit_cost / unit_hp * REPAIR_RATE
MAX_B_LEVEL = 3
UPGRADE_BASE = 500
FOUND_COST = 1500
UNIT_CAP = 99
COUNTER_FACTOR = 0.75
FOUND_TERRAIN = {".", "="}
START_CREDITS = 600
CREDITS_BY_SIZE = {10: 600, 16: 1650, 18: 2200, 20: 2750}


def upgrade_cost(lvl):
    return UPGRADE_BASE * lvl


# ========================================================================
# units: 4 categories x 2 units
# ========================================================================
class UnitDef(TypedDict):
    name: str
    full: str
    code: str
    cat: str
    cls: str
    hp: int
    move: int
    cost: int
    rng: tuple[int, int]
    vis: int
    capture: bool
    indirect: bool
    move_fire: bool
    desc: str
    sites: tuple[str, ...]



# Base damage by target class; IFVs are armored, not soft targets.
def atk_summary(tp):
    return ATTACK[tp]


# Per-unit entries are generated from the four target classes for API clients.
DMG = {a: {d: attack_base(a, d) for d in UNITS} for a in UNITS}
assert set(TIERS[max(TIER_ORDER)]["units"]) == set(ORDER)


# ========================================================================
# AI levels - none of them gets income bonuses or free units.
# Fixed display order (easy -> hard); a dict is used so configs stay keyed.
# ========================================================================
# Legacy names from the old 8-level ladder map onto the 10-level ladder.
def building_defs(tier=2):
    blds = [
        {"type": "HQ",      "x": 11, "y": 1, "side": "A", "level": 1},
        {"type": "factory", "x": 11, "y": 3, "side": "A", "level": 1},
        {"type": "city",    "x": 10, "y": 2, "side": "A", "level": 1},
        {"type": "HQ",      "x": 2,  "y": 8, "side": "P", "level": 1},
        {"type": "factory", "x": 2,  "y": 6, "side": "P", "level": 1},
        {"type": "city",    "x": 3,  "y": 7, "side": "P", "level": 1},
        {"type": "city",    "x": 5,  "y": 4, "side": None, "level": 1},
        {"type": "city",    "x": 8,  "y": 5, "side": None, "level": 1},
    ]
    if tier >= 2:
        blds += [
            {"type": "barracks", "x": 12, "y": 2, "side": "A", "level": 1},
            {"type": "barracks", "x": 1,  "y": 7, "side": "P", "level": 1},
        ]
    return blds


# ========================================================================
# helpers
# ========================================================================


def dmg_calc(game, atype, ahp, dtype, dx, dy, scale=1.0, abonus=0, dtaken=1.0):
    base = attack_base(atype, dtype)
    if base <= 0:
        return 0
    m = 1.0 if UNITS[dtype]["cls"] == "air" else tile_def(game, dx, dy)
    m *= dtaken
    return max(1, int(base * ahp / UNITS[atype]["hp"] * m * scale + 0.5) + abonus)


def counter_calc(game, dfn, att):
    """Damage the defender (after taking the hit) deals back to the attacker."""
    if dfn["hp"] <= 0 or UNITS[dfn["type"]]["indirect"] or not in_rng(dfn["type"], manu(dfn, att)):
        return 0
    return dmg_calc(game, dfn["type"], dfn["hp"], att["type"], att["x"], att["y"],
                    scale=COUNTER_FACTOR)


def calc_damage(game, att, dfn):
    ab = 0
    if doctrine_of(game, att["side"]) == "fire" and UNITS[att["type"]]["indirect"]:
        ab += 1
    dt = 1.0
    if doctrine_of(game, dfn["side"]) == "territ":
        b = building_at(game, dfn["x"], dfn["y"])
        if b is not None and b["side"] == dfn["side"]:
            dt *= 0.9
    return dmg_calc(game, att["type"], att["hp"], dfn["type"], dfn["x"], dfn["y"],
                    abonus=ab, dtaken=dt)


# ---------------- log ----------------
def glog(game, cat, tone, text, x=None, y=None, aud="both", gate=True):
    """Write a log entry into each side's own logbook.

    text may be a str or a callable(side) -> str (return None to skip that side).
    aud="both"  : every side, but only if position (x, y) is inside that side's fog vision.
    aud=<side>  : private entry for that side only (own builds, repairs, income), no fog gate.
    gate=False  : bypass the fog gate (game-over news everyone must see).
    Returns {side: [entries]}.
    """
    vis_at = None
    out = {}
    for S in ("P", "A"):
        if aud != "both" and aud != S:
            continue
        if x is not None and gate and aud == "both":
            if vis_at is None:
                vis_at = {sd: ((x, y) in vision(game, sd)) for sd in ("P", "A")}
            if not vis_at[S]:
                continue
        t = text(S) if callable(text) else text
        if t is None:
            continue
        e = {"i": game["log_seq"], "turn": game["turn"], "cat": cat, "tone": tone,
             "text": t, "pos": [x, y] if x is not None else None}
        game["log_seq"] += 1
        game["log"][S].append(e)
        out.setdefault(S, []).append(e)
        if len(game["log"][S]) > 400:
            del game["log"][S][:100]
    return out


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
            if not in_b(game, nx, ny) or (nx, ny) in blocked:
                continue
            c = step[game["ter"][ny][nx]]
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


def eff_sites(game, utype):
    """Tier 5+: aircraft can only be produced at airfields (or the HQ)."""
    sites = UNITS[utype]["sites"]
    if game.get("tier", 2) >= 5 and UNITS[utype]["cls"] == "air":
        return ("HQ", "airfield")
    return sites


def air_rules(game):
    return tier5.air_active(game)


def unit_move(game, u):
    m = UNITS[u["type"]]["move"]
    if doctrine_of(game, u["side"]) == "mech" and UNITS[u["type"]]["cls"] == "tread":
        m += 1
    return m


def move_dest(game, unit, known_block):
    """Tiles a unit may end on. Enemy units it does not know about don't block (ambush).
    Air units never block ground movement and ground units never block aircraft."""
    t = UNITS[unit["type"]]
    dom = dom_of(unit)
    block = set()
    for tile in known_block:
        occ = unit_at(game, tile[0], tile[1])
        if occ is not None and occ["side"] != unit["side"] and dom_of(occ) == dom:
            block.add(tile)
    if dom == "s":                       # ships cannot pass through beaches -
        for y, row in enumerate(game["ter"]):   # only dock tiles are enterable
            for x, c in enumerate(row):
                if c == "~" and not building_at(game, x, y):
                    block.add((x, y))
    dist, par = dijkstra(game, t["cls"], unit["x"], unit["y"], unit_move(game, unit), block)
    friends = {(u["x"], u["y"]) for u in game["units"]
               if u["side"] == unit["side"] and u["id"] != unit["id"] and dom_of(u) == dom}
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
    """Follow a path; stop before any (hidden) enemy of the same movement domain.
    Air units fly over ground and ground moves under aircraft. Returns (final_tile, ambusher)."""
    dom = dom_of(unit)
    last_ok = path[0]
    for tile in path[1:]:
        occ = unit_at(game, tile[0], tile[1])
        if occ is not None and dom_of(occ) == dom:
            if occ["side"] != unit["side"]:
                return last_ok, occ
            return last_ok, None          # friendly unit of same domain: halt before it
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
                if in_b(game, x, y):
                    vis.add((x, y))

    vbonus = 2 if doctrine_of(game, side) == "recon" else 0
    for u in game["units"]:
        if u["side"] == side:
            add(u["x"], u["y"], UNITS[u["type"]]["vis"] + vbonus)
    # submarines are invisible unless detected: destroyer sonar (4), else close spotting (2).
    # their tile is removed from vision even when ordinary sight radius would cover it.
    for u in game["units"]:
        if u["side"] != side and u["type"] == "sub":
            r = tier6.SONAR_RANGE if any(a["side"] == side and a["type"] == "dd"
                         and manu(a, u) <= tier6.SONAR_RANGE for a in game["units"]) else tier6.SPOT_RANGE
            if any(manu(u, a) <= r for a in game["units"] if a["side"] == side):
                vis.add((u["x"], u["y"]))
            else:
                vis.discard((u["x"], u["y"]))
    for b in game["buildings"]:
        if b["side"] == side:
            add(b["x"], b["y"], 3 if b["type"] == "HQ" else 2)
            if b["type"] == "radar":
                add(b["x"], b["y"], 4 + 2 * b.get("level", 1))
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


# ========================================================================
# combat
# ========================================================================
def emit_combat(game, events, a0, d0, a_hp1, d_hp1, dmg, counter, dk, ak):
    ind = UNITS[a0["type"]]["indirect"]
    al, dl = label(a0["x"], a0["y"]), label(d0["x"], d0["y"])
    p_log = []
    for S in ("P", "A"):
        a_seen = a0["side"] == S or (a0["x"], a0["y"]) in vision(game, S)
        d_seen = d0["side"] == S or (d0["x"], d0["y"]) in vision(game, S)
        if not (a_seen or d_seen):
            continue
        an, dn = uname(a0, S), uname(d0, S)
        if a_seen:
            txt = f"{an} ({al}) {'shelled' if ind else 'hit'} {dn} ({dl}): -{dmg} HP ({d0['hp']}→{d_hp1})"
            if counter:
                txt += f" · counter -{counter} ({a0['hp']}→{a_hp1})"
        else:
            txt = f"{dn} ({dl}) hit by unseen enemy fire: -{dmg} HP ({d0['hp']}→{d_hp1})"
        es = glog(game, "combat", "good" if a0["side"] != S else "bad", txt, d0["x"], d0["y"])
        if S == "P":
            p_log += es.get("P", [])
        if dk:
            by = f"{an} (from {al})" if a_seen else "unseen enemy fire"
            ek = glog(game, "kill", "good" if d0["side"] != S else "bad",
                      f"✖ {dn} destroyed at {dl} by {by}.", d0["x"], d0["y"])
            if S == "P":
                p_log += ek.get("P", [])
        if ak:
            ek = glog(game, "kill", "good" if a0["side"] != S else "bad",
                      f"✖ {an} destroyed at {al} by counter-fire from {dn} ({dl}).",
                      a0["x"], a0["y"])
            if S == "P":
                p_log += ek.get("P", [])
    a_seen_p = a0["side"] == "P" or (a0["x"], a0["y"]) in vision(game, "P")
    events.append({"t": "combat", "a": a0 if a_seen_p else None, "d": d0,
                   "a_hp1": a_hp1, "d_hp1": d_hp1, "dmg": dmg, "counter": counter,
                   "dk": dk, "ak": ak, "ind": ind, "log": p_log})


def resolve_attack(game, att, dfn, events):
    a0, d0 = snap(att), snap(dfn)
    dmg = calc_damage(game, att, dfn)
    eff = min(dmg, dfn["hp"])
    dfn["hp"] -= eff
    d_killed = dfn["hp"] <= 0
    counter, a_killed = 0, False
    if not d_killed:
        counter = counter_calc(game, dfn, att)
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
    emit_combat(game, events, a0, d0, a_hp1, d_hp1, eff, counter, d_killed, a_killed)
    check_annihilation(game)
    return d_killed


def maybe_capture(game, unit, events):
    if not UNITS[unit["type"]]["capture"]:
        return
    b = building_at(game, unit["x"], unit["y"])
    if not b or b["side"] == unit["side"]:
        return
    prev = b["side"]
    _need = {1: tier1, 2: tier2}.get(game.get("tier", 2), tier3).capture_need(b["type"])
    if _need > 1:
        need = _need
        cap = b.get("cap")
        if not cap or cap.get("side") != unit["side"]:
            cap = {"side": unit["side"], "pts": 0}
            b["cap"] = cap
        cap["pts"] += 1
        if cap["pts"] < need:
            glog(game, "capture", "good" if unit["side"] == "P" else "bad",
                 lambda S: f"⚑ {uname(unit, S)} is capturing the {bname(b).lower()} at "
                           f"{label(b['x'], b['y'])} ({cap['pts']}/{need}).",
                 b["x"], b["y"], aud="both")
            events.append({"t": "capprog", "x": b["x"], "y": b["y"], "pts": cap["pts"],
                           "need": need, "side": unit["side"], "log": []})
            return
        b.pop("cap", None)
    if b["type"] == "HQ":
        game["result"] = {"winner": unit["side"], "reason": "hq"}
        finalize_result(game)
        entries = glog(
            game, "capture",
            "good" if unit["side"] == "P" else "bad",
            lambda S: (f"⚑ {uname(unit, S)} captured the enemy HQ at {label(b['x'], b['y'])}. "
                       f"Operation complete." if unit["side"] == S else
                       f"⚑ {uname(unit, S)} captured our HQ at {label(b['x'], b['y'])}!"),
            b["x"], b["y"], gate=False)
        events.append({"t": "win", "side": unit["side"], "x": b["x"], "y": b["y"],
                       "log": entries.get("P", [])})
        return
    b["side"] = unit["side"]
    bn, loc = bname(b).lower(), label(b["x"], b["y"])
    out = glog(game, "capture", "good",
               lambda S: f"⚑ {uname(unit, S)} captured a {bn} at {loc}.",
               b["x"], b["y"], aud=unit["side"])
    if prev is not None:
        r = glog(game, "capture", "bad",
                 lambda S: f"⚑ {uname(unit, S)} captured our {bn} at {loc}!",
                 b["x"], b["y"], aud=prev)
        for k, v in r.items():
            out.setdefault(k, []).extend(v)
    r = glog(game, "capture", "bad",
             lambda S: None if S in (unit["side"], prev)
             else f"⚑ {uname(unit, S)} captured a neutral {bn} at {loc}.",
             b["x"], b["y"], aud="both")
    for k, v in r.items():
        out.setdefault(k, []).extend(v)
    events.append({"t": "capture", "x": b["x"], "y": b["y"], "side": unit["side"],
                   "btype": b["type"], "level": b.get("level", 1),
                   "log": out.get("P", [])})


def check_annihilation(game):
    if game["result"]:
        return
    p = any(u["side"] == "P" for u in game["units"])
    a = any(u["side"] == "A" for u in game["units"])
    if not a:
        game["result"] = {"winner": "P", "reason": "annihilation"}
        finalize_result(game)
    elif not p:
        game["result"] = {"winner": "A", "reason": "annihilation"}
        finalize_result(game)


# ========================================================================
# turn structure & healing
# ========================================================================
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
            entries = glog(game, "repair", "bad",
                           lambda S: f"✚ {uname(u, S)} could not be repaired at {label(u['x'], u['y'])}: not enough credits.",
                           u["x"], u["y"], aud=side)
            if side == "P":
                events.append({"t": "note", "log": entries.get("P", [])})
            continue
        hp0 = u["hp"]
        u["hp"] += amt
        game["credits"][side] -= amt * per
        entries = glog(game, "repair", "good",
                       lambda S: f"✚ {uname(u, S)} repaired +{amt} HP at {bname(b)} "
                                 f"({label(u['x'], u['y'])}): {hp0}→{u['hp']}, -{amt * per} cr.",
                       u["x"], u["y"], aud=side)
        if side == "P":
            game["stats"]["repaired"] += amt
            events.append({"t": "heal", "id": u["id"], "x": u["x"], "y": u["y"], "amt": amt,
                           "hp": u["hp"], "log": entries.get("P", [])})


DEFENSES = tier6.DEFENSES


def battery_fire(game, side, events):
    """Coastal batteries fire once each at the strongest visible enemy ship in range."""
    vis = vision(game, side)
    for b in game["buildings"]:
        if b["type"] != "battery" or b["side"] != side:
            continue
        targets = [u for u in game["units"] if u["side"] != side
                   and UNITS[u["type"]]["cls"] == "sea" and (u["x"], u["y"]) in vis
                   and 2 <= man(b["x"], b["y"], u["x"], u["y"]) <= 4]
        if not targets:
            continue
        t = max(targets, key=lambda u: UNITS[u["type"]]["cost"] * u["hp"] / UNITS[u["type"]]["hp"])
        dmg = DEFENSES["battery"]["power"] + 2 * (b.get("level", 1) - 1)
        eff = min(dmg, t["hp"])
        t["hp"] -= eff
        killed = t["hp"] <= 0
        st = game["stats"]
        if side == "P":
            st["dealt"] += eff
            st["kills"] += int(killed)
        else:
            st["taken"] += eff
            st["losses"] += int(killed)
        if killed:
            game["units"] = [u for u in game["units"] if u["id"] != t["id"]]
        pv = vision(game, "P")
        p_log = []
        if t["side"] == "P" or (t["x"], t["y"]) in pv:
            entries = glog(game, "combat", "good" if side == "P" else "bad",
                           f"☗ Coastal battery at {label(b['x'], b['y'])} hit "
                           f"{uname(t, side)} ({label(t['x'], t['y'])}): -{eff} HP"
                           + (" — destroyed!" if killed else "."),
                           t["x"], t["y"])
            p_log = entries.get("P", [])
        events.append({"t": "combat", "a": None, "d": snap(t), "a_hp1": 0, "d_hp1": t["hp"],
                       "dmg": eff, "counter": 0, "dk": killed, "ak": False, "ind": True,
                       "log": p_log})
    check_annihilation(game)


def spawn_unit(game, side, utype, x, y):
    nu = {"id": game["next_uid"], "type": utype, "side": side, "x": x, "y": y,
          "hp": UNITS[utype]["hp"], "moved": True, "acted": True}
    if air_rules(game) and UNITS[utype]["cls"] == "air":
        nu["fuel"] = fuel_max(nu)
    game["units"].append(nu)
    game["next_uid"] += 1
    return nu


def process_queue(game, side, events):
    """Production orders count down at the start of the owner's turn; upgrades take time."""
    for q in list(game["prod"]):
        if q["side"] != side:
            continue
        if unit_at(game, q["x"], q["y"]) is not None:
            continue                                # pad occupied: hold the order
        q["left"] -= 1
        if q["left"] > 0:
            glog(game, "build", "info",
                 lambda S: f"⚙ Producing {UNITS[q['utype']]['code']} — {q['left']} turn(s) left.",
                 q["x"], q["y"], aud=side)
            continue
        nu = spawn_unit(game, side, q["utype"], q["x"], q["y"])
        game["prod"] = [o for o in game["prod"] if o is not q]
        glog(game, "build", "good",
             lambda S: f"⚙ {uname(nu, S)} rolled out at {label(q['x'], q['y'])}.",
             q["x"], q["y"], aud=side)
        events.append({"t": "built", "u": snap(nu), "log": []})
    for b in game["buildings"]:
        if b["side"] == side and b.get("upgrading"):
            b["upgrading"] -= 1
            if b["upgrading"] <= 0:
                b.pop("upgrading", None)
                b["level"] = b.get("level", 1) + 1
                glog(game, "build", "good",
                     lambda S: f"⚙ {bname(b)} at {label(b['x'], b['y'])} reached L{b['level']}.",
                     b["x"], b["y"], aud=side)


def begin_turn(game, side, events=None):
    events = events if events is not None else []
    inc = income_of(game, side)
    game["credits"][side] += inc
    for u in game["units"]:
        if u["side"] == side:
            u["moved"] = u["acted"] = False
    battery_fire(game, side, events)
    process_queue(game, side, events)
    if air_rules(game):
        for u in game["units"]:
            if u["side"] == side and UNITS[u["type"]]["cls"] == "air":
                b = building_at(game, u["x"], u["y"])
                if b is not None and b["side"] == side and b["type"] in ("HQ", "airfield"):
                    u["fuel"] = fuel_max(u)
    heal_units(game, side, events)
    glog(game, "system", "info",
         lambda S: f"Turn {game['turn']} begins. Income +{inc} cr "
                   f"(credits: {game['credits'][side]}).",
         aud=side)
    return events


def new_game(level="normal", mode="ai", opponent=None, map_idx=0, tier=2, doctrines=None):
    level = LEGACY_LEVELS.get(level, level)
    if level not in AI_LEVELS:
        level = "easy"
    if mode not in ("ai", "pvp"):
        mode = "ai"
    if map_idx in (-1, "-1", "random", None):
        map_idx = random.randrange(len(MAPS))
    try:
        map_idx = int(map_idx)
    except (TypeError, ValueError):
        map_idx = 0
    if not 0 <= map_idx < len(MAPS):
        map_idx = 0
    try:
        tier = int(tier)
    except (TypeError, ValueError):
        tier = 2
    if tier not in TIERS:
        tier = 2
    uid = session.get("uid")
    seats = {"P": uid, "A": opponent if mode == "pvp" else None}
    md = MAPS[map_idx]
    start_cr = md.get("credits") or CREDITS_BY_SIZE.get(md.get("h", H), START_CREDITS)
    game = {"v": SAVE_VERSION, "id": uuid.uuid4().hex[:10], "turn": 1, "ai_level": level,
            "tier": tier, "map": map_idx, "w": md.get("w", W), "h": md.get("h", H),
            "ter": tier_terrain(tier, MAPS[map_idx]["terrain"]),
            "mode": mode, "seats": seats, "active": "P", "first_side": "P",
            "created_ts": time.time(),
            "credits": {"P": start_cr, "A": start_cr},
            "buildings": [dict(b) for b in md.get("blds", building_defs(tier))
                          if B_TIER.get(b["type"], 1) <= tier],
            "units": [], "next_uid": 1, "result": None, "log": {"P": [], "A": []}, "log_seq": 1, "chat": [],
            "stats": {"kills": 0, "losses": 0, "dealt": 0, "taken": 0, "repaired": 0},
            "prod": [],
            "doctrine": dict(doctrines or {"P": "territ", "A": "territ"}),
            "ai_mem": {}, "p_seen": {"P": [], "A": []}, "p_known_b": {"P": {}, "A": {}} ,
            "rank_note": {}, "rank_applied": False,
            "record_saved": False, "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    if md.get("start"):
        start = list(md["start"])
    elif tier == 1:
        start = [("inf", "P", 2, 7), ("mbt", "P", 3, 6), ("heli", "P", 3, 8),
                 ("inf", "A", 11, 2), ("mbt", "A", 10, 3), ("heli", "A", 10, 1)]
    else:
        start = [("inf", "P", 2, 7), ("ifv", "P", 3, 8), ("mbt", "P", 3, 6),
                 ("inf", "A", 11, 2), ("ifv", "A", 10, 1), ("mbt", "A", 10, 3)]
    start = [q for q in start if q[0] in TIERS[tier]["units"]]   # tiers never field foreign units
    for t, s, x, y in start:
        nu = {"id": game["next_uid"], "type": t, "side": s, "x": x, "y": y,
              "hp": UNITS[t]["hp"], "moved": False, "acted": False}
        if air_rules(game) and UNITS[t]["cls"] == "air":
            nu["fuel"] = fuel_max(nu)
        game["units"].append(nu)
        game["next_uid"] += 1
    for n, b in enumerate(game["buildings"]):
        b["id"] = 9000 + n
        if b["type"] in ("battery", "fort"):
            b["hp"] = b["max_hp"] = 20 + 10 * (b.get("level", 1) - 1)
    if tier >= 3 and not md.get("blds"):
        force_tile(game, 12, 2, ".")
        force_tile(game, 1, 7, ".")
    for b in game["buildings"]:                      # no structure floats on open water
        c = game["ter"][b["y"]][b["x"]]
        if c == "O":
            force_tile(game, b["x"], b["y"], "~" if b["type"] in ("harbor", "shipyard") else ".")
        elif c == "W":
            force_tile(game, b["x"], b["y"], ".")
    for b in game["buildings"]:
        for s in ("P", "A"):
            if b["side"] == s:
                game["p_known_b"][s][f"{b['x']},{b['y']}"] = dict(b)
    op = "PvP operation" if mode == "pvp" else f"Operation begins ({level})"
    dn = game["doctrine"]
    glog(game, "system", "info",
         f"Doctrine - {'You' if True else ''}: {DOCTRINES[dn['P']]['name']} vs "
         f"{DOCTRINES[dn['A']]['name']}.")
    glog(game, "system", "info", f"{op}. Capture income, repair at cities, take their HQ.")
    if mode == "pvp":
        glog(game, "system", "info",
             "Turn 1 begins. The challenger moves first (seat P). Credits: "
             f"{START_CREDITS}.")
    else:
        glog(game, "system", "info", f"Turn 1 begins. Credits: {start_cr}.")
    return game


def update_known_buildings(game, visk, side):
    pk = game["p_known_b"][side]
    for b in game["buildings"]:
        k = f"{b['x']},{b['y']}"
        if b["side"] == side or k in visk or pk.get(k, {}).get("side") == side:
            d = {"type": b["type"], "x": b["x"], "y": b["y"],
                 "side": b["side"], "level": b.get("level", 1)}
            if b.get("cap"):
                d["cap"] = dict(b["cap"])
            pk[k] = d


def enemy_of(side):
    return "A" if side == "P" else "P"


def my_seat(game):
    """Which side of this game the current session controls (None if spectating/none)."""
    uid = session.get("uid")
    for s, u in (game.get("seats") or {}).items():
        if u == uid:
            return s
    return None


def public_state(game, side=None):
    """Viewer-relative state: the viewer's side is always relabeled to 'P'."""
    if side is None:
        side = my_seat(game) or "P"
    vis = vision(game, side)
    visk = {f"{x},{y}" for x, y in vis}
    seen_set = set(game["p_seen"][side]) | visk
    game["p_seen"][side] = sorted(seen_set)
    update_known_buildings(game, visk, side)
    units = []
    for u in game["units"]:
        if u["side"] == side or (u["x"], u["y"]) in vis:
            d = {k: u[k] for k in ("id", "type", "side", "x", "y", "hp", "moved", "acted")}
            if air_rules(game) and UNITS[u["type"]]["cls"] == "air":
                d["fuel"] = u.get("fuel", fuel_max(u))
                d["fuel_max"] = fuel_max(u)
            if u.get("cargo"):
                d["cargo"] = len(u["cargo"])
            d["side"] = "P" if u["side"] == side else "A"
            d["mhp"] = UNITS[u["type"]]["hp"]
            units.append(d)
    blds = []
    for k, b in sorted(game["p_known_b"][side].items()):
        d = dict(b)
        if d["side"]:
            d["side"] = "P" if d["side"] == side else "A"
        d["visible"] = k in visk
        live = building_at(game, b["x"], b["y"])
        if live is not None:
            d["id"] = live.get("id")
            if live.get("upgrading"):
                d["upgrading"] = live["upgrading"]
            if live.get("hp"):
                d["hp"] = live["hp"]
                d["max_hp"] = live.get("max_hp", live["hp"])
        blds.append(d)
    opp = ""
    opp_online, opp_seen = True, 0
    if game.get("mode", "ai") == "pvp":
        ouid = (game.get("seats") or {}).get(enemy_of(side))
        opp = user_name(ouid) or "Opponent"
        ts = LAST_SEEN.get(ouid, 0)
        opp_seen = int(time.time() - ts) if ts else -1
        opp_online = ts > 0 and opp_seen < 90
    res = game["result"]
    if res:
        win_me = res["winner"] == side
        if res["reason"] == "hq":
            reason = "Enemy HQ captured" if win_me else "Your HQ was captured"
        else:
            reason = "Enemy forces destroyed" if win_me else "Your forces were destroyed"
        res = {"winner": "P" if win_me else "A", "reason": reason}
    st = game["stats"]
    if side == "P":
        stats = dict(st)
    else:
        stats = {"kills": st["losses"], "losses": st["kills"], "dealt": st["taken"],
                 "taken": st["dealt"], "repaired": 0}
    return {"turn": game["turn"], "over": bool(res), "result": res,
            "credits": game["credits"][side], "income": income_of(game, side),
            "units": units, "buildings": blds, "visible": sorted(visk),
            "seen": game["p_seen"][side], "unit_cap": UNIT_CAP,
            "level": game["ai_level"] if game.get("mode", "ai") == "ai" else "pvp",
            "tier": game.get("tier", 2), "map": game.get("map", 0),
            "w": dims(game)[0], "h": dims(game)[1], "ter": list(game["ter"]),
            "active_side": game.get("active", "P"),
            "opponent": opp,
            "turn_label": ("Your move" if game.get("active") == side else f"{opp}'s move")
                          if game.get("mode", "ai") == "pvp" else "Your move",
            "your_turn": game.get("mode", "ai") != "pvp" or game.get("active") == side,
            "rank_note": game.get("rank_note", {}).get(side, ""),
            "log": game["log"][side][-250:], "stats": stats,
            "opp_online": opp_online, "opp_seen": opp_seen,
            "queue": [dict(q) for q in game["prod"] if q["side"] == side],
            "can_record": False,
            "id": game["id"]}


# ========================================================================
# AI
# ========================================================================
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


def ring(cx, cy, rmin, rmax, w=W, h=H):
    k = (cx, cy, rmin, rmax, w, h)
    r = _ring_cache.get(k)
    if r is None:
        r = [(x, y) for x in range(w) for y in range(h) if rmin <= man(cx, cy, x, y) <= rmax]
        _ring_cache[k] = r
    return r


def build_threat(game, known):
    tm = {}
    for e in known:
        t = UNITS[e["type"]]
        w = 0.6 if e.get("ghost") else 1.0
        w, h = dims(game)
        tiles = set()
        if t["indirect"]:
            tiles.update(ring(e["x"], e["y"], t["rng"][0], t["rng"][1], w, h))
        else:
            dist, _ = dijkstra(game, t["cls"], e["x"], e["y"], t["move"])
            for (x, y) in dist:
                tiles.update(ring(x, y, t["rng"][0], t["rng"][1], w, h))
        for tile in tiles:
            tm.setdefault(tile, []).append((e, w))
    return tm


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
    raiders, garrison = set(), set()
    if cfg["tactics"] and a_units:
        # Raiders strike the enemy base instead of blobbing on the main push.
        frac = {"advance": 0.15, "probe": 0.2, "counter": 0.3, "withdraw": 0.4}.get(posture, 0.2)
        n_raid = max(1, int(len(a_units) * frac))
        raid_pool = [u for u in a_units if not UNITS[u["type"]]["indirect"]]
        raid_pool.sort(key=lambda u: (-UNITS[u["type"]]["move"], -UNITS[u["type"]]["cost"]))
        raiders = {u["id"] for u in raid_pool[:n_raid]}
        # A cheap garrison stays home so a lone IFV cannot walk onto the HQ.
        if posture in ("withdraw", "counter"):
            cheap = sorted(a_units, key=lambda u: UNITS[u["type"]]["cost"])
            garrison = {u["id"] for u in cheap[:2]}
    ctx = {"vis": real, "known": known, "hq": hq, "ehq": ehq, "pvis": pvis,
           "posture": posture, "hq_threat": hq_threat, "dead": set(), "dm": {},
           "block": {(e["x"], e["y"]) for e in real}, "bait": None,
           "raiders": raiders, "garrison": garrison,
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
    # Artillery hunters: gunships, jets and recon actively hunt rocket/missile batteries.
    if cfg["counters"] and u["type"] in ("heli", "jet", "afv"):
        batteries = [e for e in known if e["type"] in ("mrl", "sam")]
        if batteries:
            t = min(batteries, key=lambda e: man(u["x"], u["y"], e["x"], e["y"]))
            return {"tile": (t["x"], t["y"]), "mode": "attack", "hold": 0}
    if ctx["hq_threat"] is not None and u["type"] != "sam" and u["id"] not in ctx.get("raiders", ()):
        e = ctx["hq_threat"]
        return {"tile": (e["x"], e["y"]), "mode": "attack", "hold": 0}
    post = ctx["posture"]
    is_bait = ctx["bait"] == u["id"]
    if known and u["id"] in ctx.get("garrison", ()):
        return {"tile": ctx["hq"], "mode": "garrison", "hold": 2}
    if u["id"] in ctx.get("raiders", ()):
        return {"tile": ctx["ehq"], "mode": "raid", "hold": 0}
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
    if e["type"] in ("mrl", "sam"):
        val *= 1.6                      # counter-battery: rockets and SAMs die first
    kill = eff >= e["hp"]
    if kill:
        val += cfg["kill"] * kb * et["cost"] / 25.0
    else:
        e2 = dict(e, hp=e["hp"] - eff)
        att_pos = {"type": u["type"], "side": u["side"], "x": dest[0], "y": dest[1], "hp": u["hp"]}
        c = min(counter_calc(game, e2, att_pos), u["hp"])
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
        w = cfg["goal_w"] * (1.5 if goal["mode"] in ("heal", "capture")
                             else 2.5 if goal["mode"] == "garrison" else 1.0)
        if post == "probe" and goal["mode"] == "attack":
            w *= 0.6
        s += prog * w
    if cfg["stealth"] and not attacking and dest in ctx["pvis"]:
        if is_bait:
            if man(dest[0], dest[1], *ctx["hq"]) <= 7:
                s += 6.0
        else:
            s -= cfg["stealth"] * (0.5 if post == "advance" else 1.0)
    if cfg["stealth"] and not attacking and u["type"] in STRIKERS and post != "counter"             and dest not in ctx["pvis"]:
        reach = t["move"] + t["rng"][1] + 1
        if any(UNITS[e["type"]]["cost"] >= 250 and man(dest[0], dest[1], e["x"], e["y"]) <= reach
               for e in ctx["known"]):
            s += cfg["stealth"] * 1.2          # lurk in the fog, strike from out of sight
    if cfg["flank"] and focus is not None and dest != (focus["x"], focus["y"])             and man(dest[0], dest[1], focus["x"], focus["y"]) <= 3:
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
        ev_log = []
        if from_vis and to_vis:
            mv = (lambda S: None if unit["side"] == S else
                  f"{uname(unit, S)} moved {label(*start)} → {label(*final)}.")
        elif to_vis:
            mv = (lambda S: None if unit["side"] == S else
                  f"{uname(unit, S)} moved into {label(*final)}.")
        else:
            mv = (lambda S: None if unit["side"] == S else
                  f"{uname(unit, S)} left {label(*start)}.")
        ev_log += glog(game, "move", "info", mv, final[0], final[1]).get("P", [])
        if to_vis and not from_vis:
            ev_log += glog(game, "contact", "bad",
                           lambda S: None if unit["side"] == S
                           else f"◉ Contact: {uname(unit, S)} spotted at {label(*final)}.",
                           final[0], final[1]).get("P", [])
        if ev_log:
            ev["log"] = ev_log
        events.append(ev)
    if amb is not None and amb["side"] == "P":
        entries = glog(
            game, "contact", "good",
            lambda S: f"◉ {uname(unit, S)} blundered into {uname(amb, S)} at "
                      f"{label(amb['x'], amb['y'])} and halted.",
            amb["x"], amb["y"])
        events.append({"t": "ambush", "x": amb["x"], "y": amb["y"],
                       "log": entries.get("P", [])})
    maybe_capture(game, unit, events)


def ai_construct(game, unit, cfg, ctx):
    """Tier-3 engineers dig in or pave; bridgelayers breach rivers toward their goal."""
    if game.get("tier", 2) < 3 or unit["acted"]:
        return False
    side = unit["side"]
    if unit["type"] == "bl":
        goal = ai_goal(game, cfg, ctx, unit)
        d = gdist(game, ctx, UNITS["bl"]["cls"], (unit["x"], unit["y"]), goal["tile"])
        if d < 90:                      # path exists; no bridging needed
            return False
        for dx, dy in DIRS:
            x, y = unit["x"] + dx, unit["y"] + dy
            if in_b(game, x, y) and game["ter"][y][x] == "W" and game["credits"][side] >= 250:
                game["credits"][side] -= 250
                force_tile(game, x, y, "B")
                unit["moved"] = unit["acted"] = True
                glog(game, "build", "info",
                     lambda S: f"⚒ {uname(unit, S)} built a bridge at {label(x, y)}, -250 cr.",
                     x, y, aud=side)
                return True
        return False
    if unit["type"] == "eng":
        danger = ai_danger(game, ctx, unit, (unit["x"], unit["y"]))
        near_enemy = any(manu(unit, e) <= 5 for e in ctx["known"])
        if not near_enemy and danger <= 0:
            return False
        c = game["ter"][unit["y"]][unit["x"]]
        if (danger > 0 or random.random() < 0.4) and building_at(game, unit["x"], unit["y"]) is None \
                and game["credits"][side] >= 300:
            game["credits"][side] -= 300
            game["buildings"].append({"type": "fort", "x": unit["x"], "y": unit["y"],
                                      "side": side, "level": 1})
            unit["moved"] = unit["acted"] = True
            glog(game, "build", "info",
                 lambda S: f"⚒ {uname(unit, S)} raised a fortification at "
                           f"{label(unit['x'], unit['y'])}, -300 cr.",
                 unit["x"], unit["y"], aud=side)
            return True
        if c == "." and game["credits"][side] >= 200:
            game["credits"][side] -= 200
            force_tile(game, unit["x"], unit["y"], "=")
            unit["moved"] = unit["acted"] = True
            glog(game, "build", "info",
                 lambda S: f"⚒ {uname(unit, S)} laid a road at {label(unit['x'], unit['y'])}, -200 cr.",
                 unit["x"], unit["y"], aud=side)
            return True
    return False


def ai_act_unit(game, unit, cfg, ctx, events):
    t = UNITS[unit["type"]]
    if ai_construct(game, unit, cfg, ctx):
        return
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
        if best is None:
            return
        dest = best[1]
    if dest != cur:
        if air_rules(game) and UNITS[unit["type"]]["cls"] == "air":
            dist_map, _ = move_dest(game, unit, ctx["block"])
            need = int(-(-dist_map.get(dest, 99) // 1))
            if unit.get("fuel", 0) < need:
                unit["moved"] = unit["acted"] = True
                return
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
    x, y = b["x"], b["y"]
    if UNITS[utype]["cls"] == "sea":
        for dx, dy in DIRS:
            nx, ny = b["x"] + dx, b["y"] + dy
            if in_b(game, nx, ny) and game["ter"][ny][nx] == "O" and unit_at(game, nx, ny) is None:
                x, y = nx, ny
                break
        else:
            game["credits"]["A"] += UNITS[utype]["cost"]      # no berth: refund and skip
            return
    au = {"id": game["next_uid"], "type": utype, "side": "A", "x": x,
          "y": y, "hp": UNITS[utype]["hp"], "moved": True, "acted": True}
    if air_rules(game) and UNITS[utype]["cls"] == "air":
        au["fuel"] = fuel_max(au)
    game["units"].append(au)
    game["next_uid"] += 1


def ai_build_weights(game, cfg, ctx, a_units, cred, threatened):
    cnt = Counter(u["type"] for u in a_units)
    ek = Counter(e["type"] for e in ctx["known"])
    air = ek["heli"] + ek["jet"]
    armor = ek["mbt"] + ek["afv"] + ek["ifv"]
    w = {"inf": 1.0, "ifv": 1.3, "afv": 0.4 if cnt["afv"] >= 1 else 0.9, "mbt": 1.8,
         "mrl": 1.2 if (cnt["mrl"] < max(1, len(a_units) // 4) and game["turn"] > 2) else 0.1,
         "sam": 0.0, "heli": 0.8 if cnt["mbt"] >= 2 else 0.2,
         "jet": 0.5 if cred > 1500 else 0.0,
         "eng": 0.8, "bl": 0.3,
         "at": 1.6 if armor >= 2 else 0.3,
         "mortar": 1.0 if game["turn"] > 3 else 0.2,
         "drone": 0.9 if cnt["drone"] < 2 else 0.1,
         "ht": 1.4, "sf": 0.8, "how": 0.9 if cred > 1200 else 0.0,
         "uav": 0.8 if cnt["uav"] < 1 else 0.1, "cv": 0.6,
         "asf": 2.0 if air >= 2 else 0.2,
         "intr": 1.2, "sb": 0.7 if cred > 2000 else 0.0, "th": 0.2,
         "aa": 2.2 if air >= 1 else 0.0, "td": 0.8,
         "cor": 0.9, "fr": 1.2, "dd": 1.2 if ek["sub"] else 0.6,
         "ca": 0.8 if cred > 2000 else 0.0, "sub": 1.0, "ls": 0.0}
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
    if ek["mrl"] >= 2:
        w["heli"] *= 3.5                # gunships are the hard counter to rocket spam
        w["jet"] = max(w["jet"] * 1.5, 3.0 if cred > 1200 else 0.0)
        w["afv"] *= 1.5                 # fast recon raiding the batteries
    if armor + ek["inf"] >= 6:
        w["mrl"] *= 2.0                 # out-range the IFV wall
        w["heli"] *= 2.0
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
        prod = [b for b in game["buildings"] if b["side"] == "A"
                and b["type"] in ("factory", "barracks", "airbase", "shipyard", "harbor")
                and unit_at(game, b["x"], b["y"]) is None]
        if not prod:
            return
        cred = game["credits"]["A"]
        if cred < cfg["build_gate"]:
            return
        w = ai_build_weights(game, cfg, ctx, a_units, cred, threatened)
        roster = TIERS[game.get("tier", 2)]["units"]
        cands = [k for k in ORDER if UNITS[k]["cost"] <= cred and w[k] > 0 and k in roster]
        if not cands:
            return
        if cfg["counters"]:
            pick = max(cands, key=lambda k: w[k] * (1 + 0.15 * random.random()))
        else:
            pick = random.choices(cands, weights=[w[k] for k in cands])[0]
        sites, tech = PROD_SITES.get(pick, (("factory",), 1))
        ok = [b for b in prod if b["type"] in sites and tech <= b.get("level", 1)]
        if not ok:
            return
        b = min(ok, key=lambda b: man(b["x"], b["y"], *ctx["ehq"]))
        takes = BUILD_TIMES.get(pick, 1)
        if takes > 1:
            if len([q for q in game["prod"] if q["side"] == "A"]) >= 4:
                return
            game["prod"].append({"side": "A", "x": b["x"], "y": b["y"], "utype": pick,
                                 "site": b["type"], "left": takes})
            return
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
            if man(u["x"], u["y"], hq[0], hq[1]) > 5 or game["ter"][u["y"]][u["x"]] not in FOUND_TERRAIN:
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


# ========================================================================
# accounts & ranks (same SQLite file)
# ========================================================================
def apply_rank_ai(uid, level, won, tier=2):
    """Band-based rank curve on the game's tier rating: AI level i only teaches
    up to rating 100*(i+1) on that tier. Big jumps for beating far stronger AIs."""
    i = AI_LEVEL_ORDER.index(level)
    thr = 100 * (i + 1)
    with closing(db()) as c:
        row = c.execute("SELECT rating FROM tier_ratings WHERE user_id=? AND tier=?", (uid, tier)).fetchone()
        if row is None:
            c.execute("INSERT INTO tier_ratings(user_id,tier) VALUES(?,?)", (uid, tier))
            row = c.execute("SELECT rating FROM tier_ratings WHERE user_id=? AND tier=?", (uid, tier)).fetchone()
        old = row["rating"]
        if won and old >= thr:
            return (f"No rating gain - {level} AIs sit below your band on this tier. "
                    f"Defeat rating {thr}+ doctrines to keep climbing.")
        d = (thr - old + 9) // 10 if won else -(max(1, 9 - i - old // 200))
        new = max(0, min(1000, old + d))
        c.execute("UPDATE tier_ratings SET rating=?, wins=wins+?, losses=losses+? "
                  "WHERE user_id=? AND tier=?",
                  (new, 1 if won else 0, 0 if won else 1, uid, tier))
        c.commit()
    sign = "+" if d >= 0 else ""
    return f"Rating {sign}{d} → {new} ({rank_title(new)})"


def apply_rank_pvp(winner_uid, loser_uid, tier=2):
    with closing(db()) as c:
        for uid in (winner_uid, loser_uid):
            c.execute("INSERT OR IGNORE INTO tier_ratings(user_id,tier) VALUES(?,?)", (uid, tier))
        w = c.execute("SELECT rating FROM tier_ratings WHERE user_id=? AND tier=?", (winner_uid, tier)).fetchone()
        l = c.execute("SELECT rating FROM tier_ratings WHERE user_id=? AND tier=?", (loser_uid, tier)).fetchone()
        if w is None or l is None:
            return "", ""
        rw, rl = w["rating"], l["rating"]
        exp_w = 1.0 / (1.0 + 10 ** ((rl - rw) / 400.0))
        dw = round(64 * (1 - exp_w))
        dl = round(64 * (0 - (1 - exp_w)))
        nw = max(0, min(1000, rw + dw))
        nl = max(0, min(1000, rl + dl))
        c.execute("UPDATE tier_ratings SET rating=?, wins=wins+1 WHERE user_id=? AND tier=?", (nw, winner_uid, tier))
        c.execute("UPDATE tier_ratings SET rating=?, losses=losses+1 WHERE user_id=? AND tier=?", (nl, loser_uid, tier))
        c.commit()
    return (f"Rating {'+' if dw >= 0 else ''}{dw} → {nw} ({rank_title(nw)})",
            f"Rating {'+' if dl >= 0 else ''}{dl} → {nl} ({rank_title(nl)})")


def auto_record(game):
    uid = (game.get("seats") or {}).get("P")
    name = user_name(uid) or "Anon"
    left = sum(1 for u in game["units"] if u["side"] == "P")
    with closing(db()) as c:
        c.execute("INSERT INTO records(name,user_id,turns,units_left,kills,level,date,tier) "
                  "VALUES(?,?,?,?,?,?,?,?)",
                  (name[:12], uid, game["turn"], left, game["stats"]["kills"],
                   game["ai_level"], time.strftime("%Y-%m-%d"), game.get("tier", 2)))
        c.commit()
    game["record_saved"] = True


def log_match(game):
    res = game.get("result") or {}
    with closing(db()) as c:
        c.execute("INSERT INTO matches(tier,mode,map_id,turns,result,level,date) VALUES(?,?,?,?,?,?,?)",
                  (game.get("tier", 2), game.get("mode", "ai"), game.get("map", 0),
                   game["turn"], res.get("winner", "?"), game.get("ai_level", ""),
                   time.strftime("%Y-%m-%d")))
        c.commit()


def finalize_result(game):
    """Apply rank deltas (and auto-record AI wins) exactly once per finished game."""
    if game.get("rank_applied") or not game.get("result"):
        return
    game["rank_applied"] = True
    tier = game.get("tier", 2)
    winner = game["result"]["winner"]
    log_match(game)
    if game.get("mode", "ai") == "ai":
        uid = (game.get("seats") or {}).get("P")
        if uid:
            won = winner == "P"
            game["rank_note"]["P"] = apply_rank_ai(uid, game["ai_level"], won, tier)
            if won:
                auto_record(game)
    else:
        wu = (game.get("seats") or {}).get(winner)
        lu = (game.get("seats") or {}).get(enemy_of(winner))
        if wu and lu:
            nw, nl = apply_rank_pvp(wu, lu, tier)
            game["rank_note"][winner] = nw
            game["rank_note"][enemy_of(winner)] = nl


# ========================================================================
# SQLite: users, saves, hall of fame
# ========================================================================
def db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _cols(c, table):
    return [r["name"] for r in c.execute(f"PRAGMA table_info({table})")]


def init_db():
    with closing(db()) as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            pw_hash TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
            created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS saves(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'manual', created TEXT NOT NULL,
            turn INTEGER, level TEXT, credits INTEGER, units INTEGER, data TEXT NOT NULL,
            user_id INTEGER);
        CREATE TABLE IF NOT EXISTS records(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, turns INTEGER NOT NULL,
            units_left INTEGER NOT NULL, kills INTEGER NOT NULL DEFAULT 0,
            level TEXT NOT NULL, date TEXT NOT NULL, user_id INTEGER);
        """)
        # migrations for DBs created by V3
        if "user_id" not in _cols(c, "saves"):
            c.execute("ALTER TABLE saves ADD COLUMN user_id INTEGER")
        if "user_id" not in _cols(c, "records"):
            c.execute("ALTER TABLE records ADD COLUMN user_id INTEGER")
        if "tier" not in _cols(c, "records"):
            c.execute("ALTER TABLE records ADD COLUMN tier INTEGER NOT NULL DEFAULT 2")
        # per-tier competitive ratings + match history (design doc section 9)
        c.executescript("""
        CREATE TABLE IF NOT EXISTS tier_ratings(
            user_id INTEGER NOT NULL, tier INTEGER NOT NULL,
            rating INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id, tier));
        CREATE TABLE IF NOT EXISTS matches(
            id INTEGER PRIMARY KEY AUTOINCREMENT, tier INTEGER NOT NULL,
            mode TEXT NOT NULL, map_id INTEGER NOT NULL, turns INTEGER NOT NULL,
            result TEXT NOT NULL, level TEXT NOT NULL, date TEXT NOT NULL);
        """)
        # seed tier-2 ratings from the legacy account-wide rank, once
        c.execute("INSERT OR IGNORE INTO tier_ratings(user_id, tier, rating, wins, losses) "
                  "SELECT id, 2, rank, wins, losses FROM users")
        # rename old ladder names onto the 10-level ladder (single pass, no chaining)
        c.execute("UPDATE records SET level = CASE level "
                  "WHEN 'easy' THEN 'very easy' WHEN 'normal' THEN 'easy' "
                  "WHEN 'extreme' THEN 'very hard' WHEN 'brutal' THEN 'extreme' "
                  "WHEN 'merciless' THEN 'relentless' ELSE level END")
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
    uid = session.get("uid")
    with closing(db()) as c:
        if kind == "auto":
            c.execute("DELETE FROM saves WHERE kind='auto' AND (user_id=? OR user_id IS NULL)", (uid,))
        else:
            c.execute("DELETE FROM saves WHERE kind='manual' AND (user_id=? OR user_id IS NULL) AND id NOT IN "
                      "(SELECT id FROM saves WHERE kind='manual' ORDER BY id DESC LIMIT 29)")
        cur = c.execute("INSERT INTO saves(name,kind,created,turn,level,credits,units,data,user_id) "
                        "VALUES(?,?,?,?,?,?,?,?,?)",
                        (name, kind, now, game["turn"], game["ai_level"],
                         game["credits"]["P"], nunits, data, uid))
        c.commit()
        return cur.lastrowid


# ========================================================================
# HTTP API
# ========================================================================
LAST_SEEN = {}     # uid -> last request timestamp (LAN presence)
USER_NAMES = {}    # uid -> name cache


def user_name(uid):
    if not uid:
        return None
    if uid not in USER_NAMES:
        with closing(db()) as c:
            row = c.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()
        USER_NAMES[uid] = row["name"] if row else None
    return USER_NAMES[uid]


def touch(uid):
    if uid:
        LAST_SEEN[uid] = time.time()


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get("uid"):
            if request.path.startswith("/api/"):
                return fail("login required", 401)
            return redirect("/lobby")
        touch(session["uid"])
        return fn(*a, **kw)
    return wrapper


def current_game(create=False):
    game = GAMES.get(session.get("gid"))
    if game is None and create:
        game = new_game(session.get("level", "normal"))
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
    return game


def fail(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


def player_unit(game, unit_id):
    u = get_unit(game, unit_id)
    side = my_seat(game) or "P"
    return u if (u and u["side"] == side) else None


def active_game():
    game = current_game()
    if game is None or game["result"]:
        return None
    return game


def my_turn_or_fail(game):
    """Returns (side, error_response). For PvP, only the active seat may act."""
    side = my_seat(game) or "P"
    if game.get("mode", "ai") == "pvp" and game.get("active") != side:
        return None, fail("not your turn")
    return side, None


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/lobby")
def lobby_page():
    return render_template("lobby.html")


# ---------------- accounts ----------------
@app.route("/api/me")
def api_me():
    uid = session.get("uid")
    if not uid:
        return jsonify({"ok": True, "user": None})
    with closing(db()) as c:
        row = c.execute("SELECT id,name FROM users WHERE id=?", (uid,)).fetchone()
        if row is None:
            session.clear()
            return jsonify({"ok": True, "user": None})
        tiers = {}
        for t in TIER_ORDER:
            tr = c.execute("SELECT rating,wins,losses FROM tier_ratings WHERE user_id=? AND tier=?",
                           (uid, t)).fetchone()
            r = tr["rating"] if tr else 0
            tiers[t] = {"rating": r, "title": rank_title(r),
                        "wins": tr["wins"] if tr else 0, "losses": tr["losses"] if tr else 0}
    overall = sum(v["rating"] for v in tiers.values()) // max(1, len(tiers))
    u = {"id": row["id"], "name": row["name"],
         "wins": sum(v["wins"] for v in tiers.values()),
         "losses": sum(v["losses"] for v in tiers.values()),
         "overall": overall, "overall_title": rank_title(overall),
         "rank": overall, "title": rank_title(overall),     # legacy keys for older clients
         "tiers": tiers}
    touch(uid)
    return jsonify({"ok": True, "user": u})


def valid_name(n):
    return 3 <= len(n) <= 16 and all(ch.isalnum() or ch in " _-" for ch in n)


@app.route("/api/register", methods=["POST"])
def api_register():
    d = request.get_json(force=True, silent=True) or {}
    name = str(d.get("name", "")).strip()
    pw = str(d.get("password", ""))
    if not valid_name(name):
        return fail("name must be 3-16 letters, numbers, space, _ or -")
    if not 4 <= len(pw) <= 64:
        return fail("password must be 4-64 characters")
    with LOCK, closing(db()) as c:
        try:
            cur = c.execute("INSERT INTO users(name,pw_hash,created) VALUES(?,?,?)",
                            (name, generate_password_hash(pw), time.strftime("%Y-%m-%d")))
            c.commit()
        except sqlite3.IntegrityError:
            return fail("that name is taken")
        uid = cur.lastrowid
    session["uid"] = uid
    USER_NAMES.pop(uid, None)
    return api_me()


@app.route("/api/login", methods=["POST"])
def api_login():
    d = request.get_json(force=True, silent=True) or {}
    with closing(db()) as c:
        row = c.execute("SELECT id,pw_hash FROM users WHERE name=?",
                        (str(d.get("name", "")).strip(),)).fetchone()
    if row is None or not check_password_hash(row["pw_hash"], str(d.get("password", ""))):
        return fail("wrong name or password", 401)
    session["uid"] = row["id"]
    USER_NAMES.pop(row["id"], None)
    return api_me()


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


# ---------------- lobby ----------------
@app.route("/api/lobby")
@login_required
def api_lobby():
    now = time.time()
    me = session["uid"]
    with closing(db()) as c:
        rows = c.execute("SELECT id,name,rank FROM users").fetchall()
    info = {r["id"]: r for r in rows}
    players = []
    for uid, ts in LAST_SEEN.items():
        if uid != me and now - ts < 90 and uid in info:
            r = info[uid]
            players.append({"id": uid, "name": r["name"], "rank": r["rank"],
                            "title": rank_title(r["rank"])})
    players.sort(key=lambda p: -p["rank"])
    open_games, my_games = [], []
    with LOCK:
        for g in GAMES.values():
            if g.get("mode") != "pvp" or g.get("result"):
                continue
            sp, sa = g["seats"].get("P"), g["seats"].get("A")
            opp_id = sa if sp == me else sp
            seat = my_seat(g)
            entry = {"id": g["id"], "turn": g["turn"],
                     "opponent": user_name(opp_id) if opp_id else "Open challenge",
                     "your_turn": seat is not None and g["active"] == seat,
                     "first": seat == "P", "tier": g.get("tier", 2)}
            if sp == me or sa == me:
                my_games.append(entry)
            elif sa is None and now - g.get("created_ts", now) < 1800:
                open_games.append(entry)
    return jsonify({"ok": True, "players": players, "open": open_games, "games": my_games})


@app.route("/api/pvp/create", methods=["POST"])
@login_required
def api_pvp_create():
    d = request.get_json(force=True, silent=True) or {}
    me = session["uid"]
    opp = d.get("opponent")
    if opp is not None:
        try:
            opp = int(opp)
        except (TypeError, ValueError):
            return fail("bad opponent")
        if opp == me:
            return fail("cannot challenge yourself")
        if user_name(opp) is None:
            return fail("player not found")
    with LOCK:
        pdoc = d.get("doctrine", "territ")
        if pdoc not in DOCTRINES:
            pdoc = "territ"
        game = new_game(mode="pvp", opponent=opp, tier=d.get("tier", 2),
                        doctrines={"P": pdoc, "A": "territ"})
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
        if opp:
            glog(game, "system", "info",
                 f"{user_name(me)} challenged {user_name(opp)} to an operation.")
    return jsonify({"ok": True, "id": game["id"]})


@app.route("/api/pvp/<gid>/join", methods=["POST"])
@login_required
def api_pvp_join(gid):
    with LOCK:
        game = GAMES.get(gid)
        if game is None or game.get("mode") != "pvp" or game.get("result"):
            return fail("game not available", 404)
        if game["seats"].get("A") is None and game["seats"].get("P") != session["uid"]:
            game["seats"]["A"] = session["uid"]
            adoc = (request.get_json(force=True, silent=True) or {}).get("doctrine", "territ")
            game["doctrine"]["A"] = adoc if adoc in DOCTRINES else "territ"
            glog(game, "system", "info",
                 f"{user_name(session['uid'])} joined the operation as the opposing commander.")
        session["gid"] = gid
    return jsonify({"ok": True})


@app.route("/api/pvp/<gid>/play", methods=["POST"])
@login_required
def api_pvp_play(gid):
    game = GAMES.get(gid)
    if game is None or game.get("mode") != "pvp":
        return fail("game not found", 404)
    if session["uid"] not in (game["seats"].get("P"), game["seats"].get("A")):
        return fail("you are not part of this operation")
    session["gid"] = gid
    return jsonify({"ok": True})


@app.route("/api/game/<gid>/abandon", methods=["POST"])
@login_required
def api_game_abandon(gid):
    with LOCK:
        game = GAMES.get(gid)
        if game is None:
            if session.get("gid") == gid:
                session.pop("gid", None)
            return jsonify({"ok": True})
        if session["uid"] not in (game.get("seats", {}).get("P"),
                                   game.get("seats", {}).get("A")):
            return fail("you are not part of this operation", 403)
        del GAMES[gid]
        if session.get("gid") == gid:
            session.pop("gid", None)
    return jsonify({"ok": True})


# ---------------- tier-5 air transport (load / unload) ----------------
FOOT_CARGO = {"inf", "eng", "at", "mortar", "sf"}


@app.route("/api/load", methods=["POST"])
@login_required
def api_load():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None or u["type"] not in ("th", "ls") or u["acted"]:
            return fail("that transport cannot load now")
        cap = 1 if u["type"] == "th" else 2
        cargo = u.setdefault("cargo", [])
        if len(cargo) >= cap:
            return fail("transport is full")
        ok_types = FOOT_CARGO if u["type"] == "th" else None     # ls: any ground unit
        pax = next((q for q in game["units"] if q["side"] == side and q["id"] != u["id"]
                    and q["x"] == u["x"] and q["y"] == u["y"]
                    and (ok_types is None and dom_of(q) == "g" or q["type"] in ok_types)), None)
        if pax is None:
            return fail("no loadable unit on this tile")
        cargo.append({"type": pax["type"], "hp": pax["hp"]})
        game["units"] = [q for q in game["units"] if q["id"] != pax["id"]]
        u["moved"] = u["acted"] = True
        glog(game, "move", "info",
             lambda S: f"✈ {uname(u, S)} loaded {UNITS[pax['type']]['code']} at {label(u['x'], u['y'])}.",
             u["x"], u["y"], aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/unload", methods=["POST"])
@login_required
def api_unload():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        d = request.get_json(force=True, silent=True) or {}
        u = player_unit(game, d.get("unit"))
        try:
            x, y = int(d.get("x", -1)), int(d.get("y", -1))
        except (TypeError, ValueError):
            return fail("bad tile")
        if u is None or u["type"] not in ("th", "ls") or not u.get("cargo"):
            return fail("that transport is empty")
        if not in_b(game, x, y) or man(u["x"], u["y"], x, y) != 1:
            return fail("unload to an adjacent tile")
        if unit_at(game, x, y) is not None:
            return fail("tile occupied")
        if game["ter"][y][x] in ("W", "O"):
            return fail("cannot unload into water")
        if u["type"] == "ls" and game["ter"][y][x] != "~":
            return fail("landing ships unload onto beaches")
        c = u["cargo"].pop(0)
        au = {"id": game["next_uid"], "type": c["type"], "side": side, "x": x, "y": y,
              "hp": c["hp"], "moved": True, "acted": True}
        if air_rules(game) and UNITS[c["type"]]["cls"] == "air":
            au["fuel"] = fuel_max(au)
        game["units"].append(au)
        game["next_uid"] += 1
        u["moved"] = u["acted"] = True
        glog(game, "move", "info",
             lambda S: f"✈ {uname(u, S)} unloaded {UNITS[c['type']]['code']} at {label(x, y)}.",
             x, y, aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


# ---------------- tier-3 field construction (engineers & bridgelayers) ----------------
CONSTRUCT = tier3.CONSTRUCT


@app.route("/api/construct", methods=["POST"])
@login_required
def api_construct():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        if game.get("tier", 2) < 3:
            return fail("construction requires tier 3 (Engineers)")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        d = request.get_json(force=True, silent=True) or {}
        u = player_unit(game, d.get("unit"))
        kind = d.get("kind")
        if u is None:
            return fail("not your unit")
        if u["acted"]:
            return fail("unit already acted")
        if kind not in CONSTRUCT:
            return fail("unknown project")
        who = UNITS[u["type"]]
        if kind == "bridge":
            if u["type"] != "bl":
                return fail("only bridgelayers build bridges")
            try:
                x, y = int(d.get("x", -1)), int(d.get("y", -1))
            except (TypeError, ValueError):
                return fail("bad tile")
            if not in_b(game, x, y) or game["ter"][y][x] != "W":
                return fail("bridges are built on river tiles")
            if m.man(u["x"], u["y"], x, y) != 1:
                return fail("the river tile must be adjacent to the bridgelayer")
            if game["credits"][side] < CONSTRUCT[kind]:
                return fail("not enough credits")
            game["credits"][side] -= CONSTRUCT[kind]
            force_tile(game, x, y, "B")
            u["moved"] = u["acted"] = True
            glog(game, "build", "info",
                 lambda S: f"⚒ {uname(u, S)} built a bridge at {label(x, y)}, -{CONSTRUCT[kind]} cr.",
                 x, y, aud=side)
            return jsonify({"ok": True, "state": public_state(game)})
        if u["type"] != "eng":
            return fail("only engineer squads build that")
        if kind == "fort":
            if building_at(game, u["x"], u["y"]) is not None:
                return fail("tile already has a structure")
            if game["credits"][side] < CONSTRUCT[kind]:
                return fail("not enough credits")
            game["credits"][side] -= CONSTRUCT[kind]
            game["buildings"].append({"type": "fort", "x": u["x"], "y": u["y"],
                                      "side": side, "level": 1})
            u["moved"] = u["acted"] = True
            glog(game, "build", "info",
                 lambda S: f"⚒ {uname(u, S)} raised a fortification at {label(u['x'], u['y'])}, "
                           f"-{CONSTRUCT[kind]} cr.",
                 u["x"], u["y"], aud=side)
            return jsonify({"ok": True, "state": public_state(game)})
        # road / rail on open terrain
        c = game["ter"][u["y"]][u["x"]]
        if kind == "road":
            if c not in ".FS" or building_at(game, u["x"], u["y"]) is not None:
                return fail("roads need open ground (plains, forest or swamp)")
        else:
            if c not in ".=" or building_at(game, u["x"], u["y"]) is not None:
                return fail("railways need plains or an existing road")
        if game["credits"][side] < CONSTRUCT[kind]:
            return fail("not enough credits")
        game["credits"][side] -= CONSTRUCT[kind]
        force_tile(game, u["x"], u["y"], "=" if kind == "road" else "R")
        u["moved"] = u["acted"] = True
        glog(game, "build", "info",
             lambda S: f"⚒ {uname(u, S)} laid {kind} at {label(u['x'], u['y'])}, -{CONSTRUCT[kind]} cr.",
             u["x"], u["y"], aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


# ---------------- chat (in-memory only, never persisted) ----------------
@app.route("/api/chat", methods=["GET", "POST"])
@login_required
def api_chat():
    game = current_game()
    if game is None or game.get("mode") != "pvp":
        return fail("no multiplayer battle", 404)
    if request.method == "POST":
        with LOCK:
            d = request.get_json(force=True, silent=True) or {}
            txt = str(d.get("text", "")).strip()[:200]
            if txt:
                game["chat"].append({"u": user_name(session["uid"]) or "?",
                                     "s": my_seat(game) or "?",
                                     "t": time.strftime("%H:%M"), "x": txt})
                if len(game["chat"]) > 200:
                    del game["chat"][:50]
        return jsonify({"ok": True})
    after = int(request.args.get("after", 0) or 0)
    msgs = [dict(m, i=i) for i, m in enumerate(game["chat"]) if i >= after]
    return jsonify({"ok": True, "msgs": msgs, "n": len(game["chat"])})


# ---------------- meta & state ----------------
@app.route("/api/meta")
def api_meta():
    units = {}
    for k, t in UNITS.items():
        d = dict(t)
        d["rng"] = list(t["rng"])
        d["atk"] = atk_summary(k)
        d["dmg"] = DMG[k]
        d["tech"] = PROD_SITES.get(k, (None, 1))[1]
        units[k] = d
    terrain = {}
    for ch, (nm, ds) in TINFO.items():
        terrain[ch] = {"name": nm, "desc": ds, "def": DEF_MULT[ch],
                       "foot": STEP["foot"][ch], "tread": STEP["tread"][ch], "air": STEP["air"][ch]}
    return jsonify({"ok": True, "units": units, "order": ORDER, "cats": CATEGORIES,
                    "terrain": terrain, "map": TERRAIN,
                    "maps": [{"name": m["name"], "terrain": list(m["terrain"]),
                              "w": m.get("w", W), "h": m.get("h", H)} for m in MAPS],
                    "w": W, "h": H,
                    "income": BASE_INCOME, "heal": HEAL, "repair_rate": REPAIR_RATE,
                    "found_cost": FOUND_COST, "upgrade_base": UPGRADE_BASE,
                    "max_level": MAX_B_LEVEL, "unit_cap": UNIT_CAP,
                    "b_def": B_DEF, "counter": COUNTER_FACTOR, "build_times": BUILD_TIMES,
                    "version": APP_VERSION,
                    "ai_order": AI_LEVEL_ORDER,
                    "tiers": {str(t): {"name": TIERS[t]["name"], "units": TIERS[t]["units"]} for t in TIER_ORDER},
                    "doctrines": {k: v["name"] + " - " + v["desc"] for k, v in DOCTRINES.items()},
                    "defenses": {k: {"power": v["power"], "range": list(v["range"]),
                                     "detection": v["detection"]} for k, v in DEFENSES.items()},
                    "doctrine_order": DOCTRINE_ORDER,
                    "levels": {k: AI_LEVELS[k]["desc"] for k in AI_LEVEL_ORDER}})


@app.route("/api/state")
@login_required
def api_state():
    with LOCK:
        game = current_game(create=True)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/new", methods=["POST"])
@login_required
def api_new():
    with LOCK:
        d = request.get_json(force=True, silent=True) or {}
        pdoc = d.get("doctrine", "territ")
        if pdoc not in DOCTRINES:
            pdoc = "territ"
        game = new_game(d.get("level", "normal"), map_idx=d.get("map", 0), tier=d.get("tier", 2),
                        doctrines={"P": pdoc, "A": random.choice(DOCTRINE_ORDER)})
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
        session["level"] = game["ai_level"]
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/ranges", methods=["POST"])
@login_required
def api_ranges():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side = my_seat(game) or "P"
        u = get_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None or u["side"] != side:
            return fail("not your unit")
        vis_e = visible_enemies(game, side)
        moves = []
        if not u["moved"]:
            dests, _ = move_dest(game, u, {(e["x"], e["y"]) for e in vis_e})
            moves = [list(c) for c in dests]
        attacks = []
        t = UNITS[u["type"]]
        vis_all = vision(game, side)
        if not u["acted"] and (not u["moved"] or t["move_fire"]):
            for e in attack_options(game, u, vis_e):
                dmg = min(calc_damage(game, u, e), e["hp"])
                ctr = 0
                if dmg < e["hp"]:
                    e2 = dict(e, hp=e["hp"] - dmg)
                    ctr = min(counter_calc(game, e2, u), u["hp"])
                attacks.append({"id": e["id"], "dmg": dmg, "counter": ctr, "kill": dmg >= e["hp"]})
            for bl in game["buildings"]:
                if bl["side"] == side or not bl.get("hp") or (bl["x"], bl["y"]) not in vis_all:
                    continue
                if not in_rng(u["type"], man(u["x"], u["y"], bl["x"], bl["y"])):
                    continue
                base = attack_base(u["type"], "cv")
                if base <= 0:
                    continue
                dmg = max(1, int(base * u["hp"] / UNITS[u["type"]]["hp"]
                                 * tile_def(game, bl["x"], bl["y"]) + 0.5))
                attacks.append({"id": bl["id"], "bld": True, "dmg": min(dmg, bl["hp"]),
                                "counter": 0, "kill": dmg >= bl["hp"]})
        return jsonify({"ok": True, "moves": moves, "attacks": attacks})


@app.route("/api/move", methods=["POST"])
@login_required
def api_move():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
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
        vis_e = visible_enemies(game, side)
        dests, par = move_dest(game, u, {(en["x"], en["y"]) for en in vis_e})
        if (x, y) not in dests:
            return fail("illegal destination")
        if air_rules(game) and UNITS[u["type"]]["cls"] == "air":
            need = int(-(-dests[(x, y)] // 1))      # ceil of path cost
            if u.get("fuel", 0) < need:
                return fail("not enough fuel — land at a friendly airfield or HQ to refuel")
            u["fuel"] = u.get("fuel", fuel_max(u)) - need
        start = (u["x"], u["y"])
        final, amb = walk(game, u, path_to(par, start, (x, y)))
        u["x"], u["y"] = final
        u["moved"] = True
        if not UNITS[u["type"]]["move_fire"]:
            u["acted"] = True
        events = []
        if final != start:
            entries = glog(game, "move", "info",
                           lambda S: f"{uname(u, S)} moved {label(*start)} → {label(*final)}.",
                           final[0], final[1])
            events.append({"t": "move", "u": snap(u), "from": list(start), "to": list(final),
                           "from_vis": True, "to_vis": True, "log": entries.get("P", [])})
        if amb is not None:
            e1 = glog(game, "contact", "bad",
                      lambda S: (f"◉ AMBUSH! {uname(u, S)} halted at {label(*final)} by an "
                                 f"unseen enemy at {label(amb['x'], amb['y'])}.") if S == u["side"] else None,
                      amb["x"], amb["y"])
            e2 = glog(game, "contact", "good",
                      lambda S: (f"◉ {uname(amb, S)} ambushed {uname(u, S)} at {label(*final)} — "
                                 f"the move was halted.") if S == amb["side"] else None,
                      amb["x"], amb["y"])
            events.append({"t": "ambush", "x": amb["x"], "y": amb["y"],
                           "log": e1.get("P", []) + e2.get("P", [])})
        maybe_capture(game, u, events)
        check_annihilation(game)
        return jsonify({"ok": True, "state": public_state(game), "events": events})


def resolve_building_attack(game, att, bl, events):
    base = attack_base(att["type"], "cv")
    eff = max(1, int(base * att["hp"] / UNITS[att["type"]]["hp"]
                     * tile_def(game, bl["x"], bl["y"]) + 0.5))
    eff = min(eff, bl["hp"])
    bl["hp"] -= eff
    destroyed = bl["hp"] <= 0
    att["moved"] = att["acted"] = True
    st = game["stats"]
    if att["side"] == "P":
        st["dealt"] += eff
    else:
        st["taken"] += eff
    pv = vision(game, "P")
    entries = glog(game, "combat", "good" if att["side"] == "P" else "bad",
                   f"{uname(att, 'P' if att['side'] == 'P' else 'A')} ({label(att['x'], att['y'])}) "
                   f"shelled the {bname(bl)} at {label(bl['x'], bl['y'])}: -{eff} HP",
                   bl["x"], bl["y"])
    if destroyed:
        game["buildings"] = [b for b in game["buildings"] if b["id"] != bl["id"]]
        st["kills" if att["side"] == "P" else "losses"] += 1
        entries = {k: v + glog(game, "kill", "good" if att["side"] == "P" else "bad",
                    f"✖ {bname(bl)} destroyed at {label(bl['x'], bl['y'])}.",
                    bl["x"], bl["y"]).get(k, []) for k, v in entries.items()}
    events.append({"t": "bldhit", "x": bl["x"], "y": bl["y"], "dmg": eff,
                   "dk": destroyed, "log": entries.get("P", [])})


@app.route("/api/attack", methods=["POST"])
@login_required
def api_attack():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        d = request.get_json(force=True, silent=True) or {}
        att = player_unit(game, d.get("attacker"))
        dfn = get_unit(game, d.get("target"))
        if att is None or att["acted"]:
            return fail("cannot attack")
        if att["moved"] and not UNITS[att["type"]]["move_fire"]:
            return fail("this unit cannot move and fire")
        if dfn is None:
            bl = next((b for b in game["buildings"] if b.get("id") == d.get("target") and b.get("hp")), None)
            if bl is None or bl["side"] == side:
                return fail("invalid target")
            if not in_rng(att["type"], man(att["x"], att["y"], bl["x"], bl["y"])):
                return fail("target out of range")
            events = []
            resolve_building_attack(game, att, bl, events)
            return jsonify({"ok": True, "state": public_state(game), "events": events})
        if dfn["side"] != enemy_of(side):
            return fail("invalid target")
        if dfn not in attack_options(game, att, visible_enemies(game, side)):
            return fail("target out of range or cannot be hit by this unit")
        events = []
        resolve_attack(game, att, dfn, events)
        return jsonify({"ok": True, "state": public_state(game), "events": events})


@app.route("/api/wait", methods=["POST"])
@login_required
def api_wait():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None:
            return fail("not your unit")
        u["moved"] = u["acted"] = True
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/build", methods=["POST"])
@login_required
def api_build():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        d = request.get_json(force=True, silent=True) or {}
        try:
            x, y = int(d.get("x", -1)), int(d.get("y", -1))
        except (TypeError, ValueError):
            return fail("bad tile")
        utype = d.get("type")
        b = building_at(game, x, y)
        if b is None or b["side"] != side or b["type"] not in ("factory", "barracks",
                                                               "airbase", "shipyard", "harbor"):
            return fail("cannot build here")
        if unit_at(game, x, y) is not None:
            return fail("tile occupied")
        if utype not in UNITS:
            return fail("unknown unit")
        if utype not in TIERS[game.get("tier", 2)]["units"]:
            return fail(f"{UNITS[utype]['name']} is not available in tier {game.get('tier', 2)}")
        sites, tech = PROD_SITES.get(utype, (("factory",), 1))
        if b["type"] not in sites:
            return fail(f"{UNITS[utype]['name']} is built at {' or '.join(sites)}, "
                        f"not at a {bname(b)}")
        if tech > b.get("level", 1):
            return fail(f"{UNITS[utype]['name']} needs a level {tech} {bname(b)}")
        if sum(1 for u in game["units"] if u["side"] == side) >= UNIT_CAP:
            return fail("unit cap reached")
        cost = UNITS[utype]["cost"]
        if game["credits"][side] < cost:
            return fail("not enough credits")
        game["credits"][side] -= cost
        takes = BUILD_TIMES.get(utype, 1)
        if UNITS[utype]["cls"] == "sea":
            if b["type"] not in ("shipyard", "harbor"):
                return fail("ships are built at a shipyard or harbor")
            spawn = next(((x + dx, y + dy) for dx, dy in DIRS
                          if in_b(game, x + dx, y + dy) and game["ter"][y + dy][x + dx] == "O"
                          and unit_at(game, x + dx, y + dy) is None), None)
            if spawn is None:
                game["credits"][side] += cost
                return fail("the shipyard needs an open sea tile beside it")
            x, y = spawn
        if takes > 1:
            game["prod"].append({"side": side, "x": x, "y": y, "utype": utype,
                                 "site": b["type"], "left": takes})
            glog(game, "build", "info",
                 lambda S: f"⚙ {bname(b)} began a {UNITS[utype]['code']} — ready in "
                           f"{takes} turns, -{cost} cr.", x, y, aud=side)
            return jsonify({"ok": True, "state": public_state(game)})
        nu = spawn_unit(game, side, utype, x, y)
        glog(game, "build", "info",
             lambda S: f"⚙ Produced {uname(nu, S)} at {bname(b)} ({label(x, y)}), -{cost} cr.",
             x, y, aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/upgrade", methods=["POST"])
@login_required
def api_upgrade():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        d = request.get_json(force=True, silent=True) or {}
        try:
            b = building_at(game, int(d.get("x", -1)), int(d.get("y", -1)))
        except (TypeError, ValueError):
            return fail("bad tile")
        if b is None or b["side"] != side:
            return fail("not your building")
        lvl = b.get("level", 1)
        if lvl >= MAX_B_LEVEL:
            return fail("already at max level")
        if b.get("upgrading"):
            return fail("already upgrading")
        cost = upgrade_cost(lvl)
        if game["credits"][side] < cost:
            return fail("not enough credits")
        game["credits"][side] -= cost
        b["upgrading"] = 1 if lvl == 1 else 2      # first upgrade 1 turn, second 2
        glog(game, "build", "info",
             lambda S: f"⚙ Upgrading {bname(b)} to L{lvl + 1} ({b['upgrading']} turn(s)), -{cost} cr.",
             b["x"], b["y"], aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/found", methods=["POST"])
@login_required
def api_found():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        u = player_unit(game, (request.get_json(force=True, silent=True) or {}).get("unit"))
        if u is None or not UNITS[u["type"]]["capture"]:
            return fail("only infantry and IFVs can found a factory")
        if u["acted"]:
            return fail("unit already acted")
        if game["ter"][u["y"]][u["x"]] not in FOUND_TERRAIN:
            return fail("needs open ground (plains or road)")
        if building_at(game, u["x"], u["y"]) is not None:
            return fail("site occupied")
        if game["credits"][side] < FOUND_COST:
            return fail(f"not enough credits ({FOUND_COST} needed)")
        game["credits"][side] -= FOUND_COST
        game["buildings"].append({"type": "factory", "x": u["x"], "y": u["y"], "side": side, "level": 1})
        u["moved"] = u["acted"] = True
        glog(game, "build", "info",
             lambda S: f"⚙ {uname(u, S)} founded a factory at {label(u['x'], u['y'])}, -{FOUND_COST} cr.",
             u["x"], u["y"], aud=side)
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/end_turn", methods=["POST"])
@login_required
def api_end_turn():
    with LOCK:
        game = active_game()
        if game is None:
            return fail("no active game")
        side, e = my_turn_or_fail(game)
        if e:
            return e
        glog(game, "system", "info", f"— Turn {game['turn']} ended. Enemy phase. —")
        pre = public_state(game)
        events = []
        if game.get("mode", "ai") == "ai":
            events = ai_turn(game)
            if not game["result"]:
                game["turn"] += 1
                begin_turn(game, "P", events)
                if (request.get_json(force=True, silent=True) or {}).get("autosave"):
                    save_game(game, f"Autosave T{game['turn']}", "auto")
        else:
            nxt = enemy_of(side)
            game["active"] = nxt
            if nxt == "P":
                game["turn"] += 1
            begin_turn(game, nxt, events)
        return jsonify({"ok": True, "state": pre, "final": public_state(game), "events": events})


# ---------------- saves ----------------
@app.route("/api/saves")
@login_required
def api_saves():
    with closing(db()) as c:
        rows = c.execute("SELECT id,name,kind,created,turn,level,credits,units FROM saves "
                         "WHERE user_id=? OR user_id IS NULL ORDER BY id DESC",
                         (session["uid"],)).fetchall()
    return jsonify({"ok": True, "saves": [dict(r) for r in rows]})


@app.route("/api/saves", methods=["POST"])
@login_required
def api_save_create():
    with LOCK:
        game = current_game()
        if game is None:
            return fail("no game to save")
        if game.get("mode", "ai") != "ai":
            return fail("only AI operations can be saved")
        d = request.get_json(force=True, silent=True) or {}
        name = str(d.get("name", "")).strip()[:40] or f"Turn {game['turn']} ({game['ai_level']})"
        sid = save_game(game, name)
        return jsonify({"ok": True, "id": sid})


@app.route("/api/saves/<int:sid>/load", methods=["POST"])
@login_required
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
        if isinstance(game.get("log"), list):          # pre-chat save format
            game["log"] = {"P": game["log"], "A": []}
        game.setdefault("chat", [])
        game.setdefault("prod", [])
        game.setdefault("ter", list(MAPS[game.get("map", 0)]["terrain"]))
        for n, b in enumerate(game.get("buildings", [])):
            b.setdefault("id", 9000 + n)
            if b["type"] in ("battery", "fort"):
                b.setdefault("hp", 20)
                b.setdefault("max_hp", 20)
        game["ai_level"] = LEGACY_LEVELS.get(game.get("ai_level"), game.get("ai_level"))
        game.setdefault("map", 0)
        game.setdefault("ter", list(MAPS[0]["terrain"]))
        game.setdefault("seats", {"P": None, "A": None})
        game["seats"]["P"] = session["uid"]
        if game.get("result"):
            game["record_saved"] = True       # finished games can't be re-submitted to the Hall of Fame
        GAMES[game["id"]] = game
        session["gid"] = game["id"]
        return jsonify({"ok": True, "state": public_state(game)})


@app.route("/api/saves/<int:sid>", methods=["DELETE"])
@login_required
def api_save_delete(sid):
    with closing(db()) as c:
        c.execute("DELETE FROM saves WHERE id=? AND (user_id=? OR user_id IS NULL)",
                  (sid, session["uid"]))
        c.commit()
    return jsonify({"ok": True})


# ---------------- hall of fame ----------------
def load_records():
    """Top 3 verified wins per AI level, common to all players (up to 18 rows)."""
    out = []
    with closing(db()) as c:
        for lvl in AI_LEVEL_ORDER:
            rows = c.execute(
                "SELECT r.name, r.turns, r.units_left, r.kills, r.level, r.date, r.tier, u.rank AS rank "
                "FROM records r LEFT JOIN users u ON u.id = r.user_id "
                "WHERE r.level=? ORDER BY r.turns ASC, r.kills DESC, r.units_left DESC, r.id ASC LIMIT 3",
                (lvl,)).fetchall()
            for row in rows:
                d = dict(row)
                d["rank_title"] = rank_title(d["rank"] or 0)
                out.append(d)
    return out


@app.route("/api/records")
def api_records():
    return jsonify({"ok": True, "records": load_records()})


@app.route("/api/records", methods=["POST"])
@login_required
def api_add_record():
    """Records are built from the server-side game, never from client-supplied numbers."""
    with LOCK:
        game = current_game()
        res = game["result"] if game else None
        if game is None or game.get("mode", "ai") != "ai" or not res or res["winner"] != "P":
            return fail("no victory to record")
        if game["record_saved"]:
            return fail("this victory is already recorded")
        auto_record(game)
        return jsonify({"ok": True, "records": load_records()})


if __name__ == "__main__":
    port = int(os.environ.get("IRON_GRID_PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    print(f"IRON GRID V4 — listening on all interfaces. On this PC: http://127.0.0.1:{port}")
    print(f"LAN players connect to http://<this-PC's-LAN-IP>:{port}  (set IRON_GRID_SECRET_KEY "
          f"so logins survive restarts)")
    app.run(host=os.environ.get("IRON_GRID_HOST", "0.0.0.0"), port=port, debug=debug)
