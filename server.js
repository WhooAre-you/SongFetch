const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const nodeID3 = require('node-id3');
const ffmpegPath = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { resolveYouTubePlaylist, resolveSoundCloudPlaylist } = require('./playlistResolvers');
const arabicResolver = require('./arabicMediaResolver');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS, JSON and URL-encoded form parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Set up directories
const binDir = path.join(__dirname, 'bin');
const tempDir = path.join(__dirname, 'temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// OS-specific yt-dlp setup
const isWindows = process.platform === 'win32';
const ytDlpFileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpPath = path.join(binDir, ytDlpFileName);

// Download yt-dlp dynamically if not present
async function ensureYtDlp() {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  if (fs.existsSync(ytDlpPath)) {
    console.log(`yt-dlp binary verified at: ${ytDlpPath}`);
    return ytDlpPath;
  }
  
  console.log('yt-dlp not found. Downloading latest binary...');
  let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  if (isWindows) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (process.platform === 'linux') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  } else if (process.platform === 'darwin') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(ytDlpPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        if (!isWindows) {
          fs.chmodSync(ytDlpPath, 0o755);
        }
        console.log(`yt-dlp downloaded and saved to: ${ytDlpPath}`);
        resolve(ytDlpPath);
      });
      writer.on('error', (err) => {
        console.error('Error writing yt-dlp file:', err);
        reject(err);
      });
    });
  } catch (err) {
    console.error('Failed to download yt-dlp:', err.message);
    throw err;
  }
}

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
        // Upgrade image size from 100x100 to 600x600 for premium metadata
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
// Resolver: Spotify Link
async function resolveSpotifyTrack(url) {
  try {
    console.log(`Resolving Spotify URL: ${url}`);
    
    // Extract track ID from URL
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

    // Clean up title for search
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
    
    // Clean "by Artist Name" from title if present
    if (artist && title.toLowerCase().endsWith(` by ${artist.toLowerCase()}`)) {
      title = title.substring(0, title.length - (artist.length + 4)).trim();
    }
    
    const artwork = data.thumbnail_url || '';
    
    // Query iTunes search to clean it up and get album name
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

    // Filter out translation hits (e.g. "English Translation" pages) to return original lyrics
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

    // Fallback to first hit if all are translations
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
      // Fallback to older container class name
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
      // Remove elements marked to be excluded (contributors count, translation dropdowns, about description)
      $el.find('[data-exclude-from-selection="true"]').remove();
      
      // Replace <br> elements with newlines to avoid merged words
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
app.post('/api/search', async (req, res) => {
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
        // Playlists are not supported — treat every Spotify URL as a single track
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
        // Direct single-song lookup requested from search options list selection
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
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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
        // Return 5-10 options for selection list
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
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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
            const jsonStr = await new Promise((resolve, reject) => {
              execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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

    // Scrape lyrics for single tracks only
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
app.post('/api/download', async (req, res) => {
  const { title, artist, album, artwork, lyrics, youtubeUrl } = req.body;

  if (!title || !artist) {
    return res.status(400).json({ error: 'Title and artist are required' });
  }

  const tempId = `song_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const finalMp3Path = path.join(tempDir, `${tempId}.mp3`);
  
  let downloadUrl = youtubeUrl;
  if (!downloadUrl) {
    // Search query for yt-dlp to pick the first search result
    downloadUrl = `ytsearch1:${artist} - ${title} (Official Audio)`;
  }

  try {
    const ytDlpBinary = await ensureYtDlp();
    const ffmpegDir = path.dirname(ffmpegPath);

    console.log(`Starting audio download using yt-dlp for: ${downloadUrl}`);
    
    // Arguments: extract audio (-x), convert to mp3, point to local ffmpeg, specify output path, bypass security blocks
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Best VBR quality
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

      // Download Cover Art
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

      // Embed tags using node-id3
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

      // Stream the file back to client
      const safeFilename = `${artist} - ${title}.mp3`.replace(/[\\/:*?"<>|]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      const fileStream = fs.createReadStream(finalMp3Path);
      fileStream.pipe(res);

      fileStream.on('end', () => {
        // Delete the temporary MP3 file after transfer is complete
        fs.unlink(finalMp3Path, (err) => {
          if (err) console.error('Failed to delete temporary file:', err.message);
          else console.log(`Temporary file cleaned up: ${finalMp3Path}`);
        });
      });

      fileStream.on('error', (err) => {
        console.error('File stream error:', err.message);
        // Clean up on error
        fs.unlink(finalMp3Path, () => {});
      });
    });

  } catch (err) {
    console.error('Backend download route failed:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred during downloading' });
    // Clean up if file exists
    if (fs.existsSync(finalMp3Path)) {
      fs.unlink(finalMp3Path, () => {});
    }
  }
});

// ==========================================
// VIDEOFETCH DOWNLOADER MODULE
// ==========================================

// Helper: Format duration from seconds to MM:SS
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper: Format size in bytes to human readable string (KB, MB)
function formatSize(bytes) {
  if (!bytes) return 'Unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${mb.toFixed(1)} MB`;
}

// Route: Serve SongFetch HTML page
app.get('/songfetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'songfetch.html'));
});

// Route: Serve VideoFetch HTML page
app.get('/videofetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'videofetch.html'));
});

// Route: Serve MovieFetch HTML page
app.get('/moviefetch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moviefetch.html'));
});

// Helper: Download subtitle file directly from URL (direct SRT or ZIP archive)
async function downloadDirectSubtitle(url, outputSrtPath) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://videodownloader.site',
        'Referer': 'https://videodownloader.site/'
      }
    });
    
    // Check if the content is a ZIP file
    const isZip = url.includes('.zip') || response.headers['content-type']?.includes('zip');
    if (isZip) {
      const zip = new AdmZip(response.data);
      const zipEntries = zip.getEntries();
      for (const entry of zipEntries) {
        if (entry.entryName.endsWith('.srt')) {
          fs.writeFileSync(outputSrtPath, entry.getData());
          return true;
        }
      }
    } else {
      // Direct SRT download
      fs.writeFileSync(outputSrtPath, response.data);
      return true;
    }
  } catch (err) {
    console.error('Subtitle download failed:', err.message);
  }
  return false;
}


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
app.get('/api/movies/search', async (req, res) => {
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
      // Map domain prefix to movie vs series
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
app.post('/api/movies/imdb', async (req, res) => {
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
app.post('/api/movies/info', async (req, res) => {
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
    
    // Action 1: If it's a TV series root, fetch seasons and return episode list
    if (isSeries) {
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
    }
    
    // Action 2: If it's a Movie or an Episode Download, fetch quality options and subtitles
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
    
    // Filter only Arabic and English subtitles
    const subtitles = wefeedCaptions
      .filter(cap => cap.lan === 'ar' || cap.lan === 'en' || cap.lanName?.toLowerCase().includes('arabic') || cap.lanName?.toLowerCase().includes('english'))
      .map(cap => ({
        lan: cap.lan === 'ar' ? 'ar' : 'en',
        url: cap.url
      }));
      
    // Format download options
    const downloads = wefeedDownloads.map(dl => {
      // Human-readable size helper
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
      
      // Pack video URL and captions array into a JSON payload so /api/movies/download can unpack them
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

// Route: Direct Movie Stream GET Endpoint for instant native browser file downloads (0% RAM overhead, no 60% hang)
app.get('/api/movies/stream', async (req, res) => {
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

    let hosterOrigin = 'https://google.com';
    try {
      const u = new URL(actualVideoUrl);
      hosterOrigin = `${u.protocol}//${u.hostname}`;
    } catch (e) {}

    const checkRes = await fetch(actualVideoUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': hosterOrigin,
        'Accept': '*/*'
      }
    });

    const contentType = checkRes.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlRes = await fetch(actualVideoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': hosterOrigin,
          'Accept': '*/*'
        }
      });
      const text = await htmlRes.text();
      if (text.includes('copyright') || text.includes('removed') || text.includes('Notice !') || text.includes('404 Not Found')) {
        return res.status(400).send('هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر من القائمة.');
      }
    }

    const downloadResponse = await axios({
      url: actualVideoUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': hosterOrigin,
        'Accept': '*/*'
      }
    });

    const safeFilename = `${title || 'movie'}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    
    const upstreamContentType = downloadResponse.headers['content-type'] || contentType;
    if (upstreamContentType && upstreamContentType.includes('video/')) {
      res.setHeader('Content-Type', upstreamContentType);
    } else {
      res.setHeader('Content-Type', 'video/mp4');
    }

    const contentLength = downloadResponse.headers['content-length'];
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    res.on('close', () => {
      if (downloadResponse.data && typeof downloadResponse.data.destroy === 'function') {
        downloadResponse.data.destroy();
      }
    });

    downloadResponse.data.pipe(res);
  } catch (err) {
    console.error('Movie stream failed:', err.message);
    if (!res.headersSent) {
      res.status(500).send('تعذر تنزيل هذا السيرفر حالياً. يرجى اختيار سيرفر آخر من القائمة.');
    }
  }
});

// Route: MovieFetch download POST endpoint
app.post('/api/movies/download', async (req, res) => {
  const { downloadUrl, title } = req.body;
  if (!downloadUrl) {
    return res.status(400).json({ error: 'Download URL is required' });
  }

  console.log(`Download request received for: "${title}" => ${downloadUrl}`);
  
  try {
    let actualVideoUrl = downloadUrl;
    try {
      const parsed = JSON.parse(downloadUrl);
      if (parsed && parsed.videoUrl) actualVideoUrl = parsed.videoUrl;
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
          error: 'هذا السيرفر (BowFile) ملفه محذوف بسبب الحقوق أو غير متوفر حالياً. يرجى اختيار سيرفر آخر من الجدول أعلاه.'
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

    res.on('close', () => {
      if (downloadResponse.data && typeof downloadResponse.data.destroy === 'function') {
        downloadResponse.data.destroy();
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

// ====================================================
// Arabic Media Routes (TopCinema, WeCima, ArabSeed, Movizland, QFilm, Prestige)
// ====================================================

// Unified Search across TopCinema, WeCima, ArabSeed, Movizland, QFilm, Prestige
app.post('/api/arabic/search', async (req, res) => {
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
app.post('/api/arabic/resolve', async (req, res) => {
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

// Extract direct video URL from Arabic episode page using yt-dlp or direct fallback
app.post('/api/arabic/extract', async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const fallbackDirectDetails = async () => {
    try {
      const details = await arabicResolver.resolvePageDetails(url);
      if (details && details.downloads && details.downloads.length > 0) {
        return res.json({ downloads: details.downloads, title: details.title || title });
      }
    } catch (e) {}
    const directUrl = await arabicResolver.resolveDirectHosterMediaUrl(url);
    return res.json({
      downloads: [{
        quality: '1080p Full HD Direct Download',
        url: directUrl,
        host: 'Direct Server',
        size: 'Direct Stream'
      }],
      title
    });
  };

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

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 20, timeout: 15000 }, async (error, stdout, stderr) => {
      if (error) {
        console.warn('yt-dlp Arabic extract failed, falling back to direct scraper:', error.message);
        return await fallbackDirectDetails();
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

        if (downloads.length === 0) {
          return await fallbackDirectDetails();
        }

        return res.json({ downloads, title: data.title || title });
      } catch (parseErr) {
        return await fallbackDirectDetails();
      }
    });
  } catch (err) {
    console.error('Arabic extract error:', err.message);
    return await fallbackDirectDetails();
  }
});

// Route: OpenSubtitles Search
app.post('/api/subtitles/search', async (req, res) => {
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
          downloadLink: s.SubDownloadLink, // .gz link
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
app.post('/api/subtitles/download', async (req, res) => {
  const { downloadLink, fileName } = req.body;
  if (!downloadLink) return res.status(400).json({ error: 'Download link required' });
  
  try {
    const subRes = await fetch(downloadLink, {
      method: 'GET',
      headers: { 'User-Agent': 'TemporaryUserAgent' }
    });
    
    if (!subRes.ok) throw new Error('Failed to fetch from OpenSubtitles');
    
    // Decompress the .gz stream
    const zlib = require('zlib');
    const gunzip = zlib.createGunzip();
    
    const safeName = (fileName || 'subtitle.srt').replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // Send as plain text so it's a standard SRT
    
    // Pipe standard node streams: fetch body uses require('stream').Readable.fromWeb(subRes.body)
    const { Readable } = require('stream');
    Readable.fromWeb(subRes.body).pipe(gunzip).pipe(res);
  } catch (err) {
    console.error('Subtitle download failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download subtitle' });
  }
});




// Route: Fetch estimated MP3 size for SongFetch
app.post('/api/songfetch/size', async (req, res) => {
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

// Route: Fetch Video Info (metadata + available resolutions)
app.post('/api/videofetch/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let platform = 'unknown';
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    platform = 'youtube';
  } else if (urlLower.includes('instagram.com')) {
    platform = 'instagram';
  } else if (urlLower.includes('tiktok.com')) {
    platform = 'tiktok';
  }

  try {
    const ytDlpBinary = await ensureYtDlp();
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '-J',
      '--no-playlist',
      url
    ];

    console.log(`Fetching video metadata using yt-dlp for: ${url}`);
    
    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp metadata extraction failed:', error.message);
        // Fallback response for TikTok / Instagram if they are rate-limited or blocked
        if (platform === 'tiktok' || platform === 'instagram') {
          console.log(`Using fallback metadata for platform: ${platform}`);
          return res.json({
            title: `Video from ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
            thumbnail: '/favicon.svg',
            duration: 'Unknown',
            uploader: 'Uploader',
            platform: platform,
            formats: [{ height: 'best', size: 'Unknown size' }],
            audioSize: 'Unknown size',
            bestSize: 'Unknown size'
          });
        }
        return res.status(500).json({ error: `Failed to retrieve video metadata. Details: ${error.message}` });
      }

      try {
        const data = JSON.parse(stdout);
        
        // Find available resolutions for YouTube
        const uniqueHeights = new Set();
        if (data.formats) {
          data.formats.forEach(f => {
            if (f.height && f.vcodec !== 'none') {
              uniqueHeights.add(f.height);
            }
          });
        }
        
        // Filter standard heights
        const resolutions = Array.from(uniqueHeights)
          .filter(h => [144, 240, 360, 480, 720, 1080, 1440, 2160].includes(h))
          .sort((a, b) => b - a);

        // Find best audio size for YouTube estimates
        let bestAudioSize = 0;
        if (data.formats) {
          const audioFormats = data.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
          if (audioFormats.length > 0) {
            audioFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
            const bestAudio = audioFormats.find(f => f.filesize || f.filesize_approx) || audioFormats[0];
            bestAudioSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
            
            if (!bestAudioSize && bestAudio.tbr && data.duration) {
              bestAudioSize = Math.round((bestAudio.tbr * 1000 / 8) * data.duration);
            }
          }
        }

        // Map resolutions to include their size estimation (video + audio)
        const formatOptions = resolutions.map(h => {
          let videoSize = 0;
          if (data.formats) {
            const videoForHeight = data.formats
              .filter(f => f.height === h && f.vcodec !== 'none')
              .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
            if (videoForHeight.length > 0) {
              const chosenVideo = videoForHeight.find(f => f.filesize || f.filesize_approx) || videoForHeight[0];
              videoSize = chosenVideo.filesize || chosenVideo.filesize_approx || 0;
              
              if (!videoSize && chosenVideo.tbr && data.duration) {
                videoSize = Math.round((chosenVideo.tbr * 1000 / 8) * data.duration);
              }
            }
          }
          const totalSize = videoSize ? (videoSize + bestAudioSize) : 0;
          return {
            height: h,
            size: formatSize(totalSize)
          };
        });

        // Best combined size estimation for other platforms
        const bestFormat = data.formats ? data.formats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0] : null;
        const bestSize = data.filesize || data.filesize_approx || (bestFormat ? (bestFormat.filesize || bestFormat.filesize_approx) : 0);

        // Best thumbnail URL
        let thumbnail = '/favicon.svg';
        if (data.thumbnails && data.thumbnails.length > 0) {
          thumbnail = data.thumbnails[data.thumbnails.length - 1].url;
        } else if (data.thumbnail) {
          thumbnail = data.thumbnail;
        }

        res.json({
          title: data.title || 'Video',
          thumbnail: thumbnail,
          duration: formatDuration(data.duration),
          uploader: data.uploader || data.channel || 'Unknown',
          platform: platform,
          formats: platform === 'youtube' ? formatOptions : [{ height: 'best', size: formatSize(bestSize) }],
          audioSize: formatSize(bestAudioSize),
          bestSize: formatSize(bestSize)
        });
      } catch (parseErr) {
        console.error('Failed to parse metadata JSON:', parseErr.message);
        res.status(500).json({ error: 'Failed to process metadata returned from downloader.' });
      }
    });
  } catch (err) {
    console.error('Metadata API error:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred fetching metadata' });
  }
});

