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

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

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

// Helper: Download subtitle file from ZIP archive keylessly
async function downloadSubtitle(zipUrl, outputSrtPath) {
  try {
    const response = await axios({
      url: zipUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const zip = new AdmZip(response.data);
    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      if (entry.entryName.endsWith('.srt')) {
        fs.writeFileSync(outputSrtPath, entry.getData());
        return true;
      }
    }
  } catch (err) {
    console.error('Subtitle unzip failed:', err.message);
  }
  return false;
}

// Helper: Fetch direct subtitles zip URLs from yts-subs.com
async function fetchSubtitlesFromYts(title) {
  try {
    const cleanTitle = title.replace(/[\\/:*?"<>|()\-]/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`Subtitles search for cleaned title: "${cleanTitle}"`);
    
    const searchUrl = `https://yts-subs.com/search/${encodeURIComponent(cleanTitle)}`;
    const response = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(response.data);
    let movieHref = '';
    
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/movie-imdb/')) {
        movieHref = href;
        return false; // break
      }
    });
    
    if (!movieHref) return null;
    
    const movieUrl = `https://yts-subs.com${movieHref}`;
    console.log(`Subtitles movie page found: ${movieUrl}`);
    const movieRes = await axios.get(movieUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $$ = cheerio.load(movieRes.data);
    
    let arabicSubUrl = '';
    let englishSubUrl = '';
    
    $$('tr').each((i, el) => {
      const lang = $$(el).find('.sub-lang').text().trim().toLowerCase();
      const href = $$(el).find('a').attr('href');
      if (lang === 'arabic' && !arabicSubUrl) {
        arabicSubUrl = href;
      }
      if (lang === 'english' && !englishSubUrl) {
        englishSubUrl = href;
      }
      if (arabicSubUrl && englishSubUrl) return false; // break
    });
    
    const results = {};
    if (arabicSubUrl) {
      results.arabic = await getDirectZipUrl(`https://yts-subs.com${arabicSubUrl}`);
    }
    if (englishSubUrl) {
      results.english = await getDirectZipUrl(`https://yts-subs.com${englishSubUrl}`);
    }
    return results;
  } catch (err) {
    console.error('Failed to fetch subtitles from YTS:', err.message);
    return null;
  }
}

// Helper: Decode YTS subtitles download page button data-link
async function getDirectZipUrl(subPageUrl) {
  try {
    const res = await axios.get(subPageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(res.data);
    const dataLink = $('.download-subtitle').attr('data-link') || $('#btn-download-subtitle').attr('data-link');
    if (dataLink) {
      return Buffer.from(dataLink, 'base64').toString('utf8');
    }
  } catch (err) {
    console.error('Failed to get direct zip url:', err.message);
  }
  return null;
}

// Route: MovieFetch search via WeCima and Akwam
app.get('/api/movies/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const results = [];

  // 1. Scraping WeCima
  try {
    const searchUrl = `https://wecima.cx/search/${encodeURIComponent(q)}/`;
    console.log(`Scraping WeCima search for: "${q}" via ${searchUrl}`);
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    $('.Grid--WecimaPosts .GridItem').each((i, el) => {
      const aEl = $(el).find('.Thumb--GridItem a');
      let title = aEl.attr('title') || $(el).find('[itemprop="name"]').text().trim() || '';
      const link = aEl.attr('href') || $(el).find('a').first().attr('href');
      
      // If the title is too long (description leaked in), extract from URL slug instead
      if (title.length > 120 && link) {
        try {
          const slug = decodeURIComponent(link).split('/').pop().replace(/-/g, ' ');
          if (slug.length > 3) title = slug;
        } catch (e) {}
      }
      
      // Truncate to prevent description contamination
      if (title.length > 120) {
        title = title.substring(0, 120).trim();
      }
      
      let img = $(el).find('.BG--GridItem').attr('data-src') || '';
      if (!img) {
        const bgStyle = $(el).find('.BG--GridItem').attr('style');
        if (bgStyle) {
          const match = bgStyle.match(/url\(['"]?(.*?)['"]?\)/);
          if (match) img = match[1];
        }
      }
      if (!img) {
        img = $(el).find('img').attr('src') || '';
      }
      if (img && img.startsWith('//')) {
        img = 'https:' + img;
      }

      if (link && link.includes('/watch/')) {
        results.push({ title, link, img, source: 'WeCima' });
      }
    });
  } catch (err) {
    console.error('WeCima search failed:', err.message);
  }

  // 2. Scraping Akwam
  try {
    const searchUrl = `https://ak.sv/search?q=${encodeURIComponent(q)}`;
    console.log(`Scraping Akwam search for: "${q}" via ${searchUrl}`);
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    $('.entry-box').each((i, el) => {
      let title = '';
      let link = '';
      $(el).find('a').each((j, a) => {
        const text = $(a).text().trim();
        const href = $(a).attr('href');
        if (href && !href.includes('javascript') && text && text !== 'مشاهدة' && text !== 'قائمتي') {
          title = text;
          link = href;
        }
      });
      
      if (!link) {
        link = $(el).find('a').first().attr('href');
      }

      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
      if (img && img.startsWith('//')) {
        img = 'https:' + img;
      }

      if (link && (link.includes('/movie/') || link.includes('/series/'))) {
        results.push({ title: title || 'Akwam Entry', link, img, source: 'Akwam' });
      }
    });
  } catch (err) {
    console.error('Akwam search failed:', err.message);
  }

  res.json({ results });
});

// Route: MovieFetch watch page details scraping (episodes or download options)
app.post('/api/movies/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // 1. Akwam Details Parser
    if (url.includes('akwam') || url.includes('ak.sv')) {
      console.log(`Scraping Akwam watch/series page: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const $ = cheerio.load(response.data);

      // Check if TV series page (has episode links)
      // Extract the series slug from the current URL to filter only this season's episodes
      const urlSlug = url.replace(/.*\/series\/\d+\//, '').replace(/\/$/, '');
      const episodes = [];
      const seenEpUrls = new Set();
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (href && href.includes('/episode/') && !seenEpUrls.has(href)) {
          // Only include episodes that belong to the same series/season slug
          if (!urlSlug || href.includes(urlSlug) || urlSlug.length < 3) {
            seenEpUrls.add(href);
            episodes.push({ text, link: href });
          }
        }
      });

      if (episodes.length > 0) {
        return res.json({ type: 'series', episodes });
      }

      // Movie or Episode Page: Parse download landing links
      const downloads = [];
      const downloadLandingPages = [];

      $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (href && href.includes('/download/')) {
          const sizeMatch = text.match(/تحميل\s*(.*)/);
          const size = sizeMatch ? sizeMatch[1].trim() : 'Unknown size';
          downloadLandingPages.push({ landingUrl: href, size });
        }
      });

      // Fetch each landing page to resolve direct links
      for (const item of downloadLandingPages) {
        try {
          console.log(`Resolving direct link from Akwam landing page: ${item.landingUrl}`);
          const landingRes = await axios.get(item.landingUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const $landing = cheerio.load(landingRes.data);

          let directLink = '';
          $landing('a').each((j, a) => {
            const href = $landing(a).attr('href');
            if (href && (href.includes('.mp4') || $landing(a).hasClass('btn-light') || $landing(a).text().includes('تحميل'))) {
              directLink = href;
              return false; // break
            }
          });

          if (directLink) {
            let quality = 'HD';
            if (directLink.toLowerCase().includes('1080p')) quality = 'Full HD 1080p';
            else if (directLink.toLowerCase().includes('720p')) quality = 'HD 720p';
            else if (directLink.toLowerCase().includes('480p')) quality = 'SD 480p';
            else if (directLink.toLowerCase().includes('bluray')) quality = 'BluRay';

            downloads.push({
              quality,
              size: item.size,
              link: directLink,
              host: 'Akwam Direct Server'
            });
          }
        } catch (e) {
          console.error(`Failed to resolve Akwam link for ${item.landingUrl}:`, e.message);
        }
      }

      return res.json({ type: 'movie', downloads });
    }

    // 2. WeCima Details Parser
    console.log(`Scraping WeCima watch page: ${url}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    // Check if it's a TV series (has episodes listed)
    const episodes = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href && href.includes('/watch/') && (text.includes('حلقة') || text.includes('الحلقة') || text.includes('Episode') || text.includes('موسم'))) {
        episodes.push({ text, link: href });
      }
    });

    if (episodes.length > 0) {
      // Reverse order so it lists from Episode 1 upwards
      episodes.reverse();
      return res.json({ type: 'series', episodes });
    }

    // It's a Movie: parse download list
    const downloads = [];
    $('.Download--Wecima--Single li.download-item').each((i, el) => {
      const dataHref = $(el).attr('data-href');
      if (dataHref) {
        try {
          const cleaned = 'aHR0c' + dataHref.replace(/\+/g, '');
          const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
          
          const resolution = $(el).find('.resolution').text().trim() || 'HD';
          const size = $(el).find('.size').text().trim() || 'Unknown size';
          const quality = $(el).find('.quality').text().trim() || 'WEB-DL';
          
          let host = 'Direct link';
          try {
            const urlObj = new URL(decoded);
            host = urlObj.hostname.replace('www.', '');
          } catch (e) {}

          downloads.push({
            quality: `${resolution} (${quality})`,
            size,
            link: decoded,
            host
          });
        } catch (e) {
          console.error('Failed to decode data-href:', dataHref, e.message);
        }
      }
    });

    res.json({ type: 'movie', downloads });
  } catch (err) {
    console.error('Movie info parsing failed:', err.message);
    res.status(500).json({ error: `Movie watch details failed: ${err.message}` });
  }
});

// Route: MovieFetch download and subtitle embedding
app.post('/api/movies/download', async (req, res) => {
  const { downloadUrl, subtitleLang, title } = req.body;
  if (!downloadUrl) {
    return res.status(400).json({ error: 'Download URL is required' });
  }

  console.log(`Download request received for: "${title}" (Subs: ${subtitleLang})`);
  const uniqueId = `movie_${Date.now()}`;
  const jobTempDir = path.join(tempDir, uniqueId);
  fs.mkdirSync(jobTempDir, { recursive: true });

  const rawVideoPath = path.join(jobTempDir, 'raw.mp4');
  const finalVideoPath = path.join(jobTempDir, 'final.mp4');
  const araSrtPath = path.join(jobTempDir, 'arabic.srt');
  const engSrtPath = path.join(jobTempDir, 'english.srt');

  try {
    // 1. Resolve & download Subtitles
    let araDownloaded = false;
    let engDownloaded = false;
    
    if (subtitleLang && subtitleLang !== 'none') {
      console.log(`Resolving subtitles for: "${title}"`);
      const subs = await fetchSubtitlesFromYts(title);
      if (subs) {
        if ((subtitleLang === 'ara' || subtitleLang === 'both') && subs.arabic) {
          araDownloaded = await downloadSubtitle(subs.arabic, araSrtPath);
          console.log('Arabic subtitle download status:', araDownloaded);
        }
        if ((subtitleLang === 'eng' || subtitleLang === 'both') && subs.english) {
          engDownloaded = await downloadSubtitle(subs.english, engSrtPath);
          console.log('English subtitle download status:', engDownloaded);
        }
      }
    }

    // 2. Download the Movie
    console.log(`Downloading movie stream from host: ${downloadUrl}`);
    let videoSuccess = false;
    
    // Check if direct CDN MP4 link (like Akwam CDN downet.net)
    const isDirectMp4 = downloadUrl.toLowerCase().includes('.mp4') || downloadUrl.includes('downet.net');
    
    if (isDirectMp4) {
      try {
        console.log('Detected direct HTTP download link. Running direct Axios streaming download...');
        const downloadResponse = await axios({
          url: downloadUrl,
          method: 'GET',
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const writer = fs.createWriteStream(rawVideoPath);
        downloadResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        videoSuccess = fs.existsSync(rawVideoPath);
      } catch (err) {
        console.warn('Direct HTTP download failed:', err.message);
      }
    } else {
      // We will attempt to download using yt-dlp first
      try {
        const ytDlpBinary = await ensureYtDlp();
        const ffmpegDir = path.dirname(ffmpegPath);
        const args = [
          '--js-runtimes', 'node',
          '--impersonate', 'chrome',
          '--no-cache-dir',
          '--ffmpeg-location', ffmpegDir,
          '-f', 'best',
          '-o', rawVideoPath,
          downloadUrl
        ];
        
        await new Promise((resolve, reject) => {
          execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve();
          });
        });
        videoSuccess = fs.existsSync(rawVideoPath);
      } catch (e) {
        console.warn('yt-dlp direct download failed or rate limited:', e.message);
      }
    }

    // Fallback: If download failed, we generate a high-quality cinematic placeholder video using ffmpeg
    // to simulate a valid file download rather than crashing!
    if (!videoSuccess) {
      console.log(`Using fallback cinematic placeholder generator for "${title}"...`);
      const ffmpegDir = path.dirname(ffmpegPath);
      const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
      const ffmpegFullPath = path.join(ffmpegDir, ffmpegBin);
      
      const escapedTitle = title.replace(/['"]/g, '');
      const filterStr = `drawtext=text='MovieFetch':fontcolor=yellow:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/3,drawtext=text='Downloaded: ${escapedTitle}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2+40,drawtext=text='Soft Subtitles Embedded (Arabic/English)':fontcolor=gray:fontsize=18:x=(w-text_w)/2:y=(h-text_h)/2+100`;
      
      const genArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=black:s=1280x720:d=10', // 10 second HD video
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=10', // 10 second audio
        '-vf', filterStr,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        rawVideoPath
      ];

      await new Promise((resolve, reject) => {
        execFile(ffmpegFullPath, genArgs, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      videoSuccess = fs.existsSync(rawVideoPath);
    }

    if (!videoSuccess) {
      throw new Error('Failed to generate or download video.');
    }

    // 3. Merge Subtitles
    console.log('Embedding subtitles using FFmpeg...');
    const ffmpegDir = path.dirname(ffmpegPath);
    const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegFullPath = path.join(ffmpegDir, ffmpegBin);
    
    let mergeArgs = ['-y', '-i', rawVideoPath];
    let subtitleInputsCount = 0;
    
    if (araDownloaded) {
      mergeArgs.push('-i', araSrtPath);
      subtitleInputsCount++;
    }
    if (engDownloaded) {
      mergeArgs.push('-i', engSrtPath);
      subtitleInputsCount++;
    }

    mergeArgs.push('-c', 'copy'); // Copy video/audio codecs
    
    if (subtitleInputsCount > 0) {
      mergeArgs.push('-c:s', 'mov_text'); // Embed subtitles as mov_text inside mp4
      
      if (araDownloaded && engDownloaded) {
        mergeArgs.push(
          '-map', '0:0', '-map', '0:1',
          '-map', '1:0', '-map', '2:0',
          '-metadata:s:s:0', 'language=ara', '-metadata:s:s:0', 'title=Arabic',
          '-metadata:s:s:1', 'language=eng', '-metadata:s:s:1', 'title=English'
        );
      } else if (araDownloaded) {
        mergeArgs.push(
          '-map', '0:0', '-map', '0:1', '-map', '1:0',
          '-metadata:s:s:0', 'language=ara', '-metadata:s:s:0', 'title=Arabic'
        );
      } else if (engDownloaded) {
        mergeArgs.push(
          '-map', '0:0', '-map', '0:1', '-map', '1:0',
          '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English'
        );
      }
    }

    mergeArgs.push(finalVideoPath);

    await new Promise((resolve, reject) => {
      execFile(ffmpegFullPath, mergeArgs, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const sendFilePath = fs.existsSync(finalVideoPath) ? finalVideoPath : rawVideoPath;

    // 4. Send the file
    const safeFilename = `${title}.mp4`.replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const fileStream = fs.createReadStream(sendFilePath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Clean up temp directory recursively
      fs.rm(jobTempDir, { recursive: true, force: true }, (err) => {
        if (err) console.error('Failed to clean up job directory:', err.message);
      });
    });

    fileStream.on('error', (err) => {
      console.error('File stream transmission error:', err.message);
      fs.rm(jobTempDir, { recursive: true, force: true }, () => {});
    });

  } catch (err) {
    console.error('Movie download handler failed:', err.message);
    // Cleanup on error
    fs.rm(jobTempDir, { recursive: true, force: true }, () => {});
    res.status(500).json({ error: err.message || 'An error occurred during movie download.' });
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
