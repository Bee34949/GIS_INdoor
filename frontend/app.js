// FILE: frontend/app.js  (Multi-floor + Import/Export IndoorGML)

////////////////////
// Global state
////////////////////
let currentPage = null;
let currentFloor = 1;

// Map data (read-only for Map/Search)
let baseNodes = { 1:{}, 2:{} };

// Admin working copy
let adminNodes = { 1:{}, 2:{} };
let adminEdges = { 1:[], 2:[] };        // in-floor transitions
let interEdges = [];                     // cross-floor transitions: {from:{floor,id}, to:{floor,id}, type}

let tool = "select";
let connectBuffer = [];                  // for Connect tool: [{floor,id}, ...]
let dragging = null;
let selected = null;                     // {floor,id} or null

const EventRegistry = {
  records: [],
  on(t, type, fn, opt){ t.addEventListener(type, fn, opt); this.records.push({t,type,fn,opt}); },
  offAll(){ for(const r of this.records){ try{ r.t.removeEventListener(r.type, r.fn, r.opt);}catch{} } this.records=[]; }
};

////////////////////
// Helpers
////////////////////
const deepClone = obj => JSON.parse(JSON.stringify(obj));
const isAdmin = () => currentPage === "admin";
const svgEl = () => document.querySelector("svg");
const cap = s => s ? s[0].toUpperCase()+s.slice(1) : s;
const escId = s => (s||"").replace(/[^A-Za-z0-9_-]/g,"");
const euclid = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function getNodes(floor){ return isAdmin() ? adminNodes[floor] : baseNodes[floor]; }

