// why: ห่อ Qdrant + ตัวฝังเวกเตอร์แบบเบา (ไม่พึ่ง API ภายนอก)
const { QdrantClient } = require("@qdrant/js-client-rest");

const DIM = 256; // ขนาดเวกเตอร์ง่ายๆ

function qdrantClientFromEnv() {
  const url = process.env.QDRANT_URL || "http://localhost:6333";
  const apiKey = process.env.QDRANT_API_KEY || undefined;
  return new QdrantClient({ url, apiKey });
}

async function ensureCollection(client, name) {
  const coll = name || process.env.QDRANT_COLLECTION || "mju_poi";
  const exists = await client.getCollection(coll).then(()=>true).catch(()=>false);
  if (!exists) {
    await client.createCollection(coll, { vectors: { size: DIM, distance: "Cosine" } });
    // payload indexes (why: filter/sort เร็วขึ้น)
    for (const field of ["name","type"]) {
      try { await client.createPayloadIndex(coll, { field_name: field, field_schema: "keyword" }); } catch {}
    }
    try { await client.createPayloadIndex(coll, { field_name: "floor", field_schema: "integer" }); } catch {}
  }
  return coll;
}

// embed แบบ hashing ไม่ง้อโมเดลภายนอก (พอใช้เดโม/ทดสอบ)
function embed(text) {
  const v = new Array(DIM).fill(0);
  const toks = String(text||"").toLowerCase().split(/[^a-z0-9ก-๙]+/i).filter(Boolean);
  for (const t of toks) {
    let h = 2166136261; // FNV-like
    for (let i=0;i<t.length;i++){ h ^= t.charCodeAt(i); h += (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24); }
    v[Math.abs(h)%DIM] += 1;
  }
  const n = Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1;
  return v.map(x=>x/n);
}

module.exports = { qdrantClientFromEnv, ensureCollection, embed, DIM };