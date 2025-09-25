// FILE: frontend/app.js
// App (1–6 floors) + Cross-floor routing with elevator/stairs fallback + Multi-floor preview

// ---------- Helpers / Basics ----------
function getNodeSafe(floor, id) {
  const f = Number(floor);
  return (baseNodes?.[f] || {})[id] || null; // กัน undefined
}

const FLOORS = [1, 2, 3, 4, 5, 6];
const makeFloorMap = (initVal) =>
  FLOORS.reduce((acc, f) => {
    acc[f] =
      typeof initVal === "function"
        ? initVal(f)
        : JSON.parse(JSON.stringify(initVal || {}));
    return acc;
  }, {});
const STAIRS = new Set(["stair_left","stair_mid","stair_right","stair"]);
const ELEV = new Set(["elevator"]);

let currentPage = null;
let currentFloor = 1;
let baseNodes = makeFloorMap({});
let adminNodes = makeFloorMap({});
let adminEdges = makeFloorMap([]);   // same-floor edges
let interEdges = [];                  // [{from:{floor,id}, to:{floor,id}, type}]
let tool = "select", connectBuffer = [], dragging = null, selected = null;

const deepClone = (o)=>JSON.parse(JSON.stringify(o));
const isAdmin = ()=> currentPage==="admin";
const svgEl = ()=> document.querySelector("svg");
const escId = (s)=> (s||"").replace(/[^A-Za-z0-9_-]/g,"");
const euclid = (a,b)=> Math.hypot((a?.x||0)-(b?.x||0),(a?.y||0)-(b?.y||0));
const clampFloor = f => (FLOORS.includes(Number(f)) ? Number(f) : FLOORS[0]);
function getNodes(floor){ return isAdmin()? adminNodes[floor] : baseNodes[floor]; }

// ---------- Graph (multi-floor) ----------
const keyOf = (f,id)=>`${f}::${id}`;
const parseKey = k => ({ floor:+k.split("::")[0], id:k.split("::")[1] });

function buildMultiLayer({nodesByFloor, edgesByFloor, interEdges}, {fallbackDense=false, interCost={}} = {}){
  const G = {}; const meta = { byKey:{}, connectors:new Set(), noEdges:{} };

  // nodes
  for(const f of FLOORS){
    const N = nodesByFloor[f] || {};
    for(const [id,n] of Object.entries(N)){ meta.byKey[keyOf(f,id)] = { ...n, id, floor:f }; }
  }

  // in-floor edges
  for(const f of FLOORS){
    const N = nodesByFloor[f] || {};
    const E = edgesByFloor?.[f] || [];
    const ids = Object.keys(N);
    if(E.length){
      for(const e of E){
        const a = keyOf(f,e.from), b = keyOf(f,e.to);
        addEdge(G, a, b, e.weight ?? euclid(meta.byKey[a], meta.byKey[b]));
      }
    }else{
      meta.noEdges[f]=true;
      if(fallbackDense){
        for(let i=0;i<ids.length;i++){
          for(let j=i+1;j<ids.length;j++){
            const a = keyOf(f,ids[i]), b = keyOf(f,ids[j]);
            addEdge(G, a, b, euclid(meta.byKey[a], meta.byKey[b]));
          }
        }
      }
    }
  }

  // inter-floor edges (only elevator/stairs)
  for(const e of (interEdges||[])){
    const ta = (e.type||"").toLowerCase();
    if(!ELEV.has(ta) && !STAIRS.has(ta)) continue;
    const a = keyOf(e.from.floor, e.from.id), b = keyOf(e.to.floor, e.to.id);
    if(!meta.byKey[a] || !meta.byKey[b]) continue;
    const w = Number.isFinite(interCost[ta]) ? interCost[ta] : 5;
    addEdge(G, a, b, w);
    meta.connectors.add(a); meta.connectors.add(b);
  }

  return { G, meta };
}
function addEdge(G,a,b,w){ (G[a] ||= []).push({v:b,w}); (G[b] ||= []).push({v:a,w}); }