////////////////////
// Navigation
////////////////////
function navigate(page){
  teardownPage();
  currentPage = page;
  const app = document.getElementById("app");

  if(page==="home"){
    app.innerHTML = `
      <div class="text-center mt-20">
        <h2 class="text-2xl mb-4">Welcome to Indoor Map</h2>
        <div class="space-x-2">
          <button onclick="navigate('map')"   class="px-6 py-3 bg-blue-600 text-white rounded-lg shadow">View Map</button>
          <button onclick="navigate('admin')" class="px-6 py-3 bg-yellow-600 text-white rounded-lg shadow">Admin</button>
          <button onclick="navigate('search')"class="px-6 py-3 bg-gray-800 text-white rounded-lg shadow">Search</button>
        </div>
      </div>`;
    return;
  }

  if(page==="map"){
    app.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">Building A</h2>
          <select id="floor-select" class="border p-2 rounded">
            <option value="1">Floor 1</option><option value="2">Floor 2</option>
          </select>
        </div>
        <div class="flex gap-2 mb-4">
          <select id="start-node" class="border p-2 rounded w-1/3"></select>
          <select id="goal-node"  class="border p-2 rounded w-1/3"></select>
          <button id="btnFind"  class="bg-blue-600 text-white px-4 py-2 rounded">Find Path</button>
          <button id="btnClear" class="bg-gray-600 text-white px-4 py-2 rounded">Clear</button>
        </div>
        <div id="svg-container" class="border bg-white shadow"></div>
      </div>`;
    (async()=>{
      await ensureBaseData();
      await loadFloor(1,false);
      populateNodeDropdowns();
      EventRegistry.on(document.getElementById("floor-select"),"change",e=>{
        loadFloor(+e.target.value,false).then(populateNodeDropdowns);
      });
      EventRegistry.on(document.getElementById("btnFind"),"click", findPathUI);
      EventRegistry.on(document.getElementById("btnClear"),"click", clearOverlays);
    })();
    return;
  }

  if(page==="search"){
    app.innerHTML = `
      <div class="max-w-xl mx-auto">
        <h2 class="text-xl font-semibold mb-3">Search rooms/points</h2>
        <div class="flex gap-2 mb-3">
          <select id="floor-select" class="border p-2 rounded">
            <option value="1">Floor 1</option><option value="2">Floor 2</option>
          </select>
          <input id="q" class="flex-1 border p-2 rounded" placeholder="Type name or id..."/>
        </div>
        <ul id="results" class="space-y-2"></ul>
      </div>`;
    (async()=>{
      await ensureBaseData();
      const q = document.getElementById("q"), results = document.getElementById("results");
      const floorSel = document.getElementById("floor-select");
      const render = ()=>{
        const s=q.value.trim().toLowerCase(); const f=+floorSel.value;
        results.innerHTML="";
        if(!s) return;
        for(const [id,n] of Object.entries(baseNodes[f])){
          const nm=n.name||"";
          if(!id.toLowerCase().includes(s) && !nm.toLowerCase().includes(s)) continue;
          const li=document.createElement("li");
          li.className="p-2 bg-white rounded shadow flex justify-between";
          li.innerHTML=`<span>${n.type}: <b>${nm||id}</b> (id:${id}) • floor ${n.floor}</span>
                        <button class="px-3 py-1 text-sm bg-blue-600 text-white rounded">Route</button>`;
          const btn = li.querySelector("button");
          EventRegistry.on(btn,"click",()=>{ navigate("map"); setTimeout(()=>{ 
            document.getElementById("floor-select").value=String(f);
            document.getElementById("floor-select").dispatchEvent(new Event("change"));
            setTimeout(()=>selectDropdownByValue("start-node",id),50);
          },50);});
          results.appendChild(li);
        }
      };
      EventRegistry.on(q,"input",render);
      EventRegistry.on(floorSel,"change",render);
    })();
    return;
  }

  if(page==="admin"){
    app.innerHTML = `
      <style>.tool-active{ background:#1f2937; color:#fff; }</style>
      <div class="grid grid-cols-12 gap-4">
        <div class="col-span-9">
          <div class="flex justify-between items-center mb-3">
            <h2 class="text-xl font-semibold">Admin Editor</h2>
            <div class="flex items-center gap-2">
              <select id="floor-select" class="border p-2 rounded">
                <option value="1">Floor 1</option><option value="2">Floor 2</option>
              </select>
              <div class="flex gap-1">
                <button id="tool-select"   class="px-3 py-2 rounded border">Select</button>
                <button id="tool-room"     class="px-3 py-2 rounded border">Add Room</button>
                <button id="tool-door"     class="px-3 py-2 rounded border">Add Door</button>
                <button id="tool-junction" class="px-3 py-2 rounded border">Add Junction</button>
                <button id="tool-connect"  class="px-3 py-2 rounded border">Connect</button>
                <button id="tool-delete"   class="px-3 py-2 rounded border">Delete</button>
                <button id="tool-clear"    class="px-3 py-2 rounded border">Clear Edges</button>
                <button id="tool-apply"    class="px-3 py-2 rounded border bg-indigo-600 text-white">Apply to Map</button>
                <button id="tool-reset"    class="px-3 py-2 rounded border">Reset Admin</button>
                <button id="tool-import"   class="px-3 py-2 rounded border">Import GML</button>
                <input  id="file-gml" type="file" accept=".gml,application/xml" class="hidden"/>
                <button id="tool-export"   class="px-3 py-2 rounded border bg-green-600 text-white">Export IndoorGML</button>
              </div>
            </div>
          </div>
          <div id="svg-container" class="border bg-white shadow"></div>
          <div class="text-sm text-gray-600 mt-2">
            Hint: Connect ข้ามชั้นได้ → เลือก node ชั้น 1, เปลี่ยน dropdown เป็นชั้น 2, คลิก node ชั้น 2 เพื่อสร้าง InterLayer
          </div>
        </div>
        <aside class="col-span-3">
          <div class="bg-white rounded-lg shadow p-4 sticky top-4" id="inspector">
            <h3 class="font-semibold mb-2">Inspector</h3>
            <div class="space-y-2">
              <label class="text-sm">ID</label>
              <input id="inp-id" class="w-full border p-2 rounded" placeholder="e.g. N001"/>
              <label class="text-sm">Name</label>
              <input id="inp-name" class="w-full border p-2 rounded" placeholder="e.g. Room 101"/>
              <label class="text-sm">Type</label>
              <select id="inp-type" class="w-full border p-2 rounded">
                <option value="room">room</option><option value="door">door</option>
                <option value="junction">junction</option><option value="stair">stair</option>
                <option value="elevator">elevator</option>
              </select>
              <div class="flex gap-2 pt-2">
                <button id="btn-save" class="flex-1 bg-blue-600 text-white py-2 rounded">Save</button>
                <button id="btn-del"  class="flex-1 bg-red-600 text-white  py-2 rounded">Delete</button>
              </div>
              <hr class="my-3"/>
              <div class="space-y-1 text-sm">
                <div>Inter-layer edges: <span id="inter-count">0</span></div>
                <button id="btn-clear-inter" class="w-full border rounded py-2">Clear InterLayer</button>
              </div>
            </div>
          </div>
        </aside>
      </div>`;
    (async()=>{
      await ensureBaseData();
      // working copy every time entering admin
      adminNodes = { 1: deepClone(baseNodes[1]), 2: deepClone(baseNodes[2]) };
      adminEdges = { 1:[], 2:[] };
      interEdges = [];
      selected = null; tool="add-room"; connectBuffer=[]; dragging=null;

      await loadFloor(1,true);
      const $ = id => document.getElementById(id);
      EventRegistry.on($("floor-select"),"change",e=>loadFloor(+e.target.value,true));
      EventRegistry.on($("tool-select"),  "click",()=>setTool("select"));
      EventRegistry.on($("tool-room"),    "click",()=>setTool("add-room"));
      EventRegistry.on($("tool-door"),    "click",()=>setTool("add-door"));
      EventRegistry.on($("tool-junction"),"click",()=>setTool("add-junction"));
      EventRegistry.on($("tool-connect"), "click",()=>setTool("connect"));
      EventRegistry.on($("tool-delete"),  "click",()=>setTool("delete"));
      EventRegistry.on($("tool-clear"),   "click",()=>{ adminEdges[currentFloor]=[]; redrawAll(); });
      EventRegistry.on($("tool-apply"),   "click",()=>{
        baseNodes = { 1: deepClone(adminNodes[1]), 2: deepClone(adminNodes[2]) };
        alert("Applied to Map (both floors, this session)");
      });
      EventRegistry.on($("tool-reset"),   "click",()=>{
        adminNodes = { 1: deepClone(baseNodes[1]), 2: deepClone(baseNodes[2]) };
        adminEdges = { 1:[], 2:[] }; interEdges = []; selected=null; redrawAll(); renderInspector(); updateInterCount();
      });
      EventRegistry.on($("tool-export"),  "click", exportIndoorGML);

      // Import GML
      EventRegistry.on($("tool-import"),  "click", ()=> $("file-gml").click());
      EventRegistry.on($("file-gml"),     "change", async (e)=>{
        const file = e.target.files?.[0]; if(!file) return;
        const text = await file.text();
        try{
          const summary = importIndoorGML(text);
          redrawAll(); renderInspector(); updateInterCount();
          alert(`Imported: floor1 ${summary.f1.nodes} nodes, ${summary.f1.edges} edges; floor2 ${summary.f2.nodes} nodes, ${summary.f2.edges} edges; inter ${summary.inter} connections`);
        }catch(err){
          console.error(err);
          alert("Import GML failed: " + err.message);
        } finally {
          e.target.value = "";
        }
      });

      EventRegistry.on($("btn-save"),     "click", onInspectorSave);
      EventRegistry.on($("btn-del"),      "click", onInspectorDelete);
      EventRegistry.on($("btn-clear-inter"),"click",()=>{ interEdges=[]; updateInterCount(); });
      updateInterCount();
    })();
    return;
  }
}

function teardownPage(){
  EventRegistry.offAll();
  removeSvgOverlays();
  const app=document.getElementById("app"); if(app) app.innerHTML="";
  connectBuffer=[]; dragging=null; selected=null; tool="select";
}

////////////////////
// Data load (Floor01 + Floor02)
////////////////////
async function ensureBaseData(){
  if(Object.keys(baseNodes[1]).length || Object.keys(baseNodes[2]).length) return;
  // Floor 1
  const [n1r, d1r] = await Promise.all([
    fetch("Floor01/nodes_floor1.json"),
    fetch("Floor01/doors.json")
  ]);
  const [n1, d1] = await Promise.all([n1r.ok?n1r.json():{}, d1r.ok?d1r.json():{}]);
  baseNodes[1] = { ...(n1||{}), ...((d1&&d1.nodes)||d1||{}) };

  // Floor 2 (optional files)
  let n2={}, d2={};
  try{
    const [n2r, d2r] = await Promise.all([
      fetch("Floor02/nodes_floor2.json"),
      fetch("Floor02/doors.json")
    ]);
    n2 = n2r.ok ? await n2r.json() : {};
    d2 = d2r.ok ? await d2r.json() : {};
  }catch(_){}
  baseNodes[2] = { ...(n2||{}), ...((d2&&d2.nodes)||d2||{}) };
}

////////////////////
// Floor / SVG
////////////////////
async function loadFloor(floorNumber, adminMode){
  const container = document.getElementById("svg-container"); if(!container) return;
  currentFloor = floorNumber;
  const res = await fetch(`./Floor0${floorNumber}/map.svg`);
  container.innerHTML = res.ok ? await res.text() : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 360" width="800" height="720"><rect x="10" y="10" width="380" height="340" fill="#fafafa" stroke="#ccc"/><text x="20" y="30" font-size="14">Floor ${floorNumber}</text></svg>`;
  enhanceSVG(adminMode);
  redrawAll();
  if(adminMode) renderInspector();
}

function enhanceSVG(adminMode){
  const svg = svgEl(); if(!svg) return;
  EventRegistry.on(svg,"mousedown",onSvgMouseDown);
  EventRegistry.on(svg,"mousemove",onSvgMouseMove);
  EventRegistry.on(window,"mouseup",onSvgMouseUp);
  svg.style.userSelect="none";
  svg.style.cursor = adminMode && tool.startsWith("add-") ? "crosshair" : "default";
}

function removeSvgOverlays(){
  const svg=svgEl(); if(!svg) return;
  svg.querySelectorAll(".editable-node,.edge-line,.node-label,.selected-ring,.path-line,.highlight-node,.inter-icon").forEach(el=>el.remove());
}

function redrawAll(){
  const svg=svgEl(); if(!svg) return;
  removeSvgOverlays();

  // edges (admin same-floor)
  if(isAdmin()){
    for(const e of adminEdges[currentFloor]){
      const a=adminNodes[currentFloor][e.from], b=adminNodes[currentFloor][e.to]; if(!a||!b) continue;
      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",a.x); line.setAttribute("y1",a.y);
      line.setAttribute("x2",b.x); line.setAttribute("y2",b.y);
      line.setAttribute("stroke","#888"); line.setAttribute("stroke-width","2");
      line.classList.add("edge-line"); svg.appendChild(line);
    }
    // inter-layer anchors on this floor
    for(const e of interEdges){
      for(const side of ["from","to"]){
        const s=e[side]; if(s.floor!==currentFloor) continue;
        const n=adminNodes[s.floor][s.id]; if(!n) continue;
        const icon=document.createElementNS("http://www.w3.org/2000/svg","rect");
        icon.setAttribute("x", n.x-6); icon.setAttribute("y", n.y-6);
        icon.setAttribute("width", 12); icon.setAttribute("height", 12);
        icon.setAttribute("fill", e.type==="elevator"?"#4b5563":"#6b7280");
        icon.setAttribute("stroke", "#111"); icon.setAttribute("stroke-width", "1");
        icon.classList.add("inter-icon");
        svg.appendChild(icon);
      }
    }
  }

  // nodes
  const nodes = getNodes(currentFloor);
  for(const [id,n] of Object.entries(nodes)){
    if(+n.floor!==+currentFloor) continue;
    const color = n.type==="door"?"red": n.type==="junction"?"orange": n.type==="stair"?"#6b7280": n.type==="elevator"?"#4b5563":"blue";
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",n.x); c.setAttribute("cy",n.y); c.setAttribute("r",6); c.setAttribute("fill",color);
    c.setAttribute("data-id",id); c.classList.add("editable-node");
    if(isAdmin()){ EventRegistry.on(c,"mousedown",onNodeMouseDown); EventRegistry.on(c,"click",onNodeClick); }
    svg.appendChild(c);
    const t=document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x",n.x+8); t.setAttribute("y",n.y-8); t.setAttribute("font-size","12");
    t.textContent=n.name||id; t.classList.add("node-label"); svg.appendChild(t);
    if(isAdmin() && selected && selected.floor===currentFloor && selected.id===id){
      const ring=document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.setAttribute("cx",n.x); ring.setAttribute("cy",n.y);
      ring.setAttribute("r",10); ring.setAttribute("fill","none");
      ring.setAttribute("stroke","#10b981"); ring.setAttribute("stroke-width","2");
      ring.classList.add("selected-ring"); svg.appendChild(ring);
    }
  }
}

////////////////////
// Admin tools
////////////////////
function setTool(name){
  tool=name; connectBuffer=[]; dragging=null;
  ["tool-select","tool-room","tool-door","tool-junction","tool-connect","tool-delete"].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const active=(id==="tool-select"&&tool==="select")||(id==="tool-room"&&tool==="add-room")||
                 (id==="tool-door"&&tool==="add-door")||(id==="tool-junction"&&tool==="add-junction")||
                 (id==="tool-connect"&&tool==="connect")||(id==="tool-delete"&&tool==="delete");
    el.classList.toggle("tool-active",active);
  });
  const svg=svgEl(); if(svg) svg.style.cursor = tool.startsWith("add-") ? "crosshair":"default";
}

