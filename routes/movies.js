const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const arabicResolver = require('../arabicMediaResolver');
const { handleWeFeedSeriesInfo } = require('./series');

const router = express.Router();

// Helper: Get cached or fresh WeFeed guest session token
let cachedWeFeedToken = null;
let weFeedTokenExpiry = 0;

async function getWeFeedToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedWeFeedToken && weFeedTokenExpiry > now + 3600) {
    return cachedWeFeedToken;
  }
  
  console.log('Fetching new WeFeed guest token...');
  const res = await axios.get('https://api.seocloud.biz/wefeed-seo-bff/vip/sku-list', {
    headers: {
      'Accept': 'application/json',
      'x-request-lang': 'en',
      'X-Client-Info': JSON.stringify({ timezone: 'Africa/Cairo' }),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://videodownloader.site',
      'Referer': 'https://videodownloader.site/'
    }
  });
  
  const xUserStr = res.headers['x-user'];
  if (!xUserStr) throw new Error('x-user header missing in token response');
  const xUserData = JSON.parse(xUserStr);
  cachedWeFeedToken = xUserData.token;
  
  try {
    const payload = JSON.parse(Buffer.from(cachedWeFeedToken.split('.')[1], 'base64').toString('utf8'));
    weFeedTokenExpiry = payload.exp || (now + 86400);
  } catch (e) {
    weFeedTokenExpiry = now + 86400;
  }
  return cachedWeFeedToken;
}

// Route: MovieFetch search via WeFeed API
router.get('/api/movies/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const token = await getWeFeedToken();
    const searchRes = await axios.post('https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search', {
      keyword: q,
      page: 1,
      perPage: 30
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Source': 'downloader',
        'X-Site-Domain': 'videodownloader.site',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://videodownloader.site',
        'Referer': 'https://videodownloader.site/'
      }
    });

    const items = searchRes.data?.data?.items || [];
    const results = items.map(item => {
      const prefix = item.subjectType === 2 ? 'series' : 'movie';
      const link = `https://wefeed.site/${prefix}?id=${item.subjectId}&path=${item.detailPath}&title=${encodeURIComponent(item.title)}`;
      return {
        title: item.title,
        link,
        img: item.cover?.url || '',
        source: 'WeFeed'
      };
    });

    res.json({ results });
  } catch (err) {
    console.error('WeFeed search failed:', err.message);
    res.status(500).json({ error: `Search failed: ${err.message}` });
  }
});

// Route: Resolve IMDB ID for VidSrc integration
router.post('/api/movies/imdb', async (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const query = encodeURIComponent(title.toLowerCase());
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${query}.json`;
    
    const imdbRes = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (imdbRes.data && imdbRes.data.d && imdbRes.data.d.length > 0) {
      const match = imdbRes.data.d.find(item => item.id && item.id.startsWith('tt'));
      if (match) {
        return res.json({ imdbId: match.id });
      }
    }
    
    res.status(404).json({ error: 'IMDB ID not found for the given title.' });
  } catch (err) {
    console.error('IMDB resolution failed:', err.message);
    res.status(500).json({ error: 'IMDB resolution failed' });
  }
});

// Route: MovieFetch watch page details scraping (episodes or download options)
router.post('/api/movies/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    const id = params.get('id');
    const pathVal = params.get('path');
    const title = params.get('title') || 'Media';
    
    const isSeries = urlObj.pathname.includes('/series');
    const isDownload = urlObj.pathname.includes('/download');
    
    const token = await getWeFeedToken();
    
    // Delegate to TV Series handler if TV series root
    if (isSeries) {
      return handleWeFeedSeriesInfo(req, res, id, pathVal, title, token);
    }
    
    // If it's a Movie or an Episode Download, fetch quality options
    let se = 0;
    let ep = 0;
    
    if (isDownload) {
      se = parseInt(params.get('se') || '0', 10);
      ep = parseInt(params.get('ep') || '0', 10);
    }
    
    console.log(`Fetching WeFeed download resources for subjectId: ${id}, se: ${se}, ep: ${ep}`);
    const dlRes = await axios.get(`https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/download?subjectId=${id}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(pathVal)}`, {
      headers: {
        'Accept': 'application/json',
        'x-request-lang': 'en',
        'X-Client-Info': JSON.stringify({ timezone: 'Africa/Cairo' }),
        'X-Source': 'downloader',
        'X-Site-Domain': 'videodownloader.site',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://videodownloader.site',
        'Referer': 'https://videodownloader.site/'
      }
    });
    
    const dlData = dlRes.data?.data || {};
    const wefeedDownloads = dlData.downloads || [];
    const wefeedCaptions = dlData.captions || [];
    
    const subtitles = wefeedCaptions
      .filter(cap => cap.lan === 'ar' || cap.lan === 'en' || cap.lanName?.toLowerCase().includes('arabic') || cap.lanName?.toLowerCase().includes('english'))
      .map(cap => ({
        lan: cap.lan === 'ar' ? 'ar' : 'en',
        url: cap.url
      }));
      
    const downloads = wefeedDownloads.map(dl => {
      let sizeStr = 'Unknown size';
      if (dl.size) {
        const sizeBytes = parseInt(dl.size, 10);
        if (sizeBytes > 1024 * 1024 * 1024) {
          sizeStr = `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        } else if (sizeBytes > 1024 * 1024) {
          sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
        } else {
          sizeStr = `${(sizeBytes / 1024).toFixed(1)} KB`;
        }
      }
      
      const compositeLink = JSON.stringify({
        videoUrl: dl.url,
        captions: subtitles
      });
      
      return {
        quality: `${dl.resolution}p (${dl.codecName || 'h264'})`,
        size: sizeStr,
        link: compositeLink,
        host: 'WeFeed CDN'
      };
    });
    
    return res.json({ type: 'movie', downloads });
  } catch (err) {
    console.error('WeFeed info resolution failed:', err.message);
    res.status(500).json({ error: `Details resolution failed: ${err.message}` });
  }
});

