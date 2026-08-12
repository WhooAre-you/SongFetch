const cheerio = require('cheerio');

async function testFetch() {
    try {
        const uEgy = 'https://egybest.space/explore/?q=mentalist';
        const resEgy = await fetch(uEgy);
        const htmlEgy = await resEgy.text();
        const $ = cheerio.load(htmlEgy);
        console.log('--- EgyBest ---');
        $('.movie').each((i, el) => {
            const a = $(el).attr('href');
            const title = $(el).find('.title').text().trim();
            console.log(title, a);
        });

    } catch (e) {
        console.error(e.message);
    }
}
testFetch();