function dijkstra(G, start, goal){
  const D = new Map(), P = new Map(), Q = new Set(Object.keys(G));
  for(const v of Q) D.set(v, Infinity);
  if(!Q.has(start) || !Q.has(goal)){ return null; }
  D.set(start,0);
  while(Q.size){
    let u=null, best=Infinity;
    for(const v of Q){ const dv=D.get(v); if(dv<best){best=dv; u=v;} }
    if(u===null) break;
    Q.delete(u);
    if(u===goal) break;
    for(const e of (G[u]||[])){
      if(!Q.has(e.v)) continue;
      const alt = D.get(u)+e.w;
      if(alt < D.get(e.v)){ D.set(e.v,alt); P.set(e.v,u); }
    }
  }
  if(start!==goal && !P.has(goal)) return null;
  const path=[]; let u=goal; while(u){ path.unshift(u); if(u===start) break; u=P.get(u); if(!u) break; }
  return path;
}
function segmentByFloor(path){
  if(!path || !path.length) return [];
  const segs=[]; let cur={floor:parseKey(path[0]).floor,nodes:[path[0]]};
  for(let i=1;i<path.length;i++){
    const f=parseKey(path[i]).floor;
    if(f!==cur.floor){ segs.push(cur); cur={floor:f,nodes:[path[i]]}; } else cur.nodes.push(path[i]);
  }
  segs.push(cur); return segs;
}
function connectorType(meta, a, b){
  const na=meta.byKey[a], nb=meta.byKey[b];
  const ta=(na?.type||"").toLowerCase(), tb=(nb?.type||"").toLowerCase();
  if(ta.includes("elevator")||tb.includes("elevator")) return "elevator";
  if(ta.includes("stair_left")||tb.includes("stair_left")) return "stair_left";
  if(ta.includes("stair_mid") ||tb.includes("stair_mid"))  return "stair_mid";
  if(ta.includes("stair_right")||tb.includes("stair_right")) return "stair_right";
  if(ta.includes("stair")||tb.includes("stair")) return "stair";
  return "connector";
}
function thConnLabel(t){
  if(t==="elevator") return "ลิฟต์";
  if(t==="stair_left") return "บันได (ซ้าย)";
  if(t==="stair_mid") return "บันได (กลาง)";
  if(t==="stair_right") return "บันได (ขวา)";
  if(t==="stair") return "บันได";
  return "ทางเชื่อม";
}
function narrate(segs, meta, {startKey,goalKey}){
  const steps=[];
  if(!segs.length) return ["ไม่พบเส้นทาง"];
  const start = meta.byKey[startKey], goal = meta.byKey[goalKey];
  steps.push(`เริ่มที่ ชั้น ${start.floor}: ${start.name||start.id}`);
  for(let i=0;i<segs.length;i++){
    const s=segs[i], nodes=s.nodes;
    if(nodes.length<=1){
      steps.push(`ชั้น ${s.floor}: ไม่มีเส้นทางในชั้นนี้`);
    }else{
      const a = meta.byKey[nodes[0]], b = meta.byKey[nodes[nodes.length-1]];
      steps.push(`ชั้น ${s.floor}: เดินจาก ${a.name||a.id} → ${b.name||b.id}`);
    }
    const next = segs[i+1];
    if(next){
      const fromKey = nodes[nodes.length-1], toKey = next.nodes[0];
      const dir = next.floor > s.floor ? "ขึ้น" : "ลง";
      steps.push(`ใช้ ${thConnLabel(connectorType(meta, fromKey, toKey))} เพื่อ${dir}ไป ชั้น ${next.floor}`);
    }
  }
  steps.push(`ถึงเป้าหมาย ชั้น ${goal.floor}: ${goal.name||goal.id}`);
  return steps;
}
function planCrossFloorRoute(start, goal){
  const multi = buildMultiLayer({
    nodesByFloor: baseNodes,
    edgesByFloor: adminEdges,
    interEdges
  }, { fallbackDense: true, interCost: { elevator:3, stair_left:5, stair_mid:5, stair_right:5, stair:5 } });

  const startKey = keyOf(start.floor,start.id), goalKey = keyOf(goal.floor,goal.id);
  if(!multi.meta.byKey[startKey] || !multi.meta.byKey[goalKey]) return {path:null, segments:[], steps:["จุดเริ่ม/ปลายทางไม่ถูกต้อง"]};
  const path = dijkstra(multi.G, startKey, goalKey);
  if(!path) return {path:null, segments:[], steps:["ไม่พบเส้นทางที่เป็นไปได้ (ไม่มีตัวเชื่อม/เส้นทางภายในชั้น)"]};
  const segs = segmentByFloor(path);
  const steps = narrate(segs, multi.meta, {startKey,goalKey});
  return { path, segments: segs, steps, meta: multi.meta };
}

// ---------- KNN (in-floor auto edges) ----------
function _floorNodeEntries(floor){
  return Object.entries(baseNodes?.[floor] || {}).filter(([,n]) => +n.floor === +floor);
}
function knnGraphForFloor(floor, k = 6){
  const entries = _floorNodeEntries(floor);
  const byKey = {}; const G = {}; const ids = entries.map(([id]) => id);
  if (entries.length < 2) return { G: {}, byKey, ids };

  const pts = entries.map(([id, n]) => ({ id, x: +n.x || 0, y: +n.y || 0 }));
  for (const p of pts) byKey[p.id] = { ...baseNodes[floor][p.id], id: p.id, floor };

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], cand = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const b = pts[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1e-6;
      cand.push({ id: b.id, d });
    }
    cand.sort((x, y) => x.d - y.d);
    const nbrs = cand.slice(0, Math.min(k, cand.length));
    for (const nb of nbrs) {
      (G[a.id] ||= []).push({ v: nb.id, w: nb.d });
      (G[nb.id] ||= []).push({ v: a.id, w: nb.d });
    }
  }
  return { G, byKey, ids };
}
function dijkstraIds(G, startId, goalId){
  const V = Object.keys(G);
  if (!V.includes(startId) || !V.includes(goalId)) return null;
  const D = new Map(), P = new Map(), Q = new Set(V);
  for (const v of V) D.set(v, Infinity);
  D.set(startId, 0);
  while (Q.size) {
    let u = null, best = Infinity;
    for (const v of Q) { const dv = D.get(v); if (dv < best) { best = dv; u = v; } }
    if (u === null) break;
    Q.delete(u);
    if (u === goalId) break;
    for (const e of (G[u] || [])) {
      if (!Q.has(e.v)) continue;
      const alt = D.get(u) + e.w;
      if (alt < D.get(e.v)) { D.set(e.v, alt); P.set(e.v, u); }
    }
  }
  if (startId !== goalId && !P.has(goalId)) return null;
  const path = []; let u = goalId;
  while (u) { path.unshift(u); if (u === startId) break; u = P.get(u); if (!u) break; }
  return path;
}
function planInFloorRouteKNN(floor, fromId, toId, k = 6){
  const { G, byKey, ids } = knnGraphForFloor(floor, k);
  if (ids.length < 2) return { path: null, meta: { byKey: {} }, reason: `ชั้น ${floor} มีโหนดไม่พอ` };
  const pathIds = dijkstraIds(G, fromId, toId);
  if (!pathIds) return { path: null, meta: { byKey }, reason: `ชั้น ${floor} ยังเชื่อมโหนดไม่ถึงกัน` };
  const pathKeys = pathIds.map(id => `${floor}::${id}`);
  const meta = { byKey: Object.fromEntries(Object.entries(byKey).map(([id, n]) => [`${floor}::${id}`, n])) };
  return { path: pathKeys, meta };
}

