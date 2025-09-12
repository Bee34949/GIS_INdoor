import csv, json

nodes = {}

def add_node(key, x, y, type_, floor):
    if key not in nodes:
        nodes[key] = {
            "x": float(x),
            "y": float(y),
            "type": type_.lower(),
            "floor": int(floor)
        }

# -------- 1) Rooms --------
with open("Floor01/nodes1.csv", encoding="utf-8-sig") as f:
    rdr = csv.DictReader(f)
    rdr.fieldnames = [h.strip().lower() for h in rdr.fieldnames]
    for row in rdr:
        key = f"room_{row['id']}_{row['floor']}"
        add_node(key, row["x"], row["y"], "room", row["floor"])

# -------- 2) Walk nodes --------
with open("Floor01/walk01.csv", encoding="utf-8-sig") as f:
    rdr = csv.DictReader(f)
    rdr.fieldnames = [h.strip().lower() for h in rdr.fieldnames]
    for row in rdr:
        key = f"walk_{row['id']}_{row['floor']}"
        add_node(key, row["x"], row["y"], "walk", row["floor"])

# -------- 3) Doors --------
with open("Floor01/DoorF1.csv", encoding="utf-8-sig") as f:
    rdr = csv.DictReader(f)
    rdr.fieldnames = [h.strip().lower() for h in rdr.fieldnames]
    for row in rdr:
        key = f"D_D_{row['id']}"
        add_node(key, row["x"], row["y"], "door", row["floor"])

# -------- 4) Lifts / Stairs --------
with open("Floor01/Lift_stairs01.csv", encoding="utf-8-sig") as f:
    rdr = csv.DictReader(f)
    rdr.fieldnames = [h.strip().lower() for h in rdr.fieldnames]
    for row in rdr:
        key = f"{row['type'].lower()}_{row['name']}_{row['floor']}"
        add_node(key, row["x"], row["y"], row["type"], row["floor"])

# -------- Save nodes.json --------
with open("nodes.json", "w", encoding="utf-8") as f:
    json.dump(nodes, f, ensure_ascii=False, indent=2)

print("✅ nodes.json สร้างเรียบร้อย")
print(f"ทั้งหมด {len(nodes)} nodes")
