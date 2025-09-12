// backend/routes/floor.js
// backend/routes/floor.js


// ... route logic ...



const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// โหลด nodes.csv ของแต่ละชั้น
router.get('/:floorId/nodes', (req, res) => {
  const floorId = req.params.floorId;
  const filePath = path.join(__dirname, '..', 'data', `floor${floorId}`, 'nodes.csv');

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(404).json({ error: 'File not found' });
    }

    // แปลง CSV เป็น JSON object (ง่าย ๆ)
    const lines = data.trim().split('\n');
    const header = lines.shift().split(',');

    const result = lines.map(line => {
      const values = line.split(',');
      const obj = {};
      header.forEach((h, i) => (obj[h] = values[i]));
      return obj;
    });

    res.json(result);
  });
});

module.exports = router;
