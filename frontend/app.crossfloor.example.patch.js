// FILE: frontend/app.crossfloor.example.patch.js
// วิธีเรียกใช้จาก app.js เดิม (เพิ่มปุ่ม+handler ตัวอย่าง)
import { buildMultiLayer } from "./lib/graph.js";
import { planRoute } from "./lib/router.js";
import { renderRouteOnSvg, showSteps } from "./lib/messages.js";

// เรียกจากหน้า "map" หรือ "admin" ก็ได้
async function planCrossFloorRouteUI(){
  // TODO: แทนที่ 2 บรรทัดนี้ด้วยค่าจริงจาก dropdown/form ของคุณ
  const start = { floor: Number(document.getElementById("floor-select").value), id: document.getElementById("start-node").value };
  const goal  = { floor: Number(prompt("ไปชั้นอะไร?", "6")), id: prompt("ไป node อะไร? เช่น Labcom4", "Labcom4") };

  // สร้างกราฟจากข้อมูลที่มีอยู่ในแอป (ใช้ baseNodes + interEdges/adminEdges ที่คุณเก็บอยู่)
  const multi = buildMultiLayer({
    baseNodes: window.baseNodes ?? {},
    adminEdges: window.adminEdges ?? {},
    interEdges: window.interEdges ?? [] // ต้องมี type: 'elevator'|'stair_left'|'stair_mid'|'stair_right'
  }, { fallbackDense: true, interCost: { elevator: 3, stair_left:5, stair_mid:5, stair_right:5, stair:5 } });

  const result = planRoute(multi, start, goal);
  const svg = document.querySelector("svg");
  renderRouteOnSvg(svg, result.segments, multi.meta);
  showSteps(result.steps); // หรือโยนเข้า sidebar
  console.log(result);
}

// ตัวอย่างปุ่มใน HTML:
// <button id="btnXFloor" class="bg-indigo-600 text-white px-4 py-2 rounded">ข้ามชั้น</button>
// <ol id="route-steps" class="bg-white rounded shadow mt-2"></ol>
document.getElementById("btnXFloor")?.addEventListener("click", planCrossFloorRouteUI);