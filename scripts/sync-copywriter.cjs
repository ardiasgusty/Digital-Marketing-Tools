const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('./copywriter-core.js');

async function main() {
    const year = Number(process.env.COPYWRITER_YEAR || core.localDate(new Date()).slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Invalid year');
    const file = path.join(__dirname, '..', 'json', String(year), `kpi-copywriter-siska-${year}.json`);
    let database;
    try { database = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; database = core.empty(year); }
    if (database.year !== year || !Array.isArray(database.articles)) throw new Error('Invalid saved database');
    const articles = await core.fetchArticles(year, url => fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } }));
    const next = core.merge(database, articles);
    if (JSON.stringify(database.articles) === JSON.stringify(next.articles) && database.lastSyncedAt) {
        console.log(`No article changes for ${year}.`);
        return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n');
    await fs.rename(temporary, file);
    console.log(`Saved ${next.articles.length} articles for ${year}.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
