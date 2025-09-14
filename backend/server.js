// backend/server.js
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// ✅ API routes
const pathfinderRoutes = require("./routes/pathfinder.js");
app.use("/api", pathfinderRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
