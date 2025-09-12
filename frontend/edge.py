import csv, json, math

# ---------- Threshold ----------
STAION_WALK_MAX = 30.0   # ระยะสูงสุด stairs/elevator ↔ walk
# --------------------------------

def add_edge(edges, a, b):
    if a == b:
        return
    edges.setdefault(a, [])
    edges.setdefault(b, [])
    if b not in edges[a]:
        edges[a].append(b)
    if a not in edges[b]:
        edges[b].append(a)

def dist(p, q):
    return math.hypot(p["x"] - q["x"], p["y"] - q["y"])

def on_same_floor(nodes, a, b):
    return nodes[a]["floor"] == nodes[b]["floor"]

# ---------- โหลด nodes.json ----------
with open("nodes.json", encoding="utf-8") as f:
    nodes = json.load(f)

# ---------- แยกประเภท ----------
rooms = {k for k,v in nodes.items() if v["type"]=="room"}
walks = {k for k,v in nodes.items() if v["type"]=="walk"}
doors = {k for k,v in nodes.items() if v["type"].lower() in ("d","door")}
stairs = {k for k,v in nodes.items() if v["type"]=="stairs"}
elev = {k for k,v in nodes.items() if v["type"]=="elevator"}

edges = {}

# ---------- 1) walk ↔ walk (เชื่อม 2 ตัวใกล้สุด) ----------
walk_list = list(walks)
for a in walk_list:
    cand = [b for b in walk_list if on_same_floor(nodes, a, b) and b != a]
    if cand:
        cand_sorted = sorted(cand, key=lambda b: dist(nodes[a], nodes[b]))
        for nearest in cand_sorted[:2]:   # เชื่อม 2 ตัว
            add_edge(edges, a, nearest)

# ---------- 2) room ↔ door ----------
for r in rooms:
    cand = [d for d in doors if on_same_floor(nodes, r, d)]
    if not cand:
        print(f"⚠️ {r} ไม่มี door ใน floor เดียวกัน")
        continue
    nearest = min(cand, key=lambda d: dist(nodes[r], nodes[d]))
    add_edge(edges, r, nearest)

# ---------- 3) door ↔ walk ----------
for d in doors:
    cand = [w for w in walks if on_same_floor(nodes, d, w)]
    if not cand:
        print(f"⚠️ {d} ไม่มี walk ใน floor เดียวกัน")
        continue
    nearest = min(cand, key=lambda w: dist(nodes[d], nodes[w]))
    add_edge(edges, d, nearest)

# ---------- 4) stairs/elevator ↔ walk ----------
for s in list(stairs) + list(elev):
    cand = [w for w in walks if on_same_floor(nodes, s, w)]
    if cand:
        nearest = min(cand, key=lambda w: dist(nodes[s], nodes[w]))
        if dist(nodes[s], nodes[nearest]) <= STAION_WALK_MAX:
            add_edge(edges, s, nearest)

# ---------- เซฟผล ----------
with open("edges.json", "w", encoding="utf-8") as f:
    json.dump(edges, f, ensure_ascii=False, indent=2)

print("✅ edges.json สร้างเรียบร้อย")
print(f"- rooms: {len(rooms)}")
print(f"- doors: {len(doors)}")
print(f"- walks: {len(walks)}")
print(f"- stairs: {len(stairs)}")
print(f"- elevators: {len(elev)}")
print(f"- nodes in edges: {len(edges)}")
