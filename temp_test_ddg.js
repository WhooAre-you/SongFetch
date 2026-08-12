const axios = require('axios');
const cheerio = require('cheerio');

async function ddg() {
    try {
        const url = 'https://html.duckduckgo.com/html/?q=site:vid.mycima.cc+the+mentalist';
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(res.data);
        $('.result__url').each((i, el) => console.log($(el).text().trim()));
    } catch (e) { console.error(e.message); }
}
ddg();
