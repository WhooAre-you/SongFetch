const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureYtDlp, tempDir, formatDuration, formatSize } = require('../utils/ytDlp');

const router = express.Router();

// Helper: Secure in-process Snapsave script deobfuscator
function deobfuscateSnapsave(packedScript) {
  try {
    const match = packedScript.match(/\}\s*\(\s*["']([^"']+)["']\s*,\s*(\d+)\s*,\s*["']([^"']+)["']\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!match) return null;
    
    const [_, h, uStr, n, tStr, eStr, rStr] = match;
    const u = parseInt(uStr);
    const t = parseInt(tStr);
    const e = parseInt(eStr);
    const r = parseInt(rStr);
    
    const _0xc1e = ["", "split", "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/", "slice", "indexOf", "", "", ".", "pow", "reduce", "reverse", "0"];
    
    function _0xe4c(d, eVal, fVal) {
      var g = _0xc1e[2][_0xc1e[1]](_0xc1e[0]);
      var hVal = g[_0xc1e[3]](0, eVal);
      var iVal = g[_0xc1e[3]](0, fVal);
      var jVal = d[_0xc1e[1]](_0xc1e[0])[_0xc1e[10]]()[_0xc1e[9]](function(a, b, c) {
        if (hVal[_0xc1e[4]](b) !== -1) return a += hVal[_0xc1e[4]](b) * (Math[_0xc1e[8]](eVal, c));
      }, 0);
      var kVal = _0xc1e[0];
      while (jVal > 0) {
        kVal = iVal[jVal % fVal] + kVal;
        jVal = (jVal - (jVal % fVal)) / fVal;
      }
      return kVal || _0xc1e[11];
    }
    
    let decoded = "";
    for (let i = 0, len = h.length; i < len; i++) {
      let s = "";
      while (h[i] !== n[e]) {
        s += h[i];
        i++;
      }
      for (let j = 0; j < n.length; j++) {
        s = s.replace(new RegExp(n[j], "g"), j);
      }
      decoded += String.fromCharCode(_0xe4c(s, e, 10) - t);
    }
    return decodeURIComponent(escape(decoded));
  } catch (err) {
    console.error('deobfuscateSnapsave error:', err.message);
    return null;
  }
}

