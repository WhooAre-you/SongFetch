const path = require('path');
const fs = require('fs');
const axios = require('axios');

const projectRoot = path.join(__dirname, '..');
const isVercel = Boolean(process.env.VERCEL);
const binDir = isVercel ? '/tmp' : path.join(projectRoot, 'bin');
const tempDir = isVercel ? '/tmp' : path.join(projectRoot, 'temp');

if (!fs.existsSync(tempDir)) {
  try { fs.mkdirSync(tempDir, { recursive: true }); } catch (e) {}
}

// OS-specific yt-dlp setup
const isWindows = process.platform === 'win32';
const ytDlpFileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const targetDir = isWindows ? binDir : tempDir;
const ytDlpPath = path.join(targetDir, ytDlpFileName);

// Download yt-dlp dynamically if not present
async function ensureYtDlp(force = false) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  let needsDownload = true;

  if (fs.existsSync(ytDlpPath) && !force) {
    try {
      const stats = fs.statSync(ytDlpPath);
      const isRecent = (Date.now() - stats.mtimeMs) < ONE_DAY_MS;
      const isValidSize = stats.size > 10000000; // Standalone binary is > 10MB (Linux 38MB, Windows 17MB)
      if (isRecent && isValidSize) {
        needsDownload = false;
      }
    } catch (e) {
      needsDownload = true;
    }
  }

  if (!needsDownload) {
    return ytDlpPath;
  }
  
  console.log('Downloading latest yt-dlp binary...');
  let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  if (isWindows) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (process.platform === 'darwin') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      maxRedirects: 10
    });

    const tempBinaryPath = `${ytDlpPath}.tmp`;
    const writer = fs.createWriteStream(tempBinaryPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        try {
          // Verify downloaded size before replacing
          const tempStats = fs.statSync(tempBinaryPath);
          if (tempStats.size < 1000000) {
            throw new Error(`Downloaded yt-dlp binary is suspiciously small (${tempStats.size} bytes). Aborting update.`);
          }

          if (!isWindows) {
            fs.chmodSync(tempBinaryPath, 0o755);
          }
          if (fs.existsSync(ytDlpPath)) {
            fs.unlinkSync(ytDlpPath);
          }
          fs.renameSync(tempBinaryPath, ytDlpPath);
          console.log(`yt-dlp downloaded and updated at: ${ytDlpPath}`);
          resolve(ytDlpPath);
        } catch (err) {
          console.error('Error replacing yt-dlp binary:', err.message);
          if (fs.existsSync(ytDlpPath)) resolve(ytDlpPath);
          else reject(err);
        }
      });
      writer.on('error', (err) => {
        console.error('Error writing yt-dlp file:', err);
        if (fs.existsSync(ytDlpPath)) resolve(ytDlpPath);
        else reject(err);
      });
    });
  } catch (err) {
    console.error('Failed to download yt-dlp:', err.message);
    if (fs.existsSync(ytDlpPath)) return ytDlpPath;
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
    '--js-runtimes', 'node',
    '--extractor-args', 'youtube:player_client=ios,mweb,android,tv,web'
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

const { execFile } = require('child_process');

async function execYtDlp(args, options = {}) {
  let binary = await ensureYtDlp();
  const maxBuffer = options.maxBuffer || (1024 * 1024 * 50);
  
  return new Promise((resolve, reject) => {
    execFile(binary, args, { ...options, maxBuffer }, async (error, stdout, stderr) => {
      if (error) {
        const errMsg = (stderr || '') + (error.message || '');
        const needsUpdate = errMsg.toLowerCase().includes('update') || 
                            errMsg.toLowerCase().includes('latest version') || 
                            errMsg.toLowerCase().includes('unexpected response') ||
                            errMsg.toLowerCase().includes('signature') ||
                            errMsg.toLowerCase().includes('confirm you are on the latest version');
        if (needsUpdate) {
          console.log('Detected yt-dlp error/outdated warning. Forcing self-update...');
          try {
            binary = await ensureYtDlp(true);
            console.log('yt-dlp updated successfully. Retrying command...');
            execFile(binary, args, { ...options, maxBuffer }, (retryErr, retryStdout, retryStderr) => {
              if (retryErr) {
                reject({ error: retryErr, stderr: retryStderr, stdout: retryStdout });
              } else {
                resolve(retryStdout);
              }
            });
            return;
          } catch (updateErr) {
            console.error('Failed to update yt-dlp on error fallback:', updateErr.message);
          }
        }
        reject({ error, stderr, stdout });
      } else {
        resolve(stdout);
      }
    });
  });
}

function cleanTempDir() {
  if (fs.existsSync(tempDir)) {
    try {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        if (file.startsWith('yt-dlp') || file.startsWith('cookies')) return;
        const filePath = path.join(tempDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
      console.log('Temporary files cleaned up successfully on startup.');
    } catch (e) {
      console.error('Failed to clean up temp files:', e.message);
    }
  }
}

module.exports = {
  ensureYtDlp,
  execYtDlp,
  getYtDlpArgs,
  ytDlpPath,
  tempDir,
  binDir,
  isWindows,
  formatDuration,
  formatSize,
  cleanTempDir
};
