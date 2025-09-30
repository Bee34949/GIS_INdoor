// FILE: frontend/app.js
// Indoor Map — +Search, +Blink, +Toast, +Undo/Redo, +Minimap, +Measure, +Shortcuts

// ---------- Config & Utils ----------
let PX_PER_M = Number(localStorage.getItem('PX_PER_M') || 50);
const STEP_PX = 50;
const SNAP_TOL = 12;

const FLOORS = [1, 2, 3, 4, 5, 6];
const STAIRS = new Set(["stair_left", "stair_mid", "stair_right", "stair"]);
const ELEV = new Set(["elevator"]);

const byId = (id) => document.getElementById(id);
const on = (id, ev, fn) => { const el = byId(id); if (!el) return false; el.addEventListener(ev, fn); return true; };

const makeFloorMap = (initVal) =>
  FLOORS.reduce((acc, f) => {
    acc[f] =
      typeof initVal === "function"
        ? initVal(f)
        : JSON.parse(JSON.stringify(initVal || {}));
    return acc;
  }, {});

const deepClone = (o) => JSON.parse(JSON.stringify(o));
const isAdmin = () => currentPage === "admin";
const svgEl = () => document.querySelector("#svg-container svg");
const escId = (s) => (s || "").replace(/[^A-Za-z0-9_-]/g, "");
const clampFloor = (f) => (FLOORS.includes(Number(f)) ? Number(f) : FLOORS[0]);

const distPx = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
const distM = (a, b) => distPx(a, b) / PX_PER_M;

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setPxPerM(val){
  const v = Math.max(1, Math.round(Number(val) || 50));
  PX_PER_M = v;
  try { localStorage.setItem('PX_PER_M', String(v)); } catch {}
  recomputeAllCorridorWeights();
  const lbl = document.getElementById('lbl-scale'); if (lbl) lbl.textContent = `${v} px/m`;
  const inp = document.getElementById('inp-scale'); if (inp) inp.value = String(v);
  if (typeof redrawAll === 'function') redrawAll();
  if (typeof ccToast === 'function') ccToast(`Scale set to ${v} px/m`);
}
function recomputeAllCorridorWeights(){
  // ทำให้น้ำหนัก edge ของ corridor เป็น "เมตร" ตาม PX_PER_M ปัจจุบัน
  if (!window.adminEdges || !window.adminNodes) return;
  for (const f of (window.FLOORS || [])){
    const edges = adminEdges[f] || [];
    const nodes = adminNodes[f] || {};
    for (const e of edges){
      const a = nodes[e.from], b = nodes[e.to];
      if (a && b) e.weight = Math.hypot(a.x - b.x, a.y - b.y) / PX_PER_M;
    }
  }
}
// ---------- Toast (UX feedback) ----------
(function mountToast(){
  if (byId('cc-toasts')) return;
  const wrap = document.createElement('div');
  wrap.id = 'cc-toasts';
  wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:9999';
  document.body.appendChild(wrap);
  window.ccToast = (msg, ms=1600) => {
    const el = document.createElement('div');
    el.className = 'cc-toast';
    el.textContent = msg;
    el.style.cssText = 'background:#111;color:#fff;padding:.6rem .8rem;border-radius:.5rem;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:.9rem;opacity:.98';
    wrap.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .25s'; }, ms);
    setTimeout(()=> wrap.removeChild(el), ms+260);
  };
})();

// ---------- History (snapshot-based Undo/Redo) ----------
class History {
  constructor(limit=200){ this.limit=limit; this.stack=[]; this.idx=-1; }
  push(doState, undoState, label='Change'){
    // why: snapshot restore keeps logic simple/robust
    this.stack = this.stack.slice(0, this.idx+1);
    this.stack.push({ doState, undoState, label });
    if (this.stack.length > this.limit) this.stack.shift(); else this.idx++;
    this.apply(doState); window.ccToast?.(`✓ ${label}`);
  }
  apply(snap){ setSnapshot(snap); }
  canUndo(){ return this.idx>=0; }
  canRedo(){ return this.idx < this.stack.length-1; }
  undo(){ if(!this.canUndo()) return; const rec=this.stack[this.idx]; this.apply(rec.undoState); this.idx--; window.ccToast?.('↩ Undo'); }
  redo(){ if(!this.canRedo()) return; const rec=this.stack[this.idx+1]; this.apply(rec.doState); this.idx++; window.ccToast?.('↪ Redo'); }
}
const ccHistory = new History();

// capture/restore whole admin-editing state (cheap & safe for editor-sized data)
function captureSnapshot(){
  return {
    nodes: deepClone(adminNodes),
    edges: deepClone(adminEdges),
    inter: deepClone(interEdges),
    selected: selected ? { ...selected } : null,
    floor: currentFloor
  };
}
function setSnapshot(s){
  adminNodes = deepClone(s.nodes);
  adminEdges = deepClone(s.edges);
  interEdges = deepClone(s.inter);
  selected = s.selected ? { ...s.selected } : null;
  currentFloor = s.floor;
  redrawAll(); renderInspector(); updateInterCount();
}
function recordChange(label, mutator){
  const before = captureSnapshot();
  mutator(); // perform change once
  const after = captureSnapshot();
  ccHistory.push(after, before, label);
}

// ---------- App State ----------
let currentPage = null;
let currentFloor = 1;
let baseNodes = makeFloorMap({});
let adminNodes = makeFloorMap({});
let adminEdges = makeFloorMap([]);
let interEdges = [];
let tool = "select", connectBuffer = [], dragging = null, selected = null;

// Corridor
let corridorBuffer = [];
let corridorActive = false;

// Search index
let SEARCH_IDX = []; // [{floor,id,name,type,x,y, norm, tokens}]

// Measure / Minimap runtime
let measureOn = false, measureStart = null;

// ---------- Graph Helpers ----------
const keyOf = (f, id) => `${f}::${id}`;
const parseKey = (k) => ({ floor: +k.split("::")[0], id: k.split("::")[1] });

function addEdge(G, a, b, w) { (G[a] ||= []).push({ v: b, w }); (G[b] ||= []).push({ v: a, w }); }

function dijkstra(G, start, goal) {
  const V = Object.keys(G);
  if (!V.includes(start) || !V.includes(goal)) return null;
  const D = new Map(), P = new Map(), Q = new Set(V);
  V.forEach(v => D.set(v, Infinity));
  D.set(start, 0);
  while (Q.size) {
    let u = null, best = Infinity;
    for (const v of Q) { const dv = D.get(v); if (dv < best) { best = dv; u = v; } }
    if (u === null) break;
    Q.delete(u);
    if (u === goal) break;
    for (const e of (G[u] || [])) {
      if (!Q.has(e.v)) continue;
      const alt = D.get(u) + e.w;
      if (alt < D.get(e.v)) { D.set(e.v, alt); P.set(e.v, u); }
    }
  }
  if (start !== goal && !P.has(goal)) return null;
  const path = []; let u = goal;
  while (u) { path.unshift(u); if (u === start) break; u = P.get(u); if (!u) break; }
  return path;
}

// ---------- Multi-layer Build ----------
function buildMultiLayer({ nodesByFloor, edgesByFloor, interEdges }, { fallbackDense = false, interCost = {} } = {}) {
  const G = {}; const meta = { byKey: {}, connectors: new Set(), noEdges: {} };
  for (const f of FLOORS) {
    const N = nodesByFloor[f] || {};
    for (const [id, n] of Object.entries(N)) meta.byKey[keyOf(f, id)] = { ...n, id, floor: f };
  }
  for (const f of FLOORS) {
    const N = nodesByFloor[f] || {};
    const E = edgesByFloor?.[f] || [];
    const ids = Object.keys(N);
    if (E.length) {
      for (const e of E) {
        const a = keyOf(f, e.from), b = keyOf(f, e.to);
        const na = meta.byKey[a], nb = meta.byKey[b];
        if (!na || !nb) continue;
        addEdge(G, a, b, e.weight ?? distM(na, nb));
      }
    } else {
      meta.noEdges[f] = true;
      if (fallbackDense) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = keyOf(f, ids[i]), b = keyOf(f, ids[j]);
            const na = meta.byKey[a], nb = meta.byKey[b];
            if (!na || !nb) continue;
            addEdge(G, a, b, distM(na, nb));
          }
        }
      }
    }
  }
  for (const e of (interEdges || [])) {
    const ta = (e.type || "").toLowerCase();
    if (!ELEV.has(ta) && !STAIRS.has(ta)) continue;
    const a = keyOf(e.from.floor, e.from.id), b = keyOf(e.to.floor, e.to.id);
    if (!meta.byKey[a] || !meta.byKey[b]) continue;
    const w = Number.isFinite(interCost[ta]) ? interCost[ta] : 5;
    addEdge(G, a, b, w);
    meta.connectors.add(a); meta.connectors.add(b);
  }
  return { G, meta };
}

