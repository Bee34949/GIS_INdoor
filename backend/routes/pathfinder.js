const express = require('express');
const router = express.Router();

// (ยังไม่ต้องมีอะไรในนี้ก็ได้)
router.get('/', (req, res) => {
  res.send('Pathfinder works!');
});

module.exports = router; // ✅ อันนี้สำคัญมาก
