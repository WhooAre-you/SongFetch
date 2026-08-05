const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const sslAgent = new https.Agent({ rejectUnauthorized: false });

// Configured Base URLs and mirrors for the 6 target sites
const SITE_CONFIGS = {
  topcinema: {
    name: 'TopCinema',
    baseUrl: 'https://topcinemaa.co',
    mirrors: ['https://topcinemaa.co', 'https://topcinemaa.cam', 'https://topcinema.cam'],
    searchPath: '/?s='
  },
  wecima: {
    name: 'WeCima / MyCima',
    baseUrl: 'https://wecima.cx',
    mirrors: ['https://wecima.cx', 'https://mycima.wecima.cx'],
    searchPath: '/search/'
  },
  arabseed: {
    name: 'ArabSeed',
    baseUrl: 'https://arabseeds.show',
    mirrors: ['https://arabseeds.show', 'https://a.arabseed.site', 'https://arabseed.net'],
    searchPath: '/?s='
  },
  movizland: {
    name: 'Movizland',
    baseUrl: 'https://movizland.online',
    mirrors: ['https://movizland.online', 'https://movizland.com'],
    searchPath: '/?s='
  },
  qfilm: {
    name: 'QFilm',
    baseUrl: 'https://qfilm.vip',
    mirrors: ['https://qfilm.vip'],
    searchPath: '/?s='
  },
  prestige: {
    name: 'Prestige',
    baseUrl: 'https://brstej.com',
    mirrors: ['https://brstej.com', 'https://brstej.net'],
    searchPath: '/?s='
  }
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// Helper: Make HTTP request with mirror failovers, proxy bypass & SSL agent
async function fetchHtml(url, mirrors = []) {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const urlsToTry = [
    url,
    ...mirrors.map(m => url.replace(/^https?:\/\/[^\/]+/, m)),
    proxyUrl
  ];
  
  for (const targetUrl of urlsToTry) {
    try {
      const response = await axios.get(targetUrl, {
        headers: BROWSER_HEADERS,
        httpsAgent: sslAgent,
        timeout: 8000,
        maxRedirects: 5
      });
      if (response.data && (typeof response.data === 'string') && response.data.length > 300) {
        return response.data;
      }
    } catch (error) {
      console.error(`[ArabicResolver] Axios mirror failed (${targetUrl}):`, error.message);
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: BROWSER_HEADERS,
          redirect: 'follow'
        });
        if (fetchRes.ok) {
          const htmlText = await fetchRes.text();
          if (htmlText && htmlText.length > 300) return htmlText;
        }
      } catch (fetchErr) {
        console.error(`[ArabicResolver] Native fetch mirror failed (${targetUrl}):`, fetchErr.message);
      }
    }
  }
  return null;
}

