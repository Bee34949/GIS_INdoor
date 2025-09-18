const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function euclid(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function buildGraph(nodesObj, edgesArr) {
  const nodes = nodesObj || {};
  const edges = {};
  const push = (u, v, w) => {
    edges[u] = edges[u] || [];
    edges[v] = edges[v] || [];
    edges[u].push({ v, w });
    edges[v].push({ v: u, w });
  };

  if (Array.isArray(edgesArr) && edgesArr.length) {
    for (const e of edgesArr) {
      const a = nodes[e.src], b = nodes[e.dst];
      if (!a || !b) continue;
      push(e.src, e.dst, Number(e.weight ?? euclid(a, b)));
    }
  } else {
    // WHY: fallback k-NN for quick demo
    const ids = Object.keys(nodes);
    for (const id of ids) {
      const a = nodes[id];
      const dists = ids
        .filter(j => j !== id && nodes[j].floor === a.floor)
        .map(j => ({ j, w: euclid(a, nodes[j]) }))
        .sort((x, y) => x.w - y.w)
        .slice(0, 3);
      for (const { j, w } of dists) push(id, j, w);
    }
  }
  return { nodes, edges };
}

function dijkstra(G, src, dst) {
  const dist = {}, prev = {}, Q = new Set(Object.keys(G.edges));
  for (const v of Q) dist[v] = Infinity;
  if (!Q.has(src) || !Q.has(dst)) return null;
  dist[src] = 0;

  while (Q.size) {
    let u = null;
    for (const v of Q) if (u === null || dist[v] < dist[u]) u = v;
    Q.delete(u);
    if (u === dst) break;
    for (const { v, w } of G.edges[u] || []) {
      if (!Q.has(v)) continue;
      const alt = dist[u] + w;
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
    }
  }
  if (dst in prev === false && src !== dst) return null;
  const path = [];
  let u = dst; 
  while (u) { path.unshift(u); if (u === src) break; u = prev[u]; }
  return { path, cost: dist[dst] };
}

router.get("/graph", (req, res) => {
  const floor = String(req.query.floor || "1");
  const base = path.join(__dirname, "..", "data", `Floor0${floor}`);
  const nodes = readJSON(path.join(base, "frontend/Floor01/nodes_floor1.json")) || {};
  const doorsMaybe = readJSON(path.join(base, "frontend/Floor01/doors.json"));
  const edges = readJSON(path.join(base, "edges_floor1.json")) || [];
  const merged = { ...nodes, ...(doorsMaybe?.nodes || doorsMaybe || {}) };
  const G = buildGraph(merged, edges);
  res.json({ nodes: G.nodes, edges: G.edges });
});

router.get("/path", (req, res) => {
  const { from, to, floor = "1" } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from/to required" });

  const base = path.join(__dirname, "..", "data", `Floor0${floor}`);
  const nodes = readJSON(path.join(base, "frontend/Floor01/nodes_floor1.json")) || {};
  const doorsMaybe = readJSON(path.join(base, "frontend/Floor01/doors.json"));
  const edges = readJSON(path.join(base, "edges_floor1.json")) || [];
  const merged = { ...nodes, ...(doorsMaybe?.nodes || doorsMaybe || {}) };
  const G = buildGraph(merged, edges);
  if (!merged[from] || !merged[to]) {
    return res.status(404).json({ error: "node not found" });
  }
  const r = dijkstra(G, from, to);
  if (!r) return res.status(404).json({ error: "no path" });
  res.json({
    path: r.path,
    cost: r.cost,
    coords: r.path.map(id => ({ id, ...merged[id] }))
  });
});

module.exports = router;