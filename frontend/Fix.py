import json

with open("nodes.json", encoding="utf-8") as f:
    nodes = json.load(f)

with open("edges.json", encoding="utf-8") as f:
    edges = json.load(f)

edges_fixed = {}
for a, neighs in edges.items():
    if a not in nodes:
        continue
    valid_neighs = [b for b in neighs if b in nodes]
    if valid_neighs:
        edges_fixed[a] = valid_neighs

with open("edges_fixed.json", "w", encoding="utf-8") as f:
    json.dump(edges_fixed, f, ensure_ascii=False, indent=2)

print("✅ edges_fixed.json สร้างเสร็จ")
print(f"- nodes ใน edges (เดิม): {len(edges)}")
print(f"- nodes ใน edges (ใหม่): {len(edges_fixed)}")
