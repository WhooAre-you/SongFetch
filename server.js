const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const nodeID3 = require('node-id3');
const ffmpegPath = require('ffmpeg-static');

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

// Resolver: Apple Music Link
async function resolveAppleMusicTrack(url) {
  try {
    console.log(`Resolving Apple Music URL: ${url}`);
    // Extract song ID (typically 'i' param)
    const urlObj = new URL(url);
    let trackId = urlObj.searchParams.get('i');
    
    if (!trackId) {
      // Fallback: parse last section of path if it's a numeric ID
      const parts = urlObj.pathname.split('/');
      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart)) {
        trackId = lastPart;
      }
    }

    if (trackId) {
      const meta = await lookupiTunesId(trackId);
      if (meta) return meta;
    }

    // Secondary fallback: Scrape title and search iTunes
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    const pageTitle = $('title').text().trim(); // "Song Name by Artist on Apple Music"
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    
    let title = ogTitle;
    let artist = '';
    
    if (pageTitle.includes(' by ')) {
      const parts = pageTitle.split(' by ');
      title = title || parts[0].trim();
      artist = parts[1].split(' on Apple Music')[0].trim();
    }

    if (title && artist) {
      const cleanMeta = await searchiTunes(`${artist} ${title}`);
      if (cleanMeta) return cleanMeta;
    }

    return {
      title: title || 'Apple Music Song',
      artist: artist || 'Unknown Artist',
      album: 'Apple Music Single',
      artwork: ogImage
    };
  } catch (error) {
    console.error('Apple Music resolver error:', error.message);
    throw new Error('Failed to resolve Apple Music track metadata');
  }
}

// Resolver: Anghami Link
async function resolveAnghamiTrack(url) {
  try {
    console.log(`Resolving Anghami URL via curl: ${url}`);
    
    // Command to execute curl with decompression and full headers
    const cmd = `curl -sL --compressed -H "Accept-Encoding: gzip, deflate, br" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" -H "Accept-Language: en-US,en;q=0.5" "${url}"`;
    
    const html = await new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });

    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    
    let title = ogTitle;
    let artist = '';

    if (ogTitle.includes(' - ')) {
      const parts = ogTitle.split(' - ');
      title = parts[0].trim();
      artist = parts[1].trim();
    } else if (ogTitle.includes(' by ')) {
      const parts = ogTitle.split(' by ');
      title = parts[0].trim();
      artist = parts[1].trim();
    } else if (ogDesc && ogDesc.includes(' · ')) {
      const parts = ogDesc.split(' · ');
      artist = parts[0].trim();
      title = ogTitle || '';
    } else {
      const match = ogDesc.match(/Listen to (.*?) by (.*?) on Anghami/i);
      if (match) {
        title = match[1].trim();
        artist = match[2].trim();
      }
    }

    if (title && artist) {
      const cleanMeta = await searchiTunes(`${artist} ${title}`);
      if (cleanMeta) return cleanMeta;
    }

    return {
      title: title || ogTitle || 'Anghami Song',
      artist: artist || 'Unknown Artist',
      album: 'Anghami Single',
      artwork: ogImage
    };
  } catch (error) {
    console.error('Anghami resolver error:', error.message);
    throw new Error('Failed to resolve Anghami track metadata');
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

// Resolver: YouTube Playlist
async function resolveYouTubePlaylist(url) {
  try {
    console.log(`Resolving YouTube Playlist URL: ${url}`);
    
    // Extract playlist ID
    const match = url.match(/[&?]list=([^&]+)/);
    const playlistId = match ? match[1] : '';
    if (!playlistId) throw new Error('Invalid YouTube playlist URL');

    const ytdlpPath = ytDlpPath;
    const args = [
      '--js-runtimes', 'node',
      '--impersonate', 'chrome',
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    console.log(`Running yt-dlp to extract YouTube playlist: ${url}`);
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });

    const data = JSON.parse(jsonStr);
    const title = data.title || 'YouTube Playlist';
    const curator = data.uploader || 'Unknown Creator';
    
    // Get high res thumbnail if possible
    let artwork = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      artwork = data.thumbnails[data.thumbnails.length - 1].url;
    }

    const tracks = [];
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(entry => {
        if (entry) {
          tracks.push({
            title: entry.title || 'Unknown Video',
            artist: entry.uploader || curator,
            album: title,
            artwork: artwork || '',
            youtubeUrl: `https://www.youtube.com/watch?v=${entry.id}`
          });
        }
      });
    }

    return {
      isPlaylist: true,
      title,
      artist: curator,
      artwork,
      tracks
    };
  } catch (error) {
    console.error('YouTube playlist resolver error:', error.message);
    throw new Error(`Failed to resolve YouTube playlist: ${error.message}`);
  }
}

