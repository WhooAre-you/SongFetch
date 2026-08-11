const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const nodeID3 = require('node-id3');
const ffmpegPath = require('ffmpeg-static');
const { resolveYouTubePlaylist, resolveSoundCloudPlaylist } = require('../playlistResolvers');
const { ensureYtDlp, getYtDlpArgs, ytDlpPath, tempDir, formatSize } = require('../utils/ytDlp');

const router = express.Router();


// Number word mappings (Arabic <-> Digits)
const numberWordsMap = [
  { words: ['واحد و عشرين', 'واحد وعشرين', 'واحد و20', '21'], num: '21' },
  { words: ['اثنان و عشرين', 'اثنين و عشرين', 'اثنين وعشرين', '22'], num: '22' },
  { words: ['ثلاثة و عشرين', 'ثلاثه و عشرين', 'ثلاثه وعشرين', '23'], num: '23' },
  { words: ['واحد', 'واحده'], num: '1' },
  { words: ['اثنين', 'اثنان'], num: '2' },
  { words: ['ثلاثة', 'ثلاثه'], num: '3' },
  { words: ['اربعة', 'اربع'], num: '4' },
  { words: ['خمسة', 'خمسه'], num: '5' },
  { words: ['ستة', 'سته'], num: '6' },
  { words: ['سبعة', 'سبعه'], num: '7' },
  { words: ['ثمانية', 'ثمانيه'], num: '8' },
  { words: ['تسعة', 'تسعه'], num: '9' },
  { words: ['عشرة', 'عشره'], num: '10' }
];

// Transliterate Franco-Arabic and normalize Arabic letters/numbers
function generateQueryVariants(query) {
  if (!query) return [];
  const variants = [query];

  // 1. Swap ه and ة for Arabic words
  const hToT = query.replace(/ه\b/g, 'ة');
  if (hToT !== query && !variants.includes(hToT)) variants.push(hToT);
  const tToH = query.replace(/ة\b/g, 'ه');
  if (tToH !== query && !variants.includes(tToH)) variants.push(tToH);

  // 2. Arabic letter normalization (أ/إ/آ -> ا, ى -> ي)
  const normArabic = query
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .trim();
  if (normArabic !== query && !variants.includes(normArabic)) variants.push(normArabic);

  // 3. Convert written Arabic numbers to digits (e.g. واحد و عشرين -> 21)
  let numConverted = query;
  numberWordsMap.forEach(({ words, num }) => {
    words.forEach(word => {
      numConverted = numConverted.replace(new RegExp(word, 'gi'), num);
    });
  });
  if (numConverted !== query && !variants.includes(numConverted)) variants.push(numConverted);

  // 4. Franco-Arabic to Arabic transliteration mapping
  let francoConverted = query
    .replace(/(\w*)3(\w*)/gi, '$1ع$2')
    .replace(/(\w*)7(\w*)/gi, '$1ح$2')
    .replace(/(\w*)5(\w*)/gi, '$1خ$2')
    .replace(/(\w*)2(\w*)/gi, '$1ء$2')
    .replace(/(\w*)8(\w*)/gi, '$1غ$2')
    .replace(/(\w*)9(\w*)/gi, '$1ص$2')
    .replace(/\bel\b/gi, 'ال')
    .replace(/\bal\b/gi, 'ال')
    .replace(/\bblil\b/gi, 'بليل')
    .replace(/\bhelw\b/gi, 'حلوة')
    .replace(/\bhelwa\b/gi, 'حلوة')
    .replace(/\bnhayt\b/gi, 'نهاية')
    .replace(/\bnehayt\b/gi, 'نهاية')
    .replace(/\b3alam\b/gi, 'العالم')
    .replace(/\balam\b/gi, 'العالم')
    .replace(/\bnesena\b/gi, 'نسينا')
    .replace(/\bnisina\b/gi, 'نسينا')
    .replace(/\bwegz\b/gi, 'ويجز');

  if (francoConverted !== query && !variants.includes(francoConverted)) {
    variants.push(francoConverted);
    const normFranco = generateQueryVariants(francoConverted);
    normFranco.forEach(v => {
      if (!variants.includes(v)) variants.push(v);
    });
  }

  return variants;
}



