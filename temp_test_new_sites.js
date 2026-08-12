const cheerio = require('cheerio');

async function testFetch() {
    try {
        const uFasel = 'https://www.faselhd.club/?s=the+mentalist';
        const resFasel = await fetch(uFasel);
        const htmlFasel = await resFasel.text();
        let $ = cheerio.load(htmlFasel);
        console.log('--- FaselHD ---');
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('/movies/') || href.includes('/series/') || href.includes('/episodes/'))) {
                console.log($(el).text().trim(), href);
            }
        });

        const uEgy = 'https://iegybest.com/explore/?q=the+mentalist';
        const resEgy = await fetch(uEgy);
        const htmlEgy = await resEgy.text();
        $ = cheerio.load(htmlEgy);
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
