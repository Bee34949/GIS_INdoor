const express = require("express");
const router = express.Router();

// WHY: placeholder to avoid 404 from older imports
router.get("/", (_req, res) => res.json({ ok: true, msg: "admin stub" }));

module.exports = router;
