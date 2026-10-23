"""Tier 5 - Sky rules. Aircraft fuel, airbases, transport helicopters."""
TIER = 5
AIR_MIN_TIER = 5
AIR_FUEL = {"th": 40}
FUEL_MAX = 32

def air_active(game):
    return game.get("tier", 2) >= AIR_MIN_TIER