// Resolver: Spotify Link
async function resolveSpotifyTrack(url) {
  try {
    console.log(`Resolving Spotify URL: ${url}`);
    const match = url.match(/\/track\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Invalid Spotify track URL');
    }
    const trackId = match[1];
    const embedUrl = `https://open.spotify.com/embed/track/${trackId}`;
    
    const { data } = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(data);
    const nextDataText = $('#__NEXT_DATA__').text();
    if (!nextDataText) {
      throw new Error('Failed to find __NEXT_DATA__ tag in Spotify embed');
    }
    
    const json = JSON.parse(nextDataText);
    const entity = json.props.pageProps.state.data.entity;
    const title = entity.title || entity.name;
    const artist = entity.artists.map(a => a.name).join(', ');
    const coverArt = entity.visualIdentity.image && entity.visualIdentity.image[0] 
      ? entity.visualIdentity.image[0].url 
      : '';
      
    return {
      title: title || 'Spotify Song',
      artist: artist || 'Unknown Artist',
      album: 'Spotify Single',
      artwork: coverArt
    };
  } catch (error) {
    console.error('Spotify resolver error:', error.message);
    throw new Error('Failed to resolve Spotify track metadata');
  }
}

// Resolver: YouTube Link
async function resolveYouTubeTrack(url) {
  try {
    console.log(`Resolving YouTube URL: ${url}`);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await axios.get(oembedUrl);
    const videoTitle = response.data.title;
    const author = response.data.author_name;

    let cleanTitle = videoTitle
      .replace(/\[Official.*?\]/gi, '')
      .replace(/\(Official.*?\)/gi, '')
      .replace(/\[Lyrics.*?\]/gi, '')
      .replace(/\(Lyrics.*?\)/gi, '')
      .replace(/\[Lyrical.*?\]/gi, '')
      .replace(/\(Lyrical.*?\)/gi, '')
      .replace(/Official Music Video/gi, '')
      .replace(/Music Video/gi, '')
      .replace(/Official Audio/gi, '')
      .replace(/Audio/gi, '')
      .replace(/\(HD\)/gi, '')
      .replace(/\(4K\)/gi, '')
      .replace(/\(1080p\)/gi, '')
      .replace(/ft\./gi, '')
      .replace(/feat\./gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    let title = cleanTitle;
    let artist = author.replace('- Topic', '').trim();
    if (cleanTitle.includes(' - ')) {
      const parts = cleanTitle.split(' - ');
      artist = parts[0].trim();
      title = parts[1].trim();
    }

    return {
      title,
      artist,
      album: 'YouTube Single',
      artwork: response.data.thumbnail_url || '',
      youtubeUrl: url
    };
  } catch (error) {
    console.error('YouTube resolver error:', error.message);
    throw new Error('Failed to resolve YouTube track metadata');
  }
}

// Resolver: SoundCloud Link
async function resolveSoundCloudTrack(url) {
  try {
    console.log(`Resolving SoundCloud URL: ${url}`);
    const oembedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const response = await axios.get(oembedUrl);
    const data = response.data;
    
    const artist = data.author_name || 'Unknown Artist';
    let title = data.title || 'SoundCloud Song';
    
    if (artist && title.toLowerCase().endsWith(` by ${artist.toLowerCase()}`)) {
      title = title.substring(0, title.length - (artist.length + 4)).trim();
    }
    
    const artwork = data.thumbnail_url || '';
    
    return {
      title,
      artist,
      album: 'SoundCloud Single',
      artwork,
      youtubeUrl: url
    };
  } catch (error) {
    console.error('SoundCloud resolver error:', error.message);
    throw new Error('Failed to resolve SoundCloud track metadata');
  }
}

// Helper: Extract multiple entry results from yt-dlp JSON search response
function extractEntriesFromYtDlp(data, albumLabel) {
  const options = [];
  if (data && data.entries && data.entries.length > 0) {
    data.entries.forEach(video => {
      if (video && video.title) {
        let title = video.title;
        let artist = video.uploader || 'Unknown Artist';
        if (title.includes(' - ')) {
          const parts = title.split(' - ');
          artist = parts[0].trim();
          title = parts[1].trim();
        }
        
        let artwork = '';
        if (video.thumbnails && video.thumbnails.length > 0) {
          artwork = video.thumbnails[video.thumbnails.length - 1].url;
        } else if (video.thumbnail) {
          artwork = video.thumbnail;
        }

        options.push({
          title,
          artist,
          album: albumLabel,
          artwork,
          youtubeUrl: video.webpage_url || video.url || `https://www.youtube.com/watch?v=${video.id}`
        });
      }
    });
  }
  return options;
}

// Helper: Search YouTube & SoundCloud via fast primary query execution
async function searchMediaOptions(query, limit = 8) {
  const queryVariants = generateQueryVariants(query);
  const primaryQuery = queryVariants[0] || query;

  // 1. Try primary query on YouTube immediately (Fast Path)
  console.log(`Searching YouTube for: "${primaryQuery}"`);
  try {
    const args = getYtDlpArgs([
      '--flat-playlist',
      '-J',
      `ytsearch${limit}:${primaryQuery}`
    ]);
    const ytDlpBinary = await ensureYtDlp();
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
    const data = JSON.parse(jsonStr);
    const options = extractEntriesFromYtDlp(data, 'YouTube Search Result');
    if (options && options.length > 0) {
      return options;
    }
  } catch (err) {
    console.error('Primary YouTube search error:', primaryQuery, err.message);
  }

  // 2. If primary query returned no results, try first transliterated variant
  const secondaryQuery = queryVariants.find(v => v !== primaryQuery);
  if (secondaryQuery) {
    console.log(`Searching YouTube for secondary variant: "${secondaryQuery}"`);
    try {
      const args = getYtDlpArgs([
        '--flat-playlist',
        '-J',
        `ytsearch${limit}:${secondaryQuery}`
      ]);
      const ytDlpBinary = await ensureYtDlp();
      const jsonStr = await new Promise((resolve, reject) => {
        execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else resolve(stdout);
        });
      });
      const data = JSON.parse(jsonStr);
      const options = extractEntriesFromYtDlp(data, 'YouTube Search Result');
      if (options && options.length > 0) {
        return options;
      }
    } catch (err) {
      console.error('Secondary YouTube search error:', secondaryQuery, err.message);
    }
  }

  // 3. Fallback to SoundCloud search
  console.log(`Searching SoundCloud for: "${primaryQuery}"`);
  try {
    const args = [
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      `scsearch${limit}:${primaryQuery}`
    ];
    const ytDlpBinary = await ensureYtDlp();
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
    const data = JSON.parse(jsonStr);
    const options = extractEntriesFromYtDlp(data, 'SoundCloud Search Result');
    if (options && options.length > 0) {
      return options;
    }
  } catch (err) {
    console.error('SoundCloud search error:', primaryQuery, err.message);
  }

  return [];
}