function segmentByFloor(path) {
  if (!path || !path.length) return [];
  const segs = []; let cur = { floor: parseKey(path[0]).floor, nodes: [path[0]] };
  for (let i = 1; i < path.length; i++) {
    const f = parseKey(path[i]).floor;
    if (f !== cur.floor) { segs.push(cur); cur = { floor: f, nodes: [path[i]] }; } else cur.nodes.push(path[i]);
  }
  segs.push(cur); return segs;
}

function connectorType(meta, a, b) {
  const na = meta.byKey[a], nb = meta.byKey[b];
  const ta = (na?.type || "").toLowerCase(), tb = (nb?.type || "").toLowerCase();
  if (ta.includes("elevator") || tb.includes("elevator")) return "elevator";
  if (ta.includes("stair_left") || tb.includes("stair_left")) return "stair_left";
  if (ta.includes("stair_mid") || tb.includes("stair_mid")) return "stair_mid";
  if (ta.includes("stair_right") || tb.includes("stair_right")) return "stair_right";
  if (ta.includes("stair") || tb.includes("stair")) return "stair";
  return "connector";
}
function thConnLabel(t) {
  if (t === "elevator") return "ลิฟต์";
  if (t === "stair_left") return "บันได (ซ้าย)";
  if (t === "stair_mid") return "บันได (กลาง)";
  if (t === "stair_right") return "บันได (ขวา)";
  if (t === "stair") return "บันได";
  return "ทางเชื่อม";
}

function narrate(segs, meta, { startKey, goalKey }) {
  const steps = [];
  if (!segs.length) return ["ไม่พบเส้นทาง"];
  const start = meta.byKey[startKey], goal = meta.byKey[goalKey];
  steps.push(`เริ่มที่ ชั้น ${start.floor}: ${start.name || start.id}`);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], nodes = s.nodes;
    if (nodes.length <= 1) steps.push(`ชั้น ${s.floor}: ไม่มีเส้นทางในชั้นนี้`);
    else {
      const a = meta.byKey[nodes[0]], b = meta.byKey[nodes[nodes.length - 1]];
      steps.push(`ชั้น ${s.floor}: เดินจาก ${a.name || a.id} → ${b.name || b.id}`);
    }
    const next = segs[i + 1];
    if (next) {
      const fromKey = nodes[nodes.length - 1], toKey = next.nodes[0];
      const dir = next.floor > s.floor ? "ขึ้น" : "ลง";
      steps.push(`ใช้ ${thConnLabel(connectorType(meta, fromKey, toKey))} เพื่อ${dir}ไป ชั้น ${next.floor}`);
    }
  }
  steps.push(`ถึงเป้าหมาย ชั้น ${goal.floor}: ${goal.name || goal.id}`);
  return steps;
}

function planCrossFloorRoute(start, goal) {
  const multi = buildMultiLayer({
    nodesByFloor: baseNodes,
    edgesByFloor: adminEdges,
    interEdges
  }, { fallbackDense: true, interCost: { elevator: 3, stair_left: 5, stair_mid: 5, stair_right: 5, stair: 5 } });

  const startKey = keyOf(start.floor, start.id), goalKey = keyOf(goal.floor, goal.id);
  if (!multi.meta.byKey[startKey] || !multi.meta.byKey[goalKey]) return { path: null, segments: [], steps: ["จุดเริ่ม/ปลายทางไม่ถูกต้อง"] };
  const path = dijkstra(multi.G, startKey, goalKey);
  if (!path) return { path: null, segments: [], steps: ["ไม่พบเส้นทางที่เป็นไปได้ (ไม่มีตัวเชื่อม/เส้นทางภายในชั้น)"] };
  const segs = segmentByFloor(path);
  const steps = narrate(segs, multi.meta, { startKey, goalKey });
  return { path, segments: segs, steps, meta: multi.meta };
}

