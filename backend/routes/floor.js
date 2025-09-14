// backend/routes/floor.js
const express = require("express");
const router = express.Router();
const { db } = require("../services/firebase");

// ดึง nodes ของ floor จาก Firestore
router.get("/:floorId/nodes", async (req, res) => {
  try {
    const floorId = parseInt(req.params.floorId);
    const snapshot = await db.collection("nodes").where("floor", "==", floorId).get();

    if (snapshot.empty) {
      return res.json([]);
    }

    const nodes = [];
    snapshot.forEach(doc => {
      nodes.push({ id: doc.id, ...doc.data() });
    });

    res.json(nodes);
  } catch (err) {
    console.error("❌ Error loading nodes:", err);
    res.status(500).json({ error: "Failed to fetch nodes" });
  }
});

module.exports = router;
