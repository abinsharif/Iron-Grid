"""Tier 2 - Combined Arms AI identity.

The eight-unit counter web: the AI fields balanced combined arms, hunts the enemy's
rocket and missile batteries with aircraft and recon, and leans on the MBT/IFV core
while artillery duels play out behind the line.
"""
TIER = 2


def capture_need(btype):
    return 1


def ai_doctrine(tier, level, w, h):
    return None


def ai_opening(roster):
    return [k for k in ("inf", "ifv", "mbt") if k in roster]


def ai_hunters(utype):
    return ["mrl", "sam"]


def ai_weights(w, ctx, game):
    w["mbt"] = w.get("mbt", 1.0) * 1.5
    w["ifv"] = w.get("ifv", 1.0) * 1.4
    w["mrl"] = w.get("mrl", 1.0) * 1.3
    w["at"] = w.get("at", 1.0) * 1.2
    return w


def _has(g, t, side="P"):
    return any(u["side"] == side and u["type"] == t for u in g["units"])