// ---------- KNN (in-floor) ----------
function _floorNodeEntries(floor) {
  return Object.entries(baseNodes?.[floor] || {}).filter(([, n]) => +n.floor === +floor);
}
function knnGraphForFloor(floor, k = 6) {
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
      (G[a.id] ||= []).push({ v: nb.id, w: nb.d / PX_PER_M });
      (G[nb.id] ||= []).push({ v: a.id, w: nb.d / PX_PER_M });
    }
  }
  return { G, byKey, ids };
}
function dijkstraIds(G, startId, goalId) {
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
function planInFloorRouteKNN(floor, fromId, toId, k = 6) {
  const { G, byKey, ids } = knnGraphForFloor(floor, k);
  if (ids.length < 2) return { path: null, meta: { byKey: {} }, reason: `ชั้น ${floor} มีโหนดไม่พอ` };
  const pathIds = dijkstraIds(G, fromId, toId);
  if (!pathIds) return { path: null, meta: { byKey }, reason: `ชั้น ${floor} ยังเชื่อมโหนดไม่ถึงกัน` };
  const pathKeys = pathIds.map(id => `${floor}::${id}`);
  const meta = { byKey: Object.fromEntries(Object.entries(byKey).map(([id, n]) => [`${floor}::${id}`, n])) };
  return { path: pathKeys, meta };
}

// ---------- Connector detection ----------
function _norm(s) { return (s || "").toString().toLowerCase().trim(); }
function _isElevatorLike(n) { const t = _norm(n?.type), nm = _norm(n?.name); if (t.includes("elevator")) return true; return /(ลิฟ(ต์|ท์)?|elev(at(or)?)?|(^|\b)elv\b|(^|\b)lift\b)/i.test(nm); }
function _isStairLike(n) { const t = _norm(n?.type), nm = _norm(n?.name); if (t === "stair" || t.startsWith("stair_")) return true; return /(stair|บันได)/i.test(nm); }
function _connectorsOfFloor(floor) {
  const nodes = baseNodes?.[floor] || {};
  const list = [];
  for (const [id, n] of Object.entries(nodes)) {
    if (_isElevatorLike(n)) list.push({ id, kind: "elevator", ...n });
    else if (_isStairLike(n)) list.push({ id, kind: "stair", ...n });
  }
  return list;
}
function elevatorNodesOfFloor(floor) {
  const cons = _connectorsOfFloor(floor);
  const elev = cons.filter(c => c.kind === "elevator");
  return elev.length ? elev : cons.filter(c => c.kind === "stair");
}
function nearestElevator(floor, ref) {
  const list = elevatorNodesOfFloor(floor);
  if (!list.length) return null;
  const p = typeof ref === "string" ? baseNodes[floor]?.[ref] : ref;
  if (!p) return list[0];
  let best = list[0], dmin = Infinity;
  for (const e of list) {
    const d = distPx(e, p);
    if (d < dmin) { dmin = d; best = e; }
  }
  return best;
}

// ---------- Smart Planner ----------
function planCrossFloorRouteSmart(start, goal) {
  const sameFloor = +start.floor === +goal.floor;
  if (sameFloor) {
    const r = planInFloorRouteKNN(start.floor, start.id, goal.id, 6);
    if (r.path) {
      const segs = [{ floor: +start.floor, nodes: r.path }];
      const steps = [`ชั้น ${start.floor}: เดินจาก ${(baseNodes[start.floor][start.id]?.name || start.id)} → ${(baseNodes[goal.floor][goal.id]?.name || goal.id)}`];
      return { path: r.path, segments: segs, steps, meta: r.meta };
    }
  }
  const normal = planCrossFloorRoute(start, goal);
  if (normal.path) return normal;

  const sFloor = clampFloor(start.floor), gFloor = clampFloor(goal.floor);
  const sNode = start.id, gNode = goal.id;
  const sP = baseNodes?.[sFloor]?.[sNode], gP = baseNodes?.[gFloor]?.[gNode];
  if (!sP || !gP) {
    const why = [];
    if (!sP) why.push(`ไม่พบจุดเริ่มต้นบนชั้น ${sFloor} (id: ${sNode})`);
    if (!gP) why.push(`ไม่พบจุดปลายทางบนชั้น ${gFloor} (id: ${gNode})`);
    return { path: null, segments: [], steps: why.length ? why : ["ข้อมูลไม่ครบ"] };
  }

  const sConn = nearestElevator(sFloor, sP);
  const gConn = nearestElevator(gFloor, gP);
  if (!sConn || !gConn) {
    const msg = [];
    if (!sConn) msg.push(`ชั้น ${sFloor} ไม่พบลิฟต์/บันได`);
    if (!gConn) msg.push(`ชั้น ${gFloor} ไม่พบลิฟต์/บันได`);
    return { path: null, segments: [], steps: msg.length ? msg : ["ไม่มีตัวเชื่อมข้ามชั้น"] };
  }

  const legA = planInFloorRouteKNN(sFloor, sNode, sConn.id, 6);
  const legB = planInFloorRouteKNN(gFloor, gConn.id, gNode, 6);

  const pathA = legA.path || [`${sFloor}::${sNode}`, `${sFloor}::${sConn.id}`];
  const warp = [`${sFloor}::${sConn.id}`, `${gFloor}::${gConn.id}`];
  const pathB = legB.path || [`${gFloor}::${gConn.id}`, `${gFloor}::${gNode}`];
  const full = [...pathA, ...warp.slice(1), ...pathB.slice(1)];

  const segments = segmentByFloor(full);
  const typeLabel = (n) => _isElevatorLike(n) ? "ลิฟต์" : "บันได";
  const steps = [];
  steps.push(`เริ่มที่ ชั้น ${sFloor}: ${sP?.name || sNode}`);
  steps.push(legA.path ? `ชั้น ${sFloor}: ไป ${typeLabel(sConn)} (${sConn.name || sConn.id})` : `ชั้น ${sFloor}: ไม่มีเส้นทางในชั้นนี้ (ไปตัวเชื่อม)`);
  steps.push(`ใช้ ${typeLabel(sConn)} เพื่อ${gFloor > sFloor ? "ขึ้น" : "ลง"}ไป ชั้น ${gFloor}`);
  steps.push(legB.path ? `ชั้น ${gFloor}: จาก ${typeLabel(gConn)} ไป ${gP?.name || gNode}` : `ชั้น ${gFloor}: ไม่มีเส้นทางในชั้นนี้ (จากตัวเชื่อมไปห้อง)`);
  steps.push(`ถึงเป้าหมาย ชั้น ${gFloor}: ${gP?.name || gNode}`);

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
function navigate(page) {
  teardownPage();
  currentPage = page;
  const app = byId("app");

  // mount help/minimap/measure overlays on first navigation
  if (!byId('cc-help')) mountHelpAndOverlays();

  if (page === "map") {
    const floorOpts = FLOORS.map(f => `<option value="${f}">Floor ${f}</option>`).join("");
    app.innerHTML = `
      <style>
        .search-wrap{ position:relative; }
        .search-input{ border:1px solid #d1d5db; padding:.5rem .75rem; border-radius:.375rem; width:18rem; }
        .suggest{ position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 .5rem .5rem; max-height:16rem; overflow:auto; z-index:20; display:none; }
        .suggest.show{ display:block; }
        .suggest-item{ padding:.5rem .75rem; cursor:pointer; font-size:.9rem; display:flex; align-items:center; gap:.5rem; }
        .suggest-item:hover, .suggest-item.active{ background:#f3f4f6; }
        .badge{ font-size:.7rem; padding:.1rem .35rem; border:1px solid #e5e7eb; border-radius:.25rem; color:#374151; }
      </style>
      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-9 relative">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <label>ชั้นที่ดู:</label>
              <select id="view-floor" class="border p-2 rounded">${floorOpts}</select>
              <button id="btnClear" class="px-3 py-2 border rounded">Clear</button>
            </div>
            <div class="flex items-center gap-3">
              <div class="search-wrap">
                <input id="room-search" class="search-input" placeholder="ค้นหาห้อง / id / type (เช่น Room 101, N012, door)"/>
                <div id="room-suggest" class="suggest"></div>
              </div>
              <button id="goAdmin" class="px-3 py-2 rounded bg-yellow-600 text-white">Admin</button>
              <button id="btnHelp" title="Shortcuts (?)" class="px-3 py-2 border rounded">?</button>
            </div>
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
              <span class="text-sm text-gray-600">* 50px/เมตร • กด <b>M</b> เพื่อวัดระยะ • <b>Space+ลาก</b> เพื่อแพน</span>
            </div>
          </fieldset>

          <div id="svg-container" class="border bg-white shadow"></div>

          <div id="cc-mm" class="cc-minimap cc-mm-hide" aria-hidden="true" style="position:absolute;right:16px;bottom:16px;width:220px;height:160px;border:1px solid #e5e7eb;background:#fff;border-radius:.5rem;box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden"></div>
          <div id="cc-measure" class="cc-measure cc-mm-hide" style="position:absolute;left:16px;bottom:16px;background:#fff;border:1px solid #e5e7eb;border-radius:.5rem;padding:.35rem .6rem;box-shadow:0 2px 8px rgba(0,0,0,.08);font-size:.85rem">0 m</div>

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

    (async () => {
      await ensureBaseData();
      rebuildSearchIndex();
      const vf = byId("view-floor"); if (vf) vf.value = String(currentFloor);
      await loadFloor(currentFloor, false);
      syncNodeDropdown("sfloor", "snode");
      syncNodeDropdown("gfloor", "gnode");
      ensureBlinkStyles();

      on("btnHelp","click", ()=>toggleHelp(true));

      on("view-floor", "change", (e) => {
        const f = +e.target.value;
        loadFloor(f, false).then(() => {
          syncNodeDropdown("sfloor", "snode");
          syncNodeDropdown("gfloor", "gnode");
        });
      });
      on("sfloor", "change", () => syncNodeDropdown("sfloor", "snode"));
      on("gfloor", "change", () => syncNodeDropdown("gfloor", "gnode"));
      on("btnClear", "click", clearOverlays);
      on("goAdmin", "click", () => navigate("admin"));

      on("btnXFloor", "click", () => {
        const start = { floor: +byId("sfloor").value, id: byId("snode").value };
        const goal = { floor: +byId("gfloor").value, id: byId("gnode").value };
        const res = planCrossFloorRouteSmart(start, goal);
        renderRouteForCurrentFloor(res.segments, res.meta);
        showSteps(res.steps);
        renderMultiFloorRoute(res.segments, res.meta);
      });

      setupSearchUI();
    })();
    return;
  }

  if (page === "admin") {
    const floorOpts = FLOORS.map(f => `<option value="${f}">Floor ${f}</option>`).join("");
app.innerHTML = `
  <style>.tool-active{ background:#1f2937; color:#fff; }</style>
  <div class="flex items-center justify-between mb-3">
    <div class="flex gap-2 items-center">
      <select id="floor-select" class="border p-2 rounded">${floorOpts}</select>
      <button id="tool-select"   class="px-3 py-2 rounded border">Select</button>
      <button id="tool-room"     class="px-3 py-2 rounded border">Add Room</button>
      <button id="tool-door"     class="px-3 py-2 rounded border">Add Door</button>
      <button id="tool-junction" class="px-3 py-2 rounded border">Add Junction</button>
      <button id="tool-corridor" class="px-3 py-2 rounded border">Add Corridor Path</button>
      <button id="tool-connect"  class="px-3 py-2 rounded border">Connect</button>
      <button id="tool-delete"   class="px-3 py-2 rounded border">Delete</button>
      <button id="tool-clear"    class="px-3 py-2 rounded border">Clear Edges</button>
      <button id="tool-apply"    class="px-3 py-2 rounded border bg-indigo-600 text-white">Apply</button>
      <button id="tool-reset"    class="px-3 py-2 rounded border">Reset</button>
      <button id="tool-export"   class="px-3 py-2 rounded border bg-green-600 text-white">Export GML</button>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <label for="inp-scale" class="text-sm">Scale</label>
        <input id="inp-scale" type="number" min="1" step="1" class="w-20 border p-1 rounded"/>
        <span class="text-sm text-gray-600">px/m</span>
      </div>
      <button id="btnHelp" title="Shortcuts (?)" class="px-3 py-2 border rounded">?</button>
      <button id="backMap" class="px-3 py-2 rounded bg-gray-700 text-white">Back</button>
    </div>
  </div>
  <!-- เปลี่ยนคำว่า 50px/เมตร เป็น label แบบ dynamic -->
  <div class="mb-2 text-sm text-gray-600">
    Corridor: คลิกต่อเนื่อง ดับเบิลคลิก/คลิกขวาเพื่อจบ • น้ำหนักเป็นเมตร (<span id="lbl-scale"></span>)
  </div>
  <div class="grid grid-cols-12 gap-4">
        <div class="col-span-9 relative">
          <div id="svg-container" class="border bg-white shadow"></div>
          <div id="cc-mm" class="cc-minimap cc-mm-hide" aria-hidden="true" style="position:absolute;right:16px;bottom:16px;width:220px;height:160px;border:1px solid #e5e7eb;background:#fff;border-radius:.5rem;box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden"></div>
          <div id="cc-measure" class="cc-measure cc-mm-hide" style="position:absolute;left:16px;bottom:16px;background:#fff;border:1px solid #e5e7eb;border-radius:.5rem;padding:.35rem .6rem;box-shadow:0 2px 8px rgba(0,0,0,.08);font-size:.85rem">0 m</div>
        </div>
        <aside class="col-span-3">
          <div class="bg-white rounded-lg shadow p-4 sticky top-4" id="inspector">
            <h3 class="font-semibold mb-2">Inspector</h3>
            <label class="text-sm">ID</label><input id="inp-id" class="w-full border p-2 rounded"/>
            <label class="text-sm mt-2">Name</label><input id="inp-name" class="w-full border p-2 rounded"/>
            <label class="text-sm mt-2">Type</label>
            <select id="inp-type" class="w-full border p-2 rounded">
              <option value="room">room</option><option value="door">door</option>
              <option value="junction">junction</option><option value="corridor">corridor</option>
              <option value="stair_left">stair_left</option>
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

      {
      const initScale = Number(localStorage.getItem('PX_PER_M') || 50);
      setPxPerM(initScale); // อัปเดต lbl-scale และ redraw ให้ตรงกับค่าล่าสุด
      const _inpScaleAdmin = document.getElementById('inp-scale');
      if (_inpScaleAdmin) _inpScaleAdmin.addEventListener('change', () => setPxPerM(_inpScaleAdmin.value));
      }
      

    (async () => {
      await ensureBaseData();
      adminNodes = makeFloorMap({}); for (const f of FLOORS) adminNodes[f] = deepClone(baseNodes[f]);
      adminEdges = makeFloorMap([]); interEdges = [];
      await loadFloor(currentFloor, true);

      on("btnHelp","click", ()=>toggleHelp(true));

      on("floor-select", "change", (e) => { endCorridor(); loadFloor(+e.target.value, true); });
      on("tool-select", "click", () => setTool("select"));
      on("tool-room", "click", () => setTool("add-room"));
      on("tool-door", "click", () => setTool("add-door"));
      on("tool-junction", "click", () => setTool("add-junction"));
      on("tool-corridor", "click", () => setTool("corridor"));
      on("tool-connect", "click", () => setTool("connect"));
      on("tool-delete", "click", () => setTool("delete"));
      on("tool-clear", "click", () => recordChange("Clear edges of floor", () => { adminEdges[currentFloor] = []; redrawAll(); }));
      on("tool-apply", "click", () => { for (const f of FLOORS) baseNodes[f] = deepClone(adminNodes[f]); rebuildSearchIndex(); ccToast("Applied"); });
      on("tool-reset", "click", () => recordChange("Reset edits", () => { for (const f of FLOORS) { adminNodes[f] = deepClone(baseNodes[f]); adminEdges[f] = []; } interEdges = []; selected = null; endCorridor(); redrawAll(); renderInspector(); updateInterCount(); }));
      on("tool-export", "click", () => { exportIndoorGML(); ccToast("Exported GML"); });
      on("btn-save", "click", onInspectorSave);
      on("btn-del", "click", onInspectorDelete);
      on("btn-clear-inter", "click", () => recordChange("Clear inter-layer", () => { interEdges = []; updateInterCount(); redrawAll(); }));
      on("backMap", "click", () => navigate("map"));

      setTool("select");
      updateInterCount();
    })();
    return;
  }

  navigate("map");
}

// ---------- Help overlay & Shortcuts ----------
function mountHelpAndOverlays(){
  const help = document.createElement('div');
  help.id = 'cc-help';
  help.className = 'cc-help';
  help.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);z-index:9998';
  help.innerHTML = `
    <div class="card" style="background:#fff;border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px;max-width:540px;width:92%">
      <h3 class="font-semibold text-lg mb-2">Keyboard Shortcuts</h3>
      <ul class="grid grid-cols-2 gap-y-1 text-sm">
        <li><b>F</b> — โฟกัสค้นหา</li><li><b>Esc</b> — Clear overlays</li>
        <li><b>Space + Drag</b> — Pan</li><li><b>Wheel</b> — Zoom</li>
        <li><b>M</b> — Measure</li><li><b>?</b> — Help</li>
        <li><b>Ctrl/⌘+Z</b> — Undo</li><li><b>Ctrl/⌘+Y</b>/<b>Shift+Z</b> — Redo</li>
      </ul>
      <div class="mt-3 text-right"><button id="cc-help-close" class="px-3 py-1 border rounded">Close</button></div>
    </div>`;
  document.body.appendChild(help);
  on('cc-help-close','click',()=>toggleHelp(false));

  // global keys
  window.addEventListener('keydown',(e)=>{
    if ((e.key==='?' || (e.shiftKey && e.key==='/'))){ e.preventDefault(); toggleHelp(); }
    else if (e.key.toLowerCase()==='f'){ const el=byId('room-search'); if(el){ e.preventDefault(); el.focus(); el.select(); } }
    else if (e.key==='Escape'){ clearOverlays(); }
    else if (e.key.toLowerCase()==='m'){ e.preventDefault(); toggleMeasure(); }
    // Undo/Redo
    else if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); ccHistory.undo(); }
    else if ((e.metaKey||e.ctrlKey) && (e.key.toLowerCase()==='y' || (e.key.toLowerCase()==='z' && e.shiftKey))){ e.preventDefault(); ccHistory.redo(); }
  });
}
function toggleHelp(force){ const h=byId('cc-help'); if(!h) return; const show = (force===undefined)? h.style.display==='none' : force; h.style.display = show? 'flex':'none'; }

