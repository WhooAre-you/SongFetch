const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');
const childProcess = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureYtDlp, tempDir, formatDuration, formatSize } = require('../utils/ytDlp');

function execFile(binary, args, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === 'function') {
    cb = options;
    opts = {};
  }

  childProcess.execFile(binary, args, opts, async (error, stdout, stderr) => {
    if (error) {
      const errMsg = (stderr || '') + (error.message || '');
      const isYtDlp = binary.includes('yt-dlp');
      const needsUpdate = isYtDlp && (
        errMsg.toLowerCase().includes('update') || 
        errMsg.toLowerCase().includes('latest version') || 
        errMsg.toLowerCase().includes('unexpected response') ||
        errMsg.toLowerCase().includes('signature') ||
        errMsg.toLowerCase().includes('unsupported client') ||
        errMsg.toLowerCase().includes('sign in to confirm') ||
        errMsg.toLowerCase().includes('python3') ||
        errMsg.toLowerCase().includes('confirm you are on the latest version')
      );

      if (needsUpdate) {
        console.log('Detected yt-dlp outdated warning or webpage parsing issue. Forcing dynamic update...');
        try {
          const newBinary = await ensureYtDlp(true);
          console.log('yt-dlp successfully updated. Retrying command...');
          childProcess.execFile(newBinary, args, opts, cb);
          return;
        } catch (updateErr) {
          console.error('Failed to self-update yt-dlp on retry fallback:', updateErr.message);
        }
      }
    }
    if (cb) cb(error, stdout, stderr);
  });
}

const router = Math.random() ? express.Router() : express.Router();

// Helper: Fetch remote content-length using HEAD or GET Range request (fast metadata check)
async function getRemoteFileSize(url) {
  if (!url) return 0;
  try {
    const response = await axios.head(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': url.includes('instagram') ? 'https://www.instagram.com/' : (url.includes('facebook') ? 'https://www.facebook.com/' : '')
      },
      timeout: 4000
    });
    const len = response.headers['content-length'];
    if (len) return parseInt(len, 10);
  } catch (e) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': url.includes('instagram') ? 'https://www.instagram.com/' : (url.includes('facebook') ? 'https://www.facebook.com/' : ''),
          'Range': 'bytes=0-1'
        },
        timeout: 4000
      });
      const contentRange = response.headers['content-range'];
      if (contentRange) {
        const parts = contentRange.split('/');
        if (parts[1]) return parseInt(parts[1], 10);
      }
    } catch (err) {
      // Ignore
    }
  }
  return 0;
}

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

// Helper: Extract HTML string from packed JS script template (e.g. snapsave innerHTML)
function extractHtmlFromJs(str) {
  if (!str) return '';
  const match = str.match(/innerHTML\s*=\s*"(.+?)"\s*;/);
  if (match) {
    return match[1]
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\\//g, '/')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }
  return str;
}

// Helper: Resolve shortened redirects (e.g. vt.tiktok.com, vm.tiktok.com, fb.watch, share links) natively in < 350ms
async function resolveRedirectUrl(targetUrl) {
  if (!targetUrl || (!targetUrl.includes('vt.tiktok.com') && !targetUrl.includes('vm.tiktok.com') && !targetUrl.includes('fb.watch') && !targetUrl.includes('/share/'))) {
    return targetUrl;
  }

  return new Promise((resolve) => {
    try {
      const client = targetUrl.startsWith('https') ? https : http;
      const req = client.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) {
            const parsed = new URL(targetUrl);
            loc = `${parsed.protocol}//${parsed.host}${loc}`;
          }
          console.log(`Resolved short redirect "${targetUrl}" -> "${loc}"`);
          return resolve(loc);
        }
        resolve(targetUrl);
      });
      req.on('error', () => resolve(targetUrl));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(targetUrl);
      });
    } catch (e) {
      resolve(targetUrl);
    }
  });
}

