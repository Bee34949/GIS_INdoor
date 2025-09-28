// why: ใช้กับ route ที่ต้อง auth
const { auth } = require("../services/firebase");
async function verifyFirebaseToken(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing bearer token" });
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid token" });
  }
}
module.exports = verifyFirebaseToken;
