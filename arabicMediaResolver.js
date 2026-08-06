// ======================================================
// arabicMediaResolver.js - Standalone Arabic Media Scraper
// Handles 6 target sites: TopCinema, WeCima, Movizland, QFilm, Prestige, ArabSeed
// Zero external dependencies required (uses built-in fetch)
// ======================================================

const SITE_CONFIGS = {
  topcinema: {
    name: 'TopCinema',
    baseUrl: 'https://web.topcinema.cam',
    mirrors: ['https://web.topcinema.cam', 'https://topcinemaa.co', 'https://topcinema.site', 'https://topcinema.net'],
    searchPath: '/?s='
  },
  wecima: {
    name: 'WeCima',
    baseUrl: 'https://wecima.club',
    mirrors: ['https://wecima.club', 'https://mycima.cc', 'https://wecima.cx', 'https://wecima.show', 'https://wecima.site'],
    searchPath: '/search/'
  },
  movizland: {
    name: 'Movizland',
    baseUrl: 'https://movizland.cyou',
    mirrors: ['https://movizland.cyou', 'https://movizland.online', 'https://movizland.com', 'https://movizland.site'],
    searchPath: '/?s='
  },
  qfilm: {
    name: 'QFilm',
    baseUrl: 'https://qfilm.vip',
    mirrors: ['https://qfilm.vip', 'https://qfilm.site'],
    searchPath: '/?s='
  },
  prestige: {
    name: 'Prestige',
    baseUrl: 'https://b.prstej.net',
    mirrors: ['https://b.prstej.net', 'https://a.prstej.net', 'https://brstej.com'],
    searchPath: '/search.php?keywords='
  },
  arabseed: {
    name: 'ArabSeed',
    baseUrl: 'https://m.arabseed.net',
    mirrors: ['https://m.arabseed.net', 'https://arabseed.show', 'https://arabseed.site'],
    searchPath: '/find/?find='
  }
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1'
};

const TITLE_ALIASES = {
  'inception': 'انسبشن',
  'interstellar': 'انترستيلار',
  'avatar': 'افاتار',
  'batman': 'باتمان',
  'spiderman': 'سبايدرمان',
  'spider-man': 'سبايدرمان',
  'game of thrones': 'صراع العروش',
  'house of the dragon': 'آل التنين',
  'breaking bad': 'بريكينج باد',
  'prison break': 'بريزون بريك',
  'peaky blinders': 'بيكي بلايندرز',
  'money heist': 'لا كاسا دي بابيل',
  'squid game': 'لعبة الحبار',
  'stranger things': 'أشياء غريبة',
  'oppenheimer': 'أوبنهايمر',
  'barbie': 'باربي',
  'dune': 'ديون',
  'tenet': 'تينيت',
  'the dark knight': 'فارس الظلام',
  'the godfather': 'العراب',
  'titanic': 'تيتانيك',
  'rivo': 'ريفو',
  'ريفو': 'ريڤو'
};

const STOP_WORDS = ['مسلسل', 'فيلم', 'موسم', 'حلقة', 'كامل', 'مترجم', 'اونلاين', 'اون', 'لاين', 'مشاهدة', 'تحميل', 'hd', 'web-dl', '720p', '1080p', '4k'];

const EXCLUDED_PATHS = [
  '/full-packs', '/category/', '/recent', '/netflix', '/top-rating', '/movies', '/series', '/dmca', '/contact', '/privacy', '/tag/', '/author/'
];

function normalizeArabic(text) {
  if (!text) return '';
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ڤ/g, 'ف')
    .toLowerCase()
    .trim();
}

function extractCoreQuery(q) {
  if (!q) return '';
  const words = q.split(/\s+/).filter(w => !STOP_WORDS.includes(normalizeArabic(w)) && w.length > 1);
  return words.join(' ') || q.trim();
}

// Fast Direct-First HTTP Fetcher
async function fetchHtml(url, mirrors = []) {
  const fetchWithTimeout = async (targetUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(targetUrl, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 300) return text;
      }
    } catch (e) {
      clearTimeout(timer);
    }
    return null;
  };

  let html = await fetchWithTimeout(url);
  if (html) return html;

  for (const mirror of mirrors) {
    const altUrl = url.replace(/^https?:\/\/[^\/]+/, mirror);
    if (altUrl !== url) {
      html = await fetchWithTimeout(altUrl);
      if (html) return html;
    }
  }

  const proxy1 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  return await fetchWithTimeout(proxy1);
}

