"""Tier 6 - Sea rules. Submarine stealth, sonar, shore bombardment, coastal guns."""
TIER = 6
NAVAL_MIN_TIER = 6
SONAR_RANGE = 4                 # destroyer sonar
SPOT_RANGE = 2                  # close-range sub spotting
DEFENSES = {"battery": {"power": 8, "range": (2, 4), "detection": 2},
            "radar": {"power": 0, "range": (0, 0), "detection": 6}}
