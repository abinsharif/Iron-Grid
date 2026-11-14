"""Tier 4 - Doctrine AI identity.

Bigger boards, heavier metal: the AI picks its doctrine to fit the map (reconnaissance
when the battlefield is vast, mechanized when it is tight), leads with special forces
and heavy armor, and upgrades its industry while the artillery arms race plays out.
"""
TIER = 4
DOCTRINE_MIN_TIER = 4


def doctrines_allowed(tier):
    return tier >= DOCTRINE_MIN_TIER


def ai_doctrine(tier, level, w, h):
    return "recon" if w * h >= 300 else "mech"


def ai_opening(roster):
    return [k for k in ("sf", "mbt", "mrl") if k in roster]


def ai_hunters(utype):
    return ["mrl", "how", "sam"]


def ai_weights(w, ctx, game):
    w["ht"] = w.get("ht", 1.0) * 1.4
    w["sf"] = w.get("sf", 1.0) * 1.3
    w["mrl"] = w.get("mrl", 1.0) * 1.3
    w["how"] = w.get("how", 1.0) * 1.2
    return w