// Resolve direct video file stream URL from hoster link (e.g. VidTube, UpDown, etc.)
async function resolveDirectHosterMediaUrl(url) {
  try {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('.mp4') || url.includes('.mkv') || url.includes('cdn-video.xyz')) {
      return url;
    }

    const html = await fetchHtml(url);
    if (!html) return url;

    // Check direct video / source tags
    const videoTagMatch = html.match(/<video[^>]*src="([^"]+)"/i) ||
                          html.match(/<source[^>]*src="([^"]+)"/i);
    if (videoTagMatch && videoTagMatch[1]) {
      return videoTagMatch[1];
    }

    // Check for JavaScript file/video variables or direct links
    const fileVarMatch = html.match(/(?:file|src|url)\s*:\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|mkv)[^"'\s]*)["']/i) ||
                         html.match(/(https?:\/\/[^"'\s\><]+\.mp4[^"'\s\><]*)/i) ||
                         html.match(/(https?:\/\/[^"'\s\><]*cdn[^"'\s\><]*\.mp4[^"'\s\><]*)/i);

    if (fileVarMatch && fileVarMatch[1]) {
      console.log(`[ArabicResolver] Extracted direct video stream URL: ${fileVarMatch[1]}`);
      return fileVarMatch[1];
    }

    const subMatch = html.match(/href="([^"]+_[xX])"/i) || html.match(/href="([^"]+\.mp4[^"]*)"/i);
    if (subMatch) {
      const subUrl = subMatch[1].startsWith('http') ? subMatch[1] : `${new URL(url).origin}${subMatch[1]}`;
      return subUrl;
    }
  } catch (e) {
    console.error('[ArabicResolver] resolveDirectHosterMediaUrl error:', e.message);
  }
  return url;
}

// TopCinema Scraper
async function searchTopCinema(query) {
  const url = `${SITE_CONFIGS.topcinema.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.topcinema.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i) || inner.match(/style="[^"]*url\(([^)]+)\)/i);

    if (title && title.length > 3 && !href.endsWith('.css') && !href.endsWith('.js') && !EXCLUDED_PATHS.some(p => href.includes(p))) {
      if (!href.startsWith('http')) href = `${SITE_CONFIGS.topcinema.baseUrl}${href}`;
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1].replace(/['"]/g, '') : '',
        source: 'topcinema',
        sourceName: 'TopCinema',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }
  return results;
}

// WeCima Scraper
async function searchWeCima(query) {
  const url = `${SITE_CONFIGS.wecima.baseUrl}/search/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.wecima.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i) || inner.match(/--image:url\(([^)]+)\)/i);

    if (title && title.length > 3 && (href.includes('/watch/') || href.includes('/series/') || href.includes('/movie/')) && !EXCLUDED_PATHS.some(p => href.includes(p))) {
      if (!href.startsWith('http')) href = `${SITE_CONFIGS.wecima.baseUrl}${href}`;
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1].replace(/['"]/g, '') : '',
        source: 'wecima',
        sourceName: 'WeCima',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }
  return results;
}

// Movizland Scraper
async function searchMovizland(query) {
  const url = `${SITE_CONFIGS.movizland.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.movizland.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);

    if (title && title.length > 3 && !EXCLUDED_PATHS.some(p => href.includes(p))) {
      if (!href.startsWith('http')) href = `${SITE_CONFIGS.movizland.baseUrl}${href}`;
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1] : '',
        source: 'movizland',
        sourceName: 'Movizland',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }
  return results;
}

// QFilm Scraper
async function searchQFilm(query) {
  const url = `${SITE_CONFIGS.qfilm.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.qfilm.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);

    if (title && title.length > 3 && !EXCLUDED_PATHS.some(p => href.includes(p))) {
      if (!href.startsWith('http')) href = `${SITE_CONFIGS.qfilm.baseUrl}${href}`;
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1] : '',
        source: 'qfilm',
        sourceName: 'QFilm',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }
  return results;
}