function svgPoint(evt){
  const svg=svgEl(); if(!svg) return {x:0,y:0};
  const pt=svg.createSVGPoint(); pt.x=evt.clientX; pt.y=evt.clientY;
  const loc=pt.matrixTransform(svg.getScreenCTM().inverse());
  return {x:Math.round(loc.x), y:Math.round(loc.y)};
}

function onSvgMouseDown(evt){
  if(!isAdmin()) return;
  const hitNode = evt.target.closest?.("circle.editable-node");
  if((tool==="add-room"||tool==="add-door"||tool==="add-junction") && !hitNode){
    const {x,y}=svgPoint(evt);
    const id = nextNodeId(currentFloor);
    const type = tool==="add-door"?"door": tool==="add-junction"?"junction":"room";
    adminNodes[currentFloor][id]={x,y,name:type==="room"?`Room ${id}`:`${cap(type)} ${id}`, type, floor: currentFloor};
    selected={floor:currentFloor,id}; redrawAll(); renderInspector();
  }
}

function onNodeMouseDown(evt){
  if(!isAdmin()) return;
  evt.preventDefault();
  const id=evt.target.getAttribute("data-id");
  if(tool==="select"){
    const {x,y}=svgPoint(evt); const n=adminNodes[currentFloor][id];
    dragging={floor:currentFloor,id,offsetX:x-n.x,offsetY:y-n.y};
  }
}
function onSvgMouseMove(evt){
  if(!isAdmin()||!dragging) return;
  const {x,y}=svgPoint(evt); const n=adminNodes[dragging.floor][dragging.id];
  n.x=x-dragging.offsetX; n.y=y-dragging.offsetY; redrawAll();
}
function onSvgMouseUp(){ dragging=null; }

