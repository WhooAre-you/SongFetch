const express = require('express');
const cors = require('cors');
const path = require('path');
const { ensureYtDlp } = require('./utils/ytDlp');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS, JSON and URL-encoded form parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// HTML Page Routes
app.get('/songfetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'songfetch.html'));
});

app.get('/videofetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'videofetch.html'));
});

app.get('/moviefetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moviefetch.html'));
});

// Import and use modular API routers
app.use(require('./routes/songfetch'));
app.use(require('./routes/videofetch'));
app.use(require('./routes/movies'));
app.use(require('./routes/series').router);

// Start Server & verify binaries on startup
app.listen(PORT, async () => {
  console.log(`=========================================`);
  console.log(` MediaFetch Server is running on port ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`=========================================`);
  try {
    await ensureYtDlp();
  } catch (e) {
    console.error('Warning: Failed to verify or download yt-dlp on startup. Will try again on demand.');
  }
});