// ---------- Minimap ----------
function buildMiniMap(){
  const mm = byId('cc-mm'); const s = svgEl();
  if (!mm || !s){ if(mm) mm.classList.add('cc-mm-hide'); return; }
  const vb = (s.getAttribute('viewBox')||'0 0 800 600').split(/\s+/).map(Number);
  const [vx,vy,vw,vh]=vb;
  const fullW = s.viewBox.baseVal?.width || vw, fullH = s.viewBox.baseVal?.height || vh;
  const w = mm.clientWidth || 220, h = mm.clientHeight || 160;
  const scale = Math.min(w/fullW, h/fullH);
  const padX = (w - fullW*scale)/2, padY = (h - fullH*scale)/2;

  const svgNS = 'http://www.w3.org/2000/svg';
  const ms = document.createElementNS(svgNS,'svg');
  ms.setAttribute('width','100%'); ms.setAttribute('height','100%');
  ms.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const bg = document.createElementNS(svgNS,'rect');
  bg.setAttribute('x',padX); bg.setAttribute('y',padY);
  bg.setAttribute('width',fullW*scale); bg.setAttribute('height',fullH*scale);
  bg.setAttribute('fill','#fafafa'); bg.setAttribute('stroke','#e5e7eb');
  ms.appendChild(bg);

  const vRect = document.createElementNS(svgNS,'rect');
  vRect.setAttribute('x', padX + vx*scale); vRect.setAttribute('y', padY + vy*scale);
  vRect.setAttribute('width', vw*scale); vRect.setAttribute('height', vh*scale);
  vRect.setAttribute('fill','none'); vRect.setAttribute('stroke','#111'); vRect.setAttribute('stroke-width','1.4');
  ms.appendChild(vRect);

  ms.addEventListener('click',(e)=>{
    const r=ms.getBoundingClientRect();
    const mx=e.clientX-r.left-padX, my=e.clientY-r.top-padY;
    const cx=Math.max(0,Math.min(fullW,mx/scale)), cy=Math.max(0,Math.min(fullH,my/scale));
    const sview = s._view; if(!sview) return;
    const asp = sview.h/sview.w;
    const targetW = sview.w; const targetH = targetW*asp;
    const nx = Math.max(0, Math.min(fullW-targetW, cx - targetW/2));
    const ny = Math.max(0, Math.min(fullH-targetH, cy - targetH/2));
    sview.x=nx; sview.y=ny; setVB(s);
    ccToast('Jumped');
    buildMiniMap();
  });

  mm.innerHTML=''; mm.appendChild(ms); mm.classList.remove('cc-mm-hide');
}

