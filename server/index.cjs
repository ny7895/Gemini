const express = require('express');
const cors = require('cors');
require('dotenv').config();
const chalk = require('chalk');
const log = require('./utils/logger.cjs');
const { getLatestCandidates, getScanHistory } = require('./utils/db.cjs');
require('./services/scheduler.cjs');



const app = express();
const PORT = process.env.PORT || 5000;

const scannerRoutes = require('./routes/scanner.cjs');
const { analyzeMarket } = require('./controllers/scannerController.cjs');
const cron = require('node-cron');

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/scanner', scannerRoutes);

// Health check route
app.get('/', (req, res) => {
  res.send('Stock Analyzer API running');
});
app.get('/api/results', (req, res) => {
  const results = getLatestCandidates();
  res.json(results);
});

app.get('/api/history', (req, res) => {
  const history = getScanHistory();
  res.json(history);
});


// Startup log
log.success(`🚀 Server running on port ${PORT}`);
app.listen(PORT);
