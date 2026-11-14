"""Tier 5 - Sky AI identity.

The air war is the war: the AI takes Air Cavalry, scouts with drones from turn one,
fights for air superiority with interceptors (aircraft hunt aircraft), and only then
spends on strike packages. Ground air defense tracks how much sky the enemy owns.
"""
TIER = 5
AIR_MIN_TIER = 5
AIR_FUEL = {"th": 55, "heli": 45}
FUEL_MAX = 32


def air_active(game):
    return game.get("tier", 2) >= AIR_MIN_TIER
AIR_HUNTERS = ("jet",)              # these units prefer enemy aircraft as prey


def ai_doctrine(tier, level, w, h):
    return "aircav"


def ai_opening(roster):
    return [k for k in ("heli", "drone", "jet") if k in roster]


def ai_hunters(utype):
    return ["mrl", "sam"]


def ai_weights(w, ctx, game):
    enemy_air = sum(1 for e in ctx["known"] if e["type"] in
                    ("heli", "jet", "drone", "ah", "uav", "td", "sb", "intr", "th"))
    own_air = ctx.get("own_air", 0)
    w["jet"] = w.get("jet", 1.0) * (2.2 if enemy_air > own_air else 1.2)
    w["aa"] = w.get("aa", 1.0) * (1.6 if enemy_air >= 2 else 1.0)
    w["drone"] = w.get("drone", 1.0) * 1.2
    w["ah"] = w.get("ah", 1.0) * 1.4
    return w
