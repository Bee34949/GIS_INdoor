// ===== เพิ่ม Node Editor ลงในระบบ Indoor Map =====

let editMode = false;
let editableNodes = {}; // nodes แบบ local ที่วางเองใหม่

function toggleEditorMode() {
  editMode = !editMode;
  alert(editMode ? "🛠 เข้าสู่โหมดวาง Node" : "✅ ออกจากโหมด Node Editor");
  const svg = document.querySelector("svg");
  if (!svg) return;
  svg.style.cursor = editMode ? "crosshair" : "default";
}

function initEditorListeners(svg) {
  if (!svg) return;
  svg.addEventListener("click", e => {
    if (!editMode) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursorpt = pt.matrixTransform(svg.getScreenCTM().inverse());
    openNodeForm(cursorpt.x, cursorpt.y);
  });
}

function openNodeForm(x, y) {
  const form = document.createElement("div");
  form.innerHTML = `
    <div id="node-form" class="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white shadow-lg p-6 rounded border">
      <h2 class="text-lg font-semibold mb-2">📍 เพิ่ม Node</h2>
      <label>ประเภท:</label>
      <select id="node-type" class="border p-1 w-full mb-2">
        <option value="room">Room</option>
        <option value="stairs">Stairs</option>
        <option value="elevator">Elevator</option>
        <option value="other">Other</option>
      </select>
      <label>ชื่อ/รหัส:</label>
      <input id="node-name" class="border p-1 w-full mb-2" />
      <label>หมายเหตุ (optional):</label>
      <input id="node-note" class="border p-1 w-full mb-2" />
      <div class="flex justify-end gap-2">
        <button onclick="saveNode(${x}, ${y})" class="bg-blue-600 text-white px-4 py-1 rounded">บันทึก</button>
        <button onclick="closeNodeForm()" class="bg-gray-400 text-white px-4 py-1 rounded">ยกเลิก</button>
      </div>
    </div>
  `;
  document.body.appendChild(form);
}

function closeNodeForm() {
  const form = document.getElementById("node-form");
  if (form) form.remove();
}

function saveNode(x, y) {
  const type = document.getElementById("node-type").value;
  const name = document.getElementById("node-name").value;
  const note = document.getElementById("node-note").value;
  const id = `custom_${Date.now()}`;
  editableNodes[id] = { x, y, type, name, note, floor: currentFloor };
  renderEditableNode(id, editableNodes[id]);
  closeNodeForm();
}

function renderEditableNode(id, node) {
  const svg = document.querySelector("svg");
  if (!svg) return;
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", node.x);
  circle.setAttribute("cy", node.y);
  circle.setAttribute("r", 5);
  circle.setAttribute("fill", getNodeColor(id));
  circle.setAttribute("stroke", "black");
  circle.setAttribute("stroke-width", "1");
  svg.appendChild(circle);
}

function exportEditableNodes() {
  const json = JSON.stringify(editableNodes, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nodes_floor${currentFloor}.json`;
  a.click();
}

// ปุ่ม UI ในหน้า map
function addEditorButtons() {
  const container = document.createElement("div");
  container.className = "fixed top-4 right-4 z-50 flex gap-2";
  container.innerHTML = `
    <button onclick="toggleEditorMode()" class="bg-yellow-500 text-white px-3 py-1 rounded">🔧 Node Editor</button>
    <button onclick="exportEditableNodes()" class="bg-green-600 text-white px-3 py-1 rounded">💾 Export</button>
  `;
  document.body.appendChild(container);
}

// Call once floor is loaded
function enableEditorTools() {
  const svg = document.querySelector("svg");
  initEditorListeners(svg);
  addEditorButtons();
}
