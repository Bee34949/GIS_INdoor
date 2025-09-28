// FILE: backend/routes/pathfinder.js
// Patch: deterministic UUID (v5), embed includes id+aliases, threshold=0.0, +/reindex
const express = require("express");
const router = express.Router();
const { db } = require("../services/firebase");
const { qdrantClientFromEnv, ensureCollection, embed } = require("../services/qdrant");
const { v5: uuidv5, validate: uuidValidate } = require("uuid");

// Qdrant init
const qdrant = qdrantClientFromEnv();
let COLLECTION = process.env.QDRANT_COLLECTION || "mju_poi";
let QDRANT_READY = (async () => {
  try { COLLECTION = await ensureCollection(qdrant, COLLECTION); return true; }
  catch (e) { console.error("[QDRANT_INIT]", e?.message||e); return false; }
})();
async function ensureQdrantReady(res){
  const ok = await QDRANT_READY;
  if(!ok){ res.status(503).json({ error:"Qdrant not ready" }); return false; }
  return true;
}

// Deterministic point id: UUIDv5 from "mju-poi:"+id  (ไม่เปลี่ยนแม้รีสตาร์ต)
const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace
function toPointIdStable(id){
  if (Number.isInteger(id)) return id;
  const s = String(id);
  if (uuidValidate(s)) return s;
  return uuidv5("mju-poi:"+s, NS);
}

// Upsert POI
router.post("/poi", async (req,res)=>{
  try{
    if(!(await ensureQdrantReady(res))) return;
    const { id, name, type, floor, x, y, desc, aliases } = req.body || {};
    if(!id || !name || !Number.isFinite(floor)) return res.status(400).json({ error:"id,name,floor required" });

    const normAliases = Array.isArray(aliases) ? aliases.filter(Boolean) : [];
    const data = {
      id: String(id),
      name,
      type: type || "poi",
      floor: Number(floor),
      x: +x || 0,
      y: +y || 0,
      desc: desc || null,
      aliases: normAliases,
      updatedAt: Date.now(),
    };

    await db.collection("pois").doc(String(id)).set(data, { merge: true });

    const textForEmbedding = [id, name, type, desc, ...normAliases].filter(Boolean).join(" ");
    const vector = embed(textForEmbedding);
    const pointId = toPointIdStable(id);

    await qdrant.upsert(COLLECTION, {
      wait: true,
      points: [{ id: pointId, vector, payload: data }]
    });

    res.json({ ok:true, id:String(id), pointId });
  }catch(e){
    console.error("[/api/poi]", e?.message||e);
    res.status(500).json({ error:"poi upsert failed", detail:String(e?.message||e) });
  }
});

// Semantic search
router.get("/search", async (req,res)=>{
  try{
    if(!(await ensureQdrantReady(res))) return;
    const q = String(req.query.q || "").trim();
    const topK = Math.max(1, Math.min(20, +(req.query.topK||5)));
    if(!q) return res.status(400).json({ error:"q required" });

    const vector = embed(q);
    const result = await qdrant.search(COLLECTION, {
      vector, limit: topK, with_payload: true, score_threshold: 0.0
    });
    const hits = (result||[]).map(h => ({ id:h.id, score:h.score, ...h.payload }));
    res.json({ q, topK, hits });
  }catch(e){
    res.status(500).json({ error:"search failed", detail:String(e?.message||e) });
  }
});

// Reindex from Firestore → Qdrant (embed using latest logic)
router.post("/reindex", async (_req,res)=>{
  try{
    if(!(await ensureQdrantReady(res))) return;
    const snap = await db.collection("pois").get();
    const points = [];
    snap.forEach(doc=>{
      const p = doc.data();
      const aliases = Array.isArray(p.aliases) ? p.aliases.filter(Boolean) : [];
      const text = [p.id, p.name, p.type, p.desc, ...aliases].filter(Boolean).join(" ");
      points.push({
        id: toPointIdStable(p.id),
        vector: embed(text),
        payload: p
      });
    });
    // batch upsert (ถ้าเยอะควรแบ่งเป็นก้อน ๆ)
    await qdrant.upsert(COLLECTION, { wait:true, points });
    res.json({ ok:true, upserted: points.length });
  }catch(e){
    console.error("[/reindex]", e?.message||e);
    res.status(500).json({ error:"reindex failed", detail:String(e?.message||e) });
  }
});

module.exports = router;