// Route: Download Video / Audio
app.post('/api/videofetch/download', async (req, res) => {
  const { url, quality, title } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let platform = 'unknown';
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    platform = 'youtube';
  } else if (urlLower.includes('instagram.com')) {
    platform = 'instagram';
  } else if (urlLower.includes('tiktok.com')) {
    platform = 'tiktok';
  }

  const tempId = `video_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const ext = quality === 'audio' ? 'mp3' : 'mp4';
  
  try {
    const ytDlpBinary = await ensureYtDlp();
    const ffmpegDir = path.dirname(ffmpegPath);

    console.log(`Starting video/audio download using yt-dlp for: ${url} (Quality: ${quality})`);

    let args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
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

    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp download failed:', error.message);
        console.error('yt-dlp download stderr:', stderr);
        return res.status(500).json({ error: `Download failed. Detail: ${error.message}` });
      }

      let finalFilePath = path.join(tempDir, `${tempId}.${ext}`);

      // Verify file existence, and fallback to search by prefix if exact extension mismatch
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
        // Clean up temporary file after transmission is finished
        fs.unlink(finalFilePath, (err) => {
          if (err) console.error('Failed to delete temporary video file:', err.message);
          else console.log(`Temporary file cleaned up: ${finalFilePath}`);
        });
      });

      fileStream.on('error', (err) => {
        console.error('Video file stream error:', err.message);
        fs.unlink(finalFilePath, () => {});
      });
    });

  } catch (err) {
    console.error('Backend download route failed:', err.message);
    res.status(500).json({ error: err.message || 'An error occurred during video download' });
  }
});

// Start Server & verify binaries
app.listen(PORT, async () => {
  console.log(`=========================================`);
  console.log(` SongFetch Server is running on port ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`=========================================`);
  try {
    await ensureYtDlp();
  } catch (e) {
    console.error('Warning: Failed to verify or download yt-dlp on startup. Will try again on demand.');
  }
});
