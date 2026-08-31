const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('Warning: Could not set custom DNS:', e.message);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const { ensureYtDlp, cleanTempDir } = require('./utils/ytDlp');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS, JSON and URL-encoded form parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files with no-cache revalidation headers
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, pathStr) => {
    if (pathStr.endsWith('.html') || pathStr.endsWith('.js') || pathStr.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// HTML Page Routes
app.get('/songfetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'songfetch.html'));
});

app.get('/mediafetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mediafetch.html'));
});

app.get('/moviefetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moviefetch.html'));
});

// Import and use modular API routers
app.use(require('./routes/songfetch'));
app.use(require('./routes/mediafetch'));
app.use(require('./routes/movies'));
app.use(require('./routes/series').router);

// Export Express app for Vercel serverless functions
module.exports = app;

// Start Server listener when running locally
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`=========================================`);
    console.log(` OmniFetch Server is running on port ${PORT}`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`=========================================`);
    try {
      cleanTempDir();
      await ensureYtDlp(true);
    } catch (e) {
      console.error('Warning: Failed to verify or download yt-dlp on startup. Will try again on demand.');
    }
  });
}
