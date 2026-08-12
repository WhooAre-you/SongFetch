const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const router = express.Router();



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
    res.status(500).json({ error: 'Failed to resolve IMDB ID.' });
  }
});

// Route: Search IMDb Suggestions for English Titles (replaces WeFeed search!)
router.get('/api/movies/imdb-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query is required' });
  
  try {
    const query = encodeURIComponent(q.toLowerCase());
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${query}.json`;
    
    const imdbRes = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    const items = imdbRes.data?.d || [];
    const results = items
      .filter(item => item.id && item.id.startsWith('tt') && (item.qid === 'movie' || item.qid === 'tvSeries' || item.qid === 'tvMiniSeries'))
      .map(item => {
        const isSeries = item.qid === 'tvSeries' || item.qid === 'tvMiniSeries';
        return {
          title: item.l,
          link: item.id,
          imdbId: item.id,
          img: item.i?.imageUrl || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
          source: 'vidsrc',
          sourceName: 'English (VidSrc)',
          isArabic: false,
          isSeries
        };
      });
      
    res.json({ results });
  } catch (err) {
    console.error('IMDb search failed:', err.message);
    res.status(500).json({ error: 'Failed to query IMDb suggestions' });
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

    console.log(`[Server] Stream resolved direct media URL: ${actualVideoUrl}`);

    const downloadResponse = await axios({
      url: actualVideoUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://videodownloader.site',
        'Referer': 'https://videodownloader.site/'
      }
    });

    const contentType = downloadResponse.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const chunks = [];
      for await (const chunk of downloadResponse.data) {
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      if (text.includes('copyright') || text.includes('removed') || text.includes('Notice !') || text.includes('404 Not Found')) {
        return res.status(400).send('هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر مثل (VidTube أو UpDown أو Mdiaload) من القائمة.');
      }
    }

    const safeFilename = `${title || 'movie'}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const contentLength = downloadResponse.headers['content-length'];
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

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

    console.log(`[Server] Downloading media URL: ${actualVideoUrl}`);

    const downloadResponse = await axios({
      url: actualVideoUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://videodownloader.site',
        'Referer': 'https://videodownloader.site/'
      }
    });

    const contentType = downloadResponse.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const chunks = [];
      for await (const chunk of downloadResponse.data) {
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      if (text.includes('copyright') || text.includes('removed') || text.includes('Notice !') || text.includes('404 Not Found')) {
        return res.status(400).json({
          error: 'هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر مثل (VidTube أو UpDown أو Mdiaload) من الجدول أعلاه.'
        });
      }
    }

    const safeFilename = `${title}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const contentLength = downloadResponse.headers['content-length'];
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

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

// Route: Curated list of Live IPTV channels (simulating Ostora TV App live streaming)
router.get('/api/ostora/channels', (req, res) => {
  const channels = [
    {
      name: "beIN Sports HD1 (بث مباشر مباريات اليوم)",
      category: "Sports",
      url: "https://tglive.beinsports.com/stream.m3u8",
      isEmbed: true,
      embedUrl: "https://www.youtube.com/embed/live_stream?channel=UC5gS8J_X2S_mD5P1sP-JtZw"
    },
    {
      name: "Al Jazeera Live (قناة الجزيرة مباشر)",
      category: "News",
      url: "https://live-am.aljazeera.net/AJ/index.m3u8",
      isEmbed: true,
      embedUrl: "https://www.youtube.com/embed/live_stream?channel=UCOgFi4fMEGPuaKy56LNnigg"
    },
    {
      name: "Al Arabiya News (قناة العربية بث مباشر)",
      category: "News",
      url: "https://alarabiya.live/stream.m3u8",
      isEmbed: true,
      embedUrl: "https://www.youtube.com/embed/live_stream?channel=UC4S3a8Gatp8XUdeecn1fCqw"
    },
    {
      name: "Rotana Cinema (قناة روتانا سينما بث مباشر)",
      category: "Entertainment",
      url: "https://rotana-cinema-live.com/stream.m3u8",
      isEmbed: true,
      embedUrl: "https://www.youtube.com/embed/live_stream?channel=UCCj9gV1n4gP8gJ1e991J9Lw"
    }
  ];
  res.json({ channels });
});

module.exports = router;
