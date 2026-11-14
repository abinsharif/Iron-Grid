"""IRON GRID - scripted tutorials, tiers 1-6.

Pure data (no game logic): lesson text, completion checks, reference entries and the fixed
training scenarios.  app.py owns the engine side (tracking, scripted opponent, unlocks).

Check specs (evaluated in app.tut_check against the actions taken since the lesson began):
  {"k": "event", "name": ..., "n": 1}          client-reported (inspect_own / inspect_enemy / doctrine)
  {"k": "act", "ep": "attack", ...}           player API calls; optional filters:
        utypes=[...]   acting unit type        targets=[...] target unit/building type
        kind=...       construct kind          tiles=[...]   destination terrain char (moves)
        n=N            how many calls          distinct=N    how many different acting unit types
        cls="air"      acting unit class
  {"k": "turn", "orders": N}                   N orders, then End Turn
  {"k": "near_hq", "d": N}                     any of your units within N tiles of the enemy HQ
  {"k": "capture", "x": X, "y": Y}             building now yours
  {"k": "sonar"}                               a Destroyer is within sonar range of an enemy sub
  {"k": "owns", "types": [...]}                you own (or are building) one of these units
  {"k": "all"/"any", "of": [...]}
"""

_PLAINS = [
    "................",
    "..F.........FF..",
    "...F...MM..F....",
    "......F.M.......",
    "..FF..........F.",
    ".....F....FF....",
    "..F.......M.....",
    "....F..MM.....F.",
    "..........FF....",
    "................",
]
_ROADS = [
    "................",
    "..F.........FF..",
    "...F...MM..F....",
    "......F.M.......",
    "..FF....====..F.",
    ".===FF=======...",
    "..F...S...M.....",
    "....F..MM..S..F.",
    "..........FF....",
    "................",
]
_RIVER = [
    ".......WW.......",
    "..F....WW...F...",
    "...U...WW.......",
    ".......WW....F..",
    "..U....WW.......",
    "....F..WW..U....",
    ".......WW.......",
    ".F.....WW...F...",
    ".......WW..U....",
    ".......WW.......",
]
_BRIDGED = [r if i not in (4, 5) else r[:7] + "BB" + r[9:] for i, r in enumerate(_RIVER)]
_SEA = [
    ".....~OOOO~.....",
    "...F.~OOOO~.F...",
    ".....~OOOO~.....",
    "..M..~OOOO~..M..",
    ".....~OOOO~.....",
    ".....~OOOO~.....",
    "..F..~OOOO~..F..",
    ".....~OOOO~.....",
    ".....~OOOO~.....",
    ".....~OOOO~.....",
]


def _base(extra=(), p_extra=(), a_extra=()):
    b = [("HQ", 1, 8, "P"), ("factory", 1, 6, "P"), ("city", 2, 7, "P"),
         ("HQ", 14, 1, "A"), ("factory", 14, 3, "A"), ("city", 13, 2, "A"),
         ("city", 6, 4, None), ("city", 9, 5, None)]
    return b + list(extra) + list(p_extra) + list(a_extra)


