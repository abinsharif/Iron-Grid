"""Tier 4 - Doctrine rules. Pre-battle doctrines, radar, training camps."""
TIER = 4
DOCTRINE_MIN_TIER = 4

def doctrines_allowed(tier):
    return tier >= DOCTRINE_MIN_TIER
