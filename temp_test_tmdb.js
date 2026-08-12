const cheerio = require('cheerio');

async function testScrape() {
    const res = await fetch('https://www.themoviedb.org/search?query=inception', {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.card').each((i, el) => {
        const title = $(el).find('h2').text().trim() || $(el).find('.title').text().trim();
        const link = $(el).find('a').attr('href');
        if (title && link && link.match(/(movie|tv)\/\d+/)) {
            results.push({ title, link });
        }
    });
    console.log(results);
}
testScrape();
