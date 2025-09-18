// debugNodes.js
const fetch = require("node-fetch");
require("dotenv").config();

const QDRANT_URL = process.env.QDRANT_URL;
const API_KEY = process.env.QDRANT_API_KEY;

async function qdrantScroll(collection, filter) {
  const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY
    },
    body: JSON.stringify({ filter, limit: 1000 })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Qdrant scroll failed: ${res.status} ${res.statusText} - ${errText}`);
  }

  const data = await res.json();
  return data.result.points || [];
}

(async () => {
  try {
    const floor = 1;
    console.log("QDRANT_URL:", QDRANT_URL);
    console.log("API_KEY (first 5):", API_KEY ? API_KEY.slice(0,5) : "MISSING");

    // แบบที่ 1: ไม่ filter
    const nodesNoFilter = await qdrantScroll("indoor_nodes", {});
    const nodeList1 = nodesNoFilter.map(p => p.payload).filter(n => n.id);
    console.log(`\n✅ No filter: Found ${nodeList1.length} nodes`);
    console.log(nodeList1.slice(0, 5));

    // แบบที่ 2: filter floor เป็น integer
    const nodesInt = await qdrantScroll("indoor_nodes", {
      must: [{ key: "floor", match: { value: floor } }]
    });
    const nodeList2 = nodesInt.map(p => p.payload).filter(n => n.id);
    console.log(`\n✅ Filter floor=${floor} (int): Found ${nodeList2.length} nodes`);
    console.log(nodeList2.slice(0, 5));

    // แบบที่ 3: filter floor เป็น string
    const nodesStr = await qdrantScroll("indoor_nodes", {
      must: [{ key: "floor", match: { value: String(floor) } }]
    });
    const nodeList3 = nodesStr.map(p => p.payload).filter(n => n.id);
    console.log(`\n✅ Filter floor="${floor}" (string): Found ${nodeList3.length} nodes`);
    console.log(nodeList3.slice(0, 5));

    // ตรวจสอบ node target
    const targetIds = ["1_56", "1_21"];
    [nodeList1, nodeList2, nodeList3].forEach((list, idx) => {
      console.log(`\n--- Check targets (mode ${idx+1}) ---`);
      targetIds.forEach(id => {
        const found = list.find(n => n.id === id);
        console.log(found ? `✅ Node ${id} found` : `❌ Node ${id} not found`);
      });
    });

  } catch (err) {
    console.error("❌ Error:", err);
  }
})();