// Helper: Extract poster URL reliably from img tag or background style
function extractPoster($, el) {
  const imgEl = $(el).find('img, .image, .poster, .thumb, [style*="background"]').first();
  let src = imgEl.attr('data-src') || 
            imgEl.attr('data-lazy-src') || 
            imgEl.attr('data-bg') || 
            imgEl.attr('data-lazy-style') || 
            imgEl.attr('src') || '';

  if (!src) {
    const style = imgEl.attr('style') || $(el).find('[style*="background"]').attr('style') || $(el).attr('style') || '';
    const match = style.match(/url\(['"]?(.*?)['"]?\)/i);
    if (match) src = match[1];
  }

  if (src.startsWith('//')) src = 'https:' + src;
  return src;
}

// ----------------------------------------------------
// Scraper: TopCinema (topcinemaa.cam)
// ----------------------------------------------------
async function searchTopCinema(query) {
  const url = `${SITE_CONFIGS.topcinema.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.BlockItem, .movie-item, .entry-box, article, .SmallBlockItem, .MovieBlock').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.Title, .title, .entry-title, h3, h2, h4').first();
    
    const href = linkEl.attr('href');
    let title = titleEl.text().trim() || linkEl.text().trim() || linkEl.attr('title') || '';
    
    // Fallback title from decoded URL slug if empty
    if (!title && href) {
      try {
        const slug = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
        title = slug.replace(/-/g, ' ');
      } catch (e) {}
    }

    const poster = extractPoster($, el);
    
    if (href && title && (href.includes('topcinema') || href.startsWith('/'))) {
      const fullUrl = href.startsWith('http') ? href : `${SITE_CONFIGS.topcinema.baseUrl}${href}`;
      results.push({
        id: fullUrl,
        title,
        poster,
        source: 'topcinema',
        sourceName: 'TopCinema',
        isSeries: title.includes('مسلسل') || title.includes('حلقة') || href.includes('series') || href.includes('season')
      });
    }
  });
  
  return results;
}

// ----------------------------------------------------
// Scraper: WeCima / MyCima (wecima.cx)
// ----------------------------------------------------
async function searchWeCima(query) {
  const url = `${SITE_CONFIGS.wecima.baseUrl}/search/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.Grid--WecimaPosts .GridItem, .Thumb--GridItem').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.title, strong').first();
    
    const href = linkEl.attr('href');
    const title = titleEl.text().trim() || linkEl.attr('title') || '';
    const poster = extractPoster($, el);
    
    if (href && title) {
      results.push({
        id: href,
        title,
        poster,
        source: 'wecima',
        sourceName: 'WeCima',
        isSeries: title.includes('مسلسل') || title.includes('موسم') || title.includes('حلقة') || href.includes('series')
      });
    }
  });
  
  return results;
}

// ----------------------------------------------------
// Scraper: ArabSeed (arabseeds.show)
// ----------------------------------------------------
async function searchArabSeed(query) {
  const url = `${SITE_CONFIGS.arabseed.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.MovieBlock, .BlockItem, .MovieBox, .entry-box, article').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.Title, .title, h4, h3, h2').first();
    
    const href = linkEl.attr('href');
    let title = titleEl.text().trim() || linkEl.text().trim() || linkEl.attr('title') || '';
    
    if (!title && href) {
      try {
        const slug = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');
        title = slug.replace(/-/g, ' ');
      } catch (e) {}
    }

    const poster = extractPoster($, el);
    
    if (href && title) {
      const fullUrl = href.startsWith('http') ? href : `${SITE_CONFIGS.arabseed.baseUrl}${href}`;
      results.push({
        id: fullUrl,
        title,
        poster,
        source: 'arabseed',
        sourceName: 'ArabSeed',
        isSeries: title.includes('مسلسل') || title.includes('حلقة') || href.includes('series')
      });
    }
  });
  
  return results;
}

// ----------------------------------------------------
// Scraper: Movizland (movizland.online)
// ----------------------------------------------------
async function searchMovizland(query) {
  const url = `${SITE_CONFIGS.movizland.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.BlockItem, .figure-box, .moviz-item').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.title, h2, h3').first();
    
    const href = linkEl.attr('href');
    const title = titleEl.text().trim() || linkEl.attr('title') || '';
    const poster = extractPoster($, el);
    
    if (href && title) {
      results.push({
        id: href,
        title,
        poster,
        source: 'movizland',
        sourceName: 'Movizland',
        isSeries: title.includes('مسلسل') || title.includes('حلقة')
      });
    }
  });
  
  return results;
}

// ----------------------------------------------------
// Scraper: QFilm (qfilm.vip)
// ----------------------------------------------------
async function searchQFilm(query) {
  const url = `${SITE_CONFIGS.qfilm.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.movie-card, .entry-title, .box-item').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.title, h3, h2').first();
    
    const href = linkEl.attr('href');
    const title = titleEl.text().trim() || linkEl.attr('title') || '';
    const poster = extractPoster($, el);
    
    if (href && title) {
      results.push({
        id: href,
        title,
        poster,
        source: 'qfilm',
        sourceName: 'QFilm',
        isSeries: title.includes('مسلسل') || title.includes('حلقة')
      });
    }
  });
  
  return results;
}

// ----------------------------------------------------
// Scraper: Prestige (brstej.com)
// ----------------------------------------------------
async function searchPrestige(query) {
  const url = `${SITE_CONFIGS.prestige.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.post-item, .entry-title, .video-box').each((_, el) => {
    const linkEl = $(el).find('a').first();
    const titleEl = $(el).find('.title, h3, h2').first();
    
    const href = linkEl.attr('href');
    const title = titleEl.text().trim() || linkEl.attr('title') || '';
    const poster = extractPoster($, el);
    
    if (href && title) {
      results.push({
        id: href,
        title,
        poster,
        source: 'prestige',
        sourceName: 'Prestige',
        isSeries: title.includes('مسلسل') || title.includes('حلقة')
      });
    }
  });
  
  return results;
}