// ---------- Multi-floor preview ----------
async function renderMultiFloorRoute(segments, meta) {
  const host = byId("multi-route"); if (!host) return;
  host.innerHTML = "";
  const floorsInRoute = [];
  for (const seg of (segments || [])) if (seg.nodes && seg.nodes.length >= 2 && !floorsInRoute.includes(seg.floor)) floorsInRoute.push(seg.floor);
  if (!floorsInRoute.length) { host.innerHTML = `<div class="text-sm text-gray-600">ไม่มีช่วงเส้นทางในชั้นใดเลย</div>`; return; }
  for (const f of floorsInRoute) {
    const card = document.createElement("div");
    card.className = "border rounded bg-white shadow";
    card.innerHTML = `
      <div class="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
        <div class="font-semibold">ชั้น ${f}</div><div class="text-xs text-gray-500">Preview</div>
      </div>
      <div class="p-2"><div id="mr-svg-${f}" class="w-full overflow-auto"></div></div>`;
    host.appendChild(card);
    const svgBox = card.querySelector(`#mr-svg-${f}`);
    await loadFloorSvgInto(svgBox, f);
    const svg = svgBox.querySelector("svg"); if (!svg) continue;

    svg.querySelectorAll(".path-line,.highlight-node").forEach(el => el.remove());

    const seg = (segments || []).find(s => s.floor === f);
    if (!seg || !seg.nodes || seg.nodes.length < 2) continue;
    const pts = seg.nodes.map(k => { const n = meta.byKey[k]; return n ? `${n.x},${n.y}` : null; }).filter(Boolean);
    const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    pl.setAttribute("points", pts.join(" ")); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "red"); pl.setAttribute("stroke-width", "3");
    pl.classList.add("path-line"); svg.appendChild(pl);
    const first = meta.byKey[seg.nodes[0]], last = meta.byKey[seg.nodes[seg.length - 1]];
    if (first) addDot(svg, first.x, first.y, "green");
    if (last) addDot(svg, last.x, last.y, "red");
  }
}
async function loadFloorSvgInto(target, floorNumber) {
  try { const res = await fetch(`./Floor0${floorNumber}/map.svg`); target.innerHTML = res.ok ? await res.text() : placeholderSvg(floorNumber); }
  catch { target.innerHTML = placeholderSvg(floorNumber); }
}
function placeholderSvg(f) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="100%" height="360">
  <rect x="10" y="10" width="380" height="340" fill="#fafafa" stroke="#ccc"/>
  <text x="20" y="30" font-size="14">Floor ${f} (no map.svg)</text>
</svg>`;
}
function addDot(svg, x, y, color) {
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 7);
  c.setAttribute("fill", color); c.setAttribute("stroke", "black"); c.setAttribute("stroke-width", 2);
  c.classList.add("highlight-node"); svg.appendChild(c);
}

// ---------- SVG / Viewport ----------
function initViewport(svg) {
  if (!svg) return;
  let vb = svg.getAttribute("viewBox");
  if (!vb) {
    const w = Number(svg.getAttribute("width")) || svg.clientWidth || 800;
    const h = Number(svg.getAttribute("height")) || svg.clientHeight || 600;
    vb = `0 0 ${w} ${h}`;
    svg.setAttribute("viewBox", vb);
  }
  const [x, y, w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  svg._view = {
    x, y, w, h,
    minW: Math.min(w, h) * 0.02,
    maxW: Math.max(w, h) * 8,
    isPanning: false,
    lastClientX: 0,
    lastClientY: 0,
    isSpaceHeld: false,
  };
}
function setVB(svg) {
  const s = svg?._view; if (!svg || !s) return;
  svg.setAttribute("viewBox", `${s.x} ${s.y} ${s.w} ${s.h}`);
  // sync minimap on any view change
  buildMiniMap();
}
function zoomAt(svg, factor, cx, cy) {
  const s = svg?._view; if (!s) return;
  const nf = Math.max(s.minW / s.w, Math.min(factor, s.maxW / s.w));
  const nx = cx - (cx - s.x) * nf;
  const ny = cy - (cy - s.y) * nf;
  s.x = nx; s.y = ny; s.w *= nf; s.h *= nf;
  setVB(svg);
}
function startPan(svg, e) { const s = svg?._view; if (!s) return; s.isPanning = true; s.lastClientX = e.clientX; s.lastClientY = e.clientY; }
function panTo(svg, e) {
  const s = svg?._view; if (!s || !s.isPanning) return;
  const kx = s.w / (svg.clientWidth || 1);
  const ky = s.h / (svg.clientHeight || 1);
  const dx = (e.clientX - s.lastClientX) * kx;
  const dy = (e.clientY - s.lastClientY) * ky;
  s.x -= dx; s.y -= dy;
  s.lastClientX = e.clientX; s.lastClientY = e.clientY;
  setVB(svg);
}
function endPan(svg) { const s = svg?._view; if (!s) return; s.isPanning = false; }
function setupViewportControls(svg) {
  initViewport(svg);
  const onWheel = (e) => { e.preventDefault(); const { x, y } = svgPoint(e); const factor = Math.pow(1.0018, e.deltaY); zoomAt(svg, factor, x, y); };
  const wantsPan = (e) => e.button === 1 || (e.button === 0 && svg._view.isSpaceHeld);
  const onPointerDown = (e) => { if (!wantsPan(e)) return; startPan(svg, e); };
  const onPointerMove = (e) => { if (svg._view.isPanning) panTo(svg, e); };
  const onPointerUp = () => endPan(svg);
  const onKeyDown = (e) => { if (e.code === "Space") svg._view.isSpaceHeld = true; };
  const onKeyUp = (e) => { if (e.code === "Space") svg._view.isSpaceHeld = false; };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  svg._disposeViewport = () => {
    svg.removeEventListener("wheel", onWheel);
    svg.removeEventListener("mousedown", onPointerDown);
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

// ---------- SVG / Draw ----------
function teardownPage() { const app = byId("app"); if (app) app.innerHTML = ""; connectBuffer = []; dragging = null; selected = null; endCorridor(); }

async function ensureBaseData() {
  const hasAny = FLOORS.some(f => Object.keys(baseNodes[f]).length);
  if (hasAny) return;
  const tryJson = async url => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
  const merge = (obj) => obj ? (obj.nodes ? obj.nodes : obj) : {};
  for (const f of FLOORS) {
    const pad = String(f).padStart(2, "0");
    const [g, n, d] = await Promise.all([
      tryJson(`Floor${pad}/graph_floor${f}.json`),
      tryJson(`Floor${pad}/nodes_floor${f}.json`),
      tryJson(`Floor${pad}/doors.json`)
    ]);
    baseNodes[f] = { ...(merge(g) || {}), ...(merge(n) || {}), ...(merge(d) || {}) };
  }
}

async function loadFloor(floorNumber, adminMode) {
  currentFloor = clampFloor(floorNumber);
  const container = byId("svg-container"); if (!container) return;
  const res = await fetch(`./Floor0${currentFloor}/map.svg`);
  container.innerHTML = res.ok ? await res.text()
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="800" height="720">
         <rect x="10" y="10" width="380" height="340" fill="#fafafa" stroke="#ccc"/>
         <text x="20" y="30" font-size="14">Floor ${currentFloor}</text>
       </svg>`;
  enhanceSVG(adminMode); redrawAll(); buildMiniMap();
}

