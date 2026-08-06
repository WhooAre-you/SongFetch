const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const nodeID3 = require('node-id3');
const ffmpegPath = require('ffmpeg-static');
const { resolveYouTubePlaylist, resolveSoundCloudPlaylist } = require('../playlistResolvers');
const { ensureYtDlp, ytDlpPath, tempDir, formatSize } = require('../utils/ytDlp');

const router = express.Router();

// Helper: Query iTunes Search API
async function searchiTunes(term) {
  try {
    console.log(`Searching iTunes API for: "${term}"`);
    const response = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: term,
        media: 'music',
        entity: 'song',
        limit: 1
      }
    });
    if (response.data && response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      let artwork = track.artworkUrl100;
      if (artwork) {
        artwork = artwork.replace('100x100bb', '600x600bb').replace('100x100', '600x600');
      }
      return {
        title: track.trackName,
        artist: track.artistName,
        album: track.collectionName,
        artwork: artwork,
        releaseDate: track.releaseDate
      };
    }
  } catch (error) {
    console.error('iTunes API search failed:', error.message);
  }
  return null;
}

// Helper: Search iTunes API for multiple matches
async function searchiTunesMultiple(term, limit = 10) {
  try {
    console.log(`Searching iTunes API for multiple matches: "${term}"`);
    const response = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: term,
        media: 'music',
        entity: 'song',
        limit: limit
      }
    });
    if (response.data && response.data.results && response.data.results.length > 0) {
      return response.data.results.map(track => {
        let artwork = track.artworkUrl100;
        if (artwork) {
          artwork = artwork.replace('100x100bb', '600x600bb').replace('100x100', '600x600');
        }
        return {
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName || 'Single',
          artwork: artwork,
          youtubeUrl: '' // resolved when selected
        };
      });
    }
  } catch (error) {
    console.error('iTunes API multiple search failed:', error.message);
  }
  return [];
}

// Helper: Query iTunes Lookup API
async function lookupiTunesId(id) {
  try {
    console.log(`Looking up iTunes track ID: ${id}`);
    const response = await axios.get('https://itunes.apple.com/lookup', {
      params: { id }
    });
    if (response.data && response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      let artwork = track.artworkUrl100;
      if (artwork) {
        artwork = artwork.replace('100x100bb', '600x600bb').replace('100x100', '600x600');
      }
      return {
        title: track.trackName || track.collectionName,
        artist: track.artistName,
        album: track.collectionName || 'Single',
        artwork: artwork,
        releaseDate: track.releaseDate
      };
    }
  } catch (error) {
    console.error('iTunes ID lookup failed:', error.message);
  }
  return null;
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
      
    if (title && artist) {
      const cleanMeta = await searchiTunes(`${artist} ${title}`);
      if (cleanMeta) return cleanMeta;
    }

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

    const cleanMeta = await searchiTunes(cleanTitle);
    if (cleanMeta) {
      return {
        ...cleanMeta,
        youtubeUrl: url
      };
    }

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
    
    if (title && artist) {
      const cleanMeta = await searchiTunes(`${artist} ${title}`);
      if (cleanMeta) {
        return {
          ...cleanMeta,
          youtubeUrl: url
        };
      }
    }
    
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

// Scrape Lyrics from Genius.com
async function scrapeGeniusLyrics(title, artist) {
  const query = `${artist} ${title}`;
  console.log(`Searching Genius lyrics for query: "${query}"`);
  const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const sections = response.data.response.sections;
    const songSection = sections.find(s => s.type === 'song');
    if (!songSection || !songSection.hits || songSection.hits.length === 0) {
      console.log('No Genius song matches found.');
      return 'Lyrics not found.';
    }

    let targetHit = songSection.hits.find(hit => {
      const hitTitle = (hit.result.title || '').toLowerCase();
      const hitArtist = (hit.result.primary_artist ? hit.result.primary_artist.name : '').toLowerCase();
      const hitUrl = (hit.result.url || '').toLowerCase();
      
      const isTranslation = hitTitle.includes('translation') || 
                            hitTitle.includes('translated') || 
                            hitArtist.includes('translation') || 
                            hitArtist.includes('translator') ||
                            hitUrl.includes('translation') ||
                            hitUrl.includes('translated');
      return !isTranslation;
    });

    if (!targetHit) {
      targetHit = songSection.hits[0];
    }

    const songUrl = targetHit.result.url;
    console.log(`Fetching Genius lyrics from page: ${songUrl}`);

    const pageResponse = await axios.get(songUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(pageResponse.data);
    const containers = $('div[data-lyrics-container="true"]');

    if (containers.length === 0) {
      const oldLyrics = $('.lyrics');
      if (oldLyrics.length > 0) {
        oldLyrics.find('br').replaceWith('\n');
        return oldLyrics.text().trim();
      }
      return 'Lyrics container not found on Genius.';
    }

    let lyrics = '';
    containers.each((i, el) => {
      const $el = $(el).clone();
      $el.find('[data-exclude-from-selection="true"]').remove();
      $el.find('br').replaceWith('\n');
      lyrics += $el.text().trim() + '\n\n';
    });

    return lyrics.trim();
  } catch (error) {
    console.error('Genius lyrics scraper failed:', error.message);
    return 'Lyrics failed to download.';
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

// Route: Search / Resolve Link
router.post('/api/search', async (req, res) => {
  const { queryOrUrl, resolveDirect } = req.body;
  if (!queryOrUrl) {
    return res.status(400).json({ error: 'Search query or URL is required' });
  }

  try {
    let metadata = null;
    let isUrl = false;

    if (queryOrUrl.startsWith('http://') || queryOrUrl.startsWith('https://')) {
      isUrl = true;
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
        metadata = await searchiTunes(queryOrUrl);
        
        if (!metadata) {
          console.log(`Query "${queryOrUrl}" not found on iTunes for direct lookup. Trying YouTube search fallback...`);
          try {
            const args = [
              '--js-runtimes', 'node',
              '--impersonate', 'chrome',
              '--no-cache-dir',
              '-J',
              `ytsearch1:${queryOrUrl}`
            ];
            const ytDlpBinary = await ensureYtDlp();
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve(stdout);
              });
            });
            const data = JSON.parse(jsonStr);
            const video = data.entries && data.entries.length > 0 ? data.entries[0] : null;
            
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
              metadata = {
                title,
                artist,
                album: 'YouTube Search Fallback',
                artwork,
                youtubeUrl: video.webpage_url || `https://www.youtube.com/watch?v=${video.id}`
              };
            }
          } catch (ytError) {
            console.error('YouTube search direct fallback error:', ytError.message);
          }
        }

        if (!metadata) {
          console.log(`Query "${queryOrUrl}" not found on YouTube for direct lookup. Trying SoundCloud search fallback...`);
          try {
            const args = [
              '--no-cache-dir',
              '-J',
              `scsearch1:${queryOrUrl}`
            ];
            const ytDlpBinary = await ensureYtDlp();
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve(stdout);
              });
            });
            const data = JSON.parse(jsonStr);
            const video = data.entries && data.entries.length > 0 ? data.entries[0] : null;
            
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
              metadata = {
                title,
                artist,
                album: 'SoundCloud Search Fallback',
                artwork,
                youtubeUrl: video.webpage_url || video.url
              };
            }
          } catch (scError) {
            console.error('SoundCloud search direct fallback error:', scError.message);
          }
        }

        if (!metadata) {
          return res.status(404).json({ error: 'No songs found matching your search.' });
        }
      } else {
        let options = await searchiTunesMultiple(queryOrUrl, 10);
        
        if (!options || options.length === 0) {
          console.log(`Query "${queryOrUrl}" not found on iTunes. Trying YouTube search fallback...`);
          try {
            const args = [
              '--js-runtimes', 'node',
              '--impersonate', 'chrome',
              '--no-cache-dir',
              '-J',
              `ytsearch8:${queryOrUrl}`
            ];
            const ytDlpBinary = await ensureYtDlp();
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve(stdout);
              });
            });
            const data = JSON.parse(jsonStr);
            options = extractEntriesFromYtDlp(data, 'YouTube Search Fallback');
          } catch (ytError) {
            console.error('YouTube search fallback error:', ytError.message);
          }
        }

        if (!options || options.length === 0) {
          console.log(`Query "${queryOrUrl}" not found on YouTube. Trying SoundCloud search fallback...`);
          try {
            const args = [
              '--no-cache-dir',
              '-J',
              `scsearch8:${queryOrUrl}`
            ];
            const ytDlpBinary = await ensureYtDlp();
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve(stdout);
              });
            });
            const data = JSON.parse(jsonStr);
            options = extractEntriesFromYtDlp(data, 'SoundCloud Search Fallback');
          } catch (scError) {
            console.error('SoundCloud search fallback error:', scError.message);
          }
        }

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

    if (!metadata.isPlaylist) {
      const lyrics = await scrapeGeniusLyrics(metadata.title, metadata.artist);
      metadata.lyrics = lyrics;
    }

    res.json(metadata);
  } catch (error) {
    console.error('API Search route error:', error.message);
    res.status(500).json({ error: error.message || 'An error occurred during search' });
  }
});

