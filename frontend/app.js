// ===== SPA Navigation =====
function navigate(page) {
  const app = document.getElementById("app");

  if (page === "home") {
    app.innerHTML = `
      <div class="text-center mt-20">
        <h2 class="text-2xl mb-4">Welcome to Indoor Map</h2>
        <button onclick="navigate('map')" class="px-6 py-3 bg-blue-600 text-white rounded-lg shadow">View Map</button>
      </div>
    `;
  }

  if (page === "map") {
    app.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">Building A</h2>
          <select id="floor-select" class="border p-2 rounded">
            <option value="1">Floor 1</option>
            <option value="2">Floor 2</option>
            <option value="3">Floor 3</option>
          </select>
        </div>
        <div id="svg-container" class="border bg-white shadow"></div>

        <div class="mt-4 bg-white p-4 rounded shadow">
          <label>Start:</label>
          <select id="startSelect" class="border p-1"></select>
          <label class="ml-4">End:</label>
          <select id="endSelect" class="border p-1"></select>
          <button onclick="findPathFromDropdown()" class="ml-4 px-3 py-1 bg-blue-600 text-white rounded">Go</button>
        </div>
      </div>
    `;

    loadFloor(1);
    document.getElementById("floor-select").addEventListener("change", e => {
      loadFloor(parseInt(e.target.value));
    });
  }

  if (page === "search") {
    app.innerHTML = `
      <div class="max-w-md mx-auto bg-white shadow p-6 rounded">
        <h2 class="text-xl font-bold mb-4">Search</h2>
        <input type="text" id="roomInput" class="w-full border p-2 rounded mb-4" placeholder="Room number e.g. 101">
        <button onclick="doSearch()" class="w-full px-4 py-2 bg-blue-600 text-white rounded">Search</button>
      </div>
    `;
  }
}

// ===== Indoor Map Logic (จาก script.js เดิม) =====

// QGIS Bounds (ห้ามแตะ)
const qgisMinX = 125.565, qgisMaxX = 294.397, qgisMinY = 346.627, qgisMaxY = 465.903;
let nodes = {}, nodePositions = {}, graph = {};

function normalizeCoord(x, y, viewBox) {
  const [vx, vy, vw, vh] = viewBox;
  const normX = ((x - qgisMinX) / (qgisMaxX - qgisMinX)) * vw + vx;
  const normY = ((qgisMaxY - y) / (qgisMaxY - qgisMinY)) * vh + vy;
  return [normX, normY];
}

async function loadFloor(floorNumber) {
  const svgContainer = document.getElementById('svg-container');
  if (!svgContainer) return;

  const response = await fetch(`./Floor0${floorNumber}/map.svg`);
  const svgText = await response.text();
  svgContainer.innerHTML = svgText;

  const svg = svgContainer.querySelector("svg");
  const viewBox = svg.getAttribute("viewBox").split(" ").map(parseFloat);

  nodes = await fetch("nodes.json").then(r => r.json());
  graph = await fetch("edges.json").then(r => r.json());

  nodePositions = {};
  for (const [key, node] of Object.entries(nodes)) {
    if (node.floor !== floorNumber) continue;
    const [cx, cy] = normalizeCoord(node.x, node.y, viewBox);
    nodePositions[key] = { x: cx, y: cy };
  }

  populateDropdowns(graph);
  setupInteractivePathfinding();
}

function getNodeColor(id) {
  if (id.startsWith("room_")) return "blue";
  if (id.startsWith("D_")) return "orange";
  if (id.startsWith("elevator")) return "purple";
  if (id.startsWith("stairs")) return "purple";
  return "red";
}

function getNodeXY(id) {
  const pos = nodePositions[id];
  return pos ? [pos.x, pos.y] : [0, 0];
}

function heuristic(a, b) {
  const [x1,y1] = getNodeXY(a), [x2,y2] = getNodeXY(b);
  return Math.hypot(x1 - x2, y1 - y2);
}

function edgeCost(a, b) {
  const [ax, ay] = getNodeXY(a), [bx, by] = getNodeXY(b);
  let dist = Math.hypot(ax - bx, ay - by);
  const typeA = nodes[a]?.type, typeB = nodes[b]?.type;
  if (typeA==="stairs"||typeB==="stairs") dist *= 1.2;
  if (typeA==="elevator"||typeB==="elevator") dist *= 1.05;
  return dist;
}

function astar(start, end, graph) {
  const open = new Set([start]), cameFrom = {}, g = {}, f = {};
  for (const n in graph) { g[n]=Infinity; f[n]=Infinity; }
  g[start]=0; f[start]=heuristic(start,end);

  while (open.size>0) {
    let cur=[...open].reduce((a,b)=>f[a]<f[b]?a:b);
    if (cur===end) return reconstruct(cameFrom,cur);
    open.delete(cur);
    for (const nb of graph[cur]) {
      const gTent = g[cur]+edgeCost(cur,nb);
      if (gTent<g[nb]) {
        cameFrom[nb]=cur; g[nb]=gTent; f[nb]=g[nb]+heuristic(nb,end);
        open.add(nb);
      }
    }
  }
  return null;
}

function reconstruct(cameFrom, cur) {
  const path=[cur]; while (cameFrom[cur]) { cur=cameFrom[cur]; path.unshift(cur); }
  return path;
}

function drawPath(path, pos, svg) {
  svg.querySelectorAll(".path-line").forEach(e=>e.remove());
  for (let i=0;i<path.length-1;i++) {
    const a=pos[path[i]], b=pos[path[i+1]];
    if (a&&b) {
      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",a.x); line.setAttribute("y1",a.y);
      line.setAttribute("x2",b.x); line.setAttribute("y2",b.y);
      line.setAttribute("stroke","green"); line.setAttribute("stroke-width",2);
      line.classList.add("path-line"); svg.appendChild(line);
    }
  }
}

function setupInteractivePathfinding() {
  const svg = document.querySelector("svg");
  if (!svg) return;
  let selected = [];
  for (const [id,pos] of Object.entries(nodePositions)) {
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",pos.x); c.setAttribute("cy",pos.y);
    c.setAttribute("r",5); c.setAttribute("fill",getNodeColor(id));
    c.style.cursor="pointer";
    c.addEventListener("click",()=>{
      selected.push(id);
      if (selected.length===2) {
        const p=astar(selected[0],selected[1],graph);
        drawPath(p,nodePositions,svg);
        console.log("Path:",p);
        selected=[];
      }
    });
    svg.appendChild(c);
  }
}

function populateDropdowns(graph) {
  const startSel=document.getElementById("startSelect");
  const endSel=document.getElementById("endSelect");
  if (!startSel||!endSel) return;
  startSel.innerHTML=""; endSel.innerHTML="";
  for (const id of Object.keys(graph)) {
    const node=nodes[id]; let label=id;
    if (node?.type==="room") label=`Room ${node.name||id}`;
    if (node?.type==="stairs") label=`Stairs ${node.name||id}`;
    if (node?.type==="elevator") label=`Elevator ${node.name||id}`;
    startSel.appendChild(new Option(label,id));
    endSel.appendChild(new Option(label,id));
  }
}

function findPathFromDropdown() {
  const s=document.getElementById("startSelect").value;
  const e=document.getElementById("endSelect").value;
  if (s&&e) {
    const p=astar(s,e,graph);
    if (p?.length>0) drawPath(p,nodePositions,document.querySelector("svg"));
    else alert("❌ ไม่พบเส้นทาง");
  }
}

// Search (dummy)
function doSearch() {
  const room=document.getElementById("roomInput").value;
  alert(`ค้นหาห้อง: ${room} (ยังไม่ผูกกับ map)`);
}

// ===== เริ่มที่หน้า Home =====
window.onload = ()=>navigate("home");