function enhanceSVG(adminMode) {
  const svg = svgEl(); if (!svg) return;
  svg.style.userSelect = "none";
  svg.style.cursor = adminMode && (tool.startsWith("add-") || tool === "corridor") ? "crosshair" : "default";

  const fresh = svg.cloneNode(true);
  svg.parentNode.replaceChild(fresh, svg);

  const s = svgEl(); if (!s) return;

  setupViewportControls(s);

  s.addEventListener("mousedown", onSvgMouseDown);
  s.addEventListener("dblclick", onSvgDblClick);
  s.addEventListener("contextmenu", onSvgContextMenu);
  window.addEventListener("mousemove", onSvgMouseMove);
  window.addEventListener("mouseup", onSvgMouseUp);

  // Measure: click to pick points when on
  s.addEventListener("click",(e)=>{
    if(!measureOn) return;
    const pt = svgPoint(e); const npt = {x:pt.x,y:pt.y};
    if(!measureStart){ measureStart = npt; updateMeasure(0); }
    else { const d = Math.hypot(npt.x - measureStart.x, npt.y - measureStart.y) / PX_PER_M; updateMeasure(d); measureStart = null; }
  });
}

function removeSvgOverlays() {
  const svg = svgEl(); if (!svg) return;
  svg.querySelectorAll(".editable-node,.edge-line,.node-label,.selected-ring,.path-line,.highlight-node,.inter-icon,.blink-ring").forEach(el => el.remove());
}

function redrawAll() {
  const svg = svgEl(); if (!svg) return; removeSvgOverlays();
  if (isAdmin()) {
    for (const e of adminEdges[currentFloor] || []) {
      const a = adminNodes[currentFloor][e.from], b = adminNodes[currentFloor][e.to]; if (!a || !b) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y); line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", "#888"); line.setAttribute("stroke-width", "2"); line.classList.add("edge-line"); svg.appendChild(line);
    }
    for (const e of interEdges) {
      for (const side of ["from", "to"]) {
        const s = e[side]; if (s.floor !== currentFloor) continue;
        const n = adminNodes[s.floor]?.[s.id]; if (!n) continue;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        icon.setAttribute("x", n.x - 6); icon.setAttribute("y", n.y - 6); icon.setAttribute("width", 12); icon.setAttribute("height", 12);
        icon.setAttribute("fill", e.type === "elevator" ? "#4b5563" : "#6b7280"); icon.setAttribute("stroke", "#111"); icon.setAttribute("stroke-width", "1");
        icon.classList.add("inter-icon"); svg.appendChild(icon);
      }
    }
  }
  const nodes = (isAdmin() ? adminNodes : baseNodes)[currentFloor] || {};
  for (const [id, n] of Object.entries(nodes)) {
    if (+n.floor !== +currentFloor) continue;
    const color =
      n.type === "door" ? "red" :
        n.type === "junction" ? "orange" :
          n.type === "corridor" ? "#2563eb" :
            n.type?.startsWith("stair") ? "#6b7280" :
              n.type === "elevator" ? "#4b5563" : "blue";
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", 6); c.setAttribute("fill", color);
    c.setAttribute("data-id", id); c.classList.add("editable-node");
    if (isAdmin()) { c.addEventListener("mousedown", onNodeMouseDown); c.addEventListener("click", onNodeClick); }
    svg.appendChild(c);
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", n.x + 8); t.setAttribute("y", n.y - 8); t.setAttribute("font-size", "12");
    t.textContent = n.name || id; t.classList.add("node-label"); svg.appendChild(t);
    if (isAdmin() && selected && selected.floor === currentFloor && selected.id === id) {
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("cx", n.x); ring.setAttribute("cy", n.y); ring.setAttribute("r", 10); ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "#10b981"); ring.setAttribute("stroke-width", "2"); ring.classList.add("selected-ring"); svg.appendChild(ring);
    }
  }
  buildMiniMap();
}

function renderRouteForCurrentFloor(segments, meta) {
  const svg = svgEl(); if (!svg) return;
  svg.querySelectorAll(".path-line,.highlight-node").forEach(el => el.remove());
  for (const seg of segments) {
    if (seg.floor !== currentFloor || seg.nodes.length < 2) continue;
    const pts = seg.nodes.map(k => `${meta.byKey[k].x},${meta.byKey[k].y}`).join(" ");
    const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    pl.setAttribute("points", pts); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "red"); pl.setAttribute("stroke-width", "3");
    pl.classList.add("path-line"); svg.appendChild(pl);
  }
}

function clearOverlays() { const svg = svgEl(); if (!svg) return; svg.querySelectorAll(".path-line,.highlight-node,.blink-ring").forEach(el => el.remove()); }

// ---------- Dropdown ----------
function syncNodeDropdown(floorSelId, nodeSelId) {
  const fEl = byId(floorSelId), nEl = byId(nodeSelId); if (!fEl || !nEl) return;
  const f = +fEl.value; nEl.innerHTML = "";
  const nodes = baseNodes[f] || {};
  for (const [id, n] of Object.entries(nodes)) {
    if (+n.floor !== +f) continue;
    nEl.add(new Option(`${n.type}: ${n.name || id}`, id));
  }
}

// ---------- Admin Tools ----------
function setTool(name) {
  tool = name; connectBuffer = []; dragging = null;
  if (name !== "corridor") endCorridor();
  const ids = ["tool-select", "tool-room", "tool-door", "tool-junction", "tool-corridor", "tool-connect", "tool-delete"];
  ids.forEach(i => {
    const el = byId(i); if (!el) return;
    const map = {
      "tool-select": "select",
      "tool-room": "add-room",
      "tool-door": "add-door",
      "tool-junction": "add-junction",
      "tool-corridor": "corridor",
      "tool-connect": "connect",
      "tool-delete": "delete",
    };
    if (map[i] === name) el.classList.add("tool-active"); else el.classList.remove("tool-active");
  });
  const svg = svgEl(); if (svg) svg.style.cursor = isAdmin() && (name.startsWith?.("add-") || name === "corridor") ? "crosshair" : "default";
}
function svgPoint(evt) {
  const svg = svgEl(); if (!svg) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(loc.x), y: Math.round(loc.y) };
}

function nearestNodeAt(x, y, tol = 12) {
  const nodes = adminNodes[currentFloor] || {};
  let best = null, dmin = Infinity, bestId = null;
  for (const [id, n] of Object.entries(nodes)) {
    if (+n.floor !== +currentFloor) continue;
    const d = Math.hypot((n.x || 0) - x, (n.y || 0) - y);
    if (d < dmin) { dmin = d; best = n; bestId = id; }
  }
  return (best && dmin <= tol) ? { id: bestId, node: best } : null;
}

