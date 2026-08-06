const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureYtDlp, tempDir, formatDuration, formatSize } = require('../utils/ytDlp');

const router = express.Router();

// Helper: Download a file to a buffer
async function downloadToBuffer(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });
    return response.data;
  } catch (err) {
    console.error(`Failed to download image from ${url}:`, err.message);
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
      // Parse images if available, or try falling back
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
              const qs = require('qs');
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

// Route: Download Selected Photos (ZIP or Single)
router.post('/api/mediafetch/download-photos', async (req, res) => {
  const { urls, title } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'At least one photo URL is required' });
  }

  const cleanTitle = (title || 'media_photos').replace(/[\\/:*?"<>|]/g, '_');

  try {
    if (urls.length === 1) {
      // Download single image and stream directly
      const url = urls[0];
      console.log(`Downloading single photo: ${url}`);
      
      const response = await axios.get(url, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 15000
      });

      // Try to determine content type or default to image/jpeg
      const contentType = response.headers['content-type'] || 'image/jpeg';
      let extension = 'jpg';
      if (contentType.includes('png')) extension = 'png';
      else if (contentType.includes('webp')) extension = 'webp';

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanTitle)}.${extension}"`);
      res.setHeader('Content-Type', contentType);
      response.data.pipe(res);
    } else {
      // Download multiple images concurrently and package as ZIP
      console.log(`Downloading ${urls.length} photos and packaging as ZIP...`);
      
      const zip = new AdmZip();
      const downloadPromises = urls.map(async (url, index) => {
        const buffer = await downloadToBuffer(url);
        if (buffer) {
          // Attempt to extract extension from URL or content headers
          let ext = 'jpg';
          if (url.includes('.png')) ext = 'png';
          else if (url.includes('.webp')) ext = 'webp';
          
          zip.addFile(`photo_${index + 1}.${ext}`, buffer);
        }
      });

      await Promise.all(downloadPromises);

      const zipBuffer = zip.toBuffer();
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanTitle)}_photos.zip"`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    }
  } catch (err) {
    console.error('Photo download API error:', err.message);
    res.status(500).json({ error: `Photo download failed: ${err.message}` });
  }
});

module.exports = router;
