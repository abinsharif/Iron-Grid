"""Tier 3 - Engineers AI identity.

The battlefield is mutable now: the AI leads with engineers, supports the push with
mortars and anti-tank teams, builds fortifications under contact and bridges the rivers
in its way. Captures are deliberate - it plans for the two-step tempo.
"""
TIER = 3
CAPTURE_NEED = {"HQ": 3}
CONSTRUCT = {"road": 100, "rail": 200, "fort": 300, "bridge": 250,
             "airfield": 1500, "battery": 800, "port": 1200}


def capture_need(btype):
    return CAPTURE_NEED.get(btype, 2)


def urban(rows):
    out = [list(r) for r in rows]
    for x, y in [(4, 4), (6, 4), (5, 3), (9, 5), (7, 6), (8, 6)]:
        if y < len(out) and x < len(out[y]) and out[y][x] == ".":
            out[y][x] = "U"
            py, px = len(out) - 1 - y, len(out[0]) - 1 - x
            if out[py][px] == ".":
                out[py][px] = "U"
    return ["".join(r) for r in out]


def ai_doctrine(tier, level, w, h):
    return None


def ai_opening(roster):
    return [k for k in ("eng", "inf", "mbt") if k in roster]


def ai_hunters(utype):
    return ["mrl", "mortar"]


def ai_weights(w, ctx, game):
    w["eng"] = w.get("eng", 1.0) * 1.6
    w["mortar"] = w.get("mortar", 1.0) * 1.3
    w["at"] = w.get("at", 1.0) * 1.3
    w["mbt"] = w.get("mbt", 1.0) * 1.4
    w["bl"] = w.get("bl", 1.0) * 1.2
    return w
