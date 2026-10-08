const assert = require('node:assert/strict');
const core = require('../scripts/copywriter-core.js');
const post = (id, date, extra = {}) => ({ id, author: 8, date, modified: date, link: 'https://www.honda-bintaro.com/test/', title: { rendered: 'Article' }, ...extra });
async function run() {
    const requests = [];
    const articles = await core.fetchArticles(2026, async url => {
        requests.push(new URL(url));
        const page = Number(new URL(url).searchParams.get('page'));
        return { ok: true, headers: { get: () => '2' }, json: async () => [post(page, `2026-10-0${page}T09:00:00`)] };
    });
    assert.equal(articles.length, 2);
    assert.equal(requests[1].searchParams.get('author'), '8');
    assert.equal(requests[1].searchParams.get('after'), '2026-01-01T00:00:00');
    await assert.rejects(core.fetchArticles(2026, async () => ({ ok: true, headers: { get: () => null }, json: async () => [] })), /halaman/);
    let count = 0;
    await assert.rejects(core.fetchArticles(2026, async () => ++count === 1 ? { ok: true, headers: { get: () => '2' }, json: async () => [post(1, '2026-10-01T09:00:00')] } : { ok: false, status: 503 }), /503/);
    const database = { ...core.empty(2026), holidays: ['2026-10-04', '2026-10-05'], articles: [core.normalize(post(10, '2026-10-01T09:00:00'))] };
    const merged = core.merge(database, [...articles, { ...articles[0], title: 'Updated' }], '2026-10-08T00:00:00Z');
    assert.equal(merged.articles.length, 3);
    assert.equal(merged.articles.find(item => item.wordpressId === 1).title, 'Updated');
    assert.deepEqual(merged.holidays, database.holidays);
    const newer = { ...articles[0], modifiedAt: '2026-10-08T12:00:00', title: 'Newer' };
    const staleMerge = core.merge({ ...core.empty(2026), articles: [newer] }, articles);
    assert.equal(staleMerge.articles.find(item => item.wordpressId === 1).title, 'Newer');
    const result = core.calculate({ ...database, articles: [core.normalize(post(1, '2026-10-01T09:00:00')), core.normalize(post(2, '2026-10-01T10:00:00')), core.normalize(post(3, '2026-10-09T10:00:00'))] }, '10', '2026-10-03');
    assert.equal(result.target, 26); // 31 days, 4 Sundays, 1 weekday holiday; no double subtraction.
    assert.equal(result.elapsedTarget, 3);
    assert.equal(result.actual, 2);
    assert.equal(result.timely, 1); // Two articles on one day do not cover another day's schedule.
    assert.equal(result.difference, 1);
    assert.equal(result.schedulePoints, 5);
    assert.equal(core.calculate(core.empty(2027), '1', '2026-10-08').score, null);
    assert.equal(core.localDate(new Date('2026-12-31T18:00:00Z')), '2027-01-01');
    assert.throws(() => core.normalize(post(1, '2026-10-01T09:00:00', { author: 1 })), /valid/);
    const full = core.calculate({ ...core.empty(2026), articles: Array.from({ length: 12 }, (_, index) => core.normalize(post(index + 1, '2026-10-01T09:00:00'))) }, '10', '2026-10-01');
    assert.equal(full.points, 70);
    console.log('PASS: pagination, partial-fetch failures, ID merging, archive preservation, holidays, daily schedule, future dates, WIB rollover, score cap.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