// Route: Search / Resolve Link
router.post('/api/search', async (req, res) => {
  const { queryOrUrl, resolveDirect } = req.body;
  if (!queryOrUrl) {
    return res.status(400).json({ error: 'Search query or URL is required' });
  }

  try {
    let metadata = null;

    if (queryOrUrl.startsWith('http://') || queryOrUrl.startsWith('https://')) {
      if (queryOrUrl.includes('spotify.com')) {
        if (queryOrUrl.includes('/playlist/')) {
          return res.status(400).json({ error: 'Spotify playlists are not supported. Please paste individual Spotify track links, or search by song name.' });
        }
        metadata = await resolveSpotifyTrack(queryOrUrl);
      } else if (queryOrUrl.includes('youtube.com') || queryOrUrl.includes('youtu.be')) {
        if (queryOrUrl.includes('list=') && (queryOrUrl.includes('/playlist') || queryOrUrl.includes('videoseries'))) {
          metadata = await resolveYouTubePlaylist(queryOrUrl);
        } else {
          metadata = await resolveYouTubeTrack(queryOrUrl);
        }
      } else if (queryOrUrl.includes('soundcloud.com')) {
        if (queryOrUrl.includes('/sets/')) {
          metadata = await resolveSoundCloudPlaylist(queryOrUrl);
        } else {
          metadata = await resolveSoundCloudTrack(queryOrUrl);
        }
      } else {
        return res.status(400).json({ error: 'Unsupported URL platform. Use Spotify, YouTube, or SoundCloud.' });
      }
    } else {
      if (resolveDirect) {
        const options = await searchMediaOptions(queryOrUrl, 1);
        if (options && options.length > 0) {
          metadata = options[0];
        }
      } else {
        const options = await searchMediaOptions(queryOrUrl, 8);
        if (!options || options.length === 0) {
          return res.status(404).json({ error: 'No songs found matching your search.' });
        }
        return res.json({
          isOptionsList: true,
          options: options
        });
      }
    }

    if (!metadata) {
      return res.status(404).json({ error: 'Failed to extract song metadata.' });
    }

    res.json(metadata);
  } catch (error) {
    console.error('API Search route error:', error.message);
    res.status(500).json({ error: error.message || 'An error occurred during search' });
  }
});