// ---------- Connector detection (elevator/stairs) ----------
function _norm(s){ return (s||"").toString().toLowerCase().trim(); }
function _isElevatorLike(n){
  const t = _norm(n?.type), nm = _norm(n?.name);
  if (t.includes("elevator")) return true;
  return /(ลิฟ(ต์|ท์)?|elev(at(or)?)?|(^|\b)elv\b|(^|\b)lift\b)/i.test(nm);
}
function _isStairLike(n){
  const t = _norm(n?.type), nm = _norm(n?.name);
  if (t==="stair" || t.startsWith("stair_")) return true;
  return /(stair|บันได)/i.test(nm);
}
function _connectorsOfFloor(floor){
  const nodes = baseNodes?.[floor] || {};
  const list = [];
  for (const [id, n] of Object.entries(nodes)){
    if (_isElevatorLike(n)) list.push({id, kind:"elevator", ...n});
    else if (_isStairLike(n)) list.push({id, kind:"stair", ...n});
  }
  return list;
}
function elevatorNodesOfFloor(floor){
  const cons = _connectorsOfFloor(floor);
  const elev = cons.filter(c => c.kind==="elevator");
  return elev.length ? elev : cons.filter(c => c.kind==="stair"); // fallback
}
function nearestElevator(floor, ref){
  const list = elevatorNodesOfFloor(floor);
  if (!list.length) return null;
  const p = typeof ref === "string" ? getNodeSafe(floor, ref) : ref;
  if (!p) return list[0];
  let best=list[0], dmin=Infinity;
  for (const e of list){
    const d = Math.hypot((e.x||0)-(p.x||0), (e.y||0)-(p.y||0));
    if (d < dmin){ dmin=d; best=e; }
  }
  return best;
}

// ---------- Smart planner ----------
function planCrossFloorRouteSmart(start, goal){
  const sameFloor = +start.floor === +goal.floor;

  // ชั้นเดียว → KNN
  if (sameFloor) {
    const r = planInFloorRouteKNN(start.floor, start.id, goal.id, 6);
    if (r.path) {
      const segs = [{ floor: +start.floor, nodes: r.path }];
      const steps = [`ชั้น ${start.floor}: เดินจาก ${(baseNodes[start.floor][start.id]?.name||start.id)} → ${(baseNodes[goal.floor][goal.id]?.name||goal.id)}`];
      return { path: r.path, segments: segs, steps, meta: r.meta };
    }
  }

  // ปกติ (ใช้ interEdges ถ้ามี)
  const normal = planCrossFloorRoute(start, goal);
  if (normal.path) return normal;

  // ลิฟต์/บันได + KNN
  const sFloor = clampFloor(start.floor), gFloor = clampFloor(goal.floor);
  const sNode  = start.id, gNode = goal.id;
  const sP = baseNodes?.[sFloor]?.[sNode], gP = baseNodes?.[gFloor]?.[gNode];
  if (!sP || !gP) {
    const why = [];
    if (!sP) why.push(`ไม่พบจุดเริ่มต้นบนชั้น ${sFloor} (id: ${sNode})`);
    if (!gP) why.push(`ไม่พบจุดปลายทางบนชั้น ${gFloor} (id: ${gNode})`);
    return { path:null, segments:[], steps: why.length? why : ["ข้อมูลไม่ครบ"] };
  }

  const sConn = nearestElevator(sFloor, sP);
  const gConn = nearestElevator(gFloor, gP);
  if (!sConn || !gConn) {
    const msg = [];
    if (!sConn) msg.push(`ชั้น ${sFloor} ไม่พบลิฟต์/บันได`);
    if (!gConn) msg.push(`ชั้น ${gFloor} ไม่พบลิฟต์/บันได`);
    return { path:null, segments:[], steps: msg.length? msg : ["ไม่มีตัวเชื่อมข้ามชั้น"] };
  }

  const legA = planInFloorRouteKNN(sFloor, sNode, sConn.id, 6);
  const legB = planInFloorRouteKNN(gFloor, gConn.id, gNode, 6);

  const pathA = legA.path || [`${sFloor}::${sNode}`, `${sFloor}::${sConn.id}`];
  const warp  = [`${sFloor}::${sConn.id}`, `${gFloor}::${gConn.id}`];
  const pathB = legB.path || [`${gFloor}::${gConn.id}`, `${gFloor}::${gNode}`];
  const full  = [...pathA, ...warp.slice(1), ...pathB.slice(1)];

  const segments = segmentByFloor(full);
  const typeLabel = (n)=> _isElevatorLike(n) ? "ลิฟต์" : "บันได";
  const steps = [];
  steps.push(`เริ่มที่ ชั้น ${sFloor}: ${sP?.name||sNode}`);
  steps.push(legA.path ? `ชั้น ${sFloor}: ไป ${typeLabel(sConn)} (${sConn.name||sConn.id})` : `ชั้น ${sFloor}: ไม่มีเส้นทางในชั้นนี้ (ไปตัวเชื่อม)`);
  steps.push(`ใช้ ${typeLabel(sConn)} เพื่อ${gFloor>sFloor?"ขึ้น":"ลง"}ไป ชั้น ${gFloor}`);
  steps.push(legB.path ? `ชั้น ${gFloor}: จาก ${typeLabel(gConn)} ไป ${gP?.name||gNode}` : `ชั้น ${gFloor}: ไม่มีเส้นทางในชั้นนี้ (จากตัวเชื่อมไปห้อง)`);
  steps.push(`ถึงเป้าหมาย ชั้น ${gFloor}: ${gP?.name||gNode}`);

  const meta = (() => {
    const byKey = {};
    for (const f of FLOORS) {
      for (const [id, n] of Object.entries(baseNodes[f] || {})) {
        byKey[`${f}::${id}`] = { ...n, id, floor: f };
      }
    }
    return { byKey };
  })();

  return { path: full, segments, steps, meta };
}

