const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const core = require('../scripts/copywriter-core.js');
const elements = new Map();
function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {} });
    return elements.get(id);
}
const storage = new Map();
const database = JSON.parse(fs.readFileSync('json/2026/kpi-copywriter-siska-2026.json', 'utf8'));
let calls = [];
const context = {
    CopywriterCore: core, URL, TextDecoder, Uint8Array, AbortSignal,
    DOMParser: class { parseFromString(value) { return { body: { textContent: value.replace(/<[^>]*>/g, '') } }; } },
    document: { getElementById: element, querySelectorAll: () => [], addEventListener: () => {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    getGHConfig: () => ({ user: 'test', repo: 'test', token: 'test-token' }),
    getKPIGrade: score => ({ grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E', badgeClass: 'bg-green' }),
    renderStatCards: cards => cards.map(card => `<div>${card.val} ${card.lbl} ${card.sub}</div>`).join(''),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: async (url, options) => {
        calls.push({ url, options });
        if (options?.method === 'PUT') return { ok: true };
        return { ok: true, json: async () => ({ sha: 'test-sha', content: Buffer.from(JSON.stringify(database)).toString('base64') }) };
    }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('scripts/copywriter-ui.js', 'utf8'), context);
async function run() {
    element('copywriter-year').value = '2026';
    element('copywriter-month').value = '10';
    await context.loadCopywriterDatabase();
    assert(element('copywriter-content').innerHTML.includes('Siska Irma Diana'));
    assert(element('copywriter-content').innerHTML.includes('Buka Artikel'));
    assert(element('copywriter-content').innerHTML.includes('Kalender Publikasi'));
    assert(element('copywriter-content').innerHTML.includes('30 Point pekerjaan pendukung belum dinilai'));
    element('copywriter-holidays').value = '2026-10-05,2026-10-05';
    context.saveCopywriterHolidays();
    assert.equal(JSON.parse(storage.get('honda_copywriter_2026')).holidays.length, 1);
    element('copywriter-holidays').value = '2026-02-31';
    context.saveCopywriterHolidays();
    assert(element('copywriter-status').textContent.includes('tanggal valid'));
    await context.saveCopywriterGitHub();
    const put = calls.find(call => call.options?.method === 'PUT');
    const body = JSON.parse(put.options.body);
    assert.equal(body.sha, 'test-sha');
    const persisted = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    assert.equal(persisted.articles.length, database.articles.length);
    assert.deepEqual(persisted.holidays, ['2026-10-05']);
    assert.equal(storage.get('honda_copywriter_2026_dirty'), 'false');
    context.fetch = async () => ({ ok: false, status: 503 });
    await context.syncCopywriterWordPress();
    assert(element('copywriter-status').textContent.includes('503'));
    assert.equal(JSON.parse(storage.get('honda_copywriter_2026')).articles.length, database.articles.length);
    const id = database.articles[0].wordpressId;
    vm.runInContext(`copywriterGSC = ${JSON.stringify({ year: 2026, lastSyncedAt: '2026-10-08T09:00:00Z', months: [
        { month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', articles: [{ wordpressId: id, metrics: { clicks: 2, impressions: 10, position: 2 } }] },
        { month: '2026-10', startDate: '2026-10-01', endDate: '2026-10-05', articles: [{ wordpressId: id, metrics: { clicks: 3, impressions: 90, position: 12 } }] }
    ] })}`, context);
    const metrics = context.copywriterPerformance(database.articles, 'All');
    assert.equal(metrics.total.clicks, 5);
    assert.equal(metrics.total.ctr, .05);
    assert.equal(metrics.total.position, 11);
    assert.equal(context.copywriterPerformance(database.articles, '10').total.clicks, 3);
    context.renderCopywriter();
    assert(element('copywriter-content').innerHTML.includes('Performa Google Search'));
    assert(element('copywriter-content').innerHTML.includes('CTR:'));
    assert(element('copywriter-content').innerHTML.includes('Artikel terbit setelah batas data final GSC'));
    assert(element('copywriter-content').innerHTML.includes('Google belum mengembalikan baris'));
    const older = database.articles.find(article => !article.publishedAt.startsWith('2026-10'));
    vm.runInContext(`copywriterGSC.months[1].articles.push(${JSON.stringify({ wordpressId: older.wordpressId, metrics: { clicks: 7, impressions: 500, position: 9 } })})`, context);
    context.renderCopywriter();
    const html = element('copywriter-content').innerHTML;
    assert(html.includes(`2 dari ${database.articles.length} artikel`));
    assert(html.includes('10 Klik')); // Includes October traffic from an article published earlier.
    assert(html.includes('Database Artikel (5)')); // Production still selects only October publications.
    assert(html.includes('Rincian GSC semua artikel'));
    vm.runInContext(`copywriterGA4 = ${JSON.stringify({year:2026,dateTimezone:'Asia/Jakarta',lastSyncedAt:'2026-10-09T00:00:00Z',months:[{month:'2026-10',startDate:'2026-10-01',endDate:'2026-10-08',total:{views:20,activeUsers:3,averageEngagementSeconds:45},articles:[{wordpressId:older.wordpressId,metrics:{views:20,activeUsers:3,averageEngagementSeconds:45}}]},{month:'All',startDate:'2026-01-01',endDate:'2026-10-08',total:{views:200,activeUsers:8,averageEngagementSeconds:60},articles:[]}]})}`, context);
    context.renderCopywriter();
    assert(element('copywriter-content').innerHTML.includes('20 Views Artikel'));
    assert(element('copywriter-content').innerHTML.includes('3 Pengguna Aktif'));
    assert(element('copywriter-content').innerHTML.includes('45 detik'));
    assert.equal(context.copywriterAnalytics('All').total.activeUsers, 8);
    assert.equal(context.copywriterAnalytics('9'), null);
    const analytics = context.copywriterAnalytics('10');
    const selected = context.copywriterTrafficSelection('ga4', analytics);
    assert.equal(selected.articles.length, 10);
    assert.equal(selected.articles[0].wordpressId, older.wordpressId);
    vm.runInContext('copywriterTables.ga4.page=2', context);
    assert.equal(context.copywriterTrafficSelection('ga4',analytics).articles.length,10);
    vm.runInContext("copywriterTables.ga4.query='no-matching-title-xyz'; copywriterTables.ga4.page=5",context);
    const empty=context.copywriterTrafficSelection('ga4',analytics);
    assert.equal(empty.count,0);
    assert.equal(empty.pages,1);
    assert(context.renderCopywriterTrafficTable('ga4',analytics).includes('Tidak ada artikel yang cocok'));
    context.fetch = async (url,options) => { calls.push({url,options}); return {ok:true,status:204}; };
    element('copywriter-year').value='2027';
    await context.syncCopywriterAll();
    const dispatch=calls.find(call=>call.url.includes('/dispatches'));
    assert.equal(JSON.parse(dispatch.options.body).inputs.year,'2027');
    assert(element('copywriter-status').textContent.includes('tahun 2027'));
    console.log('PASS: live-data rendering, links/calendar, holiday validation, JSON save with SHA, failure preserves existing data.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
