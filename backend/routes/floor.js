const express = require("express");
const router = express.Router();
const { db } = require("../services/firebase");

// sync โหนด/ขอบต่อชั้น
router.post("/sync-floor", async (req, res) => {
  try {
    const { floor, nodes, edges } = req.body || {};
    if (!Number.isFinite(floor)) return res.status(400).json({ error: "floor required" });
    const batch = db.batch();
    const floorDoc = db.collection("floors").doc(String(floor));
    batch.set(floorDoc, { updatedAt: Date.now() }, { merge: true });

    const nodesRef = floorDoc.collection("nodes");
    const edgesRef = floorDoc.collection("edges");

    const oldNodes = await nodesRef.get();
    oldNodes.forEach(d => batch.delete(nodesRef.doc(d.id)));

    for (const [id, n] of Object.entries(nodes || {})) {
      batch.set(nodesRef.doc(id), { ...n, id, floor: Number(floor) });
    }

    const oldEdges = await edgesRef.get();
    oldEdges.forEach(d => batch.delete(edgesRef.doc(d.id)));

    (edges || []).forEach((e, i) => {
      batch.set(edgesRef.doc(String(i)), { ...e, floor: Number(floor) });
    });

    await batch.commit();
    res.json({ ok: true, floor, nodesCount: Object.keys(nodes||{}).length, edgesCount: (edges||[]).length });
  } catch (e) {
    console.error(e); res.status(500).json({ error: "sync-floor failed" });
  }
});

// ดึงข้อมูลพื้นฐานชั้น (option ใช้บน frontend)
router.get("/floor/:floor", async (req, res) => {
  try {
    const floor = Number(req.params.floor);
    if (!Number.isFinite(floor)) return res.status(400).json({ error: "bad floor" });
    const floorDoc = db.collection("floors").doc(String(floor));
    const [nodesSnap, edgesSnap] = await Promise.all([
      floorDoc.collection("nodes").get(),
      floorDoc.collection("edges").get()
    ]);
    const nodes = {}; nodesSnap.forEach(d => nodes[d.id] = d.data());
    const edges = []; edgesSnap.forEach(d => edges.push(d.data()));
    res.json({ floor, nodes, edges });
  } catch (e) {
    console.error(e); res.status(500).json({ error: "get floor failed" });
  }
});

module.exports = router;
