(function (root) {
    const API = 'https://www.honda-bintaro.com/wp-json/wp/v2/posts';
    const localDate = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    function empty(year) {
        return { version: 1, year, authorId: 8, authorName: 'Siska Irma Diana', lastSyncedAt: null, holidays: [], articles: [] };
    }
    function normalize(post) {
        if (!Number.isInteger(post.id) || post.author !== 8 || !/^\d{4}-\d{2}-\d{2}T/.test(post.date || '')) throw new Error('Data artikel WordPress tidak valid.');
        const media = post._embedded?.['wp:featuredmedia']?.[0];
        return { wordpressId: post.id, authorId: post.author, title: post.title?.rendered || '', link: post.link || '', publishedAt: post.date, modifiedAt: post.modified || post.date, thumbnailUrl: media?.media_details?.sizes?.medium?.source_url || media?.source_url || '' };
    }
    async function fetchArticles(year, request = fetch) {
        const articles = [];
        let pages = 1;
        for (let page = 1; page <= pages; page++) {
            const url = new URL(API);
            const params = { author: '8', status: 'publish', per_page: '100', page: String(page), after: `${year}-01-01T00:00:00`, before: `${year}-12-31T23:59:59`, _embed: 'wp:featuredmedia', _fields: 'id,date,modified,link,title,author,_links,_embedded' };
            Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
            const response = await request(url.href);
            if (!response.ok) throw new Error(`WordPress tidak dapat diakses (HTTP ${response.status}).`);
            const posts = await response.json();
            if (!Array.isArray(posts)) throw new Error('Respons WordPress bukan daftar artikel.');
            const totalPages = response.headers.get('X-WP-TotalPages');
            if (totalPages === null) throw new Error('Informasi jumlah halaman WordPress tidak tersedia; sinkronisasi dibatalkan agar data tidak terpotong.');
            pages = Number(totalPages);
            if (!Number.isInteger(pages) || pages < 0 || pages > 1000) throw new Error('Jumlah halaman WordPress tidak valid.');
            articles.push(...posts.map(normalize).filter(item => item.publishedAt.startsWith(`${year}-`)));
        }
        return articles;
    }
    function merge(database, articles, now = new Date().toISOString()) {
        const map = new Map(database.articles.map(item => [item.wordpressId, item]));
        for (const item of articles) {
            const existing = map.get(item.wordpressId);
            // A stale browser copy must not overwrite a newer WordPress revision.
            if (existing && existing.modifiedAt > item.modifiedAt) continue;
            map.set(item.wordpressId, { ...existing, ...item });
        }
        const merged = [...map.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.wordpressId - a.wordpressId);
        return { ...database, lastSyncedAt: now, articles: merged };
    }
    function calculate(database, month, today = localDate(new Date())) {
        const year = database.year;
        const holidays = new Set(database.holidays || []);
        const articles = database.articles.filter(item => item.authorId === 8 && item.publishedAt.startsWith(`${year}-`) && (month === 'All' || Number(item.publishedAt.slice(5, 7)) === Number(month)));
        const counts = new Map();
        for (const item of articles) {
            const day = item.publishedAt.slice(0, 10);
            counts.set(day, (counts.get(day) || 0) + 1);
        }
        const days = [];
        const firstMonth = month === 'All' ? 1 : Number(month);
        const lastMonth = month === 'All' ? 12 : Number(month);
        for (let m = firstMonth; m <= lastMonth; m++) {
            const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
            for (let day = 1; day <= lastDay; day++) {
                const date = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const working = new Date(`${date}T00:00:00Z`).getUTCDay() !== 0 && !holidays.has(date);
                days.push({ date, working, count: counts.get(date) || 0, elapsed: date <= today });
            }
        }
        const calendarDays = days.length;
        const sundayCount = days.filter(day => new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0).length;
        const holidayCount = days.filter(day => holidays.has(day.date) && new Date(`${day.date}T00:00:00Z`).getUTCDay() !== 0).length;
        const target = calendarDays - sundayCount - holidayCount;
        const elapsedDays = days.filter(day => day.working && day.elapsed);
        const actual = new Map(articles.filter(item => item.publishedAt.slice(0, 10) <= today).map(item => [item.wordpressId, item])).size;
        const timely = elapsedDays.filter(day => day.count > 0).length;
        const quantityPoints = elapsedDays.length ? Math.min(actual / elapsedDays.length, 1) * 55 : 0;
        const schedulePoints = elapsedDays.length ? timely / elapsedDays.length * 15 : 0;
        const points = Math.round((quantityPoints + schedulePoints) * 100) / 100;
        const score = elapsedDays.length ? Math.round(points / 70 * 100) : null;
        return { articles, days, calendarDays, sundayCount, holidayCount, target, elapsedTarget: elapsedDays.length, actual, timely, difference: Math.max(elapsedDays.length - actual, 0), quantityPoints, schedulePoints, points, score };
    }
    const core = { empty, normalize, fetchArticles, merge, calculate, localDate };
    if (typeof module !== 'undefined' && module.exports) module.exports = core;
    else root.CopywriterCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
