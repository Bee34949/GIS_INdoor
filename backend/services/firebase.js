// FILE: backend/services/firebase.js
// (ใช้ไฟล์ของคุณได้เลย — แนบไว้เพื่อความครบ)
// why: ใช้ service account โดยตรง ไม่ผ่าน client SDK
const admin = require("firebase-admin");
const path = require("path");
const serviceAccount = require(path.join(__dirname, "Servicekey.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();
module.exports = { admin, db, auth };