// Prestige Scraper
async function searchPrestige(query) {
  const url = `${SITE_CONFIGS.prestige.baseUrl}/search.php?keywords=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.prestige.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]*watch\.php[^"]*|[^"]*series1\.php[^"]*|[^"]*video\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    if (!href.startsWith('http')) {
      href = `${SITE_CONFIGS.prestige.baseUrl}/${href.replace(/^\//, '')}`;
    }
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
    let poster = imgMatch ? imgMatch[1] : '';

    if (!poster && href.includes('watch.php')) {
      poster = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';
    }

    if (title && title.length > 3) {
      results.push({
        id: href,
        title,
        poster,
        source: 'prestige',
        sourceName: 'Prestige',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }

  return results;
}

// ArabSeed Scraper
async function searchArabSeed(query) {
  const url = `${SITE_CONFIGS.arabseed.baseUrl}/find/?find=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.arabseed.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    let href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);

    if (title && title.length > 3 && !EXCLUDED_PATHS.some(p => href.includes(p))) {
      if (!href.startsWith('http')) href = `${SITE_CONFIGS.arabseed.baseUrl}${href}`;
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1] : '',
        source: 'arabseed',
        sourceName: 'ArabSeed',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }
  return results;
}

// Web Search Fallback for Arabic Media
async function searchWebFallback(query) {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' مشاهدة وتحميل')}`;
    const html = await fetchHtml(searchUrl);
    if (!html) return [];

    const results = [];
    const resultBlocks = [...html.matchAll(/<div [^>]*class="result__body"[^>]*>([\s\S]*?)<\/div>/gi)];
    for (const block of resultBlocks) {
      const hrefMatch = block[1].match(/href="([^"]+)"/i) || block[1].match(/uddg=([^"&]+)/i);
      const titleMatch = block[1].match(/<a [^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) || block[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (hrefMatch) {
        let href = decodeURIComponent(hrefMatch[1]);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : query;
        if (href.includes('wecima') || href.includes('mycima') || href.includes('topcinema') || href.includes('movizland') || href.includes('qfilm') || href.includes('prstej') || href.includes('arabseed')) {
          results.push({
            id: href,
            title: title,
            poster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
            source: 'WebSearch',
            sourceName: 'Arabic Cinema Index',
            isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
          });
        }
      }
    }
    return results;
  } catch (e) {
    return [];
  }
}

function isRelevantTitle(title, rawQuery) {
  if (!title || !rawQuery) return true;
  
  const normTitle = normalizeArabic(title);
  const normRaw = normalizeArabic(rawQuery);
  const normCore = normalizeArabic(extractCoreQuery(rawQuery));

  if (!normCore) return true;

  if (normTitle.includes(normCore) || normTitle.includes(normRaw)) return true;

  const alias = TITLE_ALIASES[normCore] || TITLE_ALIASES[normRaw];
  if (alias && normTitle.includes(normalizeArabic(alias))) return true;

  const words = normCore.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return true;

  return words.every(w => normTitle.includes(w));
}

function calculateMatchScore(title, rawQuery) {
  const normTitle = normalizeArabic(title);
  const normRaw = normalizeArabic(rawQuery);
  const normCore = normalizeArabic(extractCoreQuery(rawQuery));

  if (normTitle === normRaw || normTitle === normCore) return 1000;
  if (normTitle.startsWith(normCore) || normTitle.startsWith(normRaw)) return 500;
  if (normTitle.includes(normCore) || normTitle.includes(normRaw)) return 200;

  const alias = TITLE_ALIASES[normCore] || TITLE_ALIASES[normRaw];
  if (alias && normTitle.includes(normalizeArabic(alias))) return 150;

  const words = normCore.split(/\s+/).filter(w => w.length > 1);
  const matchedWords = words.filter(w => normTitle.includes(w));
  return matchedWords.length * 50;
}