// Route: Fetch Media Info (metadata + available resolutions or photos)
router.post('/api/mediafetch/info', async (req, res) => {
  let { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Auto-resolve shortened redirects
  url = await resolveRedirectUrl(url);

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
        console.log('Attempting Snapsave extraction for Facebook media:', url);
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
          const cleanHtml = extractHtmlFromJs(decodedHtml);
          const $fb = cheerio.load(cleanHtml);
          const formats = [];
          const images = [];
          
          $fb('a').each((i, el) => {
            const href = $fb(el).attr('href');
            if (href && href.startsWith('http')) {
              const text = $fb(el).text().trim() || 'Download';
              if (href.includes('download-private') || (href.includes('facebook.com') && !href.includes('video'))) {
                return;
              }
              const cleanUrl = href.replace(/\\/g, '');
              if (text.toLowerCase().includes('photo') || cleanUrl.includes('.jpg') || cleanUrl.includes('.png') || cleanUrl.includes('.webp')) {
                if (!images.includes(cleanUrl)) {
                  images.push(cleanUrl);
                }
              } else {
                const qualityText = text.replace(/Download/i, '').trim() || 'Best Quality';
                formats.push({
                  height: qualityText,
                  size: 'Direct Link',
                  url: cleanUrl
                });
              }
            }
          });

          if (images.length > 0) {
            console.log(`Successfully extracted ${images.length} Facebook slideshow images from Snapsave.`);
            const firstImgSize = await getRemoteFileSize(images[0]);
            return res.json({
              title: `Facebook Post (${new Date().toLocaleDateString()})`,
              thumbnail: images[0],
              duration: 'Slideshow',
              uploader: 'Facebook User',
              platform: 'facebook',
              formats: [],
              images: images.map((img, idx) => ({ index: idx, url: img })),
              audioSize: 'Unknown size',
              bestSize: firstImgSize ? `${formatSize(firstImgSize)} per photo` : 'Unknown size'
            });
          }

          if (formats.length > 0) {
            console.log(`Successfully extracted ${formats.length} Facebook formats from Snapsave.`);
            
            const resolvedFormats = await Promise.all(formats.map(async f => {
              const sizeBytes = await getRemoteFileSize(f.url);
              return {
                height: f.height,
                size: sizeBytes ? formatSize(sizeBytes) : 'Unknown size',
                url: f.url
              };
            }));

            const bestSizeStr = resolvedFormats[0] ? resolvedFormats[0].size : 'Unknown size';

            return res.json({
              title: `Facebook Video (${new Date().toLocaleDateString()})`,
              thumbnail: '/favicon.svg',
              duration: 'Unknown',
              uploader: 'Facebook Video',
              platform: 'facebook',
              formats: resolvedFormats,
              audioSize: 'Unknown size',
              bestSize: bestSizeStr
            });
          }
        }
      } catch (err) {
        console.error('Snapsave extraction failed:', err.message);
      }

      // If snapsave failed, try the Facebook Embed Scraper
      try {
        console.log('Attempting Facebook Embed scraper fallback for slideshow:', url);
        
        // 1. Resolve redirect URL
        let resolvedUrl = url;
        try {
          const redirectRes = await axios.get(url, { maxRedirects: 5, timeout: 6000 });
          resolvedUrl = redirectRes.request.res.responseUrl || url;
        } catch (redirErr) {
          console.warn('Redirect resolution failed, using original url:', redirErr.message);
        }

        // 2. Extract canonical/og URLs if possible (fallback target)
        let target = resolvedUrl;
        
        // Clean slugs in URL (e.g. posts/some-text/12345 -> posts/12345)
        const slugRegex = /\/posts\/[^/]+\/(\d+)/i;
        target = target.replace(slugRegex, '/posts/$1');

        // Check if it's a Group post URL with group/permalink pattern
        const groupRegex = /\/groups\/([^/]+)\/(?:permalink|posts)\/([^/?#\s]+)/i;
        const groupMatch = target.match(groupRegex);
        if (groupMatch) {
          const groupId = groupMatch[1];
          const postId = groupMatch[2];
          target = `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${groupId}`;
        }

        // 3. Request Facebook Embed Plugin
        const embedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(target)}&show_text=true`;
        console.log('Requesting embed URL:', embedUrl);
        
        const embedRes = await axios.get(embedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 8000
        });
        const embedHtml = embedRes.data;

        // 4. Match all contentUrl values (high resolution images)
        const contentUrlRegex = /"contentUrl"\s*:\s*"([^"]+)"/g;
        let imgMatch;
        const images = [];
        while ((imgMatch = contentUrlRegex.exec(embedHtml)) !== null) {
          const cleanUrl = imgMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
          if (!images.includes(cleanUrl)) {
            images.push(cleanUrl);
          }
        }

        // Fallback to normal img tags in embed if no contentUrls matched
        if (images.length === 0) {
          const $embed = cheerio.load(embedHtml);
          $embed('img').each((i, el) => {
            const src = $embed(el).attr('src');
            if (src && (src.includes('fbcdn') || src.includes('scontent'))) {
              const cleanUrl = src.replace(/&amp;/g, '&').replace(/\\/g, '');
              if (!cleanUrl.includes('/t39.30808-1/') && !cleanUrl.includes('rsrc.php') && !images.includes(cleanUrl)) {
                images.push(cleanUrl);
              }
            }
          });
        }

        if (images.length > 0) {
          console.log(`Successfully extracted ${images.length} Facebook slideshow images from Embed Scraper.`);
          const firstImgSize = await getRemoteFileSize(images[0]);
          return res.json({
            title: `Facebook Post (${new Date().toLocaleDateString()})`,
            thumbnail: images[0],
            duration: 'Slideshow',
            uploader: 'Facebook User',
            platform: 'facebook',
            formats: [],
            images: images.map((img, idx) => ({ index: idx, url: img })),
            audioSize: 'Unknown size',
            bestSize: firstImgSize ? `${formatSize(firstImgSize)} per photo` : 'Unknown size'
          });
        }
      } catch (embedScrapeErr) {
        console.error('Facebook Embed Scraper failed:', embedScrapeErr.message);
      }
    }

    // If it is TikTok, try the dedicated TikWM extractor first (instant, bypasses datacenter blocks, HD watermark-free)
    if (platform === 'tiktok') {
      try {
        console.log('Fetching TikTok media via TikWM:', url);
        const tikwmRes = await axios.post('https://www.tikwm.com/api/', qs.stringify({ url }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          timeout: 15000
        });
        if (tikwmRes.data && tikwmRes.data.code === 0 && tikwmRes.data.data) {
          const tkData = tikwmRes.data.data;
          const images = tkData.images || [];
          
          if (images.length > 0) {
            const firstImgSize = await getRemoteFileSize(images[0]);
            return res.json({
              title: tkData.title || 'TikTok Slideshow',
              thumbnail: tkData.cover || '/favicon.svg',
              duration: 'Slideshow',
              uploader: tkData.author ? tkData.author.unique_id : 'TikTok Creator',
              platform: 'tiktok',
              formats: [],
              images: images.map((img, idx) => ({ index: idx, url: img, type: 'image', thumbnail: img })),
              audioSize: 'Unknown size',
              bestSize: firstImgSize ? `${formatSize(firstImgSize)} per photo` : 'Unknown size'
            });
          } else {
            const videoUrl = tkData.play;
            const sizeBytes = tkData.size || await getRemoteFileSize(videoUrl);
            return res.json({
              title: tkData.title || 'TikTok Video',
              thumbnail: tkData.cover || '/favicon.svg',
              duration: formatDuration(tkData.duration),
              uploader: tkData.author ? (tkData.author.nickname || tkData.author.unique_id) : 'TikTok Creator',
              platform: 'tiktok',
              formats: [{ height: 'best', size: formatSize(sizeBytes), url: videoUrl }],
              audioSize: 'Unknown size',
              bestSize: formatSize(sizeBytes)
            });
          }
        }
      } catch (tkErr) {
        console.warn('TikWM primary extraction error, will fallback to yt-dlp:', tkErr.message);
      }
    }

    // If it is Instagram, try Snapinsta / Snapsave extractors first
    if (platform === 'instagram') {
      try {
        console.log('Fetching Instagram media via Snapinsta:', url);
        const snapRes = await axios.post('https://snapinsta.app/action.php', qs.stringify({ url, action: 'post' }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://snapinsta.app/',
            'Origin': 'https://snapinsta.app'
          },
          timeout: 8000
        });

        const decoded = deobfuscateSnapsave(snapRes.data);
        if (decoded) {
          const cleanHtml = extractHtmlFromJs(decoded);
          const $ = cheerio.load(cleanHtml);
          const mediaItems = [];

          $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('http')) {
              const text = $(el).text().toLowerCase();
              const cleanUrl = href.replace(/\\/g, '');
              if (cleanUrl.includes('download-private') || (cleanUrl.includes('facebook.com') && !cleanUrl.includes('video'))) {
                return;
              }
              
              const isVideo = cleanUrl.includes('.mp4') || text.includes('video');
              const isPhoto = cleanUrl.includes('rapidcdn.app') || cleanUrl.includes('scontent') || cleanUrl.includes('cdninstagram') || cleanUrl.includes('.jpg') || cleanUrl.includes('.png') || cleanUrl.includes('.webp');
              
              if (isVideo || isPhoto) {
                let thumbUrl = '';
                const parent = $(el).closest('.download-items');
                if (parent.length > 0) {
                  thumbUrl = parent.find('img').attr('src') || '';
                }
                if (!thumbUrl) {
                  thumbUrl = $(el).parent().find('img').attr('src') || '';
                }
                
                const exists = mediaItems.some(item => item.url === cleanUrl);
                if (!exists) {
                  mediaItems.push({
                    url: cleanUrl,
                    type: isVideo ? 'video' : 'image',
                    thumbnail: thumbUrl ? thumbUrl.replace(/\\/g, '') : ''
                  });
                }
              }
            }
          });

          if (mediaItems.length === 1 && mediaItems[0].type === 'video') {
            const sizeBytes = await getRemoteFileSize(mediaItems[0].url);
            return res.json({
              title: `Instagram Video (${new Date().toLocaleDateString()})`,
              thumbnail: mediaItems[0].thumbnail || '/favicon.svg',
              duration: 'Unknown',
              uploader: 'Instagram Creator',
              platform: 'instagram',
              formats: [{ height: 'best', size: sizeBytes ? formatSize(sizeBytes) : 'Unknown size', url: mediaItems[0].url }],
              audioSize: 'Unknown size',
              bestSize: sizeBytes ? formatSize(sizeBytes) : 'Unknown size'
            });
          } else if (mediaItems.length > 0) {
            const firstImgSize = await getRemoteFileSize(mediaItems[0].url);
            return res.json({
              title: `Instagram Post (${new Date().toLocaleDateString()})`,
              thumbnail: mediaItems[0].thumbnail || mediaItems[0].url,
              duration: 'Slideshow',
              uploader: 'Instagram Creator',
              platform: 'instagram',
              formats: [],
              images: mediaItems.map((item, idx) => ({
                index: idx,
                url: item.url,
                type: item.type,
                thumbnail: item.thumbnail || item.url
              })),
              audioSize: 'Unknown size',
              bestSize: firstImgSize ? `${formatSize(firstImgSize)} per item` : 'Unknown size'
            });
          }
        }
      } catch (err) {
        console.warn('Snapinsta primary Instagram extraction error, will fallback:', err.message);
      }
    }

    const ytDlpBinary = await ensureYtDlp();
    const args = [
      '--extractor-args', 'youtube:player_client=tv_embedded,android_creator,android_music',
      '--js-runtimes', 'node',
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

      // Fallback handlers if yt-dlp fails (e.g., photo posts, error 400 or blockings)
      if (hasError || !parsedData) {
        if (platform === 'tiktok' || platform === 'instagram' || platform === 'facebook') {
          console.log(`Using fallback metadata for platform: ${platform}`);
          
          if (platform === 'tiktok') {
            try {
              console.log('Attempting TikWM fallback for TikTok video/slideshow...');
              const tikwmRes = await axios.post('https://www.tikwm.com/api/', qs.stringify({ url }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 5000
              });
              if (tikwmRes.data && tikwmRes.data.code === 0 && tikwmRes.data.data) {
                const tkData = tikwmRes.data.data;
                const images = tkData.images || [];
                
                if (images.length > 0) {
                  const firstImgSize = await getRemoteFileSize(images[0]);
                  return res.json({
                    title: tkData.title || 'TikTok Slideshow',
                    thumbnail: tkData.cover || '/favicon.svg',
                    duration: 'Slideshow',
                    uploader: tkData.author.unique_id || 'TikTok Creator',
                    platform: 'tiktok',
                    formats: [],
                    images: images.map((img, idx) => ({ index: idx, url: img })),
                    audioSize: 'Unknown size',
                    bestSize: firstImgSize ? `${formatSize(firstImgSize)} per photo` : 'Unknown size'
                  });
                } else {
                  const videoUrl = tkData.play;
                  const sizeBytes = tkData.size || await getRemoteFileSize(videoUrl);
                  return res.json({
                    title: tkData.title || 'TikTok Video',
                    thumbnail: tkData.cover || '/favicon.svg',
                    duration: formatDuration(tkData.duration),
                    uploader: tkData.author.unique_id || 'TikTok Creator',
                    platform: 'tiktok',
                    formats: [{ height: 'best', size: formatSize(sizeBytes), url: videoUrl }],
                    audioSize: 'Unknown size',
                    bestSize: formatSize(sizeBytes)
                  });
                }
              }
            } catch (tkErr) {
              console.error('TikWM fallback failed:', tkErr.message);
            }
          }

          if (platform === 'instagram') {
            // 1. Try Snapinsta
            try {
              console.log('Attempting Snapinsta fallback for Instagram slideshow:', url);
              const snapRes = await axios.post('https://snapinsta.app/action.php', qs.stringify({ url, action: 'post' }), {
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  'Referer': 'https://snapinsta.app/',
                  'Origin': 'https://snapinsta.app'
                },
                timeout: 10000
              });

              const decoded = deobfuscateSnapsave(snapRes.data);
              if (decoded) {
                const cleanHtml = extractHtmlFromJs(decoded);
                const $ = cheerio.load(cleanHtml);
                const mediaItems = [];

                $('a').each((i, el) => {
                  const href = $(el).attr('href');
                  if (href && href.startsWith('http')) {
                    const text = $(el).text().toLowerCase();
                    const cleanUrl = href.replace(/\\/g, '');
                    if (cleanUrl.includes('download-private') || (cleanUrl.includes('facebook.com') && !cleanUrl.includes('video'))) {
                      return;
                    }
                    
                    const isVideo = cleanUrl.includes('.mp4') || text.includes('video');
                    const isPhoto = cleanUrl.includes('rapidcdn.app') || cleanUrl.includes('scontent') || cleanUrl.includes('cdninstagram') || cleanUrl.includes('.jpg') || cleanUrl.includes('.png') || cleanUrl.includes('.webp');
                    
                    if (isVideo || isPhoto) {
                      let thumbUrl = '';
                      const parent = $(el).closest('.download-items');
                      if (parent.length > 0) {
                        thumbUrl = parent.find('img').attr('src') || '';
                      }
                      if (!thumbUrl) {
                        thumbUrl = $(el).parent().find('img').attr('src') || '';
                      }
                      
                      // Check if already exists to prevent duplicate entries of the same item
                      const exists = mediaItems.some(item => item.url === cleanUrl);
                      if (!exists) {
                        mediaItems.push({
                          url: cleanUrl,
                          type: isVideo ? 'video' : 'image',
                          thumbnail: thumbUrl ? thumbUrl.replace(/\\/g, '') : ''
                        });
                      }
                    }
                  }
                });

                if (mediaItems.length === 1 && mediaItems[0].type === 'video') {
                  console.log('Snapinsta extracted a single video file.');
                  const sizeBytes = await getRemoteFileSize(mediaItems[0].url);
                  return res.json({
                    title: `Instagram Video (${new Date().toLocaleDateString()})`,
                    thumbnail: mediaItems[0].thumbnail || '/favicon.svg',
                    duration: 'Unknown',
                    uploader: 'Instagram Creator',
                    platform: 'instagram',
                    formats: [{ height: 'best', size: sizeBytes ? formatSize(sizeBytes) : 'Unknown size', url: mediaItems[0].url }],
                    audioSize: 'Unknown size',
                    bestSize: sizeBytes ? formatSize(sizeBytes) : 'Unknown size'
                  });
                } else if (mediaItems.length > 0) {
                  console.log(`Successfully extracted ${mediaItems.length} Instagram items from Snapinsta.`);
                  const firstImgSize = await getRemoteFileSize(mediaItems[0].url);
                  return res.json({
                    title: `Instagram Post (${new Date().toLocaleDateString()})`,
                    thumbnail: mediaItems[0].thumbnail || mediaItems[0].url,
                    duration: 'Slideshow',
                    uploader: 'Instagram Creator',
                    platform: 'instagram',
                    formats: [],
                    images: mediaItems.map((item, idx) => ({
                      index: idx,
                      url: item.url,
                      type: item.type,
                      thumbnail: item.thumbnail || item.url
                    })),
                    audioSize: 'Unknown size',
                    bestSize: firstImgSize ? `${formatSize(firstImgSize)} per item` : 'Unknown size'
                  });
                }
              }
            } catch (err) {
              console.warn('Snapinsta Instagram fallback failed:', err.message);
            }

            // 2. Try Snapsave
            try {
              console.log('Attempting Snapsave fallback for Instagram slideshow:', url);
              const snapsaveRes = await axios.post('https://snapsave.app/action.php', qs.stringify({ url }), {
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  'Referer': 'https://snapsave.app/',
                  'Origin': 'https://snapsave.app'
                },
                timeout: 10000
              });

              const decoded = deobfuscateSnapsave(snapsaveRes.data);
              if (decoded) {
                const cleanHtml = extractHtmlFromJs(decoded);
                const $ = cheerio.load(cleanHtml);
                const mediaItems = [];

                $('a').each((i, el) => {
                  const href = $(el).attr('href');
                  if (href && href.startsWith('http')) {
                    const text = $(el).text().toLowerCase();
                    const cleanUrl = href.replace(/\\/g, '');
                    if (cleanUrl.includes('download-private') || (cleanUrl.includes('facebook.com') && !cleanUrl.includes('video'))) {
                      return;
                    }
                    
                    const isVideo = cleanUrl.includes('.mp4') || text.includes('video');
                    const isPhoto = cleanUrl.includes('rapidcdn.app') || cleanUrl.includes('scontent') || cleanUrl.includes('cdninstagram') || cleanUrl.includes('.jpg') || cleanUrl.includes('.png') || cleanUrl.includes('.webp');
                    
                    if (isVideo || isPhoto) {
                      let thumbUrl = '';
                      const parent = $(el).closest('.download-items');
                      if (parent.length > 0) {
                        thumbUrl = parent.find('img').attr('src') || '';
                      }
                      if (!thumbUrl) {
                        thumbUrl = $(el).parent().find('img').attr('src') || '';
                      }
                      
                      const exists = mediaItems.some(item => item.url === cleanUrl);
                      if (!exists) {
                        mediaItems.push({
                          url: cleanUrl,
                          type: isVideo ? 'video' : 'image',
                          thumbnail: thumbUrl ? thumbUrl.replace(/\\/g, '') : ''
                        });
                      }
                    }
                  }
                });

                if (mediaItems.length === 1 && mediaItems[0].type === 'video') {
                  console.log('Snapsave extracted a single video file.');
                  const sizeBytes = await getRemoteFileSize(mediaItems[0].url);
                  return res.json({
                    title: `Instagram Video (${new Date().toLocaleDateString()})`,
                    thumbnail: mediaItems[0].thumbnail || '/favicon.svg',
                    duration: 'Unknown',
                    uploader: 'Instagram Creator',
                    platform: 'instagram',
                    formats: [{ height: 'best', size: sizeBytes ? formatSize(sizeBytes) : 'Unknown size', url: mediaItems[0].url }],
                    audioSize: 'Unknown size',
                    bestSize: sizeBytes ? formatSize(sizeBytes) : 'Unknown size'
                  });
                } else if (mediaItems.length > 0) {
                  console.log(`Successfully extracted ${mediaItems.length} Instagram items from Snapsave.`);
                  const firstImgSize = await getRemoteFileSize(mediaItems[0].url);
                  return res.json({
                    title: `Instagram Post (${new Date().toLocaleDateString()})`,
                    thumbnail: mediaItems[0].thumbnail || mediaItems[0].url,
                    duration: 'Slideshow',
                    uploader: 'Instagram Creator',
                    platform: 'instagram',
                    formats: [],
                    images: mediaItems.map((item, idx) => ({
                      index: idx,
                      url: item.url,
                      type: item.type,
                      thumbnail: item.thumbnail || item.url
                    })),
                    audioSize: 'Unknown size',
                    bestSize: firstImgSize ? `${formatSize(firstImgSize)} per item` : 'Unknown size'
                  });
                }
              }
            } catch (err) {
              console.warn('Snapsave Instagram fallback failed:', err.message);
            }
          }

          // 3. Raw HTML Scraper Fallback (for Facebook slideshows or Instagram if snapsave/snapinsta failed)
          if (platform === 'instagram' || platform === 'facebook') {
            try {
              console.log(`Attempting HTML metadata scraping fallback for ${platform}: ${url}`);
              const htmlRes = await axios.get(url, {
                headers: {
                  'Accept-Language': 'en-US,en;q=0.9'
                },
                timeout: 8000
              });
              
              const html = htmlRes.data;
              const $ = cheerio.load(html);
              const title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Media File';
              const ogImage = $('meta[property="og:image"]').attr('content');
              const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:url"]').attr('content');
              
              if (ogVideo) {
                // Video fallback
                const sizeBytes = await getRemoteFileSize(ogVideo);
                return res.json({
                  title: title,
                  thumbnail: ogImage || '/favicon.svg',
                  duration: 'Unknown',
                  uploader: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Creator`,
                  platform: platform,
                  formats: [{ height: 'best', size: sizeBytes ? formatSize(sizeBytes) : 'Unknown size', url: ogVideo }],
                  audioSize: 'Unknown size',
                  bestSize: sizeBytes ? formatSize(sizeBytes) : 'Unknown size'
                });
              } else if (ogImage) {
                // Photo/Slideshow fallback
                const images = [];
                
                // Scan display_url values in scripts (avoiding low-res ogImage if we find original ones)
                const regex = /"display_url"\s*:\s*"([^"]+)"/g;
                let match;
                while ((match = regex.exec(html)) !== null) {
                  try {
                    const cleanUrl = match[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                    if (!images.includes(cleanUrl)) {
                      images.push(cleanUrl);
                    }
                  } catch(e) {}
                }

                if (platform === 'facebook') {
                  const fbImageRegex = /"image"\s*:\s*{\s*"uri"\s*:\s*"([^"]+)"/g;
                  let fbMatch;
                  while ((fbMatch = fbImageRegex.exec(html)) !== null) {
                    try {
                      const cleanUrl = fbMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                      if (!images.includes(cleanUrl)) {
                        images.push(cleanUrl);
                      }
                    } catch(e) {}
                  }
                }

                // If no high-res display URLs matched, fallback to the ogImage thumbnail
                if (images.length === 0 && ogImage) {
                  images.push(ogImage);
                }

                const firstImgSize = await getRemoteFileSize(images[0]);

                return res.json({
                  title: title,
                  thumbnail: ogImage,
                  duration: 'Slideshow',
                  uploader: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Creator`,
                  platform: platform,
                  formats: [],
                  images: images.map((img, idx) => ({
                    index: idx,
                    url: img,
                    type: 'image',
                    thumbnail: img
                  })),
                  audioSize: 'Unknown size',
                  bestSize: firstImgSize ? `${formatSize(firstImgSize)} per photo` : 'Unknown size'
                });
              }
            } catch (scrapeErr) {
              console.error('HTML scraper fallback failed:', scrapeErr.message);
            }
          }

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
            let mediaUrl = entry.url || entry.thumbnail;
            if (mediaUrl) {
              const isVid = entry.ext === 'mp4' || (entry.vcodec && entry.vcodec !== 'none') || (mediaUrl.includes('.mp4'));
              images.push({
                index: idx,
                url: mediaUrl,
                type: isVid ? 'video' : 'image',
                thumbnail: entry.thumbnail || mediaUrl
              });
            }
          }
        });
      } else if (parsedData.formats) {
        const allImages = parsedData.formats.every(f => f.vcodec === 'none' && f.acodec === 'none' && f.url && (f.url.includes('.jpg') || f.url.includes('.png')));
        if (allImages) {
          parsedData.formats.forEach((f, idx) => {
            images.push({
              index: idx,
              url: f.url,
              type: 'image',
              thumbnail: f.url
            });
          });
        }
      }

      // Single photo post check
      if (images.length === 0 && (parsedData.ext === 'jpg' || parsedData.ext === 'png' || parsedData.ext === 'webp' || parsedData.vcodec === 'none')) {
        let imgUrl = parsedData.url || parsedData.thumbnail;
        if (imgUrl) {
          images.push({ index: 0, url: imgUrl, type: 'image', thumbnail: imgUrl });
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
      
      const allHeights = Array.from(uniqueHeights)
        .filter(h => h >= 144)
        .sort((a, b) => b - a);

      const resolutions = [];
      allHeights.forEach(h => {
        const isDuplicate = resolutions.some(r => Math.abs(r - h) < 50);
        if (!isDuplicate) {
          resolutions.push(h);
        }
      });

      let bestAudioSize = 0;
      if (parsedData.formats) {
        const audioFormats = parsedData.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        if (audioFormats.length > 0) {
          const standardAudio = audioFormats.find(f => f.ext === 'm4a' || (f.acodec && f.acodec.includes('mp4a'))) || audioFormats[0];
          bestAudioSize = standardAudio.filesize || standardAudio.filesize_approx || 0;
          
          if (!bestAudioSize && standardAudio.tbr && parsedData.duration) {
            bestAudioSize = Math.round((standardAudio.tbr * 1000 / 8) * parsedData.duration);
          } else if (!bestAudioSize && standardAudio.abr && parsedData.duration) {
            bestAudioSize = Math.round((standardAudio.abr * 1000 / 8) * parsedData.duration);
          }
        }
      }

      const formatOptions = resolutions.map(h => {
        let videoSize = 0;
        if (parsedData.formats) {
          const videoForHeight = parsedData.formats.filter(f => f.height === h && f.vcodec !== 'none');
          if (videoForHeight.length > 0) {
            // Pick standard MP4 or modern stream to avoid massive over-estimates
            const standardVideo = videoForHeight.find(f => f.ext === 'mp4' && (f.vcodec.startsWith('avc1') || f.vcodec.startsWith('av01'))) || videoForHeight[0];
            videoSize = standardVideo.filesize || standardVideo.filesize_approx || 0;
            
            if (!videoSize && standardVideo.tbr && parsedData.duration) {
              videoSize = Math.round((standardVideo.tbr * 1000 / 8) * parsedData.duration);
            } else if (!videoSize && standardVideo.vbr && parsedData.duration) {
              videoSize = Math.round((standardVideo.vbr * 1000 / 8) * parsedData.duration);
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
      let bestSizeVal = (formatOptions.length > 0 && formatOptions[0].size !== 'Unknown size') 
        ? null 
        : (parsedData.filesize || parsedData.filesize_approx || (bestFormat ? (bestFormat.filesize || bestFormat.filesize_approx) : 0));

      // Resolve size remotely if missing
      if (!bestSizeVal && bestFormat && bestFormat.url && formatOptions.length === 0) {
        bestSizeVal = await getRemoteFileSize(bestFormat.url);
      }

      // Average size for photo slideshow or best video
      let finalBestSizeStr = (formatOptions.length > 0 && formatOptions[0].size !== 'Unknown size') 
        ? formatOptions[0].size 
        : formatSize(bestSizeVal);

      if (images.length > 0) {
        const photoSize = await getRemoteFileSize(images[0].url);
        finalBestSizeStr = photoSize ? `${formatSize(photoSize)} per photo` : 'Unknown size';
      }

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
        formats: platform === 'youtube' ? formatOptions : (bestFormat && bestFormat.url ? [{ height: 'best', size: formatSize(bestSizeVal), url: bestFormat.url }] : [{ height: 'best', size: formatSize(bestSizeVal) }]),
        audioSize: formatSize(bestAudioSize),
        bestSize: finalBestSizeStr,
        images: images.length > 0 ? images : null
      });
    });
  } catch (err) {
    console.error('Metadata API error:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred fetching metadata' });
  }
});

// Route: Download Video / Audio (via yt-dlp)
router.post('/api/mediafetch/download', async (req, res) => {
  let { url, quality, title } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Auto-resolve shortened redirects
  url = await resolveRedirectUrl(url);

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
      '--extractor-args', 'youtube:player_client=tv_embedded,android_creator,android_music',
      '--js-runtimes', 'node',
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

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, async (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp download failed:', error.message);
        console.error('yt-dlp download stderr:', stderr);

        // Fallback for TikTok if yt-dlp fails
        if (platform === 'tiktok') {
          try {
            console.log('Attempting TikWM download fallback for TikTok...');
            const tikwmRes = await axios.post('https://www.tikwm.com/api/', qs.stringify({ url }), {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              timeout: 10000
            });
            if (tikwmRes.data && tikwmRes.data.code === 0 && tikwmRes.data.data) {
              const videoUrl = quality === 'audio' ? (tikwmRes.data.data.music || tikwmRes.data.data.play) : tikwmRes.data.data.play;
              if (videoUrl) {
                console.log('TikWM fallback stream acquired:', videoUrl);
                const streamRes = await axios.get(videoUrl, {
                  responseType: 'stream',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                  }
                });
                const safeFilename = `${title || 'tiktok_media'}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
                res.setHeader('Content-Type', quality === 'audio' ? 'audio/mpeg' : 'video/mp4');
                return streamRes.data.pipe(res);
              }
            }
          } catch (tkErr) {
            console.error('TikWM download fallback failed:', tkErr.message);
          }
        }

        // Fallback for Instagram if yt-dlp fails
        if (platform === 'instagram') {
          try {
            console.log('Attempting Snapinsta/Snapsave download fallback for Instagram...');
            const snapRes = await axios.post('https://snapinsta.app/action.php', qs.stringify({ url, action: 'post' }), {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://snapinsta.app/',
                'Origin': 'https://snapinsta.app'
              },
              timeout: 10000
            });
            const decoded = deobfuscateSnapsave(snapRes.data);
            if (decoded) {
              const cleanHtml = extractHtmlFromJs(decoded);
              const $ = cheerio.load(cleanHtml);
              let directUrl = null;
              $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.startsWith('http')) {
                  const cleanHref = href.replace(/\\/g, '');
                  if (cleanHref.includes('.mp4') || $(el).text().toLowerCase().includes('video')) {
                    if (!directUrl) directUrl = cleanHref;
                  }
                }
              });
              if (directUrl) {
                console.log('Snapinsta fallback stream acquired:', directUrl);
                const streamRes = await axios.get(directUrl, {
                  responseType: 'stream',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': 'https://www.instagram.com/'
                  }
                });
                const safeFilename = `${title || 'instagram_video'}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
                res.setHeader('Content-Type', quality === 'audio' ? 'audio/mpeg' : 'video/mp4');
                return streamRes.data.pipe(res);
              }
            }
          } catch (igErr) {
            console.error('Instagram download fallback failed:', igErr.message);
          }
        }

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

      res.on('close', () => {
        if (fs.existsSync(finalFilePath)) {
          fs.unlink(finalFilePath, (err) => {
            if (!err) console.log(`Aborted request clean-up: ${finalFilePath}`);
          });
        }
      });
    });

  } catch (err) {
    console.error('Backend download route failed:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred during media download' });
  }
});

// Route: POST Proxy download for direct CDN URLs (fixes CORS and filename query truncation)
router.post('/api/mediafetch/download-direct', async (req, res) => {
  const { url, title, ext } = req.body;
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Referer': url.includes('instagram') ? 'https://www.instagram.com/' : (url.includes('facebook') ? 'https://www.facebook.com/' : '')
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