// ---------- UI: Navigation ----------
function navigate(page){
  teardownPage();
  currentPage = page;
  const app = document.getElementById("app");

  if(page==="map"){
    const floorOpts = FLOORS.map(f=>`<option value="${f}">Floor ${f}</option>`).join("");
    app.innerHTML = `
      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-9">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <label>ชั้นที่ดู:</label>
              <select id="view-floor" class="border p-2 rounded">${floorOpts}</select>
              <button id="btnClear" class="px-3 py-2 border rounded">Clear</button>
            </div>
            <button onclick="navigate('admin')" class="px-3 py-2 rounded bg-yellow-600 text-white">Admin</button>
          </div>

          <fieldset class="border rounded p-3 mb-3">
            <legend class="px-2 text-sm text-gray-600">เลือกเส้นทาง (ข้ามชั้นได้)</legend>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-sm mb-1">เริ่มต้น</div>
                <div class="flex gap-2">
                  <select id="sfloor" class="border p-2 rounded w-28">${floorOpts}</select>
                  <select id="snode"  class="border p-2 rounded flex-1"></select>
                </div>
              </div>
              <div>
                <div class="text-sm mb-1">ปลายทาง</div>
                <div class="flex gap-2">
                  <select id="gfloor" class="border p-2 rounded w-28">${floorOpts}</select>
                  <select id="gnode"  class="border p-2 rounded flex-1"></select>
                </div>
              </div>
            </div>
            <div class="mt-3 flex gap-2">
              <button id="btnXFloor" class="px-4 py-2 bg-indigo-600 text-white rounded">หาเส้นทาง (ข้ามชั้น)</button>
              <span class="text-sm text-gray-600">* ใช้ลิฟต์/บันไดที่ตรวจพบ</span>
            </div>
          </fieldset>

          <div id="svg-container" class="border bg-white shadow"></div>

          <div class="mt-4">
            <h3 class="font-semibold mb-2">แผนที่ชั้นที่ใช้ในเส้นทาง</h3>
            <div id="multi-route" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
          </div>
        </div>

        <aside class="col-span-3">
          <div class="bg-white rounded shadow p-3">
            <h3 class="font-semibold mb-2">ขั้นตอน</h3>
            <ol id="route-steps" class="text-sm space-y-1 list-decimal list-inside"></ol>
          </div>
        </aside>
      </div>`;
    (async()=>{
      await ensureBaseData();
      document.getElementById("view-floor").value = String(currentFloor);
      await loadFloor(currentFloor,false);
      syncNodeDropdown("sfloor","snode");
      syncNodeDropdown("gfloor","gnode");

      document.getElementById("view-floor").addEventListener("change", (e)=>{
        const f = +e.target.value;
        loadFloor(f,false).then(()=>{
          syncNodeDropdown("sfloor","snode");
          syncNodeDropdown("gfloor","gnode");
        });
      });
      document.getElementById("sfloor").addEventListener("change", ()=> syncNodeDropdown("sfloor","snode"));
      document.getElementById("gfloor").addEventListener("change", ()=> syncNodeDropdown("gfloor","gnode"));
      document.getElementById("btnClear").addEventListener("click", clearOverlays);

      document.getElementById("btnXFloor").addEventListener("click", ()=>{
        const start = { floor:+document.getElementById("sfloor").value, id: document.getElementById("snode").value };
        const goal  = { floor:+document.getElementById("gfloor").value, id: document.getElementById("gnode").value };
        const res = planCrossFloorRouteSmart(start, goal);
        renderRouteForCurrentFloor(res.segments, res.meta); // วาดในชั้นที่กำลังดู
        showSteps(res.steps);
        renderMultiFloorRoute(res.segments, res.meta);      // วาดทุกชั้นที่มีเส้นทาง
      });
    })();
    return;
  }

  if(page==="admin"){
    const floorOpts = FLOORS.map(f=>`<option value="${f}">Floor ${f}</option>`).join("");
    app.innerHTML = `
      <style>.tool-active{ background:#1f2937; color:#fff; }</style>
      <div class="flex items-center justify-between mb-3">
        <div class="flex gap-2 items-center">
          <select id="floor-select" class="border p-2 rounded">${floorOpts}</select>
          <button id="tool-select"   class="px-3 py-2 rounded border">Select</button>
          <button id="tool-room"     class="px-3 py-2 rounded border">Add Room</button>
          <button id="tool-door"     class="px-3 py-2 rounded border">Add Door</button>
          <button id="tool-junction" class="px-3 py-2 rounded border">Add Junction</button>
          <button id="tool-connect"  class="px-3 py-2 rounded border">Connect</button>
          <button id="tool-delete"   class="px-3 py-2 rounded border">Delete</button>
          <button id="tool-clear"    class="px-3 py-2 rounded border">Clear Edges</button>
          <button id="tool-apply"    class="px-3 py-2 rounded border bg-indigo-600 text-white">Apply</button>
          <button id="tool-reset"    class="px-3 py-2 rounded border">Reset</button>
          <button id="tool-export"   class="px-3 py-2 rounded border bg-green-600 text-white">Export GML</button>
        </div>
        <button onclick="navigate('map')" class="px-3 py-2 rounded bg-gray-700 text-white">Back</button>
      </div>
      <div class="mb-2 text-sm text-gray-600">เชื่อมข้ามชั้นจะสร้าง interEdges (ชนิดเริ่มต้น: stair_mid). เปลี่ยนชนิดได้ใน Inspector.</div>
      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-9">
          <div id="svg-container" class="border bg-white shadow"></div>
        </div>
        <aside class="col-span-3">
          <div class="bg-white rounded-lg shadow p-4 sticky top-4" id="inspector">
            <h3 class="font-semibold mb-2">Inspector</h3>
            <label class="text-sm">ID</label><input id="inp-id" class="w-full border p-2 rounded"/>
            <label class="text-sm mt-2">Name</label><input id="inp-name" class="w-full border p-2 rounded"/>
            <label class="text-sm mt-2">Type</label>
            <select id="inp-type" class="w-full border p-2 rounded">
              <option value="room">room</option><option value="door">door</option>
              <option value="junction">junction</option><option value="stair_left">stair_left</option>
              <option value="stair_mid">stair_mid</option><option value="stair_right">stair_right</option>
              <option value="stair">stair</option><option value="elevator">elevator</option>
            </select>
            <div class="flex gap-2 mt-3">
              <button id="btn-save" class="flex-1 bg-blue-600 text-white py-2 rounded">Save</button>
              <button id="btn-del"  class="flex-1 bg-red-600 text-white  py-2 rounded">Delete</button>
            </div>
            <hr class="my-3"/>
            <div class="space-y-1 text-sm">
              <div>Inter-layer edges: <span id="inter-count">0</span></div>
              <button id="btn-clear-inter" class="w-full border rounded py-2">Clear InterLayer</button>
            </div>
          </div>
        </aside>
      </div>`;
    (async()=>{
      await ensureBaseData();
      adminNodes = makeFloorMap({}); for(const f of FLOORS) adminNodes[f]=deepClone(baseNodes[f]);
      adminEdges = makeFloorMap([]); interEdges = [];
      await loadFloor(currentFloor,true);
      const $ = (id)=>document.getElementById(id);
      $("#floor-select").addEventListener("change", e=> loadFloor(+e.target.value,true));
      $("#tool-select").addEventListener("click", ()=> setTool("select"));
      $("#tool-room").addEventListener("click", ()=> setTool("add-room"));
      $("#tool-door").addEventListener("click", ()=> setTool("add-door"));
      $("#tool-junction").addEventListener("click", ()=> setTool("add-junction"));
      $("#tool-connect").addEventListener("click", ()=> setTool("connect"));
      $("#tool-delete").addEventListener("click", ()=> setTool("delete"));
      $("#tool-clear").addEventListener("click", ()=>{ adminEdges[currentFloor]=[]; redrawAll(); });
      $("#tool-apply").addEventListener("click", ()=>{ for(const f of FLOORS) baseNodes[f]=deepClone(adminNodes[f]); alert("Applied"); });
      $("#tool-reset").addEventListener("click", ()=>{ for(const f of FLOORS){ adminNodes[f]=deepClone(baseNodes[f]); adminEdges[f]=[]; } interEdges=[]; selected=null; redrawAll(); renderInspector(); updateInterCount(); });
      $("#tool-export").addEventListener("click", exportIndoorGML);
      $("#btn-save").addEventListener("click", onInspectorSave);
      $("#btn-del").addEventListener("click", onInspectorDelete);
      $("#btn-clear-inter").addEventListener("click", ()=>{ interEdges=[]; updateInterCount(); redrawAll(); });
      updateInterCount();
    })();
    return;
  }

  navigate("map");
}

