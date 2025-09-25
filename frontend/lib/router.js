// FILE: frontend/lib/router.js
// เส้นทางข้ามชั้น + บรรยายข้อความ (ทำไม: แยก logic ออกจากการวาด)
import { keyOf, parseKey } from "./graph.js";

export function dijkstra(G, start, goal){
  const D = new Map(), P = new Map(), Q = new Set(Object.keys(G));
  for(const v of Q) D.set(v, Infinity);
  D.set(start, 0);
  while(Q.size){
    let u=null, best=Infinity;
    for(const v of Q){ const dv=D.get(v); if(dv<best){best=dv; u=v;} }
    if(u===null) break;
    Q.delete(u);
    if(u===goal) break;
    for(const e of (G[u]||[])){
      if(!Q.has(e.v)) continue;
      const alt = D.get(u) + e.w;
      if(alt < D.get(e.v)){ D.set(e.v, alt); P.set(e.v, u); }
    }
  }
  if(!P.has(goal) && start!==goal) return null;
  const path = [];
  let u = goal; while(u){ path.unshift(u); if(u===start) break; u = P.get(u); if(!u) break; }
  return path;
}

export function segmentByFloor(path){
  if(!path || !path.length) return [];
  const segs = [];
  let cur = { floor: parseKey(path[0]).floor, nodes:[path[0]] };
  for(let i=1;i<path.length;i++){
    const k = path[i], f = parseKey(k).floor;
    if(f!==cur.floor){ segs.push(cur); cur={ floor:f, nodes:[k] }; }
    else cur.nodes.push(k);
  }
  segs.push(cur);
  return segs;
}

export function narrate(segs, meta, {start, goal}){
  const steps = [];
  if(!segs.length){ steps.push("ไม่พบเส้นทาง"); return steps; }

  // first segment
  const s0 = segs[0];
  const sStart = meta.byKey[start], sGoal = meta.byKey[goal];
  if(s0.nodes.length===1) steps.push(`เริ่มที่ ชั้น ${s0.floor}: ${nodeLabel(sStart)}`);

  for(let i=0;i<segs.length;i++){
    const seg = segs[i];
    const fromKey = seg.nodes[0], toKey = seg.nodes[seg.nodes.length-1];
    const from = meta.byKey[fromKey], to = meta.byKey[toKey];

    if(seg.nodes.length <= 1){
      steps.push(`ชั้น ${seg.floor}: ไม่มีเส้นทางในชั้นนี้`);
    }else{
      steps.push(`ชั้น ${seg.floor}: เดินจาก ${nodeLabel(from)} → ${nodeLabel(to)}`);
    }

    // cross-floor hint
    const next = segs[i+1];
    if(next){
      const xA = parseKey(toKey), xB = parseKey(next.nodes[0]);
      if(xA.floor !== xB.floor){
        const t = connectorType(meta, toKey, next.nodes[0]) || "connector";
        const dir = xB.floor > xA.floor ? "ขึ้น" : "ลง";
        steps.push(`ใช้ ${thaiType(t)} เพื่อ${dir}ไป ชั้น ${xB.floor}`);
      }
    }
  }

  steps.push(`ถึงเป้าหมาย: ชั้น ${parseKey(segs[segs.length-1].nodes.at(-1)).floor}: ${nodeLabel(sGoal)}`);
  return steps;
}

function nodeLabel(n){ return n?.name || n?.id || "(unknown)"; }
function connectorType(meta, kA, kB){
  // why: ไม่มี type บน edge → เดาโดยดูชนิดโหนดปลายทาง
  const na = meta.byKey[kA], nb = meta.byKey[kB];
  const ta = (na?.type||"").toLowerCase(), tb=(nb?.type||"").toLowerCase();
  if(ta.includes("elevator") || tb.includes("elevator")) return "elevator";
  if(ta.includes("stair_left")||tb.includes("stair_left")) return "stair_left";
  if(ta.includes("stair_mid") ||tb.includes("stair_mid"))  return "stair_mid";
  if(ta.includes("stair_right")||tb.includes("stair_right")) return "stair_right";
  if(ta.includes("stair")||tb.includes("stair")) return "stair";
  return null;
}
function thaiType(t){
  if(t==="elevator") return "ลิฟต์";
  if(t==="stair_left") return "บันได (ซ้าย)";
  if(t==="stair_mid") return "บันได (กลาง)";
  if(t==="stair_right") return "บันได (ขวา)";
  if(t==="stair") return "บันได";
  return "ทางเชื่อม";
}

export function planRoute(multi, start, goal){
  const startKey = keyOf(start.floor, start.id);
  const goalKey  = keyOf(goal.floor,  goal.id);
  if(!multi.meta.byKey[startKey] || !multi.meta.byKey[goalKey]) return { path:null, segments:[], steps:["จุดเริ่ม/ปลายทางไม่ถูกต้อง"] };
  const path = dijkstra(multi.G, startKey, goalKey);
  if(!path) return { path:null, segments:[], steps:["ไม่พบเส้นทางที่เป็นไปได้ (ไม่มีตัวเชื่อม/เส้นทางภายในชั้น)"] };
  const segments = segmentByFloor(path);
  const steps = narrate(segments, multi.meta, {start:startKey, goal:goalKey});
  return { path, segments, steps };
}
