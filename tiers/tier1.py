"""Tier 1 - Skirmish rules. The original 4-unit game: no roads, no swamp, instant capture."""
TIER = 1
TERRAIN_XLAT = {"=": ".", "S": "F"}

def capture_need(btype):
    return 1                      # instant capture

def terrain(rows):
    return ["".join(TERRAIN_XLAT.get(c, c) for c in r) for r in rows]
