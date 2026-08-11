const { ensureYtDlp, getYtDlpArgs } = require('../utils/ytDlp');
const { execFile } = require('child_process');

async function getChannelThumbnail(channelUrl) {
  try {
    const args = getYtDlpArgs(['-J', '--flat-playlist', channelUrl]);
    const ytDlpBinary = await ensureYtDlp();
    const jsonStr = await new Promise((resolve, reject) => {
      execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
    const data = JSON.parse(jsonStr);
    let avatar = '';
    if (data.thumbnails && data.thumbnails.length > 0) {
      avatar = data.thumbnails[data.thumbnails.length - 1].url;
    }
    return { name: data.title || data.uploader || 'Artist', avatar, channelUrl };
  } catch (err) {
    console.error('Error fetching avatar for:', channelUrl, err.message);
    return { avatar: '' };
  }
}

async function run() {
  const channels = [
    { name: 'Cairokee', url: 'https://www.youtube.com/channel/UCp-brkrLhdNTkAVoR1qHm3A' },
    { name: 'Lege-Cy', url: 'https://www.youtube.com/channel/UC6qISBBK0xjYu5GjxQH0ucw' },
    { name: 'Marwan Moussa', url: 'https://www.youtube.com/channel/UCyhPbGq7URXWz61w-1meiKg' },
    { name: 'Mond', url: 'https://www.youtube.com/@Ilmond' },
    { name: 'Abyusif', url: 'https://www.youtube.com/channel/UC11DKpZ9mdjdb5fbdb7ulRw' }
  ];

  for (const ch of channels) {
    const res = await getChannelThumbnail(ch.url);
    console.log(`Artist: ${ch.name}`);
    console.log(`Avatar: ${res.avatar}`);
    console.log('---');
  }
}

run();
