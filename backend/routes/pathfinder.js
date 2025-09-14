const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
require("dotenv").config();

const QDRANT_URL = "https://84dca8b5-df3f-4363-9c84-ec41b1dcc2a6.us-east4-0.gcp.cloud.qdrant.io";
const API_KEY = process.env.QDRANT_API_KEY;

// --- helper: Qdrant scroll ---
async function qdrantScroll(collection, filter) {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY
    },
    body: JSON.stringify({ filter, limit: 10000 })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Qdrant scroll failed: ${res.status} ${res.statusText} - ${errText}`);
  }
  const data = await res.json();
  return data.result.points || [];
}

// --- Dijkstra ---
function dijkstra(nodes, edges, startId, endId) {
  const distances = {};
  const prev = {};
  const unvisited = new Set(Object.keys(nodes));

  for (const id of Object.keys(nodes)) {
    distances[id] = Infinity;
    prev[id] = null;
  }
  distances[startId] = 0;

  while (unvisited.size > 0) {
    let current = null;
    for (const node of unvisited) {
      if (current === null || distances[node] < distances[current]) {
        current = node;
      }
    }
    if (distances[current] === Infinity) break;
    if (current === endId) break;

    unvisited.delete(current);

    const neighbors = edges.filter(e => e.from === current || e.to === current);
    for (const edge of neighbors) {
      const neighborId = edge.from === current ? edge.to : edge.from;
      if (!unvisited.has(neighborId)) continue;

      const alt = distances[current] + (edge.distance || 1);
      if (alt < distances[neighborId]) {
        distances[neighborId] = alt;
        prev[neighborId] = current;
      }
    }
  }

  const path = [];
  let u = endId;
  if (prev[u] !== null || u === startId) {
    while (u) {
      path.unshift(u);
      u = prev[u];
    }
  }

  return { path, distance: distances[endId] };
}

// --- Pathfinding API ---
router.get("/route", async (req, res) => {
  const startId = String(req.query.start).trim();
  const endId   = String(req.query.end).trim();
  const floor   = parseInt(req.query.floor);

  try {
    // โหลด nodes
    const nodePoints = await qdrantScroll("indoor_nodes", {
      must: [{ key: "floor", match: { value: floor } }]
    });
    const nodes = {};
    nodePoints.forEach(p => {
      if (p.payload.id) {
        const id = String(p.payload.id).trim();
        nodes[id] = p.payload;
      }
    });

    // โหลด edges
    const edgePoints = await qdrantScroll("indoor_graph", {
      must: [{ key: "floor", match: { value: floor } }]
    });
    const edges = edgePoints
      .map(p => p.payload)
      .filter(e => e.from && e.to);

    // Debug
    console.log("Start:", startId, "End:", endId, "Floor:", floor);
    console.log("Nodes loaded:", Object.keys(nodes).length);
    console.log("Edges loaded:", edges.length);
    console.log("Sample node:", Object.values(nodes)[0]);
    console.log("Sample edge:", edges[0]);

    if (!nodes[startId] || !nodes[endId]) {
      return res.status(404).json({ error: "Start or end node not found" });
    }

    const result = dijkstra(nodes, edges, startId, endId);

    if (result.path.length === 0) {
      return res.status(404).json({ error: "No path found" });
    }

    res.json({
      start: startId,
      end: endId,
      floor,
      distance: result.distance,
      path: result.path,
      nodes
    });

  } catch (err) {
    console.error("❌ Error pathfinding:", err);
    res.status(500).json({ error: "Pathfinding failed", details: err.message });
  }
});

// --- Debug API: list nodes on a floor ---
router.get("/debugNodes", async (req, res) => {
  const floor = parseInt(req.query.floor);

  try {
    const nodePoints = await qdrantScroll("indoor_nodes", {
      must: [{ key: "floor", match: { value: floor } }]
    });

    const list = nodePoints
      .map(p => p.payload)
      .filter(n => n.id) // เฉพาะที่เป็น node
      .map(n => ({ id: n.id, type: n.type, floor: n.floor, name: n.name }));

    res.json({ floor, count: list.length, nodes: list });
  } catch (err) {
    console.error("❌ Error debugNodes:", err);
    res.status(500).json({ error: "Debug failed", details: err.message });
  }
});

module.exports = router;