SCENARIOS = {
    1: dict(
        ter=_PLAINS, credits=1000, blds=_base(),
        units=[("inf", "P", 3, 8, None), ("mbt", "P", 3, 6, None), ("heli", "P", 2, 9, None),
               ("mrl", "P", 2, 5, None),
               ("inf", "A", 13, 1, None), ("mbt", "A", 12, 3, None), ("heli", "A", 13, 3, None),
               ("inf", "A", 6, 6, "scout")],
        script=[{"tag": "scout", "path": [[6, 6], [7, 6]], "respawn": [6, 6], "utype": "inf"}],
    ),
    2: dict(
        ter=_ROADS, credits=1500,
        blds=_base(p_extra=[("barracks", 0, 7, "P")], a_extra=[("barracks", 15, 2, "A")]),
        units=[("inf", "P", 3, 8, None), ("ifv", "P", 4, 8, None), ("afv", "P", 4, 7, None),
               ("mbt", "P", 3, 6, None), ("mrl", "P", 4, 6, None), ("sam", "P", 3, 9, None),
               ("heli", "P", 2, 9, None), ("jet", "P", 5, 9, None),
               ("inf", "A", 13, 1, None), ("mbt", "A", 12, 3, None), ("ifv", "A", 13, 3, None),
               ("inf", "A", 7, 5, "d1"), ("heli", "A", 8, 4, "d2")],
        script=[{"tag": "d1", "path": [[7, 5]], "respawn": [7, 5], "utype": "inf"},
                {"tag": "d2", "path": [[8, 4]], "respawn": [8, 4], "utype": "heli"}],
    ),
    3: dict(
        ter=_RIVER, credits=2000,
        blds=[("HQ", 1, 8, "P"), ("factory", 1, 6, "P"), ("city", 2, 7, "P"), ("barracks", 0, 7, "P"),
              ("HQ", 14, 1, "A"), ("factory", 14, 3, "A"), ("city", 13, 2, "A"), ("barracks", 15, 2, "A"),
              ("city", 5, 4, "A"), ("city", 10, 4, None), ("city", 5, 8, None)],
        units=[("eng", "P", 4, 5, None), ("eng", "P", 3, 8, None), ("at", "P", 3, 7, None),
               ("mortar", "P", 3, 9, None), ("drone", "P", 2, 9, None), ("inf", "P", 4, 7, None),
               ("mbt", "P", 3, 5, None), ("bl", "P", 3, 4, None),
               ("inf", "A", 13, 3, None), ("mbt", "A", 12, 4, None),
               ("mbt", "A", 5, 7, "d1"), ("inf", "A", 5, 9, "d2")],
        script=[{"tag": "d1", "path": [[5, 7]], "respawn": [5, 7], "utype": "mbt"},
                {"tag": "d2", "path": [[5, 9]], "respawn": [5, 9], "utype": "inf"}],
    ),
    4: dict(
        ter=_BRIDGED, credits=3000,
        blds=[("HQ", 1, 8, "P"), ("factory", 1, 6, "P"), ("city", 2, 7, "P"), ("barracks", 0, 7, "P"),
              ("radar", 0, 9, "P"),
              ("HQ", 14, 1, "A"), ("factory", 14, 3, "A"), ("city", 13, 2, "A"), ("barracks", 15, 2, "A"),
              ("radar", 15, 0, "A"), ("city", 10, 4, None), ("city", 5, 4, None)],
        units=[("eng", "P", 6, 5, None), ("ht", "P", 3, 6, None), ("sf", "P", 4, 7, None),
               ("cv", "P", 3, 8, None), ("how", "P", 3, 9, None), ("uav", "P", 2, 9, None),
               ("inf", "P", 4, 8, None), ("mbt", "P", 5, 6, None),
               ("inf", "A", 13, 3, None), ("mbt", "A", 12, 4, None),
               ("inf", "A", 6, 7, "d1")],
        script=[{"tag": "d1", "path": [[6, 7]], "respawn": [6, 7], "utype": "inf"}],
    ),
    5: dict(
        ter=_PLAINS, credits=3500,
        blds=_base(p_extra=[("barracks", 0, 7, "P"), ("airbase", 3, 9, "P")],
                   a_extra=[("barracks", 15, 2, "A"), ("airbase", 12, 0, "A")]),
        units=[("td", "P", 3, 9, None), ("ah", "P", 2, 9, None), ("intr", "P", 4, 9, None),
               ("sb", "P", 4, 8, None), ("th", "P", 5, 8, None), ("inf", "P", 5, 9, None),
               ("mbt", "P", 5, 5, None), ("sam", "P", 3, 7, None), ("aa", "P", 4, 6, None),
               ("inf", "A", 13, 4, None), ("mbt", "A", 12, 4, None),
               ("mbt", "A", 8, 6, "d1"), ("aa", "A", 9, 5, "d2"), ("inf", "A", 8, 4, "d3")],
        script=[{"tag": "d1", "path": [[8, 6]], "respawn": [8, 6], "utype": "mbt"},
                {"tag": "d2", "path": [[9, 5]], "respawn": [9, 5], "utype": "aa"},
                {"tag": "d3", "path": [[8, 4]], "respawn": [8, 4], "utype": "inf"}],
    ),
    6: dict(
        ter=_SEA, credits=4500,
        blds=[("HQ", 1, 8, "P"), ("factory", 1, 6, "P"), ("city", 2, 7, "P"), ("barracks", 0, 7, "P"),
              ("shipyard", 5, 8, "P"), ("harbor", 5, 6, "P"),
              ("HQ", 14, 1, "A"), ("factory", 14, 3, "A"), ("city", 13, 2, "A"), ("barracks", 15, 2, "A"),
              ("shipyard", 10, 1, "A"), ("harbor", 10, 3, "A")],
        units=[("eng", "P", 4, 4, None), ("inf", "P", 4, 7, None), ("inf", "P", 4, 8, None),
               ("dd", "P", 6, 5, None), ("ls", "P", 6, 7, None),
               ("fr", "P", 6, 2, None), ("sub", "P", 7, 2, None), ("ca", "P", 7, 9, None),
               ("inf", "A", 13, 3, None), ("mbt", "A", 12, 3, None),
               ("sub", "A", 9, 3, "sub"), ("cor", "A", 8, 4, "cor"), ("fr", "A", 9, 7, "fr")],
        script=[{"tag": "cor", "path": [[8, 4], [8, 5]], "respawn": [8, 4], "utype": "cor"},
                {"tag": "sub", "path": [[9, 3]], "respawn": [9, 3], "utype": "sub"},
                {"tag": "fr", "path": [[9, 7]], "respawn": [9, 7], "utype": "fr"}],
    ),
}

NEXT_HINT = "Training complete."

