const path = require('path');
const { execFile, exec } = require('child_process');
const cheerio = require('cheerio');

// Dynamic OS-specific yt-dlp path resolution
const isWindows = process.platform === 'win32';
const binDir = path.join(__dirname, 'bin');
const ytDlpFileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytDlpPath = path.join(binDir, ytDlpFileName);

// Resolver: YouTube Playlist
async function resolveYouTubePlaylist(url) {
  try {
    console.log(`Resolving YouTube Playlist URL: ${url}`);
    
    // Extract playlist ID
    const match = url.match(/[&?]list=([^&]+)/);
    const playlistId = match ? match[1] : '';
    if (!playlistId) throw new Error('Invalid YouTube playlist URL');

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
      execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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
    
    const args = [
      '--no-cache-dir',
      '--flat-playlist',
      '-J',
      url
    ];

    console.log(`Running yt-dlp to extract SoundCloud playlist: ${url}`);
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
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
    throw new Error(`Failed to resolve SoundCloud playlist: ${error.message}`);
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

module.exports = {
  resolveYouTubePlaylist,
  resolveSoundCloudPlaylist,
  resolveSpotifyPlaylist
};
