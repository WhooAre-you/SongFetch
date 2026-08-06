const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureYtDlp, tempDir, formatDuration, formatSize } = require('../utils/ytDlp');

const router = express.Router();

// Route: Fetch Video Info (metadata + available resolutions)
router.post('/api/videofetch/info', async (req, res) => {
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

    console.log(`Fetching video metadata using yt-dlp for: ${url}`);
    
    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp metadata extraction failed:', error.message);
        if (platform === 'tiktok' || platform === 'instagram' || platform === 'facebook') {
          console.log(`Using fallback metadata for platform: ${platform}`);
          return res.json({
            title: `Video from ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
            thumbnail: '/favicon.svg',
            duration: 'Unknown',
            uploader: 'Uploader',
            platform: platform,
            formats: [{ height: 'best', size: 'Unknown size' }],
            audioSize: 'Unknown size',
            bestSize: 'Unknown size'
          });
        }
        return res.status(500).json({ error: `Failed to retrieve video metadata. Details: ${error.message}` });
      }

      try {
        const data = JSON.parse(stdout);
        
        const uniqueHeights = new Set();
        if (data.formats) {
          data.formats.forEach(f => {
            if (f.height && f.vcodec !== 'none') {
              uniqueHeights.add(f.height);
            }
          });
        }
        
        const resolutions = Array.from(uniqueHeights)
          .filter(h => [144, 240, 360, 480, 720, 1080, 1440, 2160].includes(h))
          .sort((a, b) => b - a);

        let bestAudioSize = 0;
        if (data.formats) {
          const audioFormats = data.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
          if (audioFormats.length > 0) {
            audioFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
            const bestAudio = audioFormats.find(f => f.filesize || f.filesize_approx) || audioFormats[0];
            bestAudioSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
            
            if (!bestAudioSize && bestAudio.tbr && data.duration) {
              bestAudioSize = Math.round((bestAudio.tbr * 1000 / 8) * data.duration);
            }
          }
        }

        const formatOptions = resolutions.map(h => {
          let videoSize = 0;
          if (data.formats) {
            const videoForHeight = data.formats
              .filter(f => f.height === h && f.vcodec !== 'none')
              .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
            if (videoForHeight.length > 0) {
              const chosenVideo = videoForHeight.find(f => f.filesize || f.filesize_approx) || videoForHeight[0];
              videoSize = chosenVideo.filesize || chosenVideo.filesize_approx || 0;
              
              if (!videoSize && chosenVideo.tbr && data.duration) {
                videoSize = Math.round((chosenVideo.tbr * 1000 / 8) * data.duration);
              }
            }
          }
          const totalSize = videoSize ? (videoSize + bestAudioSize) : 0;
          return {
            height: h,
            size: formatSize(totalSize)
          };
        });

        const bestFormat = data.formats ? data.formats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] : null;
        const bestSize = data.filesize || data.filesize_approx || (bestFormat ? (bestFormat.filesize || bestFormat.filesize_approx) : 0);

        let thumbnail = '/favicon.svg';
        if (data.thumbnails && data.thumbnails.length > 0) {
          thumbnail = data.thumbnails[data.thumbnails.length - 1].url;
        } else if (data.thumbnail) {
          thumbnail = data.thumbnail;
        }

        res.json({
          title: data.title || 'Video',
          thumbnail: thumbnail,
          duration: formatDuration(data.duration),
          uploader: data.uploader || data.channel || 'Unknown',
          platform: platform,
          formats: platform === 'youtube' ? formatOptions : [{ height: 'best', size: formatSize(bestSize) }],
          audioSize: formatSize(bestAudioSize),
          bestSize: formatSize(bestSize)
        });
      } catch (parseErr) {
        console.error('Failed to parse metadata JSON:', parseErr.message);
        res.status(500).json({ error: 'Failed to process metadata returned from downloader.' });
      }
    });
  } catch (err) {
    console.error('Metadata API error:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred fetching metadata' });
  }
});

// Route: Download Video / Audio
router.post('/api/videofetch/download', async (req, res) => {
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

    console.log(`Starting video/audio download using yt-dlp for: ${url} (Quality: ${quality})`);

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
    res.status(500).json({ error: err.message || 'An error occurred during video download' });
  }
});

module.exports = router;