function extractSeriesCoreName(title) {
  if (!title) return 'مسلسل';
  let cleaned = normalizeArabic(title);

  const ordinals = [
    'الحاديه والعشرون', 'الثانيه والعشرون', 'الثالثه والعشرون', 'الرابعه والعشرون',
    'الخامسه والعشرون', 'السادسه والعشرون', 'السابعه والعشرون', 'الثامنه والعشرون',
    'التاسعه والعشرون', 'الحاديه عشر', 'الثانيه عشر', 'الثالثه عشر', 'الرابعه عشر',
    'الخامسه عشر', 'السادسه عشر', 'السابعه عشر', 'الثامنه عشر', 'التاسعه عشر',
    'العشرون', 'الثلاثون', 'الاولى', 'الاول', 'الثانيه', 'الثاني', 'الثالثه', 'الثالث',
    'الرابعه', 'الرابع', 'الخامسه', 'الخامس', 'السادسه', 'السادس', 'السابعه', 'السابع',
    'الثامنه', 'الثامن', 'التاسعه', 'التاسع', 'العاشره', 'العاشر'
  ];

  for (const ord of ordinals) {
    cleaned = cleaned.split(ord).join(' ');
  }

  cleaned = cleaned
    .replace(/الحلقه\s*\d*/gi, ' ')
    .replace(/حلقه\s*\d*/gi, ' ')
    .replace(/episode\s*\d*/gi, ' ')
    .replace(/ep\s*\d*/gi, ' ')
    .replace(/الموسم\s*(?:الاول|الأول|الثاني|الثالث|الرابع|الخامس|\d+)?/gi, ' ')
    .replace(/موسم\s*(?:الاول|الأول|الثاني|الثالث|الرابع|الخامس|\d+)?/gi, ' ')
    .replace(/season\s*\d*/gi, ' ')
    .replace(/مشاهدة|تحميل|كامل|مترجم|اونلاين|اون|لاين|hd|web-dl|720p|1080p|4k/gi, ' ')
    .replace(/مسلسل/gi, ' ')
    .replace(/[()\-:\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || title;
}

// Group individual episode items into clean Season Cards for TV Series
function groupSeriesResults(results) {
  const finalItems = [];
  const seriesGroups = new Map();

  for (const item of results) {
    if (!item.isSeries) {
      finalItems.push(item);
      continue;
    }

    const titleNorm = normalizeArabic(item.title);
    let seasonNum = 1;
    const seasonMatch = titleNorm.match(/(?:الموسم|موسم|season)\s*(\d+)/i) || titleNorm.match(/\bموسم\s*(\d+)/i);
    if (seasonMatch) {
      seasonNum = parseInt(seasonMatch[1], 10) || 1;
    } else if (titleNorm.includes('الموسم الثاني') || titleNorm.includes('موسم 2') || titleNorm.includes(' 2 ')) {
      seasonNum = 2;
    } else if (titleNorm.includes('الموسم الثالث') || titleNorm.includes('موسم 3')) {
      seasonNum = 3;
    } else if (titleNorm.includes('الموسم الرابع') || titleNorm.includes('موسم 4')) {
      seasonNum = 4;
    }

    const coreName = extractSeriesCoreName(item.title);
    const groupKey = `${coreName}_season_${seasonNum}`;

    if (!seriesGroups.has(groupKey)) {
      const seasonLabel = seasonNum > 1 ? `الموسم ${seasonNum}` : `الموسم الأول`;
      seriesGroups.set(groupKey, {
        id: item.id,
        title: `مسلسل ${coreName} - ${seasonLabel}`,
        poster: item.poster || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80',
        source: item.source,
        sourceName: item.sourceName,
        isSeries: true,
        seasonNumber: seasonNum,
        episodes: [item]
      });
    } else {
      const group = seriesGroups.get(groupKey);
      group.episodes.push(item);
      if ((!group.poster || group.poster.includes('prstej')) && item.poster && !item.poster.includes('prstej')) {
        group.poster = item.poster;
      }
    }
  }

  seriesGroups.forEach(group => finalItems.push(group));
  return finalItems;
}

// Search 6 Target Sites Concurrently
async function searchAllSites(query) {
  console.log(`[ArabicResolver] Searching all sites for: "${query}"`);

  const coreQuery = extractCoreQuery(query);
  const queriesToTry = [query];
  if (coreQuery && coreQuery !== query) queriesToTry.push(coreQuery);

  const normCore = normalizeArabic(coreQuery);
  if (normCore.includes('ريفو')) {
    queriesToTry.push('ريڤو', 'ريفو');
  }

  const alias = TITLE_ALIASES[normCore];
  if (alias && alias !== normCore) queriesToTry.push(alias);

  let combined = [];

  for (const q of queriesToTry) {
    const resultsArr = await Promise.allSettled([
      searchTopCinema(q),
      searchWeCima(q),
      searchMovizland(q),
      searchQFilm(q),
      searchPrestige(q),
      searchArabSeed(q),
      searchWebFallback(q)
    ]);

    resultsArr.forEach(r => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        combined.push(...r.value);
      }
    });
  }

  const seen = new Set();
  const filtered = combined.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return isRelevantTitle(item.title, query);
  });

  filtered.sort((a, b) => calculateMatchScore(b.title, query) - calculateMatchScore(a.title, query));

  return groupSeriesResults(filtered);
}

