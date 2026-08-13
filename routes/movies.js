const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache'
};

// Helper: Normalize titles for grouping
function normalizeTitle(rawTitle) {
  if (!rawTitle) return '';
  let str = rawTitle.toLowerCase();
  
  // Extract year
  const yearMatch = str.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : '';

  // Remove noise
  str = str
    .replace(/مشاهدة وتحميل|مشاهدة|وتحميل|تحميل|مترجم|كامل|اون لاين|اونلاين|بجودة|ممتازة|عالية|مباشر|بدون إعلانات|إعلانات|فيلم|مسلسل|حلقة|موسم/g, '')
    .replace(/watch|download|full|hd|bluray|web-dl|1080p|720p|480p|mkv|mp4|avi|movie|film|series|season|episode/g, '')
    .replace(/[()\-:\[\]]/g, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\s+/g, '')
    .trim();

  return `${str}_${year}`;
}

// Helper Scraper: ArabSeed
async function searchArabSeed(q) {
  try {
    const searchUrl = `https://arabseed.loan/find/?find=${encodeURIComponent(q)}`;
    const res = await axios.get(searchUrl, { headers: COMMON_HEADERS, timeout: 7000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).find('h3, h2, .title, .BlockTitle').text().trim() || $(el).attr('title') || $(el).text().trim();
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (href && (href.includes('/film/') || href.includes('/movie/') || href.includes('/watch/') || href.includes('/post/')) && title.length > 2) {
        if (img && !img.startsWith('http')) img = `https://arabseed.loan${img}`;
        const fullLink = href.startsWith('http') ? href : `https://arabseed.loan${href}`;
        results.push({
          title,
          link: fullLink,
          img: img || '',
          source: 'ArabSeed',
          sourceName: 'عرب سيد',
          isArabic: true,
          isSeries: href.includes('series') || title.includes('مسلسل')
        });
      }
    });
    return results;
  } catch (e) {
    console.error('ArabSeed search warning:', e.message);
    return [];
  }
}

// Helper Scraper: QFilm
async function searchQFilm(q) {
  try {
    const searchUrl = `https://a.qfilm.tv/?s=${encodeURIComponent(q)}`;
    const res = await axios.get(searchUrl, { headers: COMMON_HEADERS, timeout: 7000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).find('.title, h2, h3, .entry-title').text().trim() || $(el).attr('title') || $(el).text().trim();
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || $(el).find('img').attr('data-lazy-src');

      if (href && (href.includes('/movie/') || href.includes('/film/') || href.includes('/watch/') || href.includes('/post/')) && title.length > 2) {
        if (img && !img.startsWith('http')) img = `https://a.qfilm.tv${img}`;
        const fullLink = href.startsWith('http') ? href : `https://a.qfilm.tv${href}`;
        results.push({
          title,
          link: fullLink,
          img: img || '',
          source: 'QFilm',
          sourceName: 'كيوفيلم',
          isArabic: true,
          isSeries: href.includes('series') || title.includes('مسلسل')
        });
      }
    });
    return results;
  } catch (e) {
    console.error('QFilm search warning:', e.message);
    return [];
  }
}

// Helper Scraper: CimaLight
async function searchCimaLight(q) {
  try {
    const searchUrl = `https://r.cimalight.co/main27/?s=${encodeURIComponent(q)}`;
    const res = await axios.get(searchUrl, { headers: COMMON_HEADERS, timeout: 7000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).find('.title, h2, h3, .BlockTitle').text().trim() || $(el).attr('title') || $(el).text().trim();
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (href && (href.includes('/movie/') || href.includes('/film/') || href.includes('/watch/') || href.includes('/video/')) && title.length > 2) {
        if (img && !img.startsWith('http')) img = `https://r.cimalight.co/main27${img}`;
        const fullLink = href.startsWith('http') ? href : `https://r.cimalight.co/main27${href}`;
        results.push({
          title,
          link: fullLink,
          img: img || '',
          source: 'CimaLight',
          sourceName: 'سيما لايت',
          isArabic: true,
          isSeries: href.includes('series') || title.includes('مسلسل')
        });
      }
    });
    return results;
  } catch (e) {
    console.error('CimaLight search warning:', e.message);
    return [];
  }
}

