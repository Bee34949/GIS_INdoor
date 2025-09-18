// ===== SPA Navigation with Auth =====
let currentUser = null;
let isAdmin = false;
const ADMIN_EMAILS = ["admin@example.com"];

function navigate(page) {
  const app = document.getElementById("app");

  if (page === "home") {
    app.innerHTML = `
      <div class="text-center mt-20">
        <h2 class="text-2xl mb-4">Welcome to Indoor Map</h2>
        <button onclick="navigate('map')" class="px-6 py-3 bg-blue-600 text-white rounded-lg shadow">View Map</button>
        <button onclick="navigate('admin')" class="ml-4 px-6 py-3 bg-yellow-600 text-white rounded-lg shadow">Admin</button>
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
        <div class="flex gap-2 mb-4">
          <select id="start-node" class="border p-2 rounded w-1/3"></select>
          <select id="goal-node" class="border p-2 rounded w-1/3"></select>
          <button onclick="findPathUI()" class="bg-blue-600 text-white px-4 py-2 rounded">Find Path</button>
        </div>
        <div id="svg-container" class="border bg-white shadow"></div>
      </div>
    `;

    loadMapData().then(() => {
      loadFloor(1, false);
      populateNodeDropdowns();
    });

    document.getElementById("floor-select").addEventListener("change", e => {
      loadFloor(parseInt(e.target.value), false);
      populateNodeDropdowns();
    });
  }

  if (page === "admin") {
    if (!currentUser || !isAdmin) {
      alert("⛔ ต้องเป็น admin เท่านั้นจึงจะเข้าได้");
      navigate("home");
      return;
    }

    app.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">Admin Editor</h2>
          <select id="floor-select" class="border p-2 rounded">
            <option value="1">Floor 1</option>
            <option value="2">Floor 2</option>
            <option value="3">Floor 3</option>
          </select>
        </div>
        <div id="svg-container" class="border bg-white shadow"></div>
      </div>
    `;

    loadFloor(1, true);
    document.getElementById("floor-select").addEventListener("change", e => {
      loadFloor(parseInt(e.target.value), true);
    });
  }
}

// Firebase Auth Init
async function initAuth() {
  await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
  await import("https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js");

  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "indoor6mju",
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  const nav = document.querySelector("header nav");
  const authBtn = document.createElement("button");
  authBtn.className = "hover:underline";
  nav.appendChild(authBtn);

  auth.onAuthStateChanged(user => {
    currentUser = user;
    isAdmin = user && ADMIN_EMAILS.includes(user.email);
    authBtn.textContent = user ? `Logout (${user.email})` : "Login";
  });

  authBtn.onclick = () => {
    if (auth.currentUser) auth.signOut();
    else auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  };
}

// ===== ส่วนอื่นเหมือนเดิม =====
// (ปล่อยฟังก์ชัน floor, render, pathfinding ตามเดิมไว้ด้านล่าง)

window.onload = async () => {
  await initAuth();
  navigate("home");
};