"""Tier 3 - Engineers rules. Two-step captures, field construction."""
TIER = 3
CAPTURE_NEED = {"HQ": 3}
CONSTRUCT = {"road": 100, "rail": 200, "fort": 300, "bridge": 250,
             "airfield": 1500,       # engineers raise an airfield
             "battery": 800,         # coastal gun emplacement
             "port": 1200}           # coastal embarkation/trade harbor

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
