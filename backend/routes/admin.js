// ตัวอย่าง route (ว่างได้) — กัน 404 ที่คุณ mount ไว้ใน server.js
const express4 = require("express");
const router4 = express4.Router();
router4.get("/", (_req,res)=> res.json({ ok:true, admin:true }));
module.exports = router4;