// Common title translation map for popular movies/series to maximize Arabic site matches
const TITLE_ALIASES = {
  'inception': 'انسبشن',
  'interstellar': 'انترستيلار',
  'avatar': 'افاتار',
  'batman': 'باتمان',
  'spiderman': 'سبايدرمان',
  'spider-man': 'سبايدرمان',
  'game of thrones': 'صراع العروش',
  'house of the dragon': 'آل التنين',
  'breaking bad': 'اختلال ضال',
  'prison break': 'بريزون بريك',
  'peaky blinders': 'بيكي بلايندرز'
};

// Helper: Check relevance of result title to query words
function isRelevantTitle(title, query) {
  if (!query || !query.trim()) return true;
  const lowerTitle = (title || '').toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  // Exact or direct substring match
  if (lowerTitle.includes(lowerQuery)) return true;

  // Check alias match
  const alias = TITLE_ALIASES[lowerQuery];
  if (alias && lowerTitle.includes(alias)) return true;

  // Word level check (any word > 2 chars)
  const qWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
  if (qWords.length === 0) return true;

  return qWords.some(w => lowerTitle.includes(w));
}

// ----------------------------------------------------
// Unified Search Function across all 6 sites
// ----------------------------------------------------
async function searchAllSites(query) {
  console.log(`[ArabicResolver] Searching all sites for: "${query}"`);
  
  const queriesToTry = [query];
  const alias = TITLE_ALIASES[query.toLowerCase().trim()];
  if (alias) queriesToTry.push(alias);

  let combined = [];

  for (const q of queriesToTry) {
    const [topcinema, wecima, arabseed, movizland, qfilm, prestige] = await Promise.allSettled([
      searchTopCinema(q),
      searchWeCima(q),
      searchArabSeed(q),
      searchMovizland(q),
      searchQFilm(q),
      searchPrestige(q)
    ]);

    combined.push(
      ...(topcinema.status === 'fulfilled' ? topcinema.value : []),
      ...(wecima.status === 'fulfilled' ? wecima.value : []),
      ...(arabseed.status === 'fulfilled' ? arabseed.value : []),
      ...(movizland.status === 'fulfilled' ? movizland.value : []),
      ...(qfilm.status === 'fulfilled' ? qfilm.value : []),
      ...(prestige.status === 'fulfilled' ? prestige.value : [])
    );
    
    if (combined.length > 0) break;
  }

  // Filter out irrelevant sidebar items and deduplicate by URL
  const seenLinks = new Set();
  const filtered = combined.filter(item => {
    if (!item.id || seenLinks.has(item.id)) return false;
    seenLinks.add(item.id);
    return isRelevantTitle(item.title, query);
  });

  return filtered;
}

// Safe URL helper to handle relative and dynamic links without throwing exceptions
function safeUrl(link, base) {
  try {
    if (!link) return '';
    if (link.startsWith('http://') || link.startsWith('https://')) return link;
    return new URL(link, base).href;
  } catch (e) {
    return link || '';
  }
}