// Helper to execute audio download via yt-dlp with fallback
async function executeAudioDownload(ytDlpBinary, ffmpegDir, tempId, targetUrl) {
  const finalMp3Path = path.join(tempDir, `${tempId}.mp3`);
  const args = getYtDlpArgs([
    '-f', 'ba/b',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--ffmpeg-location', ffmpegDir,
    '-o', path.join(tempDir, `${tempId}.%(ext)s`),
    targetUrl
  ]);

  return new Promise((resolve, reject) => {
    execFile(ytDlpBinary, args, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
      } else {
        resolve(finalMp3Path);
      }
    });
  });
}

// Route: Download & Embed Metadata
router.post('/api/download', async (req, res) => {
  const { title, artist, album, artwork, youtubeUrl } = req.body;

  if (!title || !artist) {
    return res.status(400).json({ error: 'Title and artist are required' });
  }

  const tempId = `song_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const finalMp3Path = path.join(tempDir, `${tempId}.mp3`);
  
  let downloadUrl = youtubeUrl;
  if (!downloadUrl) {
    downloadUrl = `ytsearch1:${artist} - ${title} (Official Audio)`;
  }

  try {
    const ytDlpBinary = await ensureYtDlp();
    const ffmpegDir = path.dirname(ffmpegPath);

    console.log(`Starting audio download using yt-dlp for: ${downloadUrl}`);
    let downloadedPath = null;

    try {
      downloadedPath = await executeAudioDownload(ytDlpBinary, ffmpegDir, tempId, downloadUrl);
    } catch (primaryErr) {
      console.warn('Primary download failed, trying SoundCloud fallback...', primaryErr.stderr || primaryErr.error.message);
      const scFallbackUrl = `scsearch1:${artist} ${title}`;
      try {
        downloadedPath = await executeAudioDownload(ytDlpBinary, ffmpegDir, tempId, scFallbackUrl);
      } catch (scErr) {
        throw new Error(`Audio download failed: ${primaryErr.stderr || primaryErr.error.message}`);
      }
    }

    console.log('yt-dlp finished download and mp3 conversion.');

    if (!fs.existsSync(finalMp3Path)) {
      console.error(`Expected MP3 file not found at: ${finalMp3Path}`);
      return res.status(500).json({ error: 'Converted MP3 file was not generated.' });
    }

    let coverBuffer = null;
    if (artwork) {
      try {
        console.log(`Downloading cover artwork: ${artwork}`);
        const imageResponse = await axios.get(artwork, { responseType: 'arraybuffer' });
        coverBuffer = Buffer.from(imageResponse.data);
      } catch (imgError) {
        console.warn('Failed to download cover art image:', imgError.message);
      }
    }

    console.log('Embedding ID3 tags (Title, Artist, Album, Cover art) into MP3...');
    const tags = {
      title: title,
      artist: artist,
      album: album || '',
      image: coverBuffer ? {
        mime: 'image/jpeg',
        type: {
          id: 3,
          name: 'front cover'
        },
        description: 'Cover Art',
        imageBuffer: coverBuffer
      } : undefined
    };

    nodeID3.write(tags, finalMp3Path, (tagError) => {
      if (tagError) {
        console.warn('Failed to embed ID3 tags:', tagError);
      } else {
        console.log('ID3 tags embedded successfully.');
      }

      const safeFilename = `${artist} - ${title}.mp3`.replace(/[\\/:*?"<>|]/g, '_');
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);

      const fileStream = fs.createReadStream(finalMp3Path);
      fileStream.pipe(res);

      fileStream.on('end', () => {
        fs.unlink(finalMp3Path, (unlinkErr) => {
          if (unlinkErr) console.error('Failed to delete temp file:', unlinkErr);
          else console.log(`Temporary file cleaned up: ${finalMp3Path}`);
        });
      });

      fileStream.on('error', (err) => {
        console.error('File stream error:', err.message);
        fs.unlink(finalMp3Path, () => {});
      });
    });

  } catch (err) {
    console.error('Backend download route failed:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred during downloading' });
    if (fs.existsSync(finalMp3Path)) {
      fs.unlink(finalMp3Path, () => {});
    }
  }
});

// Route: Fetch estimated MP3 size
router.post('/api/songfetch/size', async (req, res) => {
  const { title, artist, youtubeUrl } = req.body;
  
  let downloadUrl = youtubeUrl;
  if (!downloadUrl) {
    if (!title || !artist) {
      return res.json({ size: 'Unknown size' });
    }
    downloadUrl = `ytsearch1:${artist} - ${title} (Official Audio)`;
  }

  try {
    const ytDlpBinary = await ensureYtDlp();
    const args = getYtDlpArgs([
      '-J',
      '--no-playlist',
      downloadUrl
    ]);

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to get song size:', error.message);
        return res.json({ size: 'Unknown size' });
      }

      try {
        const data = JSON.parse(stdout);
        let size = 0;
        let entries = data.entries ? data.entries[0] : data;
        
        if (entries && entries.formats) {
          const audioFormats = entries.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
          if (audioFormats.length > 0) {
            audioFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
            size = audioFormats[0].filesize || audioFormats[0].filesize_approx || 0;
          } else {
            size = entries.filesize || entries.filesize_approx || 0;
          }
        }

        res.json({ size: formatSize(size) });
      } catch (parseErr) {
        res.json({ size: 'Unknown size' });
      }
    });
  } catch (err) {
    res.json({ size: 'Unknown size' });
  }
});

// Route: Stream audio on the fly
router.get('/api/songfetch/stream', async (req, res) => {
  const { url, title, artist } = req.query;

  let streamUrl = url;
  if (!streamUrl && title && artist) {
    streamUrl = `ytsearch1:${artist} - ${title} (Official Audio)`;
  }

  if (!streamUrl) {
    return res.status(400).json({ error: 'URL or title/artist is required' });
  }

  try {
    const ytDlpBinary = await ensureYtDlp();
    
    // Set response headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    console.log(`Starting audio stream using yt-dlp to stdout for: ${streamUrl}`);

    const ytdlpArgs = getYtDlpArgs([
      '-f', 'bestaudio',
      '-o', '-',
      streamUrl
    ]);

    const ytdlpProc = spawn(ytDlpBinary, ytdlpArgs);

    const ffmpegProc = spawn(ffmpegPath, [
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-f', 'mp3',
      'pipe:1'
    ]);

    // Pipe ytdlp output to ffmpeg input
    ytdlpProc.stdout.pipe(ffmpegProc.stdin);

    // Pipe ffmpeg output to express response
    ffmpegProc.stdout.pipe(res);

    // Error handling
    ytdlpProc.on('error', (err) => {
      console.error('ytdlp streaming error:', err.message);
    });

    ffmpegProc.on('error', (err) => {
      console.error('ffmpeg streaming error:', err.message);
    });

    // Cleanup when request is closed
    req.on('close', () => {
      console.log('Streaming connection closed by client, killing processes...');
      try { ytdlpProc.kill(); } catch (e) {}
      try { ffmpegProc.kill(); } catch (e) {}
    });

  } catch (error) {
    console.error('Stream setup failed:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initialize audio stream.' });
    }
  }
});

module.exports = router;
