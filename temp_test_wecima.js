const cheerio = require('cheerio');
const axios = require('axios');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
};

async function testWeCima() {
    try {
        const query = encodeURIComponent('the mentalist');
        const url = `https://vid.mycima.cc/search/${query}`;
        console.log('Fetching:', url);
        const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(res.data);
        const results = [];
        $('.GridItem, .Thumb--GridItem').each((i, el) => {
            const link = $(el).find('a').attr('href');
            const title = $(el).find('.has-text, strong, .title').text().trim();
            if (link && title) results.push({ title, link });
        });
        console.log('Search Results:', results.length > 0 ? results : 'No results');
    } catch (e) {
        console.error('Error:', e.message);
    }
}
testWeCima();