// ----------------------------------------------------
// Episode Extractor for detail pages
// ----------------------------------------------------
async function resolvePageDetails(itemUrl) {
  const html = await fetchHtml(itemUrl);
  if (!html) return { type: 'movie', downloads: [], episodes: [] };
  
  const $ = cheerio.load(html);
  const episodes = [];
  const downloads = [];
  
  // Extract Episodes if present (Series page)
  $('.EpisodesList a, .Episodes--List a, .episodes-box a, .season-episodes a, a[href*="episode"], a[href*="حلقة"]').each((_, el) => {
    const link = $(el).attr('href');
    const text = $(el).text().trim() || $(el).attr('title') || '';
    
    if (link && !link.includes('javascript:') && !link.includes('#')) {
      const match = text.match(/(\d+)/) || link.match(/episode[-_]?(\d+)/i) || link.match(/حلقة[-_]?(\d+)/);
      const epNum = match ? parseInt(match[1], 10) : null;
      
      episodes.push({
        epNum,
        text: text || `Episode ${episodes.length + 1}`,
        link: safeUrl(link, itemUrl)
      });
    }
  });
  
  // Extract direct Download links or Servers
  $('a[href*="download"], a[href*="watch"], .Download--List a, .download-servers a, .WatchServers a').each((_, el) => {
    const link = $(el).attr('href');
    const text = $(el).text().trim() || 'Download Link';
    
    if (link && !link.includes('javascript:') && !link.includes('#')) {
      const qualityMatch = text.match(/(1080p|720p|480p|360p|FHD|HD|SD)/i);
      const quality = qualityMatch ? qualityMatch[1] : 'Standard HD';
      
      downloads.push({
        quality: quality,
        size: 'Auto',
        link: safeUrl(link, itemUrl),
        host: text
      });
    }
  });
  
  if (episodes.length > 0) {
    return { type: 'series', episodes, downloads };
  }
  
  return { type: 'movie', downloads };
}

// ----------------------------------------------------
// Multi-Source Episode Merging & Fallback Engine
// ----------------------------------------------------
async function fetchAndMergeCompleteSeries(seriesTitle, primaryEpisodes, primarySource) {
  console.log(`[ArabicResolver] Merging episodes for "${seriesTitle}". Primary source: ${primarySource}`);
  
  const episodeMap = new Map();
  let maxEpFound = 0;

  primaryEpisodes.forEach((ep, idx) => {
    const epNum = ep.epNum || (idx + 1);
    episodeMap.set(epNum, {
      epNum,
      text: ep.text || `Episode ${epNum}`,
      link: ep.link,
      source: primarySource,
      isFallback: false
    });
    if (epNum > maxEpFound) maxEpFound = epNum;
  });

  const missingEpNums = [];
  for (let i = 1; i <= maxEpFound; i++) {
    if (!episodeMap.has(i)) {
      missingEpNums.push(i);
    }
  }

  if (missingEpNums.length === 0) {
    return Array.from(episodeMap.values()).sort((a, b) => a.epNum - b.epNum);
  }

  console.log(`[ArabicResolver] Missing episode numbers detected: [${missingEpNums.join(', ')}]. Querying alternative sites...`);

  const cleanTitle = seriesTitle
    .replace(/مسلسل|حلقة|موسم|كامل|الموسم|الأول|الثاني|الثالث|الحلقة/g, '')
    .trim();

  const altResults = await searchAllSites(cleanTitle);
  
  for (const item of altResults) {
    if (item.source === primarySource) continue;
    
    const candidateDetails = await resolvePageDetails(item.id);
    if (candidateDetails.type === 'series' && candidateDetails.episodes.length > 0) {
      candidateDetails.episodes.forEach(altEp => {
        const altEpNum = altEp.epNum;
        if (altEpNum && missingEpNums.includes(altEpNum) && !episodeMap.has(altEpNum)) {
          episodeMap.set(altEpNum, {
            epNum: altEpNum,
            text: `${altEp.text} (${item.sourceName})`,
            link: altEp.link,
            source: item.sourceName,
            isFallback: true
          });
          console.log(`[ArabicResolver] Successfully backfilled Episode ${altEpNum} from ${item.sourceName}!`);
        }
      });
    }
  }

  return Array.from(episodeMap.values()).sort((a, b) => a.epNum - b.epNum);
}

module.exports = {
  SITE_CONFIGS,
  searchAllSites,
  resolvePageDetails,
  fetchAndMergeCompleteSeries
};