// ---------- Multi-floor preview ----------
async function renderMultiFloorRoute(segments, meta){
  const host = document.getElementById("multi-route");
  if (!host) return;
  host.innerHTML = "";

  const floorsInRoute = [];
  for (const seg of segments || []) {
    if (seg.nodes && seg.nodes.length >= 2) {
      if (!floorsInRoute.includes(seg.floor)) floorsInRoute.push(seg.floor);
    }
  }
  if (!floorsInRoute.length) {
    host.innerHTML = `<div class="text-sm text-gray-600">ไม่มีช่วงเส้นทางในชั้นใดเลย</div>`;
    return;
  }

  for (const f of floorsInRoute) {
    const card = document.createElement("div");
    card.className = "border rounded bg-white shadow";
    card.innerHTML = `
      <div class="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
        <div class="font-semibold">ชั้น ${f}</div>
        <div class="text-xs text-gray-500">Preview</div>
      </div>
      <div class="p-2">
        <div id="mr-svg-${f}" class="w-full overflow-auto"></div>
      </div>`;
    host.appendChild(card);

    const svgBox = card.querySelector(`#mr-svg-${f}`);
    await loadFloorSvgInto(svgBox, f);

    const svg = svgBox.querySelector("svg");
    if (!svg) continue;
    svg.querySelectorAll(".path-line,.highlight-node").forEach(el => el.remove());

    const seg = (segments || []).find(s => s.floor === f);
    if (!seg || !seg.nodes || seg.nodes.length < 2) continue;

    const pts = seg.nodes.map(k => {
      const n = meta.byKey[k]; return n ? `${n.x},${n.y}` : null;
    }).filter(Boolean);

    const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    pl.setAttribute("points", pts.join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", "red");
    pl.setAttribute("stroke-width", "3");
    pl.classList.add("path-line");
    svg.appendChild(pl);

    const first = meta.byKey[seg.nodes[0]];
    const last  = meta.byKey[seg.nodes[seg.nodes.length - 1]];
    if (first) addDot(svg, first.x, first.y, "green");
    if (last)  addDot(svg, last.x,  last.y,  "red");
  }
}
async function loadFloorSvgInto(target, floorNumber){
  try {
    const res = await fetch(`./Floor0${floorNumber}/map.svg`);
    target.innerHTML = res.ok ? await res.text() : placeholderSvg(floorNumber);
  } catch {
    target.innerHTML = placeholderSvg(floorNumber);
  }
}
function placeholderSvg(f){
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="100%" height="360">
  <rect x="10" y="10" width="380" height="340" fill="#fafafa" stroke="#ccc"/>
  <text x="20" y="30" font-size="14">Floor ${f} (no map.svg)</text>
</svg>`;
}
function addDot(svg, x, y, color){
  const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
  c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 7);
  c.setAttribute("fill", color); c.setAttribute("stroke", "black"); c.setAttribute("stroke-width", 2);
  c.classList.add("highlight-node");
  svg.appendChild(c);
}

// ---------- SVG / draw ----------
function teardownPage(){ const app=document.getElementById("app"); if(app) app.innerHTML=""; connectBuffer=[]; dragging=null; selected=null; }

async function ensureBaseData(){
  const hasAny = FLOORS.some(f=>Object.keys(baseNodes[f]).length);
  if(hasAny) return;
  const tryJson = async url => { try{ const r=await fetch(url); return r.ok ? await r.json() : null; }catch{return null;} };
  const merge = (obj)=> obj ? (obj.nodes? obj.nodes : obj) : {};
  for(const f of FLOORS){
    const pad = String(f).padStart(2,"0");
    const [g,n,d] = await Promise.all([
      tryJson(`Floor${pad}/graph_floor${f}.json`),
      tryJson(`Floor${pad}/nodes_floor${f}.json`),
      tryJson(`Floor${pad}/doors.json`)
    ]);
    baseNodes[f] = { ...(merge(g)||{}), ...(merge(n)||{}), ...(merge(d)||{}) };
  }
}

async function loadFloor(floorNumber, adminMode){
  currentFloor = clampFloor(floorNumber);
  const container = document.getElementById("svg-container"); if(!container) return;
  const res = await fetch(`./Floor0${currentFloor}/map.svg`);
  container.innerHTML = res.ok ? await res.text()
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="800" height="720">
         <rect x="10" y="10" width="380" height="340" fill="#fafafa" stroke="#ccc"/>
         <text x="20" y="30" font-size="14">Floor ${currentFloor}</text>
       </svg>`;
  enhanceSVG(adminMode); redrawAll();
}
function enhanceSVG(adminMode){
  const svg=svgEl(); if(!svg) return;
  svg.style.userSelect="none"; svg.style.cursor = adminMode && tool.startsWith("add-") ? "crosshair":"default";
  svg.addEventListener("mousedown", onSvgMouseDown);
  window.addEventListener("mousemove", onSvgMouseMove);
  window.addEventListener("mouseup", onSvgMouseUp);
}
function removeSvgOverlays(){
  const svg=svgEl(); if(!svg) return;
  svg.querySelectorAll(".editable-node,.edge-line,.node-label,.selected-ring,.path-line,.highlight-node,.inter-icon").forEach(el=>el.remove());
}
function redrawAll(){
  const svg=svgEl(); if(!svg) return; removeSvgOverlays();

  // edges (same-floor)
  if(isAdmin()){
    for(const e of adminEdges[currentFloor]||[]){
      const a=adminNodes[currentFloor][e.from], b=adminNodes[currentFloor][e.to]; if(!a||!b) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",a.x); line.setAttribute("y1",a.y); line.setAttribute("x2",b.x); line.setAttribute("y2",b.y);
      line.setAttribute("stroke","#888"); line.setAttribute("stroke-width","2"); line.classList.add("edge-line"); svg.appendChild(line);
    }
    for(const e of interEdges){
      for(const side of ["from","to"]){
        const s=e[side]; if(s.floor!==currentFloor) continue;
        const n=adminNodes[s.floor]?.[s.id]; if(!n) continue;
        const icon=document.createElementNS("http://www.w3.org/2000/svg","rect");
        icon.setAttribute("x",n.x-6); icon.setAttribute("y",n.y-6); icon.setAttribute("width",12); icon.setAttribute("height",12);
        icon.setAttribute("fill", e.type==="elevator"?"#4b5563":"#6b7280"); icon.setAttribute("stroke","#111"); icon.setAttribute("stroke-width","1");
        icon.classList.add("inter-icon"); svg.appendChild(icon);
      }
    }
  }

  // nodes
  const nodes = getNodes(currentFloor);
  for(const [id,n] of Object.entries(nodes)){
    if(+n.floor!==+currentFloor) continue;
    const color = n.type==="door"?"red": n.type?.startsWith("stair")?"#6b7280": n.type==="elevator"?"#4b5563": n.type==="junction"?"orange":"blue";
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",n.x); c.setAttribute("cy",n.y); c.setAttribute("r",6); c.setAttribute("fill",color);
    c.setAttribute("data-id",id); c.classList.add("editable-node");
    if(isAdmin()){ c.addEventListener("mousedown", onNodeMouseDown); c.addEventListener("click", onNodeClick); }
    svg.appendChild(c);
    const t=document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x",n.x+8); t.setAttribute("y",n.y-8); t.setAttribute("font-size","12");
    t.textContent=n.name||id; t.classList.add("node-label"); svg.appendChild(t);
    if(isAdmin() && selected && selected.floor===currentFloor && selected.id===id){
      const ring=document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.setAttribute("cx",n.x); ring.setAttribute("cy",n.y); ring.setAttribute("r",10); ring.setAttribute("fill","none");
      ring.setAttribute("stroke","#10b981"); ring.setAttribute("stroke-width","2"); ring.classList.add("selected-ring"); svg.appendChild(ring);
    }
  }
}
function renderRouteForCurrentFloor(segments, meta){
  const svg=svgEl(); if(!svg) return;
  svg.querySelectorAll(".path-line,.highlight-node").forEach(el=>el.remove());
  for(const seg of segments){
    if(seg.floor!==currentFloor || seg.nodes.length<2) continue;
    const pts = seg.nodes.map(k=>`${meta.byKey[k].x},${meta.byKey[k].y}`).join(" ");
    const pl=document.createElementNS("http://www.w3.org/2000/svg","polyline");
    pl.setAttribute("points",pts); pl.setAttribute("fill","none"); pl.setAttribute("stroke","red"); pl.setAttribute("stroke-width","3");
    pl.classList.add("path-line"); svg.appendChild(pl);
  }
}
function clearOverlays(){ const svg=svgEl(); if(!svg) return; svg.querySelectorAll(".path-line,.highlight-node").forEach(el=>el.remove()); }

// ---------- Node dropdown ----------
function syncNodeDropdown(floorSelId, nodeSelId){
  const f = +document.getElementById(floorSelId).value;
  const el = document.getElementById(nodeSelId); el.innerHTML="";
  const nodes = baseNodes[f] || {};
  for(const [id,n] of Object.entries(nodes)){
    if(+n.floor!==+f) continue;
    el.add(new Option(`${n.type}: ${n.name||id}`, id));
  }
}

// ---------- Admin tools ----------
function setTool(name){ tool=name; connectBuffer=[]; dragging=null; }
function svgPoint(evt){ const svg=svgEl(); const pt=svg.createSVGPoint(); pt.x=evt.clientX; pt.y=evt.clientY; const loc=pt.matrixTransform(svg.getScreenCTM().inverse()); return {x:Math.round(loc.x),y:Math.round(loc.y)}; }
function onSvgMouseDown(evt){
  if(!isAdmin()) return;
  const hit = evt.target.closest?.("circle.editable-node");
  if((tool==="add-room"||tool==="add-door"||tool==="add-junction") && !hit){
    const {x,y}=svgPoint(evt); const id=nextNodeId();
    const type = tool==="add-door"?"door": tool==="add-junction"?"junction":"room";
    adminNodes[currentFloor][id]={x,y,name:type==="room"?`Room ${id}`:`${type} ${id}`,type,floor:currentFloor};
    selected={floor:currentFloor,id}; redrawAll(); renderInspector();
  }
}
function onNodeMouseDown(evt){
  if(!isAdmin()) return; evt.preventDefault();
  const id=evt.target.getAttribute("data-id");
  if(tool==="select"){ const {x,y}=svgPoint(evt); const n=adminNodes[currentFloor][id]; dragging={floor:currentFloor,id,offsetX:x-n.x,offsetY:y-n.y}; }
}
function onSvgMouseMove(evt){ if(!isAdmin()||!dragging) return; const {x,y}=svgPoint(evt); const n=adminNodes[dragging.floor][dragging.id]; n.x=x-dragging.offsetX; n.y=y-dragging.offsetY; redrawAll(); }
function onSvgMouseUp(){ dragging=null; }
function onNodeClick(evt){
  if(!isAdmin()) return;
  const id=evt.target.getAttribute("data-id");
  if(tool==="select"){ selected={floor:currentFloor,id}; renderInspector(); redrawAll(); return; }
  if(tool==="connect"){
    connectBuffer.push({floor:currentFloor,id});
    if(connectBuffer.length===2){
      const [a,b]=connectBuffer;
      if(a.floor===b.floor){ if(a.id!==b.id) adminEdges[a.floor].push({from:a.id,to:b.id,weight:euclid(adminNodes[a.floor][a.id],adminNodes[b.floor][b.id])}); }
      else{ interEdges.push({from:a,to:b,type:"stair_mid"}); } // ค่าเริ่มต้น
      connectBuffer=[]; redrawAll(); updateInterCount();
    }
  }
  if(tool==="delete"){
    delete adminNodes[currentFloor][id];
    adminEdges[currentFloor]=adminEdges[currentFloor].filter(e=>e.from!==id && e.to!==id);
    interEdges = interEdges.filter(e=>!(e.from.floor===currentFloor&&e.from.id===id) && !(e.to.floor===currentFloor&&e.to.id===id));
    if(selected && selected.floor===currentFloor && selected.id===id) selected=null;
    renderInspector(); redrawAll(); updateInterCount();
  }
}
function renderInspector(){
  const n=(selected? adminNodes[selected.floor][selected.id] : null);
  const idEl=document.getElementById("inp-id"), nameEl=document.getElementById("inp-name"), typeEl=document.getElementById("inp-type");
  if(!idEl) return;
  if(!n){ idEl.value=""; nameEl.value=""; typeEl.value="room"; idEl.disabled=nameEl.disabled=typeEl.disabled=true; return; }
  idEl.disabled=nameEl.disabled=typeEl.disabled=false; idEl.value=selected.id; nameEl.value=n.name||""; typeEl.value=n.type||"room";
}
function onInspectorSave(){
  if(!selected) return;
  const idNew=escId(document.getElementById("inp-id").value.trim());
  const nameNew=document.getElementById("inp-name").value.trim();
  const typeNew=document.getElementById("inp-type").value;
  if(!idNew) return alert("Invalid ID");
  const nodes=adminNodes[selected.floor]; if(idNew!==selected.id && nodes[idNew]) return alert("ID ซ้ำ");
  const n=nodes[selected.id]; n.name=nameNew||null; n.type=typeNew;
  if(idNew!==selected.id){
    nodes[idNew]={...n}; delete nodes[selected.id];
    adminEdges[selected.floor] = adminEdges[selected.floor].map(e=>({from:e.from===selected.id?idNew:e.from,to:e.to===selected.id?idNew:e.to,weight:e.weight}));
    interEdges = interEdges.map(e=>({
      from:(e.from.floor===selected.floor&&e.from.id===selected.id)?{...e.from,id:idNew}:e.from,
      to:(e.to.floor===selected.floor&&e.to.id===selected.id)?{...e.to,id:idNew}:e.to,
      type:e.type
    }));
    selected.id=idNew;
  }
  redrawAll(); renderInspector();
}
function onInspectorDelete(){
  if(!selected) return;
  delete adminNodes[selected.floor][selected.id];
  adminEdges[selected.floor]=adminEdges[selected.floor].filter(e=>e.from!==selected.id && e.to!==selected.id);
  interEdges = interEdges.filter(e=>!(e.from.floor===selected.floor&&e.from.id===selected.id) && !(e.to.floor===selected.floor&&e.to.id===selected.id));
  selected=null; redrawAll(); renderInspector(); updateInterCount();
}
function updateInterCount(){ const el=document.getElementById("inter-count"); if(el) el.textContent=String(interEdges.length); }
function nextNodeId(){ let i=1; const used=new Set(FLOORS.flatMap(f=>Object.keys(adminNodes[f]))); while(true){ const id=`N${String(i).padStart(3,"0")}`; if(!used.has(id)) return id; i++; } }

// ---------- Export IndoorGML ----------
function exportIndoorGML(){
  const floors = FLOORS.filter(f=>Object.keys(adminNodes[f]).length);
  const layersXml = floors.map(f=> spaceLayerXml(f)).join("");
  const ilcXml = interEdges.map((e,i)=>`
    <core:interLayerConnectionMember>
      <core:InterLayerConnection gml:id="ilc_${i}">
        <core:weight>1.0</core:weight>
        <core:connectedLayers>
          <core:InterLayerConnectionPropertyType xlink:href="#state_${e.from.floor}_${e.from.id}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
          <core:InterLayerConnectionPropertyType xlink:href="#state_${e.to.floor}_${e.to.id}"   xmlns:xlink="http://www.w3.org/1999/xlink"/>
        </core:connectedLayers>
      </core:InterLayerConnection>
    </core:interLayerConnectionMember>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<core:IndoorFeatures xmlns:core="http://www.opengis.net/indoorgml/1.0/core" xmlns:gml="http://www.opengis.net/gml/3.2">
  <core:multiLayeredGraph>
    <core:MultiLayeredGraph gml:id="mlg_1">
      <core:spaceLayers><core:SpaceLayers>${layersXml}</core:SpaceLayers></core:spaceLayers>
      ${ilcXml}
    </core:MultiLayeredGraph>
  </core:multiLayeredGraph>
</core:IndoorFeatures>`;
  const blob=new Blob([xml],{type:"application/gml+xml;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download="indoor_layers.gml"; a.click(); URL.revokeObjectURL(url);
}
function spaceLayerXml(f){
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const nodes = Object.entries(adminNodes[f]).map(([id,n])=>({id,...n}));
  const edges = adminEdges[f] || [];
  const states = nodes.map(n=>`
    <core:stateMember>
      <core:State gml:id="state_${f}_${esc(n.id)}">
        <gml:name>${esc(n.name||n.id)}</gml:name>
        <gml:description>${esc(JSON.stringify({type:n.type||"room",floor:n.floor}))}</gml:description>
        <core:dualGraph><gml:Point gml:id="pt_${f}_${esc(n.id)}"><gml:pos>${n.x} ${n.y}</gml:pos></gml:Point></core:dualGraph>
      </core:State>
    </core:stateMember>`).join("");
  const trans = edges.map((e,i)=>`
    <core:transitionMember>
      <core:Transition gml:id="tr_${f}_${i}">
        <core:weight>${(e.weight ?? euclid(adminNodes[f][e.from], adminNodes[f][e.to])).toFixed(3)}</core:weight>
        <core:connects xlink:href="#state_${f}_${esc(e.from)}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
        <core:connects xlink:href="#state_${f}_${esc(e.to)}"   xmlns:xlink="http://www.w3.org/1999/xlink"/>
      </core:Transition>
    </core:transitionMember>`).join("");
  return `<core:spaceLayerMember><core:SpaceLayer gml:id="layer_${f}"><core:nodes><core:Nodes>${states}</core:Nodes></core:nodes><core:edges><core:Edges>${trans}</core:Edges></core:edges></core:SpaceLayer></core:spaceLayerMember>`;
}

// ---------- Steps UI ----------
function showSteps(list){ const el=document.getElementById("route-steps"); if(!el){ alert(list.join("\n")); return; } el.innerHTML=list.map(s=>`<li>${s}</li>`).join(""); }

// ---------- Boot ----------
window.onload = ()=> navigate("map");
