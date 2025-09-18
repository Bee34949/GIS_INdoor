// backend/routes/protectedRoute.js
const express = require("express");
const router = express.Router();
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");

router.post("/nodes", verifyFirebaseToken, async (req, res) => {
  // เพิ่ม node ได้เฉพาะ admin
  res.json({ message: "คุณเป็น admin แล้ว!" });
});

module.exports = router;