// Route: Fetch Media Info (metadata + available resolutions or photos)
router.post('/api/mediafetch/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let platform = 'unknown';
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    platform = 'youtube';
  } else if (urlLower.includes('instagram.com')) {
    platform = 'instagram';
  } else if (urlLower.includes('tiktok.com')) {
    platform = 'tiktok';
  } else if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) {
    platform = 'facebook';
  }

  try {
    // If it is Facebook, try the Snapsave scraper first (as it gets HD/SD direct links)
    if (platform === 'facebook') {
      try {
        console.log('Attempting Snapsave extraction for Facebook video:', url);
        const snapsaveRes = await axios.post('https://snapsave.app/action.php', qs.stringify({ url }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://snapsave.app/',
            'Origin': 'https://snapsave.app'
          },
          timeout: 10000
        });

        const decodedHtml = deobfuscateSnapsave(snapsaveRes.data);
        if (decodedHtml) {
          const $fb = cheerio.load(decodedHtml);
          const formats = [];
          
          $fb('a').each((i, el) => {
            const href = $fb(el).attr('href');
            if (href && (href.startsWith('http') || href.includes('video'))) {
              const text = $fb(el).text().trim() || 'Download';
              if (href.includes('download-private') || (href.includes('facebook.com') && !href.includes('video'))) {
                return;
              }
              const cleanUrl = href.replace(/\\/g, '');
              const qualityText = text.replace(/Download/i, '').trim() || 'Best Quality';
              formats.push({
                height: qualityText,
                size: 'Direct Link',
                url: cleanUrl
              });
            }
          });

          if (formats.length > 0) {
            console.log(`Successfully extracted ${formats.length} Facebook formats from Snapsave.`);
            return res.json({
              title: `Facebook Video (${new Date().toLocaleDateString()})`,
              thumbnail: '/favicon.svg',
              duration: 'Unknown',
              uploader: 'Facebook Video',
              platform: 'facebook',
              formats: formats,
              audioSize: 'Unknown size',
              bestSize: 'Unknown size'
            });
          }
        }
      } catch (err) {
        console.error('Snapsave extraction failed:', err.message);
      }
    }

    const ytDlpBinary = await ensureYtDlp();
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-J',
      '--no-playlist',
      url
    ];

    console.log(`Fetching media metadata using yt-dlp for: ${url}`);
    
    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, async (error, stdout, stderr) => {
      let parsedData = null;
      let hasError = false;

      if (!error) {
        try {
          parsedData = JSON.parse(stdout);
        } catch (parseErr) {
          console.error('Failed to parse metadata JSON:', parseErr.message);
          hasError = true;
        }
      } else {
        console.error('yt-dlp metadata extraction failed:', error.message);
        hasError = true;
      }

      // If we got metadata or if we have to fall back
      if (hasError || !parsedData) {
        if (platform === 'tiktok' || platform === 'instagram' || platform === 'facebook') {
          console.log(`Using fallback metadata for platform: ${platform}`);
          
          // For TikTok, we can try to hit the TikWM API as a fallback
          if (platform === 'tiktok') {
            try {
              console.log('Attempting TikWM fallback for TikTok slideshow/video...');
              const tikwmRes = await axios.post('https://www.tikwm.com/api/', qs.stringify({ url }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 5000
              });
              if (tikwmRes.data && tikwmRes.data.code === 0 && tikwmRes.data.data) {
                const tkData = tikwmRes.data.data;
                const images = tkData.images || [];
                return res.json({
                  title: tkData.title || 'TikTok Slideshow',
                  thumbnail: tkData.cover || '/favicon.svg',
                  duration: 'Slideshow',
                  uploader: tkData.author.unique_id || 'TikTok Creator',
                  platform: 'tiktok',
                  formats: [],
                  images: images.map((img, idx) => ({ index: idx, url: img })),
                  audioSize: 'Unknown size',
                  bestSize: 'Unknown size'
                });
              }
            } catch (tkErr) {
              console.error('TikWM fallback failed:', tkErr.message);
            }
          }

          // Return basic generic video fallback
          return res.json({
            title: `Media from ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
            thumbnail: '/favicon.svg',
            duration: 'Unknown',
            uploader: 'Uploader',
            platform: platform,
            formats: [{ height: 'best', size: 'Unknown size' }],
            audioSize: 'Unknown size',
            bestSize: 'Unknown size'
          });
        }
        return res.status(500).json({ error: `Failed to retrieve media metadata. Details: ${error ? error.message : 'Unknown error'}` });
      }

      // Extract image entries if any (Instagram/TikTok carousels)
      const images = [];
      
      // Instagram sidecar / playlist
      if (parsedData.entries && parsedData.entries.length > 0) {
        parsedData.entries.forEach((entry, idx) => {
          if (entry) {
            let imgUrl = entry.url || entry.thumbnail;
            if (imgUrl && (imgUrl.includes('.jpg') || imgUrl.includes('.png') || imgUrl.includes('.webp') || entry.ext === 'jpg' || entry.ext === 'png')) {
              images.push({
                index: idx,
                url: imgUrl
              });
            }
          }
        });
      } else if (parsedData.formats) {
        // Check if formats array represents only images (common in some extractors)
        const allImages = parsedData.formats.every(f => f.vcodec === 'none' && f.acodec === 'none' && f.url && (f.url.includes('.jpg') || f.url.includes('.png')));
        if (allImages) {
          parsedData.formats.forEach((f, idx) => {
            images.push({ index: idx, url: f.url });
          });
        }
      }

      // Fallback to checking thumbnail as the single image if it's an image post
      if (images.length === 0 && (parsedData.ext === 'jpg' || parsedData.ext === 'png' || parsedData.ext === 'webp' || parsedData.vcodec === 'none')) {
        let imgUrl = parsedData.url || parsedData.thumbnail;
        if (imgUrl) {
          images.push({ index: 0, url: imgUrl });
        }
      }

      const uniqueHeights = new Set();
      if (parsedData.formats) {
        parsedData.formats.forEach(f => {
          if (f.height && f.vcodec !== 'none') {
            uniqueHeights.add(f.height);
          }
        });
      }
      
      const resolutions = Array.from(uniqueHeights)
        .filter(h => [144, 240, 360, 480, 720, 1080, 1440, 2160].includes(h))
        .sort((a, b) => b - a);

      let bestAudioSize = 0;
      if (parsedData.formats) {
        const audioFormats = parsedData.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        if (audioFormats.length > 0) {
          audioFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
          const bestAudio = audioFormats.find(f => f.filesize || f.filesize_approx) || audioFormats[0];
          bestAudioSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
          
          if (!bestAudioSize && bestAudio.tbr && parsedData.duration) {
            bestAudioSize = Math.round((bestAudio.tbr * 1000 / 8) * parsedData.duration);
          }
        }
      }

      const formatOptions = resolutions.map(h => {
        let videoSize = 0;
        if (parsedData.formats) {
          const videoForHeight = parsedData.formats
            .filter(f => f.height === h && f.vcodec !== 'none')
            .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
          if (videoForHeight.length > 0) {
            const chosenVideo = videoForHeight.find(f => f.filesize || f.filesize_approx) || videoForHeight[0];
            videoSize = chosenVideo.filesize || chosenVideo.filesize_approx || 0;
            
            if (!videoSize && chosenVideo.tbr && parsedData.duration) {
              videoSize = Math.round((chosenVideo.tbr * 1000 / 8) * parsedData.duration);
            }
          }
        }
        const totalSize = videoSize ? (videoSize + bestAudioSize) : 0;
        return {
          height: h,
          size: formatSize(totalSize)
        };
      });

      const bestFormat = parsedData.formats ? parsedData.formats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] : null;
      const bestSize = parsedData.filesize || parsedData.filesize_approx || (bestFormat ? (bestFormat.filesize || bestFormat.filesize_approx) : 0);

      let thumbnail = '/favicon.svg';
      if (parsedData.thumbnails && parsedData.thumbnails.length > 0) {
        thumbnail = parsedData.thumbnails[parsedData.thumbnails.length - 1].url;
      } else if (parsedData.thumbnail) {
        thumbnail = parsedData.thumbnail;
      }

      res.json({
        title: parsedData.title || 'Media File',
        thumbnail: thumbnail,
        duration: formatDuration(parsedData.duration),
        uploader: parsedData.uploader || parsedData.channel || 'Unknown',
        platform: platform,
        formats: platform === 'youtube' ? formatOptions : [{ height: 'best', size: formatSize(bestSize) }],
        audioSize: formatSize(bestAudioSize),
        bestSize: formatSize(bestSize),
        images: images.length > 0 ? images : null
      });
    });
  } catch (err) {
    console.error('Metadata API error:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred fetching metadata' });
  }
});

// Route: Download Video / Audio
router.post('/api/mediafetch/download', async (req, res) => {
  const { url, quality, title } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let platform = 'unknown';
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    platform = 'youtube';
  } else if (urlLower.includes('instagram.com')) {
    platform = 'instagram';
  } else if (urlLower.includes('tiktok.com')) {
    platform = 'tiktok';
  } else if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) {
    platform = 'facebook';
  }

  const tempId = `video_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const ext = quality === 'audio' ? 'mp3' : 'mp4';
  
  try {
    const ytDlpBinary = await ensureYtDlp();
    const ffmpegDir = path.dirname(ffmpegPath);

    console.log(`Starting media download using yt-dlp for: ${url} (Quality: ${quality})`);

    let args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '--ffmpeg-location', ffmpegDir
    ];

    if (quality === 'audio') {
      args.push(
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', path.join(tempDir, `${tempId}.%(ext)s`)
      );
    } else {
      let formatSelector = 'bestvideo+bestaudio/best';
      if (platform === 'youtube' && quality && quality !== 'best') {
        formatSelector = `bestvideo[height<=${quality}]+bestaudio/best`;
      }
      args.push(
        '-f', formatSelector,
        '--merge-output-format', 'mp4',
        '-o', path.join(tempDir, `${tempId}.%(ext)s`)
      );
    }

    args.push(url);

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp download failed:', error.message);
        console.error('yt-dlp download stderr:', stderr);
        return res.status(500).json({ error: `Download failed. Detail: ${error.message}` });
      }

      let finalFilePath = path.join(tempDir, `${tempId}.${ext}`);

      if (!fs.existsSync(finalFilePath)) {
        const files = fs.readdirSync(tempDir);
        const matchedFile = files.find(f => f.startsWith(tempId));
        if (matchedFile) {
          finalFilePath = path.join(tempDir, matchedFile);
        } else {
          return res.status(500).json({ error: 'Downloaded file was not generated.' });
        }
      }

      const safeFilename = `${title || 'video'}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
      res.setHeader('Content-Type', quality === 'audio' ? 'audio/mpeg' : 'video/mp4');

      const fileStream = fs.createReadStream(finalFilePath);
      fileStream.pipe(res);

      fileStream.on('end', () => {
        fs.unlink(finalFilePath, (err) => {
          if (err) console.error('Failed to delete temporary video file:', err.message);
          else console.log(`Temporary file cleaned up: ${finalFilePath}`);
        });
      });

      fileStream.on('error', (err) => {
        console.error('Video file stream error:', err.message);
        fs.unlink(finalFilePath, () => {});
      });
    });

  } catch (err) {
    console.error('Backend download route failed:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred during media download' });
  }
});

// Route: Proxy download for direct CDN URLs (fixes CORS and filenames)
router.get('/api/mediafetch/download-direct', async (req, res) => {
  const { url, title, ext } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const cleanTitle = (title || 'media').replace(/[\\/:*?"<>|]/g, '_');
  const fileExt = ext || 'mp4';

  try {
    console.log(`Proxy downloading direct URL: ${url}`);
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });

    const contentType = response.headers['content-type'] || (fileExt === 'mp3' ? 'audio/mpeg' : (fileExt === 'jpg' ? 'image/jpeg' : 'video/mp4'));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanTitle)}.${fileExt}"`);
    res.setHeader('Content-Type', contentType);
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (err) {
    console.error('Proxy download route failed:', err.message);
    res.status(500).json({ error: `Proxy download failed: ${err.message}` });
  }
});

module.exports = router;