function onNodeClick(evt){
  if(!isAdmin()) return;
  const id=evt.target.getAttribute("data-id");
  if(tool==="select"){ selected={floor:currentFloor,id}; renderInspector(); redrawAll(); return; }
  if(tool==="connect"){
    connectBuffer.push({floor:currentFloor,id});
    if(connectBuffer.length===2){
      const [a,b]=connectBuffer;
      if(a.floor===b.floor){
        if(a.id!==b.id){
          adminEdges[a.floor].push({from:a.id,to:b.id,weight:euclid(adminNodes[a.floor][a.id],adminNodes[b.floor][b.id])});
        }
      }else{
        interEdges.push({from:a,to:b,type:"stair"}); // default type
      }
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

////////////////////
// Inspector
////////////////////
function renderInspector(){
  const n = (selected ? adminNodes[selected.floor][selected.id] : null);
  const idEl=document.getElementById("inp-id"), nameEl=document.getElementById("inp-name"), typeEl=document.getElementById("inp-type");
  if(!idEl||!nameEl||!typeEl) return;
  if(!n){ idEl.value=""; nameEl.value=""; typeEl.value="room"; idEl.disabled=nameEl.disabled=typeEl.disabled=true; return; }
  idEl.disabled=nameEl.disabled=typeEl.disabled=false;
  idEl.value=selected.id; nameEl.value=n.name||""; typeEl.value=n.type||"room";
}
function onInspectorSave(){
  if(!selected) return;
  const idNew = escId(document.getElementById("inp-id").value.trim());
  const nameNew = document.getElementById("inp-name").value.trim();
  const typeNew = document.getElementById("inp-type").value;
  if(!idNew) return alert("Invalid ID");
  const nodes=adminNodes[selected.floor];
  if(idNew!==selected.id && nodes[idNew]) return alert("ID ซ้ำในชั้นนี้");

  const n=nodes[selected.id]; n.name=nameNew||null; n.type=typeNew;
  if(idNew!==selected.id){
    nodes[idNew]={...n}; delete nodes[selected.id];
    adminEdges[selected.floor] = adminEdges[selected.floor].map(e=>({
      from: e.from===selected.id? idNew : e.from,
      to:   e.to  ===selected.id? idNew : e.to,
      weight: e.weight
    }));
    interEdges = interEdges.map(e=>({
      from: (e.from.floor===selected.floor && e.from.id===selected.id) ? {...e.from,id:idNew} : e.from,
      to:   (e.to.floor  ===selected.floor && e.to.id  ===selected.id) ? {...e.to,  id:idNew} : e.to,
      type: e.type
    }));
    selected.id = idNew;
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
function updateInterCount(){
  const el=document.getElementById("inter-count"); if(el) el.textContent=String(interEdges.length);
}

////////////////////
// Map (per floor)
////////////////////
function populateNodeDropdowns(){
  const start=document.getElementById("start-node"), goal=document.getElementById("goal-node");
  if(!start||!goal) return;
  start.innerHTML=""; goal.innerHTML="";
  for(const [id,n] of Object.entries(baseNodes[currentFloor])){
    if(+n.floor!==+currentFloor) continue;
    const label=`${n.type}: ${n.name||id}`;
    start.add(new Option(label,id)); goal.add(new Option(label,id));
  }
}
function findPathUI(){
  const s=document.getElementById("start-node").value, g=document.getElementById("goal-node").value;
  if(!s||!g) return alert("เลือกจุดให้ครบ");
  const start=[baseNodes[currentFloor][s].x, baseNodes[currentFloor][s].y];
  const goal =[baseNodes[currentFloor][g].x, baseNodes[currentFloor][g].y];
  const pts=Object.values(baseNodes[currentFloor]).map(n=>[n.x,n.y]);
  const G=buildVisibilityGraph(pts); const path=shortestPath(G,start,goal);
  if(!path) return alert("❌ No path");
  renderPath(path); highlightPoint(start,"green"); highlightPoint(goal,"red");
}

////////////////////
// Graph & draw
////////////////////
function buildVisibilityGraph(nodes){
  const g={};
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i], b=nodes[j], d=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const A=a.toString(), B=b.toString();
      (g[A] ||= []).push({node:B, cost:d});
      (g[B] ||= []).push({node:A, cost:d});
    }
  }
  return g;
}
function shortestPath(graph,start,goal){
  const S=start.toString(), T=goal.toString();
  const dist={}, prev={}, Q=new Set(Object.keys(graph));
  for(const v of Q) dist[v]=Infinity; dist[S]=0;
  while(Q.size){ const u=[...Q].reduce((a,b)=>dist[a]<dist[b]?a:b); Q.delete(u); if(u===T) break;
    for(const e of (graph[u]||[])){ const v=e.node, alt=dist[u]+e.cost; if(alt<dist[v]){dist[v]=alt; prev[v]=u;} }
  }
  if(!prev[T] && S!==T) return null;
  const path=[]; let u=T; while(u){ path.unshift(u.split(",").map(Number)); if(u===S) break; u=prev[u]; }
  return path;
}
function renderPath(path){
  const svg=svgEl(); if(!svg) return;
  svg.querySelectorAll(".path-line,.highlight-node").forEach(e=>e.remove());
  const pl=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  pl.setAttribute("points", path.map(p=>p.join(",")).join(" "));
  pl.setAttribute("fill","none"); pl.setAttribute("stroke","red"); pl.setAttribute("stroke-width","3");
  pl.classList.add("path-line"); svg.appendChild(pl);
}
function highlightPoint([x,y],color){
  const svg=svgEl(); if(!svg) return;
  const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
  c.setAttribute("cx",x); c.setAttribute("cy",y); c.setAttribute("r",8);
  c.setAttribute("fill",color); c.setAttribute("stroke","black"); c.setAttribute("stroke-width",2);
  c.classList.add("highlight-node"); svg.appendChild(c);
}
function selectDropdownByValue(id,val){ const el=document.getElementById(id); if(!el) return; for(const o of el.options){ if(o.value===val){el.value=val; break;} } }

////////////////////
// Overlays
////////////////////
function clearOverlays() {
  const svg = svgEl(); if (!svg) return;
  svg.querySelectorAll(".path-line,.highlight-node").forEach(el => el.remove());
}

////////////////////
// Import IndoorGML  (States/Transitions/InterLayerConnections)
////////////////////
function importIndoorGML(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("XML parse error");

  // utilities
  const qAll = (root, local) => Array.from(root.getElementsByTagNameNS("*", local));
  const txt = (el) => (el ? (el.textContent || "").trim() : "");
  const num = (s, d=0) => { const v = Number(s); return Number.isFinite(v) ? v : d; };
  const parseStateId = (s) => {
    // expect: state_<floor>_<id>
    const m = s.match(/^state_(\d+)_(.+)$/);
    if (!m) return null;
    return { floor: Number(m[1]), id: m[2] };
  };

  // reset admin working copies
  adminNodes = { 1:{}, 2:{} };
  adminEdges = { 1:[], 2:[] };
  interEdges = [];

  // SpaceLayers → per-floor states/transitions
  const spaceLayers = qAll(doc, "SpaceLayer");
  for (const layer of spaceLayers) {
    // States
    for (const state of qAll(layer, "State")) {
      const sid = state.getAttributeNS("http://www.opengis.net/gml/3.2", "id") || state.getAttribute("gml:id") || state.getAttribute("id");
      const parsed = sid ? parseStateId(sid) : null;
      // fallback: read floor from gml:description json if present
      let floor = parsed?.floor ?? null;
      let id = parsed?.id ?? null;

      const name = txt(qAll(state, "name")[0]) || id || "";
      const desc = txt(qAll(state, "description")[0]);
      let meta = {};
      try { if (desc) meta = JSON.parse(desc); } catch {}

      if (floor == null) floor = num(meta.floor, 1);
      if (!id) id = name || "N";

      const pos = txt(qAll(state, "pos")[0]).split(/\s+/).map(Number);
      const x = num(pos[0], 0), y = num(pos[1], 0);
      const type = meta.type || "room";

      // keep only floor 1/2
      floor = floor === 2 ? 2 : 1;
      adminNodes[floor][id] = { x, y, name, type, floor };
    }

    // Transitions (same layer only)
    for (const tr of qAll(layer, "Transition")) {
      const conns = qAll(tr, "connects").map(c => c.getAttributeNS("http://www.w3.org/1999/xlink","href") || c.getAttribute("xlink:href") || c.getAttribute("href"));
      if (conns.length < 2) continue;
      const a = parseStateId((conns[0]||"").replace(/^#/, "")); 
      const b = parseStateId((conns[1]||"").replace(/^#/, ""));
      if (!a || !b) continue;
      if (a.floor !== b.floor) continue; // same-floor only in Transition
      const floor = a.floor === 2 ? 2 : 1;
      adminEdges[floor].push({ from: a.id, to: b.id, weight: euclid(adminNodes[floor][a.id], adminNodes[floor][b.id]) });
    }
  }

  // InterLayerConnection (cross-floor)
  for (const ilc of qAll(doc, "InterLayerConnection")) {
    const conns = qAll(ilc, "InterLayerConnectionPropertyType").concat(qAll(ilc, "connectedLayers"));
    // try both patterns to be robust
    const hrefs = [];
    qAll(ilc, "InterLayerConnectionPropertyType").forEach(x=>{
      const h = x.getAttributeNS("http://www.w3.org/1999/xlink","href") || x.getAttribute("xlink:href") || x.getAttribute("href");
      if (h) hrefs.push(h);
    });
    if (!hrefs.length) {
      qAll(ilc, "connects").forEach(x=>{
        const h = x.getAttributeNS("http://www.w3.org/1999/xlink","href") || x.getAttribute("xlink:href") || x.getAttribute("href");
        if (h) hrefs.push(h);
      });
    }
    if (hrefs.length >= 2) {
      const a = parseStateId(hrefs[0].replace(/^#/, "")); 
      const b = parseStateId(hrefs[1].replace(/^#/, ""));
      if (a && b && a.floor !== b.floor) {
        interEdges.push({ from: {floor: a.floor===2?2:1, id: a.id}, to: {floor: b.floor===2?2:1, id: b.id}, type: "stair" });
      }
    }
  }

  // summary
  return {
    f1: { nodes: Object.keys(adminNodes[1]).length, edges: adminEdges[1].length },
    f2: { nodes: Object.keys(adminNodes[2]).length, edges: adminEdges[2].length },
    inter: interEdges.length
  };
}

////////////////////
// Export IndoorGML (multi-floor + inter-layer)
////////////////////
function exportIndoorGML(){
  if(!isAdmin()) return;

  const floors = [1,2].filter(f => Object.keys(adminNodes[f]).length);
  const layersXml = floors.map(f=>{
    const nodes = Object.entries(adminNodes[f]).map(([id,n])=>({id,...n}));
    const edges = adminEdges[f].map(e=>({...e}));
    return spaceLayerXml(f,nodes,edges);
  }).join("");

  const ilcXml = interEdges.map((e,i)=>{
    const sid = (f,id)=>`state_${f}_${id}`;
    return `
      <core:interLayerConnectionMember>
        <core:InterLayerConnection gml:id="ilc_${i}">
          <core:weight>1.0</core:weight>
          <core:connectedLayers>
            <core:InterLayerConnectionPropertyType xlink:href="#${sid(e.from.floor, e.from.id)}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
            <core:InterLayerConnectionPropertyType xlink:href="#${sid(e.to.floor,   e.to.id  )}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
          </core:connectedLayers>
        </core:InterLayerConnection>
      </core:interLayerConnectionMember>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<core:IndoorFeatures xmlns:core="http://www.opengis.net/indoorgml/1.0/core" xmlns:gml="http://www.opengis.net/gml/3.2">
  <core:multiLayeredGraph>
    <core:MultiLayeredGraph gml:id="mlg_1">
      <core:spaceLayers>
        <core:SpaceLayers>
          ${layersXml}
        </core:SpaceLayers>
      </core:spaceLayers>
      ${ilcXml}
    </core:MultiLayeredGraph>
  </core:multiLayeredGraph>
</core:IndoorFeatures>`.trim();

  const blob=new Blob([xml],{type:"application/gml+xml;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=`indoor_layers_1_2.gml`; a.click(); URL.revokeObjectURL(url);
}

function spaceLayerXml(floor, nodes, edges){
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const pos=n=>`${n.x} ${n.y}`;
  const statesXml = nodes.map(n=>`
    <core:stateMember>
      <core:State gml:id="state_${floor}_${esc(n.id)}">
        <gml:name>${esc(n.name || n.id)}</gml:name>
        <gml:description>${esc(JSON.stringify({type:n.type||"room",floor:n.floor}))}</gml:description>
        <core:dualGraph>
          <gml:Point gml:id="pt_${floor}_${esc(n.id)}"><gml:pos>${pos(n)}</gml:pos></gml:Point>
        </core:dualGraph>
        <core:connects/>
      </core:State>
    </core:stateMember>`).join("");
  const transXml = edges.map((e,i)=>`
    <core:transitionMember>
      <core:Transition gml:id="tr_${floor}_${i}">
        <core:weight>${(e.weight ?? euclid(adminNodes[floor][e.from], adminNodes[floor][e.to])).toFixed(3)}</core:weight>
        <core:connects xlink:href="#state_${floor}_${esc(e.from)}" xmlns:xlink="http://www.w3.org/1999/xlink"/>
        <core:connects xlink:href="#state_${floor}_${esc(e.to)}"   xmlns:xlink="http://www.w3.org/1999/xlink"/>
      </core:Transition>
    </core:transitionMember>`).join("");
  return `
    <core:spaceLayerMember>
      <core:SpaceLayer gml:id="layer_${floor}">
        <core:nodes><core:Nodes>${statesXml}</core:Nodes></core:nodes>
        <core:edges><core:Edges>${transXml}</core:Edges></core:edges>
      </core:SpaceLayer>
    </core:spaceLayerMember>`;
}

////////////////////
// Utils
////////////////////
function nextNodeId(floor){
  let i=1; const used = new Set([...Object.keys(adminNodes[1]), ...Object.keys(adminNodes[2])]);
  while(true){ const id=`N${String(i).padStart(3,"0")}`; if(!used.has(id)) return id; i++; }
}
window.onload=()=>navigate("admin");

// ✅ วางท่อนนี้ไว้ท้ายไฟล์ app.js (แทนของเดิมได้เลย)

// --- (ออปชัน) Hash Router เล็กๆ ---
function bootRouter() {
  const route = (location.hash || '#map').replace('#', '');
  // guard: เผื่อใส่ค่าประหลาด
  const allowed = new Set(['map','admin','search','home']);
  navigate(allowed.has(route) ? route : 'map');

  // เปลี่ยนหน้าตาม hash
  window.addEventListener('hashchange', () => {
    const r = (location.hash || '#map').replace('#', '');
    navigate(allowed.has(r) ? r : 'map');
  }, { once: false });
}

// เปิดหน้า View Map เป็นค่าเริ่มต้น
window.onload = () => {
  // ใช้อันใดอันหนึ่ง:
  // 1) เรียกตรงๆ:
  // navigate('map');

  // 2) หรือให้รองรับ #map/#admin/#search:
  bootRouter();
};
