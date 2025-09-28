// FILE: backend/server.js
const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const net = require("net");
dotenv.config();

const app = express();
const BASE_PORT = Number(process.env.PORT || 3000);
const MAX_TRY = 10;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

// optional services for /health/full
let db, qdrantClient, getCollections;
try { ({ db } = require("./services/firebase")); } catch {}
try {
  const { qdrantClientFromEnv } = require("./services/qdrant");
  qdrantClient = qdrantClientFromEnv();
  getCollections = () => qdrantClient.getCollections();
} catch {}

// health endpoints
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/health/full", async (_req, res) => {
  const out = { ok: true, env: { PORT: serverPort ?? BASE_PORT, QDRANT_URL: process.env.QDRANT_URL || null, QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || "mju_poi" } };
  try { if (db) { await db.listCollections(); out.firestore = "ok"; } else out.firestore = "skipped"; } catch (e) { out.ok=false; out.firestore=String(e.message||e); }
  try { if (getCollections) out.qdrant = await getCollections(); else out.qdrant = "skipped"; } catch (e) { out.ok=false; out.qdrant=String(e.message||e); }
  res.status(out.ok?200:503).json(out);
});

// mount routes (safe)
app.use("/api",   safeRequire("./routes/pathfinder.js"));
app.use("/api",   safeRequire("./routes/floor.js"));
app.use("/api",   safeRequire("./routes/protectedRoute.js"));
app.use("/admin", safeRequire("./routes/admin.js"));

// static frontend
app.use(express.static(path.join(__dirname, "../frontend")));

let serverPort = null;
findFreePort(BASE_PORT, BASE_PORT + MAX_TRY).then((port) => {
  serverPort = port;
  app.listen(serverPort, () => {
    console.log(`🚀 Backend at http://localhost:${serverPort}`);
    console.log(`[ENV] QDRANT_URL=${process.env.QDRANT_URL || "-"}  QDRANT_COLLECTION=${process.env.QDRANT_COLLECTION || "mju_poi"}`);
  });
}).catch((e) => {
  console.error("No free port found near", BASE_PORT, e);
  process.exit(1);
});

// helpers
function safeRequire(p) {
  try { return require(p); }
  catch (e) { console.warn("[route skipped]", p, "-", e?.message || e); return (_req, _res, next) => next(); }
}
function isPortFree(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().once("error", err => (err.code === "EADDRINUSE" ? resolve(false) : reject(err)))
                                 .once("listening", () => srv.close(() => resolve(true)))
                                 .listen(port, "0.0.0.0");
  });
}
async function findFreePort(start, end) {
  for (let p = start; p <= end; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) return p;
  }
  throw new Error("no free port");
}