// Resolver: SoundCloud Playlist
async function resolveSoundCloudPlaylist(url) {
  try {
    console.log(`Resolving SoundCloud Playlist URL: ${url}`);
    
    const ytdlpPath = ytDlpPath;
    const args = [
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    console.log(`Running yt-dlp to extract SoundCloud playlist: ${url}`);
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });

    const data = JSON.parse(jsonStr);
    const title = data.title || 'SoundCloud Playlist';
    const curator = data.uploader || 'Unknown Creator';
    
    let artwork = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      artwork = data.thumbnails[data.thumbnails.length - 1].url;
    }

    const tracks = [];
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(entry => {
        if (entry) {
          let trackUrl = entry.url;
          let trackTitle = entry.title || 'SoundCloud Track';
          if (trackTitle === 'SoundCloud Track' && entry.url) {
            const parts = entry.url.split('/');
            const lastPart = parts[parts.length - 1];
            trackTitle = lastPart.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }

          tracks.push({
            title: trackTitle,
            artist: entry.uploader || curator,
            album: title,
            artwork: artwork || '',
            youtubeUrl: trackUrl
          });
        }
      });
    }

    return {
      isPlaylist: true,
      title,
      artist: curator,
      artwork,
      tracks
    };
  } catch (error) {
    console.error('SoundCloud playlist resolver error:', error.message);
    throw new Error('Failed to resolve SoundCloud playlist');
  }
}

// Resolver: Spotify Playlist
async function resolveSpotifyPlaylist(url) {
  try {
    console.log(`Resolving Spotify Playlist URL: ${url}`);
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    const playlistId = match ? match[1] : '';
    if (!playlistId) throw new Error('Invalid Spotify playlist URL');
    
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
    const cmd = `curl.exe -sL --compressed -H "Accept-Encoding: gzip, deflate" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" -H "Accept-Language: en-US,en;q=0.5" "${embedUrl}"`;
    
    const html = await new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    
    const $ = cheerio.load(html);
    const nextDataText = $('#__NEXT_DATA__').text();
    
    if (nextDataText) {
      const data = JSON.parse(nextDataText);
      const pageProps = data.props.pageProps;
      
      if (pageProps.status === 404) {
        throw new Error('Spotify playlist embedding blocked by rate limits');
      }
      
      const entity = pageProps.state.data.entity;
      const title = entity.name || 'Spotify Playlist';
      const curator = entity.owner ? entity.owner.name : 'Unknown Creator';
      const artwork = entity.visualIdentity.image && entity.visualIdentity.image[0] ? entity.visualIdentity.image[0].url : '';
      
      const tracks = [];
      const tracksPath = entity.tracks || entity.content || entity.item || entity.items;
      if (tracksPath && tracksPath.items) {
        tracksPath.items.forEach(item => {
          const track = item.track;
          if (track) {
            tracks.push({
              title: track.name,
              artist: track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist',
              album: track.album ? track.album.name : title,
              artwork: track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : artwork,
              youtubeUrl: ''
            });
          }
        });
      }
      
      return {
        isPlaylist: true,
        title,
        artist: curator,
        artwork,
        tracks
      };
    } else {
      throw new Error('Could not parse Spotify embed page data');
    }
  } catch (error) {
    console.error('Spotify playlist resolver error:', error.message);
    throw new Error('Spotify playlists cannot be parsed without developer credentials due to Spotify rate limits. Please download individual tracks using Spotify track links or search by name.');
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

// Route: Search / Resolve Link
app.post('/api/search', async (req, res) => {
  const { queryOrUrl } = req.body;
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
          metadata = await resolveSpotifyPlaylist(queryOrUrl);
        } else {
          metadata = await resolveSpotifyTrack(queryOrUrl);
        }
      } else if (queryOrUrl.includes('music.apple.com')) {
        if (queryOrUrl.includes('/playlist/')) {
          throw new Error('Apple Music playlists cannot be resolved. Please download individual tracks or search by name.');
        }
        metadata = await resolveAppleMusicTrack(queryOrUrl);
      } else if (queryOrUrl.includes('anghami.com')) {
        metadata = await resolveAnghamiTrack(queryOrUrl);
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
        return res.status(400).json({ error: 'Unsupported URL platform. Use Spotify, YouTube, Apple Music, Anghami, or SoundCloud.' });
      }
    } else {
      // General Search query
      metadata = await searchiTunes(queryOrUrl);
      if (!metadata) {
        console.log(`Query "${queryOrUrl}" not found on iTunes. Trying YouTube search fallback...`);
        try {
          const ytdlpPath = path.join(__dirname, 'bin', 'yt-dlp.exe');
          const args = [
            '--js-runtimes', 'node',
            '--impersonate', 'chrome',
            '--no-cache-dir',
            '-J',
            `ytsearch1:${queryOrUrl}`
          ];
          
          const jsonStr = await new Promise((resolve, reject) => {
            execFile(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
          console.error('YouTube search fallback error:', ytError.message);
        }
      }

      // If still not found, try SoundCloud search as secondary fallback
      if (!metadata) {
        console.log(`Query "${queryOrUrl}" not found on YouTube. Trying SoundCloud search fallback...`);
        try {
          const ytdlpPath = path.join(__dirname, 'bin', 'yt-dlp.exe');
          const args = [
            '--no-cache-dir',
            '-J',
            `scsearch1:${queryOrUrl}`
          ];
          
          const jsonStr = await new Promise((resolve, reject) => {
            execFile(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
          console.error('SoundCloud search fallback error:', scError.message);
        }
      }

      if (!metadata) {
        return res.status(404).json({ error: 'No songs found matching your search.' });
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
