const express = require('express');
const axios = require('axios');
const { execFile } = require('child_process');
const arabicResolver = require('../arabicMediaResolver');
const { ensureYtDlp } = require('../utils/ytDlp');

const router = express.Router();

// Helper exported function to handle WeFeed TV Series info lookup
async function handleWeFeedSeriesInfo(req, res, id, pathVal, title, token) {
  try {
    console.log(`Fetching WeFeed TV details for: ${title} (${pathVal})`);
    const detailRes = await axios.get(`https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(pathVal)}`, {
      headers: {
        'Accept': 'application/json',
        'X-Source': 'downloader',
        'X-Site-Domain': 'videodownloader.site',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const seasonsData = detailRes.data?.data?.resource?.seasons || [];
    const episodes = [];
    
    for (const season of seasonsData) {
      const seNum = season.se;
      const maxEp = season.maxEp || 0;
      for (let epNum = 1; epNum <= maxEp; epNum++) {
        episodes.push({
          text: `Season ${seNum} Episode ${epNum}`,
          link: `https://wefeed.site/download?id=${id}&se=${seNum}&ep=${epNum}&path=${pathVal}&title=${encodeURIComponent(title)}`
        });
      }
    }
    
    return res.json({ type: 'series', episodes });
  } catch (err) {
    console.error('WeFeed TV details fetch failed:', err.message);
    return res.status(500).json({ error: `Series details resolution failed: ${err.message}` });
  }
}

// Unified Search across TopCinema, WeCima, ArabSeed, Movizland, QFilm, Prestige
router.post('/api/arabic/search', async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const results = await arabicResolver.searchAllSites(query.trim());
    return res.json({ results });
  } catch (err) {
    console.error('Arabic sites search error:', err.message);
    return res.status(500).json({ error: 'Failed to search Arabic media sites' });
  }
});

// Resolve page details & fallback episodes
router.post('/api/arabic/resolve', async (req, res) => {
  const { url, title, source } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Target URL is required' });
  }

  try {
    const details = await arabicResolver.resolvePageDetails(url);
    
    // If it's a series, run the multi-source fallback episode merger
    if (details.type === 'series' && details.episodes.length > 0) {
      const mergedEpisodes = await arabicResolver.fetchAndMergeCompleteSeries(
        title || 'Series',
        details.episodes,
        source || 'Primary Source'
      );
      return res.json({ type: 'series', episodes: mergedEpisodes, downloads: details.downloads });
    }

    return res.json(details);
  } catch (err) {
    console.error('Arabic page resolution error:', err.message);
    return res.status(500).json({ error: 'Failed to resolve item details' });
  }
});

// Extract direct video URL from Arabic episode page using yt-dlp
router.post('/api/arabic/extract', async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const ytDlpBinary = await ensureYtDlp();

    const args = [
      '--no-warnings',
      '--no-cache-dir',
      '-J',
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url
    ];

    console.log(`Extracting Arabic video URL with yt-dlp: ${url}`);

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 20, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp Arabic extract failed:', error.message);
        return res.status(500).json({ error: 'Could not extract video URL', detail: error.message });
      }

      try {
        const data = JSON.parse(stdout);
        const formats = (data.formats || []).filter(f => f.url && (f.vcodec !== 'none' || f.ext === 'mp4'));

        const seen = new Set();
        const downloads = [];

        const best = formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none').sort((a, b) => (b.height || 0) - (a.height || 0));
        for (const f of best) {
          const label = f.height ? `${f.height}p` : (f.format_note || f.format_id || 'HD');
          if (seen.has(label)) continue;
          seen.add(label);
          downloads.push({
            quality: label,
            url: f.url,
            host: new URL(f.url).hostname,
            size: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB` : '—'
          });
          if (downloads.length >= 5) break;
        }

        if (downloads.length === 0 && data.url) {
          downloads.push({
            quality: 'Best Quality',
            url: data.url,
            host: new URL(data.url).hostname,
            size: '—'
          });
        }

        return res.json({ downloads, title: data.title || title });
      } catch (parseErr) {
        return res.status(500).json({ error: 'Failed to parse yt-dlp output' });
      }
    });
  } catch (err) {
    console.error('Arabic extract error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  handleWeFeedSeriesInfo
};
