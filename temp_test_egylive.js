const cheerio = require('cheerio');
const axios = require('axios');

async function testFetch() {
    try {
        const uEgy = 'https://egybests.live/?s=inception';
        const resEgy = await axios.get(uEgy);
        const htmlEgy = resEgy.data;
        const $ = cheerio.load(htmlEgy);
        console.log('--- EgyBests.live ---');
        
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('egybests.live')) {
                const title = $(el).text().trim() || $(el).attr('title');
                if (title && title.length > 5 && !href.includes('/tag/') && !href.includes('/category/') && !href.includes('/author/')) {
                    const img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
                    console.log(title, href, img);
                }
            }
        });

    } catch (e) {
        console.error(e.message);
    }
}
testFetch();
