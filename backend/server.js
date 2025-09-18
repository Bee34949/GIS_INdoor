const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// optional routes (ไม่บังคับมีไฟล์)
try { app.use("/admin", require("./routes/admin.js")); } catch (_) {}
try { app.use("/api", require("./routes/pathfinder.js")); } catch (_) {}

// เสิร์ฟ static จาก ../frontend (โฟลเดอร์จริงของคุณ)
app.use(express.static(path.join(__dirname, "../frontend")));

app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));