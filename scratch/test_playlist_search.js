const { resolveYouTubePlaylist } = require('../playlistResolvers');
const { ensureYtDlp, getYtDlpArgs } = require('../utils/ytDlp');
const { execFile } = require('child_process');

async function searchAlbumOrPlaylist(query) {
  try {
    console.log(`Searching YouTube playlists for query: "${query}"`);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`;
    
    const args = getYtDlpArgs([
      '--flat-playlist',
      '-J',
      searchUrl
    ]);

    const ytDlpBinary = await ensureYtDlp();
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });

    const data = JSON.parse(jsonStr);

    if (data.entries && data.entries.length > 0) {
      const firstPlaylist = data.entries[0];
      const playlistUrl = firstPlaylist.url && firstPlaylist.url.includes('list=')
        ? firstPlaylist.url
        : `https://www.youtube.com/playlist?list=${firstPlaylist.id}`;

      console.log(`Found YouTube playlist URL: ${playlistUrl}`);
      const playlistData = await resolveYouTubePlaylist(playlistUrl);
      if (playlistData && playlistData.tracks && playlistData.tracks.length >= 2) {
        return playlistData;
      }
    }
  } catch (err) {
    console.warn('Playlist search error:', err.message);
  }
  return null;
}

async function test() {
  const result = await searchAlbumOrPlaylist('Supernova cairokee');
  console.log('Result isPlaylist:', result ? result.isPlaylist : false);
  if (result) {
    console.log('Title:', result.title);
    console.log('Track count:', result.tracks.length);
    console.log('Tracks:', result.tracks.map(t => t.title));
  }
}

test();
