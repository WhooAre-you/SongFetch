const { resolveYouTubePlaylist } = require('../playlistResolvers');

async function test() {
  const url = 'https://www.youtube.com/playlist?list=PLPdcLbNLnRl8';
  console.log('Testing playlist resolution for Supernova album...');
  try {
    const res = await resolveYouTubePlaylist(url);
    console.log('Playlist Title:', res.title);
    console.log('Curator:', res.artist);
    console.log('Track Count:', res.tracks.length);
    console.log('First 3 tracks:', res.tracks.slice(0, 3));
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

test();