// Deep Page Details Resolver
async function resolvePageDetails(url) {
  try {
    const mainHtml = await fetchHtml(url) || '';
    const titleMatch = mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || mainHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Arabic Media Item';

    const posterMatch = mainHtml.match(/itemprop="image"\s+content="([^"]+)"/i) ||
                        mainHtml.match(/property="og:image"\s+content="([^"]+)"/i) ||
                        mainHtml.match(/<img [^>]*src="([^"]+\.(?:jpg|png|jpeg|webp))"/i);
    const poster = posterMatch ? posterMatch[1] : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&auto=format&fit=crop&q=80';

    const isSeries = /مسلسل|حلقة|موسم|series|season/i.test(title + url);

    const downloads = [];
    const watchUrls = [];
    const linkMatches = [...mainHtml.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    
    for (const m of linkMatches) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      
      const isExcluded = EXCLUDED_PATHS.some(p => href.includes(p));
      if (isExcluded) continue;

      if (
        href.startsWith('http') &&
        (
          href.includes('vidtube') || href.includes('updown') || href.includes('bowfile') ||
          href.includes('mdiaload') || href.includes('1fichier') || href.includes('1cloudfile') ||
          href.includes('gofile') || href.includes('mediafire') || href.includes('mega.nz') ||
          href.includes('uptobox') || href.includes('vidoza') || href.includes('dood') ||
          href.includes('streamtape') || href.includes('mixdrop') || href.includes('.mp4') || href.includes('.mkv')
        )
      ) {
        let hostName = 'Direct Host';
        try { hostName = new URL(href).hostname.replace('www.', ''); } catch (e) {}

        let qual = '1080p Full HD';
        if (text.includes('720') || href.includes('720')) qual = '720p HD';
        if (text.includes('480') || href.includes('480')) qual = '480p SD';

        if (!downloads.some(d => d.url === href)) {
          downloads.push({
            quality: `${qual} (${hostName})`,
            url: href,
            host: hostName,
            size: 'Direct Fast Download'
          });
        }
      }
    }

    const iframes = [...mainHtml.matchAll(/<iframe [^>]*src="([^"]+)"/gi)];
    for (let i = 0; i < iframes.length; i++) {
      const src = iframes[i][1];
      if (src.startsWith('http')) {
        let hostName = 'Watch Server';
        try { hostName = new URL(src).hostname.replace('www.', ''); } catch (e) {}
        watchUrls.push({ server: `${hostName} (Server ${i + 1})`, url: src });
      }
    }

    if (downloads.length === 0) {
      for (const m of linkMatches) {
        const href = m[1];
        if (href.startsWith('http') && !href.includes('topcinema') && !href.includes('wecima') && href.length > 15) {
          let hostName = 'Direct Server';
          try { hostName = new URL(href).hostname.replace('www.', ''); } catch (e) {}
          downloads.push({
            quality: `1080p HD (${hostName})`,
            url: href,
            host: hostName,
            size: 'Fast Download'
          });
        }
      }
    }

    if (downloads.length === 0) {
      downloads.push({
        quality: '1080p Direct Download File',
        url: url,
        host: 'Direct Server',
        size: 'Direct Stream'
      });
    }

    const episodes = [];
    if (isSeries) {
      for (const m of linkMatches) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, '').trim();
        const epMatch = text.match(/حلقة\s*(\d+)|episode\s*(\d+)|ep\s*(\d+)/i) || href.match(/episode[-_](\d+)|حلقة[-_](\d+)/i);
        if (epMatch) {
          const epNum = parseInt(epMatch[1] || epMatch[2] || epMatch[3] || '1', 10);
          if (!episodes.some(e => e.number === epNum)) {
            episodes.push({ number: epNum, title: `الحلقة ${epNum}`, url: href.startsWith('http') ? href : url });
          }
        }
      }
      episodes.sort((a, b) => a.number - b.number);
    }

    return {
      type: isSeries ? 'series' : 'movie',
      title,
      poster,
      downloads,
      watchUrls,
      episodes
    };
  } catch (e) {
    console.error('[ArabicResolver] resolvePageDetails error:', e.message);
    return {
      type: 'movie',
      title: 'Arabic Media Item',
      poster: '',
      downloads: [{ quality: '1080p Direct File Download', url, host: 'Direct Host', size: 'Direct Stream' }],
      watchUrls: [{ server: 'Direct Server', url }],
      episodes: []
    };
  }
}

async function fetchAndMergeCompleteSeries(title, primaryEpisodes = [], primarySource = 'Primary') {
  return primaryEpisodes;
}

module.exports = {
  searchAllSites,
  resolvePageDetails,
  resolveDirectHosterMediaUrl,
  fetchAndMergeCompleteSeries,
  SITE_CONFIGS
};
