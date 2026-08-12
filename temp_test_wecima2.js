const cheerio = require('cheerio');

async function testFetch() {
    try {
        const url = 'https://cimawbas.com/search.php?keywords=the+mentalist';
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('watch.php?vid=')) {
                results.push({
                    title: $(el).text().trim() || $(el).attr('title'),
                    url: href
                });
            }
        });
        console.log('Found watch links:', results.slice(0, 10));
    } catch (e) {
        console.error(e.message);
    }
}
testFetch();
