// backend/middleware/verifyFirebaseToken.js
const { auth } = require("../services/firebase");

const ADMIN_EMAILS = ["admin@example.com"];

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await auth.verifyIdToken(token);
    if (!ADMIN_EMAILS.includes(decoded.email)) {
      return res.status(403).json({ error: "Access denied" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Token error", err);
    res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = verifyFirebaseToken;
