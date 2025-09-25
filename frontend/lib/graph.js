// สร้างกราฟหลายชั้น + กติกาข้ามชั้น (ทำไม: แยก concerns ออกจาก UI)
export function keyOf(floor, id) { return `${floor}::${id}`; }
export function parseKey(k){ const [f,id]=k.split("::"); return { floor:+f, id }; }
const STAIRS = new Set(["stair_left","stair_mid","stair_right","stair"]);
const ELEV   = new Set(["elevator"]);

function addEdge(G, a, b, w){
  (G[a] ||= []).push({v:b, w}); (G[b] ||= []).push({v:a, w}); // bidirectional
}

export function buildMultiLayer({baseNodes, adminEdges, interEdges}, opts = {}){
  const useAdmin = !!opts.useAdmin; // why: ให้ editor เรียนรู้ก่อน apply
  const nodesByFloor = useAdmin ? opts.nodes || {} : baseNodes;
  const edgesByFloor = useAdmin ? opts.edges || {} : {}; // อาจว่างได้
  const G = {};
  const meta = { byKey: {}, connectors: new Set() };

  // nodes
  for(const [fStr, nodes] of Object.entries(nodesByFloor)){
    const f = +fStr;
    for(const [id,n] of Object.entries(nodes)){
      const k = keyOf(f,id);
      meta.byKey[k] = { ...n, id, floor:f };
    }
  }

  // in-floor edges: ใช้ที่มี; ถ้าไม่มี ให้สร้าง fully-connected แบบค่าน้ำหนักเป็นระยะ (ปลอดภัยแต่ช้าในชุดเล็ก)
  const needDense = (ff)=>!edgesByFloor?.[ff]?.length;
  for(const f of Object.keys(nodesByFloor).map(Number)){
    const nodes = nodesByFloor[f] || {};
    const ids = Object.keys(nodes);
    const eList = edgesByFloor?.[f] || [];
    if(eList.length){
      for(const e of eList){
        const a = keyOf(f, e.from), b = keyOf(f, e.to);
        if(meta.byKey[a] && meta.byKey[b]) addEdge(G, a, b, e.weight ?? dist(meta.byKey[a], meta.byKey[b]));
      }
    }else if(opts.fallbackDense){
      for(let i=0;i<ids.length;i++){
        for(let j=i+1;j<ids.length;j++){
          const a = keyOf(f, ids[i]), b = keyOf(f, ids[j]);
          addEdge(G, a, b, dist(meta.byKey[a], meta.byKey[b]));
        }
      }
    }
    // mark “no route in floor” hint
    if(needDense(f) && !opts.fallbackDense) meta[`noEdges:${f}`] = true;
  }

  // inter-layer edges with constraints
  for(const e of interEdges || []){
    const from = e.from, to = e.to;
    const a = keyOf(from.floor, from.id);
    const b = keyOf(to.floor,   to.id);
    if(!meta.byKey[a] || !meta.byKey[b]) continue;

    const t = (e.type||"").toLowerCase();
    const isElev = ELEV.has(t);
    const isStair = STAIRS.has(t);

    if(!isElev && !isStair) continue; // เฉพาะลิฟต์/บันได
    const w = opts.interCost?.[t] ?? 5; // why: ลด/เพิ่มน้ำหนักข้ามชั้น
    addEdge(G, a, b, w);
    meta.connectors.add(a); meta.connectors.add(b);
  }

  return { G, meta };
}

export function dist(a,b){ return Math.hypot((a.x||0)-(b.x||0), (a.y||0)-(b.y||0)) || 1; }