function onSvgMouseDown(evt) {
  if (!isAdmin()) return;
  const hit = evt.target.closest?.("circle.editable-node");
  const { x, y } = svgPoint(evt);

  if ((tool === "add-room" || tool === "add-door" || tool === "add-junction") && !hit) {
    recordChange(`Add ${tool.replace('add-','')}`, () => {
      const id = nextNodeId();
      const type = tool === "add-door" ? "door" : tool === "add-junction" ? "junction" : "room";
      adminNodes[currentFloor][id] = { x, y, name: type === "room" ? `Room ${id}` : `${type} ${id}`, type, floor: currentFloor };
      selected = { floor: currentFloor, id }; 
    });
    redrawAll(); renderInspector();
    return;
  }

  if (tool === "corridor" && !hit) {
    const snap = nearestNodeAt(x, y, SNAP_TOL);
    let id;
    recordChange("Corridor point", () => {
      if (snap) { id = snap.id; }
      else {
        id = nextNodeId();
        adminNodes[currentFloor][id] = { x, y, name: `corr ${id}`, type: "corridor", floor: currentFloor };
      }
      appendCorridorPoint({ floor: currentFloor, id });
    });
    return;
  }
}
function onNodeMouseDown(evt) {
  if (!isAdmin()) return; evt.preventDefault();
  const id = evt.target.getAttribute("data-id");
  if (tool === "select") {
    const { x, y } = svgPoint(evt);
    const n = adminNodes[currentFloor][id];
    dragging = { floor: currentFloor, id, offsetX: x - n.x, offsetY: y - n.y, startX: n.x, startY: n.y };
  }
}
function onSvgMouseMove(evt) {
  if (!isAdmin() || !dragging) return;
  const { x, y } = svgPoint(evt);
  const n = adminNodes[dragging.floor][dragging.id];
  n.x = x - dragging.offsetX; n.y = y - dragging.offsetY;
  redrawAll();
}
function onSvgMouseUp() { 
  if (!isAdmin() || !dragging) { dragging = null; return; }
  const n = adminNodes[dragging.floor][dragging.id];
  const moved = (n.x !== dragging.startX || n.y !== dragging.startY);
  if (moved){
    const id = dragging.id, f = dragging.floor, toX = n.x, toY = n.y, fromX = dragging.startX, fromY = dragging.startY;
    // normalize via snapshot
    recordChange(`Move ${id}`, ()=>{ adminNodes[f][id].x = toX; adminNodes[f][id].y = toY; });
  }
  dragging = null; 
}

function onNodeClick(evt) {
  if (!isAdmin()) return;
  const id = evt.target.getAttribute("data-id");
  if (tool === "select") { selected = { floor: currentFloor, id }; renderInspector(); redrawAll(); return; }

  if (tool === "connect") {
    connectBuffer.push({ floor: currentFloor, id });
    if (connectBuffer.length === 2) {
      recordChange("Connect", () => {
        const [a, b] = connectBuffer;
        if (a.floor === b.floor) {
          if (a.id !== b.id) {
            const na = adminNodes[a.floor][a.id], nb = adminNodes[b.floor][b.id];
            adminEdges[a.floor].push({ from: a.id, to: b.id, weight: distM(na, nb) });
          }
        } else {
          interEdges.push({ from: a, to: b, type: "stair_mid" });
        }
      });
      connectBuffer = []; redrawAll(); updateInterCount();
    }
    return;
  }

  if (tool === "corridor") { 
    recordChange("Corridor point", ()=>appendCorridorPoint({ floor: currentFloor, id })); 
    return; 
  }

  if (tool === "delete") {
    recordChange(`Delete ${id}`, () => {
      delete adminNodes[currentFloor][id];
      adminEdges[currentFloor] = adminEdges[currentFloor].filter(e => e.from !== id && e.to !== id);
      interEdges = interEdges.filter(e => !((e.from.floor === currentFloor && e.from.id === id) || (e.to.floor === currentFloor && e.to.id === id)));
      if (selected && selected.floor === currentFloor && selected.id === id) selected = null;
    });
    renderInspector(); redrawAll(); updateInterCount();
  }
}

/**
 * Corridor auto nodes
 */
function appendCorridorPoint(pt) {
  if (!corridorActive) {
    corridorActive = true;
    corridorBuffer = [];
    corridorBuffer.push(pt);
    selected = { ...pt };
    renderInspector();
    redrawAll();
    return;
  }

  const last = corridorBuffer[corridorBuffer.length - 1];
  if (!(last && last.floor === pt.floor && last.id !== pt.id)) {
    corridorBuffer.push(pt);
    selected = { ...pt };
    renderInspector(); redrawAll();
    return;
  }

  const floor = pt.floor;
  const nodes = adminNodes[floor];
  const a = nodes[last.id];
  const b = nodes[pt.id];
  if (!a || !b) { corridorBuffer.push(pt); selected = { ...pt }; renderInspector(); redrawAll(); return; }

  let prevId = last.id;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);

  const steps = Math.floor(d / STEP_PX);

  if (steps <= 1) {
    adminEdges[floor].push({ from: prevId, to: pt.id, weight: distM(nodes[prevId], b) });
  } else {
    for (let i = 1; i < steps; i++) {
      const t = (i * STEP_PX) / d;
      const x = Math.round(a.x + dx * t);
      const y = Math.round(a.y + dy * t);

      const snap = nearestNodeAt(x, y, SNAP_TOL);
      let nid, npos;

      if (snap) {
        nid = snap.id;
        npos = adminNodes[floor][nid];
      } else {
        nid = nextNodeId();
        npos = { x, y, name: `corr ${nid}`, type: "corridor", floor };
        adminNodes[floor][nid] = npos;
      }

      if (nid !== prevId) {
        const pa = adminNodes[floor][prevId];
        adminEdges[floor].push({ from: prevId, to: nid, weight: distM(pa, npos) });
        prevId = nid;
      }
    }
    const pa = adminNodes[floor][prevId];
    adminEdges[floor].push({ from: prevId, to: pt.id, weight: distM(pa, b) });
  }

  corridorBuffer.push(pt);
  selected = { ...pt };
  renderInspector();
  redrawAll();
}

function endCorridor() { corridorActive = false; corridorBuffer = []; }
function onSvgDblClick() { if (tool === "corridor") endCorridor(); }
function onSvgContextMenu(e) { if (tool === "corridor") { e.preventDefault(); endCorridor(); } }

function renderInspector() {
  const n = (selected ? adminNodes[selected.floor][selected.id] : null);
  const idEl = byId("inp-id"), nameEl = byId("inp-name"), typeEl = byId("inp-type");
  if (!idEl || !nameEl || !typeEl) return;
  if (!n) { idEl.value = ""; nameEl.value = ""; typeEl.value = "room"; idEl.disabled = nameEl.disabled = typeEl.disabled = true; return; }
  idEl.disabled = nameEl.disabled = typeEl.disabled = false; idEl.value = selected.id; nameEl.value = n.name || ""; typeEl.value = n.type || "room";
}
function onInspectorSave() {
  if (!selected) return;
  const idNew = escId(byId("inp-id").value.trim());
  const nameNew = byId("inp-name").value.trim();
  const typeNew = byId("inp-type").value;
  if (!idNew) { ccToast("Invalid ID"); return; }
  const nodes = adminNodes[selected.floor]; if (idNew !== selected.id && nodes[idNew]) { ccToast("ID ซ้ำ"); return; }

  recordChange(`Edit ${selected.id}`, () => {
    const n = nodes[selected.id]; n.name = nameNew || null; n.type = typeNew;
    if (idNew !== selected.id) {
      nodes[idNew] = { ...n }; delete nodes[selected.id];
      adminEdges[selected.floor] = adminEdges[selected.floor].map(e => ({ from: e.from === selected.id ? idNew : e.from, to: e.to === selected.id ? idNew : e.to, weight: e.weight }));
      interEdges = interEdges.map(e => ({
        from: (e.from.floor === selected.floor && e.from.id === selected.id) ? { ...e.from, id: idNew } : e.from,
        to: (e.to.floor === selected.floor && e.to.id === selected.id) ? { ...e.to, id: idNew } : e.to,
        type: e.type
      }));
      selected.id = idNew;
    }
  });
  redrawAll(); renderInspector();
}
function onInspectorDelete() {
  if (!selected) return;
  recordChange(`Delete ${selected.id}`, () => {
    delete adminNodes[selected.floor][selected.id];
    adminEdges[selected.floor] = adminEdges[selected.floor].filter(e => e.from !== selected.id && e.to !== selected.id);
    interEdges = interEdges.filter(e => !((e.from.floor === selected.floor && e.from.id === selected.id) || (e.to.floor === selected.floor && e.to.id === selected.id)));
    selected = null; updateInterCount();
  });
  redrawAll(); renderInspector();
}
function updateInterCount() { const el = byId("inter-count"); if (el) el.textContent = String(interEdges.length); }
function nextNodeId() { let i = 1; const used = new Set(FLOORS.flatMap(f => Object.keys(adminNodes[f]))); while (true) { const id = `N${String(i).padStart(3, "0")}`; if (!used.has(id)) return id; i++; } }