// Helper Scraper: WeCima
async function searchWeCima(q) {
  try {
    const searchUrl = `https://mycima.wecima.show/search/${encodeURIComponent(q)}`;
    const res = await axios.get(searchUrl, { headers: COMMON_HEADERS, timeout: 7000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('.GridItem, .Thumb--GridItem, a[href*="/film/"], a[href*="/movie/"], a[href*="/watch/"]').each((i, el) => {
      const href = $(el).attr('href') || $(el).find('a').attr('href');
      const title = $(el).find('.has-text, strong, .title, h2, h3').text().trim() || $(el).text().trim();
      let img = $(el).find('.BG--GridItem').attr('data-bg') || $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (href && title && title.length > 2) {
        results.push({
          title,
          link: href.startsWith('http') ? href : `https://mycima.wecima.show${href}`,
          img: img || '',
          source: 'WeCima',
          sourceName: 'وي سيما',
          isArabic: true,
          isSeries: href.includes('series') || title.includes('مسلسل')
        });
      }
    });
    return results;
  } catch (e) {
    return [];
  }
}

// Helper Scraper: DuckDuckGo Fallback for Arabic Cinema
async function searchDuckDuckGo(q) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q + ' فيلم OR مسلسل')}`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 6000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('.result__body').each((i, el) => {
      const a = $(el).find('.result__title a');
      const href = a.attr('href');
      const title = a.text().trim();
      
      let actualUrl = href;
      if (href && href.includes('uddg=')) {
        const match = href.match(/uddg=([^&]+)/);
        if (match) actualUrl = decodeURIComponent(match[1]);
      }

      if (actualUrl && title && (actualUrl.includes('arabseed') || actualUrl.includes('qfilm') || actualUrl.includes('cimalight') || actualUrl.includes('wecima') || actualUrl.includes('egybest') || actualUrl.includes('fasel') || actualUrl.includes('mycima'))) {
        let source = 'Cinema';
        let sourceName = 'عرب سينما';
        if (actualUrl.includes('arabseed')) { source = 'ArabSeed'; sourceName = 'عرب سيد'; }
        else if (actualUrl.includes('qfilm')) { source = 'QFilm'; sourceName = 'كيوفيلم'; }
        else if (actualUrl.includes('cimalight')) { source = 'CimaLight'; sourceName = 'سيما لايت'; }
        else if (actualUrl.includes('wecima') || actualUrl.includes('mycima')) { source = 'WeCima'; sourceName = 'وي سيما'; }
        else if (actualUrl.includes('egybest')) { source = 'EgyBest'; sourceName = 'إيجي بست'; }

        results.push({
          title,
          link: actualUrl,
          img: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
          source,
          sourceName,
          isArabic: true,
          isSeries: actualUrl.includes('series') || title.includes('مسلسل')
        });
      }
    });
    return results;
  } catch (e) {
    return [];
  }
}

// Helper Scraper: TMDB Search (Guaranteed cloud fallback for Arabic & English movies)
async function searchTMDBArabic(q) {
  try {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=15d2ea6d0dc1d476efbca3eba2b9bbfb&language=ar-SA&query=${encodeURIComponent(q)}`;
    const res = await axios.get(url, { timeout: 6000 });
    if (!res.data || !res.data.results) return [];

    return res.data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(item => {
        const isSeries = item.media_type === 'tv';
        const title = item.title || item.name || item.original_title || item.original_name;
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
        return {
          title,
          link: `tmdb_${item.id}`,
          tmdbId: item.id,
          imdbId: item.id,
          img: poster || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
          source: 'TMDB',
          sourceName: 'TMDB Cinema',
          isArabic: true,
          isSeries
        };
      });
  } catch (e) {
    return [];
  }
}

