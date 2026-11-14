"""Tier 6 - Sea AI identity.

Naval war: the AI screens with corvettes, escorts with the frigate's SAMs, builds
destroyers the moment submarines are suspected, sends its own submarines against
transports and soft hulls, and lands marines where the coast is thin. Aircraft cover
the fleet; the cruiser is the hammer, not the first purchase.
"""
TIER = 6
NAVAL_MIN_TIER = 6
SONAR_RANGE = 4
SPOT_RANGE = 2
AIR_HUNTERS = ("jet",)
DEFENSES = {"battery": {"power": 8, "range": (2, 4), "detection": 2},
            "radar": {"power": 0, "range": (0, 0), "detection": 6}}


def ai_doctrine(tier, level, w, h):
    return "mech"


def ai_opening(roster):
    return [k for k in ("cor", "heli", "fr") if k in roster]


def ai_hunters(utype):
    if utype == "sub":
        return ["ls", "th", "cor"]    # submarines raid transports and screens
    if utype in ("jet", "ah"):
        return ["mrl", "sam"]
    return ["ls", "th"]


def ai_weights(w, ctx, game):
    ek = {}
    for e in ctx["known"]:
        ek[e["type"]] = ek.get(e["type"], 0) + 1
    subs = ek.get("sub", 0)
    w["cor"] = w.get("cor", 1.0) * 1.2
    w["fr"] = w.get("fr", 1.0) * 1.4
    w["dd"] = w.get("dd", 1.0) * (1.3 + 0.8 * subs)   # sonar answers submarines
    w["sub"] = w.get("sub", 1.0) * (1.1 if ek.get("ls") or ek.get("th") else 0.7)
    w["ah"] = w.get("ah", 1.0) * 1.2
    w["ca"] = w.get("ca", 1.0) * 0.9                  # the hammer, not the opener
    return w
