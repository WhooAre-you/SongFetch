const path = require('path');
const { execFile } = require('child_process');

// Dynamic OS-specific yt-dlp path resolution
const isWindows = process.platform === 'win32';
const binDir = path.join(__dirname, 'bin');
const ytDlpFileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpPath = path.join(binDir, ytDlpFileName);

// Helper: pick the best thumbnail from an entry's thumbnail data
function pickEntryThumbnail(entry, fallback) {
  // yt-dlp flat-playlist entries may have thumbnails[] or a thumbnail string
  if (entry.thumbnails && entry.thumbnails.length > 0) {
    // Prefer the highest-res one (last in array)
    return entry.thumbnails[entry.thumbnails.length - 1].url || fallback;
  }
  if (entry.thumbnail) return entry.thumbnail;
  return fallback;
}

// Run yt-dlp and return parsed JSON
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

// Resolver: YouTube Playlist
async function resolveYouTubePlaylist(url) {
  try {
    console.log(`Resolving YouTube Playlist URL: ${url}`);

    const match = url.match(/[&?]list=([^&]+)/);
    const playlistId = match ? match[1] : '';
    if (!playlistId) throw new Error('Invalid YouTube playlist URL');

    const args = [
      '--extractor-args', 'youtube:player_client=mweb,android',
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    const jsonStr = await runYtDlp(args);
    const data = JSON.parse(jsonStr);

    const title = data.title || 'YouTube Playlist';
    const curator = data.uploader || 'Unknown Creator';

    // Playlist-level cover (fallback for entries with no art)
    let playlistArtwork = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      playlistArtwork = data.thumbnails[data.thumbnails.length - 1].url;
    }

    const tracks = [];
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(entry => {
        if (entry) {
          // Pick per-entry thumbnail, fall back to playlist art
          const trackArt = pickEntryThumbnail(entry, playlistArtwork);
          tracks.push({
            title: entry.title || 'Unknown Video',
            artist: entry.uploader || entry.channel || curator,
            album: title,
            artwork: trackArt,
            youtubeUrl: `https://www.youtube.com/watch?v=${entry.id}`
          });
        }
      });
    }

    return { isPlaylist: true, title, artist: curator, artwork: playlistArtwork, tracks };
  } catch (error) {
    console.error('YouTube playlist resolver error:', error.message);
    throw new Error(`Failed to resolve YouTube playlist: ${error.message}`);
  }
}

// Resolver: SoundCloud Playlist
async function resolveSoundCloudPlaylist(url) {
  try {
    console.log(`Resolving SoundCloud Playlist URL: ${url}`);

    const args = [
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    const jsonStr = await runYtDlp(args);
    const data = JSON.parse(jsonStr);

    const title = data.title || 'SoundCloud Playlist';
    const curator = data.uploader || 'Unknown Creator';

    let playlistArtwork = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      playlistArtwork = data.thumbnails[data.thumbnails.length - 1].url;
    } else if (data.thumbnail) {
      playlistArtwork = data.thumbnail;
    }

    const tracks = [];
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(entry => {
        if (entry) {
          // Derive a clean title from the URL slug if entry title is generic
          let trackTitle = entry.title || '';
          if (!trackTitle && entry.url) {
            const parts = entry.url.split('/');
            const lastPart = parts[parts.length - 1];
            trackTitle = lastPart.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }

          // Per-entry thumbnail > playlist art
          const trackArt = pickEntryThumbnail(entry, playlistArtwork);

          tracks.push({
            title: trackTitle || 'SoundCloud Track',
            artist: entry.uploader || curator,
            album: title,
            artwork: trackArt,
            youtubeUrl: entry.url || entry.webpage_url || ''
          });
        }
      });
    }

    return { isPlaylist: true, title, artist: curator, artwork: playlistArtwork, tracks };
  } catch (error) {
    console.error('SoundCloud playlist resolver error:', error.message);
    throw new Error(`Failed to resolve SoundCloud playlist: ${error.message}`);
  }
}

// Resolver: Spotify Playlist — uses yt-dlp's built-in Spotify extractor
async function resolveSpotifyPlaylist(url) {
  try {
    console.log(`Resolving Spotify Playlist URL via yt-dlp: ${url}`);

    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    const playlistId = match ? match[1] : '';
    if (!playlistId) throw new Error('Invalid Spotify playlist URL');

    const args = [
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    const jsonStr = await runYtDlp(args);
    const data = JSON.parse(jsonStr);

    const title = data.title || 'Spotify Playlist';
    const curator = data.uploader || data.channel || 'Unknown Creator';

    let playlistArtwork = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      playlistArtwork = data.thumbnails[data.thumbnails.length - 1].url;
    } else if (data.thumbnail) {
      playlistArtwork = data.thumbnail;
    }

    const tracks = [];
    if (data.entries && data.entries.length > 0) {
      data.entries.forEach(entry => {
        if (entry) {
          const trackArt = pickEntryThumbnail(entry, playlistArtwork);
          tracks.push({
            title: entry.title || 'Unknown Track',
            artist: entry.artist || entry.uploader || entry.channel || curator,
            album: entry.album || title,
            artwork: trackArt,
            // Spotify tracks don't have a direct YouTube URL yet — search will resolve them
            youtubeUrl: entry.webpage_url || entry.url || '',
            spotifyQuery: `${entry.title || ''} ${entry.artist || entry.uploader || ''}`.trim()
          });
        }
      });
    }

    return { isPlaylist: true, title, artist: curator, artwork: playlistArtwork, tracks };
  } catch (error) {
    console.error('Spotify playlist resolver error:', error.message);
    throw new Error(`Failed to resolve Spotify playlist: ${error.message}. Try using a YouTube or SoundCloud playlist instead.`);
  }
}

module.exports = {
  resolveYouTubePlaylist,
  resolveSoundCloudPlaylist,
  resolveSpotifyPlaylist
};
