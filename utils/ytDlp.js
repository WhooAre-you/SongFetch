const path = require('path');
const fs = require('fs');
const axios = require('axios');

const projectRoot = path.join(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');
const tempDir = path.join(projectRoot, 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// OS-specific yt-dlp setup
const isWindows = process.platform === 'win32';
const ytDlpFileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpPath = path.join(binDir, ytDlpFileName);

// Download yt-dlp dynamically if not present
async function ensureYtDlp() {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  if (fs.existsSync(ytDlpPath)) {
    return ytDlpPath;
  }
  
  console.log('yt-dlp not found. Downloading latest binary...');
  let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  if (isWindows) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (process.platform === 'darwin') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(ytDlpPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        if (!isWindows) {
          fs.chmodSync(ytDlpPath, 0o755);
        }
        console.log(`yt-dlp downloaded and saved to: ${ytDlpPath}`);
        resolve(ytDlpPath);
      });
      writer.on('error', (err) => {
        console.error('Error writing yt-dlp file:', err);
        reject(err);
      });
    });
  } catch (err) {
    console.error('Failed to download yt-dlp:', err.message);
    throw err;
  }
}

// Ensure cookies.txt if YOUTUBE_COOKIES env var is present
function getCookiesPath() {
  const envCookies = process.env.YOUTUBE_COOKIES;
  const cookiesPath = path.join(tempDir, 'cookies.txt');
  
  if (envCookies) {
    try {
      let content = envCookies;
      if (!envCookies.includes('Netscape') && !envCookies.includes('youtube.com')) {
        // Base64 encoded
        content = Buffer.from(envCookies, 'base64').toString('utf-8');
      }
      fs.writeFileSync(cookiesPath, content, 'utf-8');
      return cookiesPath;
    } catch (e) {
      console.warn('Failed to parse YOUTUBE_COOKIES env var:', e.message);
    }
  }

  const rootCookies = path.join(projectRoot, 'cookies.txt');
  if (fs.existsSync(rootCookies)) {
    return rootCookies;
  }
  if (fs.existsSync(cookiesPath)) {
    return cookiesPath;
  }
  return null;
}

// Get standardized robust yt-dlp arguments for bypassing bot verification
function getYtDlpArgs(customArgs = []) {
  const baseArgs = [
    '--no-cache-dir',
    '--extractor-args', 'youtube:player_client=mweb,android,ios,web_creator,tv_embedded'
  ];

  const cookiesFile = getCookiesPath();
  if (cookiesFile) {
    baseArgs.push('--cookies', cookiesFile);
  }

  return [...baseArgs, ...customArgs];
}

// Helper: Format duration from seconds to MM:SS
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${bold(mins)}:${bold(secs)}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
  
  function bold(val) {
    return val.toString().padStart(2, '0');
  }
}

// Helper: Format size in bytes to human readable string (KB, MB)
function formatSize(bytes) {
  if (!bytes) return 'Unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

module.exports = {
  ensureYtDlp,
  getYtDlpArgs,
  ytDlpPath,
  tempDir,
  binDir,
  isWindows,
  formatDuration,
  formatSize
};
