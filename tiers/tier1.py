"""Tier 1 - Skirmish AI identity.

Four units, instant captures, no economy depth: the AI that plays this tier wins by
expansion tempo - infantry swarm the neutral cities, the tank punishes whatever groups
up, artillery is the only fire support worth killing.
"""
TIER = 1
from gamedata import UNITS
TERRAIN_XLAT = {"=": ".", "S": "F"}


def capture_need(btype):
    return 1


def terrain(rows):
    return ["".join(TERRAIN_XLAT.get(c, c) for c in r) for r in rows]


def ai_doctrine(tier, level, w, h):
    return None                       # doctrines do not exist at this tier


def ai_opening(roster):
    out = []
    for k in ("inf", "inf", "mbt"):   # captures first, armor behind them
        if k in roster and k not in out:
            out.append(k)
    return out


def ai_hunters(utype):
    return ["mrl"]                    # the lone battery worth hunting


def ai_weights(w, ctx, game):
    w["inf"] = w.get("inf", 1.0) * 1.4
    w["mbt"] = w.get("mbt", 1.0) * 1.5
    return w