// Route: Unified Search across all sources with Deduplication
router.get('/api/movies/search-all', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query is required' });

  try {
    const query = q.trim();
    const isArabicQuery = /[\u0600-\u06FF]/.test(query);

    // Fetch in parallel from TMDB + IMDb + ArabSeed + QFilm + CimaLight + WeCima + DuckDuckGo
    const [tmdbItems, imdbRes, arabSeedItems, qFilmItems, cimaLightItems, weCimaItems, ddgItems] = await Promise.all([
      searchTMDBArabic(query),
      axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query.toLowerCase())}.json`, { headers: COMMON_HEADERS }).catch(() => null),
      searchArabSeed(query),
      searchQFilm(query),
      searchCimaLight(query),
      searchWeCima(query),
      searchDuckDuckGo(query)
    ]);

    let imdbItems = [];
    if (imdbRes && imdbRes.data && imdbRes.data.d) {
      imdbItems = imdbRes.data.d
        .filter(item => item.id && item.id.startsWith('tt') && (item.qid === 'movie' || item.qid === 'tvSeries' || item.qid === 'tvMiniSeries'))
        .filter(item => {
          if (isArabicQuery) {
            return item.l && item.l.toLowerCase().includes(query.toLowerCase());
          }
          return true;
        })
        .map(item => ({
          title: item.l,
          link: item.id,
          imdbId: item.id,
          img: item.i?.imageUrl || '',
          source: 'vidsrc',
          sourceName: 'English (VidSrc)',
          isArabic: false,
          isSeries: item.qid === 'tvSeries' || item.qid === 'tvMiniSeries'
        }));
    }

    const allRawResults = [...tmdbItems, ...arabSeedItems, ...qFilmItems, ...cimaLightItems, ...weCimaItems, ...ddgItems, ...imdbItems];

    // Group & Deduplicate results into clean single cards
    const groupedMap = new Map();

    allRawResults.forEach(item => {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 2) return;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          title: item.title,
          key,
          img: item.img || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
          isSeries: item.isSeries,
          isArabic: item.isArabic,
          imdbId: item.imdbId || null,
          tmdbId: item.tmdbId || null,
          sources: [
            { source: item.source, sourceName: item.sourceName, link: item.link, imdbId: item.imdbId || null, tmdbId: item.tmdbId || null }
          ]
        });
      } else {
        const existing = groupedMap.get(key);
        const hasSource = existing.sources.some(s => s.source === item.source);
        if (!hasSource) {
          existing.sources.push({ source: item.source, sourceName: item.sourceName, link: item.link, imdbId: item.imdbId || null, tmdbId: item.tmdbId || null });
        }
        if ((!existing.img || existing.img.includes('unsplash')) && item.img) {
          existing.img = item.img;
        }
        if (item.imdbId && !existing.imdbId) existing.imdbId = item.imdbId;
        if (item.tmdbId && !existing.tmdbId) existing.tmdbId = item.tmdbId;
      }
    });

    const results = Array.from(groupedMap.values());

    res.json({ results });
  } catch (err) {
    console.error('Unified search failed:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Route: Proxy Endpoint to bypass Cloudflare anti-framing & 403 on Arabic movie embeds
router.get('/api/movies/proxy-embed', async (req, res) => {
  const { url: targetUrl } = req.query;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const origin = new URL(targetUrl).origin;
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        'Referer': origin + '/',
        'Origin': origin
      },
      timeout: 8000
    });

    const contentType = response.headers['content-type'] || 'text/html';
    
    if (contentType.includes('text/html')) {
      let html = response.data;
      const $ = cheerio.load(html);

      if (!$('base').length) {
        $('head').prepend(`<base href="${targetUrl}">`);
      }

      $('script[src*="pop"], script[src*="ad"]').remove();

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send($.html());
    }

    res.setHeader('Content-Type', contentType);
    res.send(response.data);
  } catch (err) {
    console.error('Proxy embed error:', err.message);
    res.status(500).send(`
      <div style="color:#ef4444; font-family:sans-serif; text-align:center; padding:30px; background:#111; border-radius:8px;">
        <h3>تعذر تحميل سيرفر المشاهدة هذا حالياً</h3>
        <p style="color:#9ca3af;">يرجى تجربة سيرفر آخر من القائمة بالأسفل.</p>
      </div>
    `);
  }
});

// Route: Extract Server Links from Arabic & Clean English movie detail pages
router.post('/api/movies/resolve-servers', async (req, res) => {
  const { sources, title } = req.body;
  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: 'Sources list is required' });
  }

  const servers = [];
  const searchTitle = title || (sources[0] && (sources[0].title || sources[0].name));
  const isArabicMovie = (searchTitle && /[\u0600-\u06FF]/.test(searchTitle)) || sources.some(s => s.isArabic);

  if (isArabicMovie && searchTitle) {
    try {
      const cleanQ = searchTitle.replace(/[^\u0600-\u06FF0-9a-zA-Z\s]/g, ' ').trim();
      const [arabSeedItems, qFilmItems, cimaLightItems, weCimaItems] = await Promise.all([
        searchArabSeed(cleanQ),
        searchQFilm(cleanQ),
        searchCimaLight(cleanQ),
        searchWeCima(cleanQ)
      ]);
      const arabicMatches = [...arabSeedItems, ...qFilmItems, ...cimaLightItems, ...weCimaItems];
      arabicMatches.forEach((m, idx) => {
        servers.push({
          name: `🟢 ${m.sourceName} - سيرفر ${idx + 1}`,
          url: `/api/movies/proxy-embed?url=${encodeURIComponent(m.link)}`,
          type: 'iframe',
          sourceName: m.sourceName
        });
      });
    } catch (e) {
      console.warn('Arabic live servers search error:', e.message);
    }
  }

  // Also include direct links passed in sources
  for (const s of sources) {
    if (s.link && s.link.startsWith('http') && !s.link.includes('tmdb') && !s.link.includes('imdb')) {
      servers.push({
        name: `🟢 ${s.sourceName || 'مشاهدة مباشرة'} - سيرفر رئيسي`,
        url: `/api/movies/proxy-embed?url=${encodeURIComponent(s.link)}`,
        type: 'iframe',
        sourceName: s.sourceName || 'Arabic'
      });
    }
  }

  // Add English servers as fallback
  for (const s of sources) {
    if (s.source === 'vidsrc' || s.source === 'TMDB' || s.imdbId || s.tmdbId) {
      const idToUse = s.tmdbId || s.imdbId || s.link;
      if (idToUse) {
        servers.unshift(
          { name: '🎬 SmashyStream (سيرفر أساسي 1080p)', url: `https://embed.smashystream.com/playere.php?tmdb=${idToUse}`, type: 'iframe', sourceName: 'SmashyStream' },
          { name: '✨ VidLink (سيرفر 2)', url: `https://vidlink.pro/movie/${idToUse}`, type: 'iframe', sourceName: 'VidLink' },
          { name: '✨ VidSrc.pro (سيرفر 3)', url: `https://vidsrc.pro/embed/movie/${idToUse}`, type: 'iframe', sourceName: 'VidSrc' },
          { name: '🎬 AutoEmbed (سيرفر 4)', url: `https://player.autoembed.cc/embed/movie/${idToUse}`, type: 'iframe', sourceName: 'AutoEmbed' }
        );
      }
      break;
    }
  }

  // Deduplicate servers by URL
  const uniqueServers = [];
  const seenUrls = new Set();
  for (const s of servers) {
    if (s.url && !seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      uniqueServers.push(s);
    }
  }

  res.json({ servers: uniqueServers });
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
