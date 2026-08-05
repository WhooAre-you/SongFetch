// ======================================================
// arabicMediaResolver.js - Standalone Arabic Media Scraper
// Handles 6 target sites: TopCinema, WeCima, ArabSeed, Movizland, QFilm, Prestige
// Zero external dependencies required (uses built-in fetch)
// ======================================================

const https = require('https');

const SITE_CONFIGS = {
  topcinema: {
    name: 'TopCinema',
    baseUrl: 'https://topcinemaa.co',
    mirrors: ['https://topcinemaa.co', 'https://topcinemaa.cam'],
    searchPath: '/?s='
  },
  wecima: {
    name: 'WeCima',
    baseUrl: 'https://wecima.cx',
    mirrors: ['https://wecima.cx'],
    searchPath: '/search/'
  },
  arabseed: {
    name: 'ArabSeed',
    baseUrl: 'https://arabseeds.show',
    mirrors: ['https://arabseeds.show', 'https://arabseeds.co'],
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
    mirrors: ['https://brstej.com'],
    searchPath: '/?s='
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

// Common Title Translation Aliases (English -> Arabic)
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
  'titanic': 'تيتانيك'
};

// Universal HTTP Fetcher with Failover Proxies
async function fetchHtml(url, mirrors = []) {
  const proxy1 = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const proxy2 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  
  const urlsToTry = [
    url,
    ...mirrors.filter(m => !url.startsWith(m)).map(m => url.replace(/^https?:\/\/[^\/]+/, m)),
    proxy1,
    proxy2
  ];

  for (const targetUrl of urlsToTry) {
    try {
      const res = await fetch(targetUrl, {
        headers: BROWSER_HEADERS,
        redirect: 'follow'
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 500) {
          return text;
        }
      }
    } catch (e) {
      // try next mirror/proxy
    }
  }
  return null;
}

// ----------------------------------------------------
// TopCinema Scraper
// ----------------------------------------------------
async function searchTopCinema(query) {
  const url = `${SITE_CONFIGS.topcinema.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.topcinema.mirrors);
  if (!html) return [];

  const results = [];
  // Match .Small--Box or anchor items
  const boxMatches = html.match(/<div class="Small--Box">[\s\S]*?<\/div>/gi) || [];
  
  for (const box of boxMatches) {
    const hrefMatch = box.match(/href="([^"]+)"/i);
    const titleMatch = box.match(/<h3[^>]*class="title"[^>]*>([\s\S]*?)<\/h3>/i) || box.match(/title="([^"]+)"/i);
    const imgMatch = box.match(/data-src="([^"]+)"/i) || box.match(/src="([^"]+)"/i);
    
    if (hrefMatch) {
      const href = hrefMatch[1];
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const poster = imgMatch ? imgMatch[1] : '';
      
      if (href && title) {
        results.push({
          id: href.startsWith('http') ? href : `${SITE_CONFIGS.topcinema.baseUrl}${href}`,
          title,
          poster,
          source: 'topcinema',
          sourceName: 'TopCinema',
          isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
        });
      }
    }
  }

  // Fallback: match generic links if empty
  if (results.length === 0) {
    const linkMatches = [...html.matchAll(/<a [^>]*href="(https?:\/\/topcinemaa\.[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of linkMatches) {
      const href = m[1];
      const inner = m[2];
      const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
      if (title && title.length > 3 && !href.endsWith('/movies/') && !href.endsWith('/series/')) {
        results.push({
          id: href,
          title,
          poster: imgMatch ? imgMatch[1] : '',
          source: 'topcinema',
          sourceName: 'TopCinema',
          isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
        });
      }
    }
  }

  return results;
}

// ----------------------------------------------------
// WeCima Scraper
// ----------------------------------------------------
async function searchWeCima(query) {
  const url = `${SITE_CONFIGS.wecima.baseUrl}/search/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.wecima.mirrors);
  if (!html) return [];

  const results = [];
  const gridMatches = html.match(/<div class="GridItem"[\s\S]*?<\/ul>/gi) || html.match(/<div class="GridItem"[\s\S]*?<\/div>\s*<\/div>/gi) || [];

  for (const grid of gridMatches) {
    const hrefMatch = grid.match(/href="(https?:\/\/wecima\.[^"]+\/watch\/[^"]+)"/i) || grid.match(/href="([^"]+\/watch\/[^"]+)"/i);
    const titleMatch = grid.match(/title="([^"]+)"/i) || grid.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const posterMatch = grid.match(/data-src="([^"]+)"/i) || grid.match(/itemprop="thumbnailUrl"\s+content="([^"]+)"/i) || grid.match(/--image:url\(([^)]+)\)/i);

    if (hrefMatch) {
      const href = hrefMatch[1];
      let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      let poster = posterMatch ? posterMatch[1].replace(/['"]/g, '') : '';

      if (href && title) {
        results.push({
          id: href.startsWith('http') ? href : `${SITE_CONFIGS.wecima.baseUrl}${href}`,
          title,
          poster,
          source: 'wecima',
          sourceName: 'WeCima',
          isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
        });
      }
    }
  }

  return results;
}

// ----------------------------------------------------
// ArabSeed Scraper (API + Fallback Regex)
// ----------------------------------------------------
async function searchArabSeed(query) {
  const results = [];
  
  // 1. Try WP JSON REST API first
  for (const mirror of SITE_CONFIGS.arabseed.mirrors) {
    try {
      const apiUrl = `${mirror}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=10`;
      const res = await fetch(apiUrl, { headers: BROWSER_HEADERS });
      if (res.ok) {
        const posts = await res.json();
        if (Array.isArray(posts) && posts.length > 0) {
          for (const post of posts) {
            const title = post.title?.rendered?.replace(/<[^>]+>/g, '') || '';
            const href = post.link || '';
            if (title && href) {
              results.push({
                id: href,
                title,
                poster: '',
                source: 'arabseed',
                sourceName: 'ArabSeed',
                isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
              });
            }
          }
          if (results.length > 0) return results;
        }
      }
    } catch (e) {}
  }

  // 2. HTML Regex fallback
  const url = `${SITE_CONFIGS.arabseed.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.arabseed.mirrors);
  if (!html) return results;

  const matches = [...html.matchAll(/<a [^>]*href="(https?:\/\/arabseeds\.[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    const href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
    if (title && title.length > 3 && !href.endsWith('/films/') && !href.endsWith('/series/')) {
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

// ----------------------------------------------------
// Movizland Scraper
// ----------------------------------------------------
async function searchMovizland(query) {
  const url = `${SITE_CONFIGS.movizland.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.movizland.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="(https?:\/\/movizland\.[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    const href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
    if (title && title.length > 3 && !href.endsWith('.com/') && !href.endsWith('.online/')) {
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

// ----------------------------------------------------
// QFilm Scraper
// ----------------------------------------------------
async function searchQFilm(query) {
  const url = `${SITE_CONFIGS.qfilm.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.qfilm.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="(https?:\/\/qfilm\.[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    const href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
    if (title && title.length > 3) {
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

// ----------------------------------------------------
// Prestige Scraper
// ----------------------------------------------------
async function searchPrestige(query) {
  const url = `${SITE_CONFIGS.prestige.baseUrl}/?s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, SITE_CONFIGS.prestige.mirrors);
  if (!html) return [];

  const results = [];
  const matches = [...html.matchAll(/<a [^>]*href="(https?:\/\/(?:brstej|prestige)\.[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of matches) {
    const href = m[1];
    const inner = m[2];
    const title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgMatch = inner.match(/src="([^"]+)"/i) || inner.match(/data-src="([^"]+)"/i);
    if (title && title.length > 3) {
      results.push({
        id: href,
        title,
        poster: imgMatch ? imgMatch[1] : '',
        source: 'prestige',
        sourceName: 'Prestige',
        isSeries: /مسلسل|حلقة|موسم|series|season/i.test(title + href)
      });
    }
  }

  return results;
}

// ----------------------------------------------------
// Relevance Check
// ----------------------------------------------------
function isRelevantTitle(title, query) {
  if (!title || !query) return true;
  const t = title.toLowerCase();
  const q = query.toLowerCase().trim();

  if (t.includes(q)) return true;

  const alias = TITLE_ALIASES[q];
  if (alias && t.includes(alias)) return true;

  const words = q.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return true;
  return words.some(w => t.includes(w));
}

// ----------------------------------------------------
// Main: Search All Sites Parallel
// ----------------------------------------------------
async function searchAllSites(query) {
  console.log(`[ArabicResolver] Searching all sites: "${query}"`);

  const queriesToTry = [query];
  const alias = TITLE_ALIASES[query.toLowerCase().trim()];
  if (alias) queriesToTry.push(alias);

  let combined = [];

  for (const q of queriesToTry) {
    const [tc, wc, as, ml, qf, pr] = await Promise.allSettled([
      searchTopCinema(q),
      searchWeCima(q),
      searchArabSeed(q),
      searchMovizland(q),
      searchQFilm(q),
      searchPrestige(q)
    ]);

    combined.push(
      ...(tc.status === 'fulfilled' ? tc.value : []),
      ...(wc.status === 'fulfilled' ? wc.value : []),
      ...(as.status === 'fulfilled' ? as.value : []),
      ...(ml.status === 'fulfilled' ? ml.value : []),
      ...(qf.status === 'fulfilled' ? qf.value : []),
      ...(pr.status === 'fulfilled' ? pr.value : [])
    );

    if (combined.length > 0) break;
  }

  const seen = new Set();
  return combined.filter(item => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return isRelevantTitle(item.title, query);
  });
}

// ----------------------------------------------------
// Episode Resolver and Merger
// ----------------------------------------------------
async function fetchAndMergeCompleteSeries(primaryUrl, source) {
  try {
    const html = await fetchHtml(primaryUrl);
    if (!html) return { url: primaryUrl, episodes: [], mergedFromSites: [] };

    const episodes = [];
    const matches = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    
    for (const m of matches) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      const num = text.match(/\d+/);
      if ((href.includes('episode') || href.includes('حلقة') || href.includes('ep')) && num) {
        const epNum = parseInt(num[0], 10);
        if (!episodes.find(e => e.number === epNum)) {
          episodes.push({ number: epNum, url: href, title: text });
        }
      }
    }

    episodes.sort((a, b) => a.number - b.number);

    return {
      url: primaryUrl,
      episodes,
      mergedFromSites: [source]
    };
  } catch (e) {
    return { url: primaryUrl, episodes: [], mergedFromSites: [] };
  }
}

module.exports = {
  searchAllSites,
  fetchAndMergeCompleteSeries,
  SITE_CONFIGS
};