// Route: Download & Embed Metadata
router.post('/api/download', async (req, res) => {
  const { title, artist, album, artwork, lyrics, youtubeUrl } = req.body;

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
    
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', ffmpegDir,
      '-o', path.join(tempDir, `${tempId}.%(ext)s`),
      downloadUrl
    ];

    execFile(ytDlpBinary, args, async (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp execution error:', error.message);
        console.error('yt-dlp stderr:', stderr);
        return res.status(500).json({ error: `Audio download and conversion failed. Detail: ${error.message}. Stderr: ${stderr}` });
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

      console.log('Embedding ID3 tags (Title, Artist, Album, Lyrics, Cover art) into MP3...');
      const tags = {
        title: title,
        artist: artist,
        album: album || '',
        unsynchronisedLyrics: lyrics ? {
          language: 'eng',
          text: lyrics
        } : undefined,
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

      const success = nodeID3.write(tags, finalMp3Path);
      if (!success) {
        console.warn('Warning: Failed to write ID3 tags to the MP3 file.');
      } else {
        console.log('ID3 tags embedded successfully.');
      }

      const safeFilename = `${artist} - ${title}.mp3`.replace(/[\\/:*?"<>|]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      const fileStream = fs.createReadStream(finalMp3Path);
      fileStream.pipe(res);

      fileStream.on('end', () => {
        fs.unlink(finalMp3Path, (err) => {
          if (err) console.error('Failed to delete temporary file:', err.message);
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
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-J',
      '--no-playlist',
      downloadUrl
    ];

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

    const ytdlpArgs = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-f', 'bestaudio',
      '-o', '-',
      streamUrl
    ];

    const ytdlpProc = spawn(ytDlpBinary, ytdlpArgs);

    const ffmpegArgs = [
      '-i', 'pipe:0',
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-f', 'mp3',
      'pipe:1'
    ];

    const ffmpegProc = spawn(ffmpegPath, ffmpegArgs);

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
