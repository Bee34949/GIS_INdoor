// backend/server.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const floorRoutes = require('./routes/floor');
const pathfinderRoutes = require('./routes/pathfinder');

app.use('/api/floor', floorRoutes);
app.use('/api/path', pathfinderRoutes);

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