// Route: Direct Movie Stream GET Endpoint
router.get('/api/movies/stream', async (req, res) => {
  const { url: downloadUrl, title } = req.query;
  if (!downloadUrl) return res.status(400).send('Download URL is required');

  console.log(`Stream request received for: "${title}" => ${downloadUrl}`);

  try {
    let actualVideoUrl = downloadUrl;
    try {
      const parsed = JSON.parse(downloadUrl);
      if (parsed && parsed.videoUrl) actualVideoUrl = parsed.videoUrl;
    } catch (e) {}

    actualVideoUrl = await arabicResolver.resolveDirectHosterMediaUrl(actualVideoUrl);
    console.log(`[Server] Stream resolved direct media URL: ${actualVideoUrl}`);

    const checkRes = await fetch(actualVideoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = checkRes.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const text = await checkRes.text();
      if (text.includes('copyright') || text.includes('removed') || text.includes('Notice !') || text.includes('404 Not Found')) {
        return res.status(400).send('هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر مثل (VidTube أو UpDown أو Mdiaload) من القائمة.');
      }
    }

    const safeFilename = `${title || 'movie'}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const downloadResponse = await axios({
      url: actualVideoUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    downloadResponse.data.pipe(res);
  } catch (err) {
    console.error('Movie stream failed:', err.message);
    if (!res.headersSent) {
      res.status(500).send('تعذر تنزيل هذا السيرفر حالياً. يرجى اختيار سيرفر آخر مثل VidTube أو UpDown.');
    }
  }
});

// Route: MovieFetch download POST endpoint
router.post('/api/movies/download', async (req, res) => {
  const { downloadUrl, title } = req.body;
  if (!downloadUrl) {
    return res.status(400).json({ error: 'Download URL is required' });
  }

  console.log(`Download request received for: "${title}" => ${downloadUrl}`);
  
  try {
    let actualVideoUrl = downloadUrl;
    try {
      const parsed = JSON.parse(downloadUrl);
      if (parsed.videoUrl) actualVideoUrl = parsed.videoUrl;
    } catch (e) {}

    actualVideoUrl = await arabicResolver.resolveDirectHosterMediaUrl(actualVideoUrl);
    console.log(`[Server] Resolved direct media stream URL: ${actualVideoUrl}`);

    const checkRes = await fetch(actualVideoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = checkRes.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const text = await checkRes.text();
      if (text.includes('copyright') || text.includes('removed') || text.includes('Notice !') || text.includes('404 Not Found')) {
        return res.status(400).json({
          error: 'هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر مثل (VidTube أو UpDown أو Mdiaload) من الجدول أعلاه.'
        });
      }
    }

    const safeFilename = `${title}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const downloadResponse = await axios({
      url: actualVideoUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    downloadResponse.data.pipe(res);
  } catch (err) {
    console.error('Movie download proxy failed:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'تعذر الاتصال بسيرفر التحميل هذا. يرجى تجربة سيرفر آخر من الجدول أعلاه.' });
    }
  }
});

// Route: OpenSubtitles Search
router.post('/api/subtitles/search', async (req, res) => {
  const { imdbId } = req.body;
  if (!imdbId) return res.status(400).json({ error: 'IMDB ID required' });
  
  try {
    const cleanId = imdbId.replace('tt', '');
    const urlEng = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
    const urlAra = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-ara`;
    
    const [resEng, resAra] = await Promise.all([
      fetch(urlEng, { headers: { 'User-Agent': 'TemporaryUserAgent' } }).catch(() => null),
      fetch(urlAra, { headers: { 'User-Agent': 'TemporaryUserAgent' } }).catch(() => null)
    ]);
    
    let allSubs = [];
    if (resEng && resEng.ok) {
        const data = await resEng.json().catch(() => []);
        if (Array.isArray(data)) allSubs = allSubs.concat(data);
    }
    if (resAra && resAra.ok) {
        const data = await resAra.json().catch(() => []);
        if (Array.isArray(data)) allSubs = allSubs.concat(data);
    }
    
    if (allSubs.length > 0) {
      const results = allSubs
        .map(s => ({
          id: s.IDSubtitleFile,
          fileName: s.SubFileName,
          lang: s.LanguageName,
          langId: s.SubLanguageID,
          downloadLink: s.SubDownloadLink,
          size: s.SubSize,
          rating: s.SubRating
        }))
        .slice(0, 15);
      return res.json({ subtitles: results });
    }
    res.json({ subtitles: [] });
  } catch (err) {
    console.error('Subtitles search failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch subtitles' });
  }
});

// Route: OpenSubtitles Download & Decompress proxy
router.post('/api/subtitles/download', async (req, res) => {
  const { downloadLink, fileName } = req.body;
  if (!downloadLink) return res.status(400).json({ error: 'Download link required' });
  
  try {
    const subRes = await fetch(downloadLink, {
      method: 'GET',
      headers: { 'User-Agent': 'TemporaryUserAgent' }
    });
    
    if (!subRes.ok) throw new Error('Failed to fetch from OpenSubtitles');
    
    const zlib = require('zlib');
    const gunzip = zlib.createGunzip();
    
    const safeName = (fileName || 'subtitle.srt').replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    const { Readable } = require('stream');
    Readable.fromWeb(subRes.body).pipe(gunzip).pipe(res);
  } catch (err) {
    console.error('Subtitle download failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download subtitle' });
  }
});

module.exports = router;