TUTORIALS = {
    1: {
        "name": "First Command",
        "briefing": [
            "Welcome, Commander.",
            "Your first battlefield is ready. Before leading a larger army, you must understand how "
            "units move, how combat works, and how to capture important territory.",
            "This tutorial introduces the basic systems of IRON GRID.",
        ],
        "lessons": [
            {"title": "The Battlefield",
             "learn": ["The battlefield is made of different tiles. Each tile represents a type of terrain "
                       "or a structure. Your units, buildings, resources, and objectives are displayed on "
                       "the map and interface.",
                       "You can select your units to inspect their information and available actions."],
             "task": "Select several friendly units and inspect their information.",
             "tip": "Always inspect a unit before using it. Knowing its role, health, movement, and attack "
                    "range helps you avoid unnecessary mistakes.",
             "check": {"k": "event", "name": "inspect_own", "n": 3}, "marks": []},
            {"title": "Movement and Terrain",
             "learn": ["Units have different movement capabilities. Their movement points determine how far "
                       "they can travel, while terrain can make certain routes more expensive or "
                       "inaccessible.",
                       "Some units are better suited to particular terrain than others."],
             "task": "Move your units towards the marked positions using different routes.",
             "tip": "Don't always choose the shortest route. A slightly longer route may be safer or cost "
                    "fewer movement points.",
             "check": {"k": "reach", "n": 2, "r": 1}, "marks": [[5, 7], [6, 8], [5, 4]]},
            {"title": "Combat",
             "learn": ["Units have different attack capabilities. Some are better against certain enemy "
                       "types, while others are more versatile.",
                       "An attack reduces the target's health. However, the final damage depends on several "
                       "factors, including the attacking unit's condition and the target's defences."],
             "task": "Inspect an enemy unit and attack it using a suitable friendly unit.",
             "tip": "Avoid attacking blindly. Choose units based on their strengths against the enemy, and "
                    "don't send weakened units into unnecessary fights.",
             "check": {"k": "all", "of": [{"k": "event", "name": "inspect_enemy", "n": 1},
                                           {"k": "act", "ep": "attack", "tags": ["scout"]}]},
             "marks": [[6, 6]]},
            {"title": "Turns and Orders",
             "learn": ["IRON GRID uses a turn-based system. You can issue orders to your units during your "
                       "turn. When you end your turn, the opponent gets the opportunity to act.",
                       "Use the entire army rather than focusing on only one unit."],
             "task": "Give orders to several units, then end your turn and observe the opponent's response.",
             "tip": "Think about your whole army before ending a turn. A unit left in a vulnerable position "
                    "may become an easy target.",
             "check": {"k": "turn", "orders": 2}, "marks": []},
            {"title": "Objectives and Victory",
             "learn": ["Battles have objectives, and capturing important enemy territory can determine the "
                       "result.",
                       "Your main objective in this mission is to capture the enemy headquarters. Protect "
                       "your own territory while advancing towards it."],
             "task": "Advance your forces and capture the enemy HQ.",
             "tip": "Don't rush your entire army towards the objective. Keep enough forces to protect your "
                    "important positions.",
             "check": {"k": "near_hq", "d": 4}, "marks": [[14, 1]]},
        ],
        "final": {"title": "Final Mission — First Victory",
                  "intro": "Your opponent controls a small territory and has an established headquarters.",
                  "objectives": ["Inspect your army and the battlefield.",
                                 "Move your forces towards enemy territory.",
                                 "Engage enemy units using suitable attackers.",
                                 "Protect your own important positions.",
                                 "Capture the enemy headquarters."]},
        "complete": {"title": "Mission Complete — First Command",
                     "text": "You have completed Tier 1. You now understand the basic controls, movement, "
                             "combat, turns, and objectives of IRON GRID."},
        "reference": {"title": "Basics: units, terrain, combat, turns, victory",
                      "points": ["Select a unit to see its health, movement, attack range and available orders.",
                                 "Movement points are spent per tile; terrain changes the cost, and some terrain "
                                 "blocks some units entirely.",
                                 "Damage depends on the attacker's type and remaining health, and on the "
                                 "defender's type and terrain.",
                                 "Each turn you may order every unit once; ending the turn hands control to the "
                                 "opponent.",
                                 "Capture the enemy HQ to win; protect your own."]},
    },
    2: {
        "name": "Combined Arms",
        "briefing": [
            "Welcome to Tier 2.",
            "The battlefield now offers a wider selection of units. Different armies have different "
            "strengths, and success depends on combining them effectively.",
            "You will learn to use specialised ground forces, artillery, aircraft, and production "
            "facilities.",
        ],
        "lessons": [
            {"title": "A Larger Army",
             "learn": ["Your army now includes more specialised ground units.",
                       "Mechanised infantry offers a more mobile infantry option, while armoured fighting "
                       "vehicles and main battle tanks provide stronger armoured capabilities.",
                       "Each unit has a different purpose, so inspect its attack profile before choosing a "
                       "target."],
             "task": "Inspect your new ground units and use different types of units during the battle.",
             "tip": "Don't build an army consisting entirely of tanks or infantry. A balanced force can "
                    "respond to more enemy threats.",
             "check": {"k": "all", "of": [{"k": "event", "name": "inspect_own", "n": 2},
                                           {"k": "act", "ep": "move", "utypes": ["ifv", "afv", "mbt"],
                                            "distinct": 2}]}, "marks": []},
            {"title": "Indirect Fire",
             "learn": ["Multiple rocket launchers provide indirect fire support. They can attack targets "
                       "without needing to fight at the same close range as ordinary ground units.",
                       "However, artillery is not a replacement for frontline units. It needs protection and "
                       "good positioning."],
             "task": "Use an MRL unit to attack an enemy position while keeping it protected.",
             "tip": "Keep artillery behind your frontline. Sending support weapons directly into combat "
                    "wastes their main advantage.",
             "check": {"k": "act", "ep": "attack", "utypes": ["mrl"], "tags": ["d1", "d2"]}, "marks": [[7, 5]]},
            {"title": "Air and Anti-Air Units",
             "learn": ["Tier 2 introduces additional aircraft and air-defence options.",
                       "Fighter aircraft are important for controlling the air, while helicopters provide a "
                       "different form of air support. Surface-to-air missile units are designed to counter "
                       "enemy aircraft.",
                       "There are no airbases yet, so aircraft (Gunship, ASF) are built at your **HQ**."],
             "task": "Inspect the available air units and use an appropriate unit against the marked target.",
             "tip": "Watch what the enemy is building. If the opponent relies heavily on aircraft, invest in "
                    "anti-air units. If their air defence is weak, aircraft may become a valuable advantage.",
             "check": {"k": "act", "ep": "attack", "utypes": ["jet", "sam", "heli"], "targets": ["heli"]},
             "marks": [[8, 4]]},
            {"title": "Production and Reinforcement",
             "learn": ["You can expand your army through production facilities and reinforce your forces "
                       "when necessary.",
                       "Production takes time and resources, so you must plan what to build instead of "
                       "waiting until a threat appears.",
                       "**Upgrading:** select a building and press **Upgrade** (or **U**). Level 2 costs 500 "
                       "credits, level 3 costs 1000. Higher levels heal more and unlock advanced units - the MRL "
                       "and SAM, for example, need a level-2 factory."],
             "task": "Produce or reinforce a unit using an available production facility.",
             "tip": "Counter-building is important. Don't keep producing the same unit when the enemy has "
                    "already built something designed to defeat it.",
             "check": {"k": "act", "ep": "build", "n": 1}, "marks": [[1, 6]]},
            {"title": "Coordinated Attacks",
             "learn": ["Your expanded army gives you more ways to approach a battle. Armour can advance, "
                       "infantry can support the frontline, artillery can provide indirect fire, and "
                       "aircraft can create pressure from above."],
             "task": "Coordinate multiple unit types in an attack against an enemy position.",
             "tip": "Use different units together. A powerful unit may still fail when it is unsupported or "
                    "facing the wrong opponent.",
             "check": {"k": "act", "ep": "attack", "distinct": 3}, "marks": [[7, 5], [8, 4]]},
        ],
        "final": {"title": "Final Mission — Combined Arms Operation",
                  "intro": "The enemy has established a stronger army and controls several important positions.",
                  "objectives": ["Inspect the enemy army and identify its main strengths.",
                                 "Produce suitable units for the threats you face.",
                                 "Use armour and infantry to establish a frontline.",
                                 "Support your advance with artillery and aircraft.",
                                 "Defeat the enemy and capture its main objective."]},
        "complete": {"title": "Mission Complete — Combined Arms",
                     "text": "You have completed Tier 2. Your army is now more versatile, and you can use "
                             "specialised units to respond to different battlefield situations."},
        "reference": {"title": "Combined arms: IFV, AFV, MBT, MRL, air, SAM, production",
                      "points": ["IFV = mobile infantry; AFV and MBT = armour. Check each unit's attack profile "
                                 "before choosing targets.",
                                 "MRLs fire indirectly at range 2-4 and never counter: protect them behind the "
                                 "front line.",
                                 "Fighters rule the sky, helicopters give flexible support, SAMs counter aircraft.",
                                 "Factories and barracks produce units over several turns - plan ahead and "
                                 "counter-build.",
                                 "Before Tier 5 aircraft are built at the HQ.",
                                 "Upgrade a building: select it, press Upgrade or U (500 cr, then 1000 cr).",
                                 "Win fights with mixed forces: armour forward, infantry beside it, artillery "
                                 "behind, aircraft overhead."]},
    },
    3: {
        "name": "Engineering the Battlefield",
        "briefing": [
            "Welcome to Tier 3.",
            "The battlefield is no longer just about attacking and defending. Engineers can now change the "
            "terrain, construct infrastructure, and capture important buildings.",
            "You will learn to prepare the battlefield to support your army.",
        ],
        "lessons": [
            {"title": "Engineers and Capturing",
             "learn": ["Engineers are specialised support units. They can capture buildings and construct "
                       "infrastructure, but they are not designed for frontline combat.",
                       "Capturing now requires time and continued presence. Ordinary buildings take two turns "
                       "to capture, while headquarters take three turns."],
             "task": "Send an Engineer to an enemy building and continue capturing it until it is yours.",
             "tip": "Protect Engineers while they capture. Moving them away interrupts the process, so make "
                    "sure the area is secure.",
             "check": {"k": "capture", "x": 5, "y": 4}, "marks": [[5, 4]]},
            {"title": "Roads and Railways",
             "learn": ["Engineers can construct roads and railways to improve movement across your "
                       "territory.",
                       "Roads reduce the movement cost of ground units. Railways provide even better movement "
                       "for suitable vehicles.",
                       "Construction requires credits and valid terrain."],
             "task": "Build a road and a railway, then move units across them.",
             "tip": "Build infrastructure along routes you actually use. A good transport network can make "
                    "reinforcements and frontline movement much easier.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "construct", "kind": "road"},
                                           {"k": "act", "ep": "construct", "kind": "rail"}]},
             "marks": [[3, 5], [4, 6]]},
            {"title": "Forts and Bridges",
             "learn": ["Engineers can construct forts and bridges.",
                       "Forts reduce incoming damage to units occupying them. Bridges allow ground forces to "
                       "cross rivers that would otherwise block their movement."],
             "task": "Construct a fort and a bridge, then use them to improve your defensive position and "
                     "movement.",
             "tip": "Build forts at important defensive positions and bridges where they provide useful "
                    "access. Infrastructure should support a plan, not simply consume credits.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "construct", "kind": "fort"},
                                           {"k": "act", "ep": "construct", "kind": "bridge"}]},
             "marks": [[6, 4], [7, 4]]},
            {"title": "Specialist Combat Units",
             "learn": ["Tier 3 adds several specialised combat units.",
                       "- **AT Teams** are inexpensive specialists against armoured vehicles.",
                       "- **Mortars** provide indirect fire at range, but cannot move and fire in the same "
                       "turn or counterattack.",
                       "- **Attack Drones** are fast and fragile aircraft suitable for scouting and light "
                       "strikes."],
             "task": "Use an AT Team against armour, a Mortar against a suitable target, and an Attack Drone "
                     "to scout or attack.",
             "tip": "Specialised units are most useful when facing the correct enemy. Don't expose Mortars or "
                    "Drones to threats they cannot handle.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "attack", "utypes": ["at"], "targets": ["mbt"]},
                                           {"k": "act", "ep": "attack", "utypes": ["mortar"], "tags": ["d1", "d2"]},
                                           {"k": "act", "ep": "move", "utypes": ["drone"]}]},
             "marks": [[5, 7], [5, 9]]},
            {"title": "Village Terrain",
             "learn": ["Villages provide defensive advantages and affect movement differently for infantry "
                       "and tread vehicles.",
                       "Terrain is not just decoration. It can change how much damage units receive and how "
                       "quickly they can travel."],
             "task": "Move different unit types through a village and use its defensive advantage.",
             "tip": "Consider terrain before starting a battle. A well-positioned unit in a defensive "
                    "location can be more effective than a stronger unit in the open.",
             "check": {"k": "act", "ep": "move", "tiles": ["U"], "distinct": 2},
             "marks": [[3, 2], [2, 4]]},
        ],
        "final": {"title": "Final Mission — Engineering the Battlefield",
                  "intro": "The enemy controls a territory protected by rivers and defensive positions.",
                  "objectives": ["Use Engineers to capture an important building.",
                                 "Construct infrastructure to improve movement.",
                                 "Build a bridge to open a crossing.",
                                 "Use specialist units against suitable enemy forces.",
                                 "Capture the enemy's main objective."]},
        "complete": {"title": "Mission Complete — Engineering the Battlefield",
                     "text": "You have completed Tier 3. You can now use Engineers and infrastructure to "
                             "reshape the battlefield and support your army."},
        "reference": {"title": "Engineers, infrastructure, specialists, villages",
                      "points": ["Capturing takes time: 2 turns for ordinary buildings, 3 for an HQ. Moving "
                                 "away interrupts it.",
                                 "Engineers build roads, railways, forts and bridges for credits, on valid "
                                 "terrain.",
                                 "Forts cut incoming damage; bridges let ground units cross rivers.",
                                 "AT Teams crush armour; Mortars fire at range but cannot move and fire or "
                                 "counter; Attack Drones are fast, fragile scouts.",
                                 "Villages give a defensive bonus and slow tread vehicles more than infantry."]},
    },
    4: {
        "name": "Doctrine and Logistics",
        "briefing": [
            "Welcome to Tier 4.",
            "Your army can now follow a military doctrine, use advanced support units, and operate with a "
            "larger command network.",
            "But maintaining an army is becoming more expensive. You must balance military strength with "
            "your economy.",
        ],
        "lessons": [
            {"title": "Army Doctrines",
             "learn": ["You can choose a doctrine that provides an advantage to your entire army.",
                       "There are six doctrines:",
                       "- **Mechanized Warfare:** Tread vehicles gain additional movement.",
                       "- **Firepower:** Indirect-fire units deal additional damage.",
                       "- **Reconnaissance:** All units gain additional vision.",
                       "- **Territorial Defense:** Units take less damage while occupying your buildings.",
                       "- **Air Cavalry:** Aircraft gain additional movement.",
                       "- **Guerrilla Warfare:** Infantry deal more damage and complete captures faster."],
             "task": "Inspect the doctrines and choose one that supports your intended strategy.",
             "tip": "Choose a doctrine based on the army you plan to use. A doctrine is most effective when "
                    "your entire army can benefit from it.",
             "check": {"k": "event", "name": "doctrine", "n": 1}, "ui": "doctrine", "marks": []},
            {"title": "Advanced Ground Forces",
             "learn": ["Tier 4 adds new ground units with specialised roles.",
                       "- **Heavy Tank:** A tough armoured breakthrough unit. It is expensive to produce and "
                       "maintain.",
                       "- **Spec Ops:** Mobile infantry with extra vision that can capture buildings.",
                       "- **Command Vehicle:** A mobile command option that provides a tougher vehicle-based "
                       "alternative.",
                       "Heavy Tanks require a level-2 factory, so upgrading production facilities becomes "
                       "important.",
                       "To upgrade: select the factory and press **Upgrade** (or **U**)."],
             "task": "Inspect the new units and produce or deploy the appropriate unit for the marked "
                     "situation.",
             "tip": "Heavy Tanks are valuable against strong resistance, but don't overproduce them. Their "
                    "cost and upkeep can put pressure on your economy.",
             "check": {"k": "any", "of": [{"k": "act", "ep": "move", "utypes": ["ht", "sf", "cv"], "distinct": 2},
                                           {"k": "act", "ep": "build", "utypes": ["ht"]}]},
             "marks": [[6, 7]]},
            {"title": "Indirect Fire and Reconnaissance",
             "learn": ["The Howitzer provides longer-range indirect fire, attacking targets from a distance. "
                       "Like Mortars, it cannot move and fire in the same turn or counterattack.",
                       "The UAV provides excellent vision and is designed for reconnaissance rather than "
                       "combat.",
                       "Radar installations reveal a large area around them. Upgrading radar increases its "
                       "detection radius."],
             "task": "Use a UAV or radar to identify enemy positions, then use a Howitzer against a suitable "
                     "target.",
             "tip": "Information can be as important as firepower. Scout before committing expensive units to "
                    "an unknown area.",
             "check": {"k": "act", "ep": "attack", "utypes": ["how"]}, "marks": [[6, 7]]},
            {"title": "Upkeep and the Economy",
             "learn": ["From Tier 4 onward, every unit costs credits each turn. Upkeep is deducted at the "
                       "start of your turn.",
                       "This means a large army can become expensive even when it is not fighting.",
                       "Capturing income-producing buildings and managing production are now essential."],
             "task": "Inspect your upkeep and income, then make a production decision that your economy can "
                     "support.",
             "tip": "Don't build units simply because you can afford their initial cost. Consider whether you "
                    "can maintain them over many turns.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "build", "n": 1}, {"k": "turn", "orders": 0}]},
             "marks": []},
            {"title": "Bridge Demolition",
             "learn": ["Engineers can now demolish bridges on adjacent tiles. Removing a bridge makes the "
                       "river impassable again.",
                       "This can prevent enemy forces from using an important crossing, but it can also block "
                       "your own army."],
             "task": "Use an Engineer to demolish a bridge and observe how the crossing changes.",
             "tip": "Think carefully before removing infrastructure. Denying the enemy a route is useful, but "
                    "destroying your own escape or reinforcement route may be a serious mistake.",
             "check": {"k": "act", "ep": "demolish_bridge"}, "marks": [[7, 5], [7, 4]]},
        ],
        "final": {"title": "Final Mission — Doctrine and Logistics",
                  "intro": "The enemy has established a well-supported army and controls several important "
                           "routes.",
                  "objectives": ["Choose a suitable army doctrine.",
                                 "Use advanced ground units and reconnaissance.",
                                 "Establish a useful radar position.",
                                 "Manage upkeep while expanding your army.",
                                 "Use Engineers to control important crossings.",
                                 "Capture the enemy's main objective."]},
        "complete": {"title": "Mission Complete — Doctrine and Logistics",
                     "text": "You have completed Tier 4. Your army now has doctrines, advanced support units, "
                             "and a growing economic responsibility."},
        "reference": {"title": "Doctrines, heavy units, recon, upkeep, demolition",
                      "points": ["Six doctrines: Mechanized, Firepower, Reconnaissance, Territorial Defense, "
                                 "Air Cavalry, Guerrilla - pick one that suits your whole army.",
                                 "Heavy Tank (level-2 factory), Spec Ops (far-sighted capturer), Command "
                                 "Vehicle (tough mobile command).",
                                 "Howitzers outrange everything but cannot move and fire or counter; UAVs and "
                                 "radar supply the vision.",
                                 "Every unit costs upkeep each turn, deducted at turn start: a big idle army "
                                 "still drains credits.",
                                 "Engineers can demolish adjacent bridges - deny the enemy a route, but mind "
                                 "your own."]},
    },
    5: {
        "name": "Sky Control",
        "briefing": [
            "Welcome to Tier 5.",
            "Air power now becomes a major part of warfare. Aircraft can scout, attack, intercept enemy "
            "forces, and transport troops.",
            "However, aircraft have limited fuel. Every operation must be planned around refuelling and "
            "airfield support.",
        ],
        "lessons": [
            {"title": "Fuel and Airfields",
             "learn": ["Aircraft consume fuel when moving. They must return to a friendly airfield or "
                       "airbase to refuel.",
                       "The amount of fuel restored depends on the type and upgrade level of the building.",
                       "Engineers can construct forward airfields, allowing aircraft to operate farther from "
                       "your main territory.",
                       "From this tier, aircraft are built only at **airbases**."],
             "task": "Move an aircraft towards a target area, then return it to a friendly airfield or "
                     "airbase to refuel.",
             "tip": "Plan the return journey before starting an operation. An aircraft that reaches its "
                    "target but cannot return is a wasted investment.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "move", "cls": "air", "n": 2},
                                           {"k": "act", "ep": "move", "cls": "air",
                                            "bld": ["airbase", "airfield", "HQ"]},
                                           {"k": "turn", "orders": 0}]}, "marks": [[3, 9], [8, 5]]},
            {"title": "Choose the Right Aircraft",
             "learn": ["Each aircraft has a different purpose.",
                       "- **Tank Hunter:** Specialised against armour. Its strong armour attack makes it "
                       "useful against tanks.",
                       "- **Interdictor:** A flexible combat aircraft that can engage several different "
                       "target types, including other fixed-wing aircraft.",
                       "- **Bomber:** Excellent against buildings and soft targets, but cannot attack "
                       "aircraft itself.",
                       "- **Tactical Drone:** Fast and fragile, with excellent vision. Best suited for "
                       "reconnaissance and light attacks."],
             "task": "Inspect the aircraft and use suitable units against the marked targets.",
             "tip": "Match aircraft to their targets. Don't use a Bomber as an interceptor or expose a "
                    "fragile Drone to strong enemy defences.",
             "check": {"k": "act", "ep": "attack", "cls": "air", "distinct": 2}, "marks": [[8, 6], [8, 4]]},
            {"title": "Air Defence",
             "learn": ["Aircraft need protection from enemy air defences.",
                       "The **AA Gun** is a specialised anti-air ground unit. It is particularly effective "
                       "against rotary aircraft such as helicopters and drones, while also threatening "
                       "fixed-wing aircraft."],
             "task": "Identify an enemy AA Gun and use your other forces to deal with the threat.",
             "tip": "Counter-building matters. If the enemy relies on aircraft, build anti-air units. If the "
                    "enemy has strong anti-air coverage, use ground forces to remove it before sending in "
                    "your aircraft.",
             "check": {"k": "act", "ep": "attack", "targets": ["aa"]}, "marks": [[9, 5]]},
            {"title": "Transport Helicopters",
             "learn": ["Transport Helicopters can carry one infantry-type unit. They allow troops to reach "
                       "positions that may be difficult or slow to access by land.",
                       "They have limited combat ability and should be treated primarily as transport "
                       "units."],
             "task": "Load an infantry unit, transport it towards the marked area, and unload it onto a "
                     "legal adjacent tile.",
             "tip": "Choose a safe landing area before transporting troops. A transport helicopter should "
                    "not be sent directly into an enemy defence network.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "load"}, {"k": "act", "ep": "unload"}]},
             "marks": [[7, 7]]},
            {"title": "Coordinated Air Operations",
             "learn": ["Air operations are most effective when different aircraft work together.",
                       "Drones can scout, Tank Hunters can threaten armour, Interdictors can provide "
                       "flexible combat support, and Bombers can attack important targets."],
             "task": "Scout an enemy position and coordinate an air attack using suitable aircraft.",
             "tip": "Protect specialised aircraft. A Bomber is especially valuable against buildings, but it "
                    "needs air support because it cannot defend itself against other aircraft.",
             "check": {"k": "act", "ep": "attack", "cls": "air", "distinct": 2}, "marks": [[8, 6], [8, 4]]},
        ],
        "final": {"title": "Final Mission — Operation Clear Skies",
                  "intro": "The enemy controls an important territory protected by ground and air defences.",
                  "objectives": ["Scout enemy positions with a Tactical Drone.",
                                 "Identify and counter enemy anti-air defences.",
                                 "Use a Tank Hunter against enemy armour.",
                                 "Protect a Bomber with suitable air support.",
                                 "Attack an important enemy building.",
                                 "Transport infantry to the designated objective.",
                                 "Capture the enemy's main objective."]},
        "complete": {"title": "Mission Complete — Sky Control",
                     "text": "You have completed Tier 5. You can now coordinate air power with your ground "
                             "forces while managing fuel and airfield support."},
        "reference": {"title": "Fuel, airfields, aircraft roles, AA, air transport",
                      "points": ["Aircraft burn fuel as they move and refuel only at friendly airfields or "
                                 "airbases; plan the return trip first.",
                                 "Tank Hunter = anti-armour, Interdictor = flexible (can hit aircraft), "
                                 "Bomber = buildings and soft targets but cannot attack aircraft, Tactical "
                                 "Drone = fast, fragile eyes.",
                                 "AA Guns are deadly to helicopters and drones and threaten fixed-wing "
                                 "aircraft too: remove them with ground forces first.",
                                 "Transport Helicopters carry one infantry-type unit; unload onto a legal "
                                 "adjacent tile.",
                                 "Escort Bombers - they cannot defend themselves against aircraft."]},
    },
    6: {
        "name": "Command of the Seas",
        "briefing": [
            "Welcome to Tier 6.",
            "The battlefield now extends across the sea. Naval forces can defend coastlines, fight enemy "
            "fleets, bombard buildings, and transport ground units.",
            "A strong fleet needs different ships working together. Learn their roles before committing "
            "them to battle.",
        ],
        "lessons": [
            {"title": "Building a Fleet",
             "learn": ["Ships are produced at harbors and shipyards. Advanced vessels may require an "
                       "upgraded shipyard.",
                       "Ships are placed in an unoccupied ocean tile beside the production building, so "
                       "suitable open water is necessary.",
                       "Naval production also takes time and requires credits."],
             "task": "Inspect your harbor and shipyard, then produce a Corvette.",
             "tip": "Plan naval production ahead of time. An empty shipyard or a coastline without enough "
                    "open water can delay your entire naval plan.",
             "check": {"k": "owns", "types": ["cor"]}, "marks": [[5, 6], [5, 8]]},
            {"title": "Know Your Ships",
             "learn": ["Each ship has a different role.",
                       "- **Corvette:** An economical patrol and screening ship, useful against other ships "
                       "and coastal buildings.",
                       "- **Frigate:** An excellent anti-air escort. Its particularly strong attack against "
                       "fixed-wing aircraft makes it valuable for protecting a fleet.",
                       "- **Destroyer:** A strong surface combatant and submarine hunter.",
                       "- **Cruiser:** A heavy bombardment ship with long range and powerful attacks against "
                       "buildings.",
                       "- **Submarine:** A stealthy vessel specialised in attacking enemy ships.",
                       "- **Landing Ship:** A transport vessel that carries ground units but cannot "
                       "attack."],
             "task": "Inspect the enemy fleet and select suitable ships to counter its composition.",
             "tip": "Don't build a fleet with only one role. A Frigate may protect against aircraft, but a "
                    "Destroyer is much better suited to hunting submarines.",
             "check": {"k": "event", "name": "inspect_enemy", "n": 2}, "marks": [[8, 4], [9, 7]]},
            {"title": "Submarine Warfare",
             "learn": ["Submarines are difficult to detect with ordinary vision. They can threaten your fleet "
                       "while remaining hidden.",
                       "Destroyers have sonar that can detect nearby submarines. Other units can also reveal "
                       "a submarine when they get close enough."],
             "task": "Use a Destroyer to locate a hidden enemy submarine.",
             "tip": "Keep Destroyers near important naval forces when submarines may be present. An "
                    "apparently empty sea is not necessarily safe.",
             "check": {"k": "sonar"}, "marks": [[9, 3]]},
            {"title": "Coastal Defence",
             "learn": ["Enemy ships can threaten coastal territory and bombard important buildings.",
                       "Engineers can construct coastal batteries beside open water. These stationary "
                       "defences can attack spotted enemy ships within their range."],
             "task": "Construct a coastal battery and use it against an enemy ship.",
             "tip": "Protect important harbors and coastal areas with suitable defences. However, don't "
                    "depend entirely on stationary batteries; a mobile fleet can respond to threats outside "
                    "their coverage.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "construct", "kind": "battery"},
                                           {"k": "act", "ep": "battery_fire"}]}, "marks": [[5, 4]]},
            {"title": "Amphibious Operations",
             "learn": ["Landing Ships transport ground forces across the sea. Each can carry two ground "
                       "units.",
                       "Different ground units have different unloading restrictions, so choose a suitable "
                       "landing location before making the journey.",
                       "Landing Ships cannot fight and need protection from combat vessels."],
             "task": "Load infantry into a Landing Ship, transport them across the sea, and unload them at "
                     "the designated location.",
             "tip": "Protect your transports with combat ships. A transport is valuable because it carries "
                    "your ground forces, not because it can defend itself.",
             "check": {"k": "all", "of": [{"k": "act", "ep": "load"}, {"k": "act", "ep": "unload"}]},
             "marks": [[10, 6], [10, 7]]},
        ],
        "final": {"title": "Final Mission — Operation Coastal Thunder",
                  "intro": "The enemy controls a coastal territory that blocks your expansion.",
                  "objectives": ["Produce a balanced naval fleet.",
                                 "Use a Frigate to protect against enemy aircraft.",
                                 "Use a Destroyer to check for submarines.",
                                 "Engage enemy ships with suitable combat vessels.",
                                 "Use a Cruiser to bombard an important coastal building.",
                                 "Protect a Landing Ship while transporting infantry.",
                                 "Capture the designated enemy objective."]},
        "complete": {"title": "Mission Complete — Command of the Seas",
                     "text": "You have completed Tier 6. You can now coordinate ground, air, and naval forces "
                             "in a combined military operation."},
        "reference": {"title": "Fleets, ship roles, submarines, coastal defence, landings",
                      "points": ["Harbors and shipyards build ships into free ocean beside them; advanced "
                                 "ships need an upgraded shipyard.",
                                 "Corvette = cheap screen, Frigate = anti-air escort, Destroyer = surface "
                                 "fighter and submarine hunter, Cruiser = long-range building bombardment, "
                                 "Submarine = stealthy ship killer, Landing Ship = unarmed transport.",
                                 "Submarines stay hidden until sonar (Destroyers) or close units reveal them.",
                                 "Engineers build coastal batteries beside open water to shoot spotted ships.",
                                 "Landing Ships carry two ground units; unload at harbors, shipyards or "
                                 "beaches, and escort them."]},
    },
}

FINAL_TOTAL = len(TUTORIALS)
