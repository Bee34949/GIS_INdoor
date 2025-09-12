import json, heapq, math

# โหลด nodes และ edges
with open("nodes.json", encoding="utf-8") as f:
    nodes = json.load(f)

with open("edges.json", encoding="utf-8") as f:
    edges = json.load(f)

# ---------- Dijkstra ----------
def shortest_path(start, goal):
    pq = [(0, start, [start])]
    visited = set()

    while pq:
        dist, node, path = heapq.heappop(pq)
        if node in visited:
            continue
        visited.add(node)

        if node == goal:
            return dist, path

        for neigh in edges.get(node, []):
            if neigh not in visited:
                # ใช้ระยะจริงจาก nodes.json
                cost = math.hypot(
                    nodes[node]["x"] - nodes[neigh]["x"],
                    nodes[node]["y"] - nodes[neigh]["y"]
                )
                heapq.heappush(pq, (dist + cost, neigh, path + [neigh]))
    return None, []

def dfs(node, visited, edges):
    stack = [node]
    comp = set()
    while stack:
        n = stack.pop()
        if n in visited: 
            continue
        visited.add(n)
        comp.add(n)
        stack.extend(edges.get(n, []))
    return comp

visited = set()
comps = []
for node in edges:
    if node not in visited:
        comps.append(dfs(node, visited, edges))

print("จำนวน connected components:", len(comps))
for i,c in enumerate(comps,1):
    print(f"Component {i}: {len(c)} nodes")
    print(list(c)[:20], "...")


# ---------- ทดสอบ ----------
start, goal = "room_1_0_1", "room_2_1_1"


dist, path = shortest_path(start, goal)

if path:
    print(f"✅ Path found ({dist:.2f} units):")
    print(" -> ".join(path))
else:
    print(f"❌ No path found from {start} to {goal}")
