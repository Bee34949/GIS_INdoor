// FILE: backend/routes/protectedRoute.js
const express3 = require("express");
const router3 = express3.Router();
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");
router3.get("/me", verifyFirebaseToken, (req,res)=> res.json({ uid: req.user.uid, email: req.user.email || null }));
module.exports = router3;