// ---------- Export IndoorGML ----------
function exportIndoorGML() {
  const floors = FLOORS.filter(f => Object.keys(adminNodes[f]).length);
  const layersXml = floors.map(f => spaceLayerXml(f)).join("");
  const ilcXml = interEdges.map((e, i) => `
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
  const blob = new Blob([xml], { type: "application/gml+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "indoor_layers.gml"; a.click(); URL.revokeObjectURL(url);
}
function spaceLayerXml(f) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nodes = Object.entries(adminNodes[f]).map(([id, n]) => ({ id, ...n }));
  const edges = adminEdges[f] || [];
  const states = nodes.map(n => `
    <core:stateMember>
      <core:State gml:id="state_${f}_${esc(n.id)}">
        <gml:name>${esc(n.name || n.id)}</gml:name>
        <gml:description>${esc(JSON.stringify({ type: n.type || "room", floor: n.floor }))}</gml:description>
        <core:dualGraph><gml:Point gml:id="pt_${f}_${esc(n.id)}"><gml:pos>${n.x} ${n.y}</gml:pos></gml:Point></core:dualGraph>
      </core:State>
    </core:stateMember>`).join("");
  const trans = edges.map((e, i) => {
    const a = adminNodes[f][e.from], b = adminNodes[f][e.to];
    const w = (e.weight ?? distM(a, b)).toFixed(3);
    return `
    <core:transitionMember>
      <core:Transition gml:id="tr_${f}_${i}">
        <core:weight>${w}</core:weight>
        <core:connects xlink:href="#state_${f}_${esc(e.from)}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
        <core:connects xlink:href="#state_${f}_${esc(e.to)}"   xmlns:xlink="http://www.w3.org/1999/xlink"/>
      </core:Transition>
    </core:transitionMember>`;
  }).join("");
  return `<core:spaceLayerMember><core:SpaceLayer gml:id="layer_${f}"><core:nodes><core:Nodes>${states}</core:Nodes></core:nodes><core:edges><core:Edges>${trans}</core:Edges></core:SpaceLayer></core:spaceLayerMember>`;
}

// ---------- Steps UI ----------
function showSteps(list) { const el = byId("route-steps"); if (!el) { ccToast(list.join(" • ")); return; } el.innerHTML = list.map(s => `<li>${s}</li>`).join(""); }

// ---------- Search ----------
function rebuildSearchIndex() {
  const idx = [];
  for (const f of FLOORS) {
    for (const [id, n] of Object.entries(baseNodes[f] || {})) {
      if (!n) continue;
      const name = String(n.name || "").trim();
      const type = String(n.type || "").trim();
      const norm = (name + " " + id + " " + type).toLowerCase();
      idx.push({ floor: f, id, name, type, x: +n.x || 0, y: +n.y || 0, norm });
    }
  }
  SEARCH_IDX = idx;
}

function querySearch(q, limit = 12) {
  const s = (q || "").toLowerCase().trim();
  if (!s) return [];
  const curF = currentFloor;
  const scored = [];
  for (const it of SEARCH_IDX) {
    let score = 0;
    if (it.id.toLowerCase() === s) score += 100;
    if (it.name.toLowerCase() === s) score += 90;
    if (it.id.toLowerCase().startsWith(s)) score += 40;
    if (it.name.toLowerCase().startsWith(s)) score += 35;
    if (it.norm.includes(s)) score += 20;
    if (it.type.toLowerCase() === s) score += 10;
    if (it.floor === curF) score += 5;
    if (score > 0) scored.push({ ...it, _score: score });
  }
  scored.sort((a,b) => b._score - a._score || a.floor - b.floor || a.id.localeCompare(b.id));
  return scored.slice(0, limit);
}

function setupSearchUI() {
  const inp = byId("room-search");
  const box = byId("room-suggest");
  if (!inp || !box) return;

  let sel = -1;
  let last = "";
  const deb = debounce(() => {
    const q = inp.value;
    if (q === last) return;
    last = q;
    renderSuggest(querySearch(q));
  }, 120);

  inp.addEventListener("input", deb);
  inp.addEventListener("keydown", (e) => {
    const items = Array.from(box.querySelectorAll(".suggest-item"));
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(-1, sel - 1); mark(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0 && items[sel]) items[sel].click();
      else {
        const r = querySearch(inp.value, 1)[0];
        if (r) pick(r);
      }
    } else if (e.key === "Escape") { hide(); }
  });

  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) hide(); });

  function renderSuggest(list) {
    if (!list.length) { hide(); return; }
    box.innerHTML = list.map(row => `
      <div class="suggest-item" data-floor="${row.floor}" data-id="${row.id}">
        <span class="badge">F${row.floor}</span>
        <span>${escapeHtml(row.name || row.id)}</span>
        <span class="text-gray-500 text-xs">(${row.type || "node"} • ${row.id})</span>
      </div>`).join("");
    box.classList.add("show");
    sel = -1;
    Array.from(box.querySelectorAll(".suggest-item")).forEach(el => {
      el.addEventListener("click", () => {
        pick({ floor: +el.getAttribute("data-floor"), id: el.getAttribute("data-id") });
      });
    });
  }
  function hide() { box.classList.remove("show"); box.innerHTML = ""; sel = -1; }
  function mark() {
    const items = Array.from(box.querySelectorAll(".suggest-item"));
    items.forEach((it,i) => it.classList.toggle("active", i === sel));
    if (sel >= 0 && items[sel]) items[sel].scrollIntoView({ block: "nearest" });
  }
  async function pick({ floor, id }) {
    hide();
    inp.blur();
    await focusNode(floor, id);
  }
}

async function focusNode(floor, id) {
  if (currentFloor !== floor) {
    const vf = byId("view-floor");
    if (vf) vf.value = String(floor);
    await loadFloor(floor, false);
  }
  const svg = svgEl(); if (!svg) return;
  const n = (baseNodes[floor] || {})[id];
  if (!n) return;
  centerZoomTo(svg, n.x, n.y, 300);
  blinkAt(svg, n.x, n.y);
}

function centerZoomTo(svg, x, y, targetW = 300) {
  const s = svg._view; if (!s) return;
  const aspect = s.h / s.w;
  s.w = Math.max(s.minW, Math.min(targetW, s.maxW));
  s.h = s.w * aspect;
  s.x = x - s.w / 2;
  s.y = y - s.h / 2;
  setVB(svg);
}

function ensureBlinkStyles() {
  if (document.getElementById("blink-style")) return;
  const css = `
  @keyframes blinkPulse { 0%{r:10; opacity:0.9} 50%{r:22; opacity:0.2} 100%{r:10; opacity:0.9} }
  .blink-ring { fill:none; stroke:#ef4444; stroke-width:3; animation: blinkPulse 800ms ease-in-out 4; }
  .cc-mm-hide{ display:none }
  `;
  const style = document.createElement("style");
  style.id = "blink-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function blinkAt(svg, x, y) {
  svg.querySelectorAll(".blink-ring").forEach(e => e.remove());
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("cx", x); ring.setAttribute("cy", y); ring.setAttribute("r", 10);
  ring.classList.add("blink-ring");
  svg.appendChild(ring);
  setTimeout(() => ring.remove(), 3200);
}

// ---------- Measure helpers ----------
function toggleMeasure(){
  measureOn = !measureOn;
  measureStart = null;
  const el = byId('cc-measure'); if (!el) return;
  el.classList.toggle('cc-mm-hide', !measureOn);
  if(!measureOn) el.textContent = '0 m';
  ccToast(measureOn? 'Measure ON':'Measure OFF');
}
function updateMeasure(dMeters){
  const el = byId('cc-measure'); if (!el) return;
  el.textContent = `${dMeters.toFixed(1)} m`;
}



// ---------- Boot ----------
window.onload = () => navigate("map");
