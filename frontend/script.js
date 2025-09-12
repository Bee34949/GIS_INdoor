// พิกัด QGIS ที่ export มา
const qgisMinX = 125.565;
const qgisMaxX = 294.397;
const qgisMinY = 346.627;
const qgisMaxY = 465.903;

let nodes = {}; // เก็บ nodes.json ทั้งหมด
let nodePositions = {}; // เก็บพิกัดของ node ที่ normalize แล้ว
let graph = {}; // เก็บ edges.json

// ฟังก์ชัน normalize ค่าพิกัดจาก QGIS → SVG ViewBox
function normalizeCoord(x, y, viewBox) {
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = viewBox;
  const normX = ((x - qgisMinX) / (qgisMaxX - qgisMinX)) * viewBoxWidth + viewBoxX;
  const normY = ((qgisMaxY - y) / (qgisMaxY - qgisMinY)) * viewBoxHeight + viewBoxY;
  return [normX, normY];
}

// โหลด SVG และข้อมูล Node
async function loadFloor(floorNumber) {
  const svgContainer = document.getElementById('svg-container');
  if (!svgContainer) {
    console.error('Missing #svg-container');
    return;
  }

  try {
    // โหลด SVG
    const response = await fetch(`./Floor01/map.svg`);
    const svgText = await response.text();
    svgContainer.innerHTML = svgText;

    const svg = svgContainer.querySelector("svg");
    const viewBox = svg.getAttribute("viewBox").split(" ").map(parseFloat);

    // โหลด nodes และ edges
    nodes = await fetch("nodes.json").then(r => r.json());
    graph = await fetch("edges.json").then(r => r.json());

    // เก็บตำแหน่ง node ทั้งหมด (รวม walk_)
    nodePositions = {};
    for (const [key, node] of Object.entries(nodes)) {
      const [cx, cy] = normalizeCoord(node.x, node.y, viewBox);
      nodePositions[key] = { x: cx, y: cy };

      if (key.startsWith("walk_")) continue; // ไม่ต้องวาด walk node

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", 5);
      circle.setAttribute("fill", getNodeColor(key));
      svg.appendChild(circle);
    }

    populateDropdowns(graph);

  } catch (err) {
    console.error("Error loading floor map:", err);
  }
}

// ฟังก์ชันช่วยเรื่องสี node
function getNodeColor(nodeId) {
  if (nodeId.startsWith("room_")) return "blue";
  if (nodeId.startsWith("D_")) return "orange";
  if (nodeId.startsWith("elevator")) return "purple";
  if (nodeId.startsWith("stairs")) return "purple";
  return "red"; // default
}

// Pathfinding utilities
function getNodeXY(nodeId) {
  const pos = nodePositions[nodeId];
  if (!pos) {
    console.warn(`❌ Node not found: ${nodeId}`);
    return [0, 0];
  }
  return [pos.x, pos.y];
}

function heuristic(a, b) {
  const [x1, y1] = getNodeXY(a);
  const [x2, y2] = getNodeXY(b);
  return Math.hypot(x1 - x2, y1 - y2);
}

function distance(a, b) {
  const [x1, y1] = getNodeXY(a);
  const [x2, y2] = getNodeXY(b);
  return Math.hypot(x1 - x2, y1 - y2);
}

function edgeCost(a, b) {
  const [ax, ay] = getNodeXY(a);
  const [bx, by] = getNodeXY(b);
  let dist = Math.hypot(ax - bx, ay - by);

  const typeA = nodes[a]?.type;
  const typeB = nodes[b]?.type;

  if (typeA === "stairs" || typeB === "stairs") {
    dist *= 1.2;   // stairs แพงกว่า
  }
  if (typeA === "elevator" || typeB === "elevator") {
    dist *= 1.05;  // elevator เพิ่มนิดหน่อย
  }

  return dist;
}

function reconstructPath(cameFrom, current) {
  const totalPath = [current];
  while (cameFrom[current]) {
    current = cameFrom[current];
    totalPath.unshift(current);
  }
  return totalPath;
}

function astar(startNode, endNode, graph) {
  const openSet = new Set([startNode]);
  const cameFrom = {};
  const gScore = {};
  const fScore = {};

  for (const node in graph) {
    gScore[node] = Infinity;
    fScore[node] = Infinity;
  }

  gScore[startNode] = 0;
  fScore[startNode] = heuristic(startNode, endNode);

  while (openSet.size > 0) {
    let current = [...openSet].reduce((a, b) =>
      fScore[a] < fScore[b] ? a : b
    );

    if (current === endNode) return reconstructPath(cameFrom, current);

    openSet.delete(current);

    for (const neighbor of graph[current]) {
      const gScoreTentative = gScore[current] + edgeCost(current, neighbor);
      if (gScoreTentative < gScore[neighbor]) {
        cameFrom[neighbor] = current;
        gScore[neighbor] = gScoreTentative;
        fScore[neighbor] = gScore[neighbor] + heuristic(neighbor, endNode);
        openSet.add(neighbor);
      }
    }
  }
  return null;
}

// วาดเส้นทาง
function drawPath(path, nodePositions, svg) {
  svg.querySelectorAll(".path-line").forEach(e => e.remove());
  for (let i = 0; i < path.length - 1; i++) {
    const from = nodePositions[path[i]];
    const to = nodePositions[path[i + 1]];
    if (from && to) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
      line.setAttribute("stroke", "green");
      line.setAttribute("stroke-width", 2);
      line.classList.add("path-line");
      svg.appendChild(line);
    }
  }
}

// Interactive Pathfinding
let selectedNodes = [];

async function setupInteractivePathfinding() {
  const svg = document.querySelector("svg");

  for (const [key, pos] of Object.entries(nodePositions)) {
    if (key.startsWith("walk_")) continue; // ไม่วาด walk node

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", 5);
    circle.setAttribute("fill", getNodeColor(key));
    circle.style.cursor = "pointer";

    circle.addEventListener("click", () => {
      selectedNodes.push(key);
      if (selectedNodes.length === 2) {
        const path = astar(selectedNodes[0], selectedNodes[1], graph);
        drawPath(path, nodePositions, svg);
        console.log("Path:", path);
        selectedNodes = [];
      }
    });

    svg.appendChild(circle);
  }
}

// Dropdown
function populateDropdowns(graph) {
  const startSelect = document.getElementById("startSelect");
  const endSelect = document.getElementById("endSelect");

  for (const nodeId of Object.keys(graph)) {
    const node = nodes[nodeId];
    let label = nodeId;
    if (node) {
      if (node.type === "room") label = `Room ${node.name}`;
      else if (node.type === "door") label = `Door ${node.name}`;
      else if (node.type === "stairs") label = `Stairs ${node.name}`;
      else if (node.type === "elevator") label = `Elevator ${node.name}`;
    }
    startSelect.appendChild(new Option(label, nodeId));
    endSelect.appendChild(new Option(label, nodeId));
  }
}

function findPathFromDropdown() {
  const startId = document.getElementById("startSelect").value;
  const endId = document.getElementById("endSelect").value;
  if (startId && endId) {
    const path = astar(startId, endId, graph);
    if (path && path.length > 0) {
      drawPath(path, nodePositions, document.querySelector("svg"));
      console.log("Path:", path);
    } else {
      alert("❌ ไม่พบเส้นทาง");
    }
  }
}

// โหลดตอนเริ่ม
window.onload = async () => {
  await loadFloor(1);
  setupInteractivePathfinding();
};
