let copywriterGA4 = null;
let copywriterDB = null;
let copywriterBusy = false;
let copywriterPage = 1;
let copywriterDirty = false;
let copywriterGSC = null;
let copywriterGSCMessage = 'Data GSC belum disinkronkan.';
const copywriterMonths = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const copywriterEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const copywriterURL = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? copywriterEscape(url.href) : ''; } catch { return ''; } };
const copywriterYear = () => Number(document.getElementById('copywriter-year').value);
const copywriterPath = year => `json/${year}/kpi-copywriter-siska-${year}.json`;
const copywriterKey = year => `honda_copywriter_${year}`;

function copywriterStatus(message, error = false) {
    const el = document.getElementById('copywriter-status');
    el.textContent = message;
    el.style.color = error ? 'var(--accent)' : 'var(--text-muted)';
}
function copywriterSetBusy(busy) {
    copywriterBusy = busy;
    document.querySelectorAll('#report-pane-copywriter button, #copywriter-year, #copywriter-holidays').forEach(el => el.disabled = busy);
}
function copywriterCache() {
    localStorage.setItem(copywriterKey(copywriterDB.year), JSON.stringify(copywriterDB));
    localStorage.setItem(`${copywriterKey(copywriterDB.year)}_dirty`, String(copywriterDirty));
}
function copywriterValidate(data, year) {
    if (!data || data.year !== year || data.authorId !== 8 || !Array.isArray(data.articles) || !Array.isArray(data.holidays)) throw new Error('Format database Siska tidak sesuai.');
    return data;
}
async function copywriterReadGitHub(year, performance = false) {
    const config = getGHConfig();
    const headers = config.token ? { Authorization: `token ${config.token}` } : {};
    const path = performance ? `json/${year}/kpi-copywriter-siska-${performance === 'ga4' ? 'ga4' : 'gsc'}-${year}.json` : copywriterPath(year);
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.user)}/${encodeURIComponent(config.repo)}/contents/${path}`, { headers, cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Gagal membaca database GitHub (HTTP ${response.status}).`);
    const file = await response.json();
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (performance) {
        if (data.year !== year || !Array.isArray(data.months)) throw new Error('Format data GSC tidak valid.');
        return { database: data, sha: file.sha };
    }
    return { database: copywriterValidate(data, year), sha: file.sha };
}
async function loadCopywriterMetrics(year) {
    copywriterGSC = null;
    copywriterGSCMessage = 'Data GSC belum disinkronkan. Aktifkan workflow setelah konfigurasi Google siap.';
    try {
        let data;
        try { data = (await copywriterReadGitHub(year, true))?.database; } catch { /* Try deployed JSON. */ }
        if (!data) {
            const response = await fetch(`json/${year}/kpi-copywriter-siska-gsc-${year}.json?v=${Date.now()}`, { cache: 'no-store' });
            if (response.status === 404) return;
            if (!response.ok) throw new Error('Gagal memuat laporan GSC.');
            data = await response.json();
        }
        if (data.year !== year || !Array.isArray(data.months)) throw new Error('Format laporan GSC tidak valid.');
        copywriterGSC = data;
        localStorage.setItem(`honda_copywriter_gsc_${year}`, JSON.stringify(data));
    } catch {
        try {
            const cached = JSON.parse(localStorage.getItem(`honda_copywriter_gsc_${year}`));
            if (cached?.year === year && Array.isArray(cached.months)) copywriterGSC = cached;
        } catch { /* No valid cached performance data. */ }
        copywriterGSCMessage = copywriterGSC ? 'Menggunakan salinan laporan GSC lokal.' : 'Laporan GSC belum dapat dimuat. Database artikel tetap tersedia.';
    }
}
function copywriterPerformance(articles, month) {
    if (!copywriterGSC) return null;
    const months = copywriterGSC.months.filter(period => month === 'All' || Number(period.month.slice(5)) === Number(month));
    const ids = new Set(articles.map(article => article.wordpressId));
    const metrics = new Map();
    for (const period of months) {
        for (const article of period.articles) {
            if (!ids.has(article.wordpressId) || !article.metrics) continue;
            const previous = metrics.get(article.wordpressId) || { clicks: 0, impressions: 0, weightedPosition: 0 };
            previous.clicks += article.metrics.clicks;
            previous.impressions += article.metrics.impressions;
            previous.weightedPosition += article.metrics.position * article.metrics.impressions;
            metrics.set(article.wordpressId, previous);
        }
    }
    for (const metric of metrics.values()) {
        metric.ctr = metric.impressions ? metric.clicks / metric.impressions : 0;
        metric.position = metric.impressions ? metric.weightedPosition / metric.impressions : null;
    }
    const total = [...metrics.values()].reduce((sum, metric) => ({ clicks: sum.clicks + metric.clicks, impressions: sum.impressions + metric.impressions, weightedPosition: sum.weightedPosition + metric.weightedPosition }), { clicks: 0, impressions: 0, weightedPosition: 0 });
    total.ctr = total.impressions ? total.clicks / total.impressions : 0;
    total.position = total.impressions ? total.weightedPosition / total.impressions : null;
    return { metrics, total, months, available: metrics.size };
}
async function loadCopywriterDatabase(force = false) {
    if (copywriterBusy) return;
    const year = copywriterYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return copywriterStatus('Tahun harus antara 2000 dan 2100.', true);
    if (copywriterDB?.year === year && !force) return renderCopywriter();
    copywriterSetBusy(true);
    copywriterPage = 1;
    copywriterDB = CopywriterCore.empty(year);
    copywriterGSC = null;
    copywriterGA4 = null;
    copywriterDirty = false;
    let cached = null;
    try { cached = copywriterValidate(JSON.parse(localStorage.getItem(copywriterKey(year))), year); } catch { /* No valid local cache. */ }
    if (cached) {
        copywriterDB = cached;
        copywriterDirty = localStorage.getItem(`${copywriterKey(year)}_dirty`) === 'true';
    }
    renderCopywriter();
    copywriterStatus('Memuat database artikel tersimpan…');
    try {
        let saved = null;
        try { saved = (await copywriterReadGitHub(year))?.database; }
        catch { /* Local deployed JSON remains available without API credentials. */ }
        if (!saved) {
            const response = await fetch(`${copywriterPath(year)}?v=${Date.now()}`, { cache: 'no-store' });
            if (response.ok) saved = copywriterValidate(await response.json(), year);
            else if (response.status !== 404) throw new Error(`Gagal memuat JSON (HTTP ${response.status}).`);
        }
        if (saved) {
            if (copywriterDirty && cached) {
                copywriterDB = CopywriterCore.merge(saved, cached.articles, cached.lastSyncedAt);
                copywriterDB.holidays = cached.holidays;
            } else copywriterDB = saved;
            copywriterCache();
        }
        copywriterStatus(copywriterDirty ? 'Ada perubahan lokal yang belum disimpan ke GitHub.' : saved ? 'Database tersimpan berhasil dimuat.' : cached ? 'Menggunakan salinan lokal.' : 'Belum ada database untuk tahun ini. Klik Tarik WordPress.');
    } catch (error) { copywriterStatus(`${error.message} Salinan lokal tetap tersedia.`, true); }
    finally { await Promise.all([loadCopywriterMetrics(year), loadCopywriterAnalytics(year)]); renderCopywriter(); copywriterSetBusy(false); }
}
async function syncCopywriterWordPress() {
    if (copywriterBusy || !copywriterDB) return;
    copywriterSetBusy(true);
    copywriterStatus('Mengambil seluruh artikel Siska untuk tahun terpilih…');
    try {
        const articles = await CopywriterCore.fetchArticles(copywriterDB.year, url => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) }));
        copywriterDB = CopywriterCore.merge(copywriterDB, articles);
        copywriterDirty = true;
        copywriterCache();
        copywriterPage = 1;
        copywriterStatus(`Berhasil menarik ${articles.length} artikel. Tersimpan lokal; klik Simpan ke GitHub untuk menyimpan JSON di repository.`);
    } catch (error) { copywriterStatus(`${error.message} Database sebelumnya tetap tersimpan.`, true); }
    finally { renderCopywriter(); copywriterSetBusy(false); }
}
async function saveCopywriterGitHub() {
    if (copywriterBusy || !copywriterDB) return;
    const config = getGHConfig();
    if (!config.token || !config.user || !config.repo) return copywriterStatus('Isi konfigurasi GitHub dan token melalui pengaturan aplikasi terlebih dahulu.', true);
    copywriterSetBusy(true);
    copywriterStatus('Menyimpan database artikel dan hari libur ke GitHub…');
    try {
        // Read the latest revision first, preserving articles added by the scheduled sync.
        const saved = await copywriterReadGitHub(copywriterDB.year);
        const next = CopywriterCore.merge(saved?.database || CopywriterCore.empty(copywriterDB.year), copywriterDB.articles, copywriterDB.lastSyncedAt);
        next.holidays = copywriterDB.holidays;
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 2) + '\n')));
        const body = { message: `Update Siska KPI database ${next.year}`, content };
        if (saved) body.sha = saved.sha;
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.user)}/${encodeURIComponent(config.repo)}/contents/${copywriterPath(next.year)}`, { method: 'PUT', headers: { Authorization: `token ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(response.status === 409 || response.status === 422 ? 'Database berubah saat disimpan. Klik Simpan ke GitHub lagi.' : `GitHub menolak penyimpanan (HTTP ${response.status}).`);
        copywriterDB = next;
        copywriterDirty = false;
        copywriterCache();
        copywriterStatus('Database artikel dan hari libur berhasil disimpan ke GitHub.');
    } catch (error) { copywriterStatus(error.message, true); }
    finally { renderCopywriter(); copywriterSetBusy(false); }
}
function saveCopywriterHolidays() {
    if (!copywriterDB) return;
    const values = document.getElementById('copywriter-holidays').value.split(/[\s,]+/).filter(Boolean);
    const valid = values.every(value => {
        const date = new Date(`${value}T00:00:00Z`);
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && value.startsWith(`${copywriterDB.year}-`) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    });
    if (!valid) return copywriterStatus('Gunakan tanggal valid YYYY-MM-DD pada tahun terpilih, dipisahkan koma atau baris baru.', true);
    copywriterDB.holidays = [...new Set(values)].sort();
    copywriterDirty = true;
    copywriterCache();
    renderCopywriter();
    copywriterStatus('Hari libur diterapkan lokal. Klik Simpan ke GitHub agar pengaturan tersimpan di JSON.');
}
function changeCopywriterPage(delta) { copywriterPage += delta; renderCopywriter(); }
function copywriterMissingMetric(article, performance) {
    if (!copywriterGSC) return 'GSC belum dimuat. Klik Muat Database.';
    if (!performance?.months.length) return 'Belum ada data final GSC untuk bulan ini.';
    const end = performance.months[performance.months.length - 1].endDate;
    const published = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(article.publishedAt + '+07:00'));
    if (published > end) return `Artikel terbit setelah batas data final GSC (${end}).`;
    return 'Google belum mengembalikan baris untuk URL ini pada periode trafik terpilih; bukan bukti trafiknya 0.';
}
function renderCopywriter() {
    if (!copywriterDB) return;
    const month = document.getElementById('copywriter-month').value;
    const result = CopywriterCore.calculate(copywriterDB, month);
    // Publication month controls production. Traffic month covers all saved articles of the year.
    const performance = copywriterPerformance(copywriterDB.articles, month);
    const analytics = copywriterAnalytics(month);
    const number = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const grade = result.score === null ? null : getKPIGrade(result.score);
    document.getElementById('copywriter-holidays').value = copywriterDB.holidays.join('\n');
    const lastSync = copywriterDB.lastSyncedAt ? new Date(copywriterDB.lastSyncedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Belum pernah';
    const pages = Math.max(1, Math.ceil(result.articles.length / 12));
    copywriterPage = Math.min(Math.max(copywriterPage, 1), pages);
    const cards = result.articles.slice((copywriterPage - 1) * 12, copywriterPage * 12).map(article => {
        const link = copywriterURL(article.link);
        const thumbnail = copywriterURL(article.thumbnailUrl);
        const title = copywriterEscape(new DOMParser().parseFromString(article.title, 'text/html').body.textContent);
        const metric = performance?.metrics.get(article.wordpressId);
        const stats = metric ? `<div style="font-size:11px; line-height:1.8; margin-top:10px; color:var(--text-muted);">Klik: <b>${number(metric.clicks)}</b> • Impresi: <b>${number(metric.impressions)}</b><br>CTR: <b>${number(metric.ctr * 100)}%</b> • Posisi: <b>${metric.position === null ? '—' : number(metric.position)}</b></div>` : `<div style="font-size:11px; margin-top:10px; color:var(--text-muted);">GSC: ${copywriterEscape(copywriterMissingMetric(article, performance))}</div>`;
        return `<article class="copywriter-article">${thumbnail ? `<img src="${thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<div style="padding:14px;"><div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">${copywriterEscape(article.publishedAt.replace('T', ' '))}</div><h4 style="margin:0 0 12px; font-size:14px; line-height:1.5;">${title}</h4>${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" style="color:var(--accent); font-size:12px; font-weight:700;">🔗 Buka Artikel</a>` : '<small>Link belum tersedia</small>'}${copywriterAnalyticsArticle(article, analytics)}${stats}</div></article>`;
    }).join('');
    const groups = [];
    for (let m = 1; m <= 12; m++) {
        const days = result.days.filter(day => Number(day.date.slice(5, 7)) === m);
        if (!days.length) continue;
        const offset = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
        const blanks = Array.from({ length: offset }, () => '<div></div>').join('');
        const calendar = days.map(day => {
            const state = !day.working ? 'holiday' : !day.elapsed ? 'future' : day.count ? 'posted' : 'missing';
            return `<div class="copywriter-day ${state}" title="${day.date}: ${day.count} artikel${!day.working ? ' • Libur' : ''}"><b>${Number(day.date.slice(8))}</b><small>${day.count ? day.count + ' artikel' : !day.working ? 'Libur' : !day.elapsed ? '—' : 'Belum'}</small></div>`;
        }).join('');
        groups.push(`<div><h4 style="font-size:14px; margin:0 0 12px;">${copywriterMonths[m - 1]}</h4><div class="copywriter-calendar">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(day => `<small style="text-align:center; color:var(--text-muted);">${day}</small>`).join('')}${blanks}${calendar}</div></div>`);
    }
    document.getElementById('copywriter-content').innerHTML = `
        <div class="creator-overview-box">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:18px;">
                <div><h3 style="margin:0 0 5px;">✍️ Siska Irma Diana</h3><div style="font-size:12px; color:var(--text-muted);">Artikel website • ${month === 'All' ? 'Semua Bulan' : copywriterMonths[Number(month) - 1]} ${copywriterDB.year}</div></div>
                <span class="grade-badge-lg ${grade?.badgeClass || 'bg-dark'}">${grade ? 'Grade Artikel ' + grade.grade : 'Belum Dinilai'}</span>
            </div>
            ${renderStatCards([
                { val: result.actual, lbl: 'Actual Artikel', sub: 'Terbit hingga hari ini' },
                { val: result.elapsedTarget, lbl: 'Target hingga Hari Ini', sub: `Target seluruh periode: ${result.target} artikel` },
                { val: result.difference, lbl: 'Selisih Artikel', sub: 'Minimum 0' },
                { val: `${result.points.toLocaleString('id-ID')} / 70`, lbl: 'Point Artikel', sub: result.score === null ? 'Periode belum berjalan' : `Capaian komponen artikel: ${result.score}%` }
            ])}
            <div style="font-size:12px; line-height:1.7; color:var(--text-muted); margin-top:14px;">
                Kuantitas: <b>${result.quantityPoints.toFixed(2)} / 55 Point</b> • Jadwal harian: <b>${result.schedulePoints.toFixed(2)} / 15 Point</b> (${result.timely} dari ${result.elapsedTarget} hari kerja terisi).<br>
                Target 1 artikel per hari selain Minggu dan tanggal libur yang diatur. Penilaian periode berjalan hanya memakai hari hingga hari ini (WIB). Artikel tambahan dapat memenuhi kuantitas, tetapi tidak menggantikan hari yang kosong.<br>
                <b>Preview penilaian produksi:</b> artikel terbit belum otomatis dinyatakan lolos kualitas. Grade ini khusus artikel; 30 Point pekerjaan pendukung belum dinilai.<br>
                ${copywriterDB.holidays.length ? `${copywriterDB.holidays.length} tanggal libur dikonfigurasi.` : '<b>Hari besar belum dikonfigurasi. Atur tanggal libur sebelum memakai nilai sebagai acuan.</b>'}<br>
                Data WordPress terakhir disinkronkan: ${copywriterEscape(lastSync)} ${copywriterDirty ? '• Ada perubahan lokal belum tersimpan ke GitHub' : ''}
            </div>
        </div>
        ${renderCopywriterAnalytics(analytics)}
        <div class="creator-overview-box"><h3 style="margin:0 0 14px; font-size:16px;">🔎 Performa Google Search</h3>
            <p style="font-size:12px; line-height:1.6; color:var(--text-muted);">Trafik ${month === 'All' ? 'sepanjang tahun' : copywriterMonths[Number(month) - 1]} untuk seluruh ${copywriterDB.articles.length} artikel Siska yang tersimpan pada tahun ${copywriterDB.year}, termasuk artikel yang terbit pada bulan sebelumnya. Filter produksi dan kalender tetap berdasarkan bulan publikasi.</p>
            ${performance?.available ? renderStatCards([
                { val: number(performance.total.clicks), lbl: 'Klik' },
                { val: number(performance.total.impressions), lbl: 'Impresi' },
                { val: number(performance.total.ctr * 100) + '%', lbl: 'CTR' },
                { val: performance.total.position === null ? '—' : number(performance.total.position), lbl: 'Posisi Rata-rata' }
            ]) : `<p style="font-size:12px; color:var(--text-muted);">${copywriterEscape(copywriterGSC ? 'Belum ada baris data GSC yang cocok untuk artikel pada periode ini.' : copywriterGSCMessage)}</p>`}
            ${performance?.months.length ? `<p style="font-size:11px; line-height:1.6; color:var(--text-muted); margin-bottom:0;">Periode trafik: ${copywriterEscape(performance.months[0].startDate)} – ${copywriterEscape(performance.months[performance.months.length - 1].endDate)} (zona waktu GSC: Pacific). Data final pencarian web; ${performance.available} dari ${copywriterDB.articles.length} artikel memiliki baris data. Artikel tanpa data tidak dianggap mendapat 0. Data tersimpan pada: ${copywriterEscape(new Date(copywriterGSC.lastSyncedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))} WIB. Performa pencarian belum memengaruhi Point produksi.</p>` : ''}
            ${performance ? renderCopywriterTrafficTable('gsc', performance) : ''}
        </div>
        <div class="creator-overview-box"><h3 style="margin:0 0 8px; font-size:16px;">📅 Kalender Publikasi</h3><p style="font-size:12px; color:var(--text-muted); margin:0 0 18px;">Hijau: terbit • Kuning: belum terbit • Merah: Minggu / hari besar yang diatur • Garis putus-putus: hari mendatang</p><div class="copywriter-calendar-grid">${groups.join('')}</div></div>
        <div class="creator-overview-box"><div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px;"><h3 style="font-size:16px; margin:0;">📰 Database Artikel (${result.articles.length})</h3><div style="display:flex; gap:8px; align-items:center;"><button class="btn-sm bg-dark" onclick="changeCopywriterPage(-1)" ${copywriterPage === 1 ? 'disabled' : ''}>←</button><small>${copywriterPage} / ${pages}</small><button class="btn-sm bg-dark" onclick="changeCopywriterPage(1)" ${copywriterPage === pages ? 'disabled' : ''}>→</button></div></div><div class="copywriter-articles">${cards || '<div class="empty-state">Belum ada artikel tersimpan pada periode ini.</div>'}</div></div>`;
}
function initializeCopywriter() {
    const today = CopywriterCore.localDate(new Date());
    document.getElementById('copywriter-year').value = today.slice(0, 4);
    document.getElementById('copywriter-month').innerHTML = '<option value="All">Semua Bulan</option>' + copywriterMonths.map((month, index) => `<option value="${index + 1}">${month}</option>`).join('');
    document.getElementById('copywriter-month').value = String(Number(today.slice(5, 7)));
    loadCopywriterDatabase(true);
}
document.addEventListener('DOMContentLoaded', initializeCopywriter);

async function loadCopywriterAnalytics(year) {
    copywriterGA4 = null;
    try {
        let data;
        try { data = (await copywriterReadGitHub(year, 'ga4'))?.database; } catch { /* Deployed fallback. */ }
        if (!data) {
            const response = await fetch(`json/${year}/kpi-copywriter-siska-ga4-${year}.json?v=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) return;
            data = await response.json();
        }
        if (data.year !== year || !Array.isArray(data.months)) return;
        copywriterGA4 = data;
    } catch { /* No stale Analytics totals presented as current data. */ }
}
function copywriterAnalytics(month) {
    return copywriterGA4?.months.find(period => period.month === (month === 'All' ? 'All' : `${copywriterDB.year}-${String(month).padStart(2, '0')}`)) || null;
}
function copywriterAnalyticsArticle(article, period) {
    const metric = period?.articles.find(row => row.wordpressId === article.wordpressId)?.metrics;
    const number = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    return `<div style="font-size:11px; line-height:1.8; margin-top:10px; color:var(--text-muted);">${metric ? `GA4 Views: <b>${number(metric.views)}</b> • Pengguna aktif: <b>${number(metric.activeUsers)}</b><br>Keterlibatan per pengguna aktif: <b>${metric.averageEngagementSeconds === null ? '—' : number(metric.averageEngagementSeconds) + ' detik'}</b>` : 'GA4: Belum tersedia data kunjungan untuk artikel ini pada periode terpilih.'}</div>`;
}
function renderCopywriterAnalytics(period) {
    const number = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    const total = period?.total;
    return `<div class="creator-overview-box"><h3 style="margin:0 0 14px; font-size:16px;">📈 Pembaca Artikel — Google Analytics</h3>
        <p style="font-size:12px; color:var(--text-muted);">Kunjungan dari seluruh sumber untuk artikel Siska yang tersimpan pada tahun terpilih, termasuk artikel yang terbit pada bulan sebelumnya.</p>
        ${total ? renderStatCards([{val:number(total.views),lbl:'Views Artikel'},{val:number(total.activeUsers),lbl:'Pengguna Aktif'},{val:total.averageEngagementSeconds === null ? '—' : number(total.averageEngagementSeconds) + ' detik',lbl:'Keterlibatan per Pengguna Aktif'}]) : '<p style="font-size:12px; color:var(--text-muted);">Data GA4 belum tersedia untuk periode ini.</p>'}
        ${period ? `<p style="font-size:11px; line-height:1.6; color:var(--text-muted);">Periode: ${copywriterEscape(period.startDate)} – ${copywriterEscape(period.endDate)} (${copywriterEscape(copywriterGA4.dateTimezone)}). Hari ini belum disertakan; data terbaru masih dapat diperbarui Google. Pengguna dihitung untuk seluruh periode, bukan penjumlahan pengguna tiap artikel. Data tersimpan: ${copywriterEscape(new Date(copywriterGA4.lastSyncedAt).toLocaleString('id-ID'))}. Belum memengaruhi Point produksi.${period.metadata?.subjectToThresholding ? ' Google menerapkan ambang privasi pada laporan ini.' : ''}${period.metadata?.dataLossFromOtherRow ? ' Sebagian rincian digabung oleh Google ke baris lain.' : ''}</p>` : ''}
        ${period ? renderCopywriterTrafficTable('ga4', period) : ''}
    </div>`;
}

const copywriterTables = {
    ga4: { page: 1, query: '', open: false },
    gsc: { page: 1, query: '', open: false }
};
function copywriterTrafficSelection(kind, data) {
    const state = copywriterTables[kind];
    const metrics = kind === 'gsc' ? data.metrics : new Map(data.articles.map(row => [row.wordpressId, row.metrics]));
    const articles = copywriterDB.articles.filter(article => new DOMParser().parseFromString(article.title, 'text/html').body.textContent.toLocaleLowerCase('id-ID').includes(state.query.toLocaleLowerCase('id-ID')))
        .sort((a,b) => (metrics.get(b.wordpressId)?.[kind === 'gsc' ? 'impressions' : 'views'] || 0) - (metrics.get(a.wordpressId)?.[kind === 'gsc' ? 'impressions' : 'views'] || 0));
    const pages = Math.max(1, Math.ceil(articles.length / 10));
    state.page = Math.min(Math.max(1, state.page), pages);
    return { metrics, articles: articles.slice((state.page - 1) * 10, state.page * 10), count: articles.length, pages };
}
function renderCopywriterTrafficTable(kind, data) {
    const state = copywriterTables[kind];
    const { metrics, articles, count, pages } = copywriterTrafficSelection(kind, data);
    const number = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 });
    const labels = kind === 'gsc' ? ['Artikel','Klik','Impresi','CTR','Posisi'] : ['Artikel','Views','Pengguna aktif','Keterlibatan / pengguna aktif'];
    const style = 'padding:10px; text-align:left; border-bottom:1px solid var(--border);';
    const rows = articles.map(article => {
        const metric = metrics.get(article.wordpressId);
        const title = copywriterEscape(new DOMParser().parseFromString(article.title, 'text/html').body.textContent);
        const link = copywriterURL(article.link);
        const values = !metric ? null : kind === 'gsc' ? [number(metric.clicks),number(metric.impressions),number(metric.ctr*100)+'%',metric.position === null ? '—' : number(metric.position)] : [number(metric.views),number(metric.activeUsers),metric.averageEngagementSeconds === null ? '—' : number(metric.averageEngagementSeconds)+' detik'];
        return `<tr><td style="${style} min-width:220px;">${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${title}</a>` : title}<small style="display:block; color:var(--text-muted);">Terbit: ${copywriterEscape(article.publishedAt.slice(0,10))}</small></td>${values ? values.map(value => `<td style="${style} white-space:nowrap;">${value}</td>`).join('') : `<td colspan="${labels.length-1}" style="${style} color:var(--text-muted);">${kind === 'gsc' ? copywriterEscape(copywriterMissingMetric(article,data)) : 'Data kunjungan belum tersedia untuk periode ini.'}</td>`}</tr>`;
    }).join('');
    return `<details id="copywriter-table-${kind}" ${state.open ? 'open' : ''} ontoggle="copywriterTables.${kind}.open=this.open" style="margin-top:16px;"><summary style="cursor:pointer; font-weight:700; font-size:13px;">Rincian ${kind.toUpperCase()} semua artikel (${copywriterDB.articles.length})</summary><div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px;"><input type="search" aria-label="Cari judul artikel ${kind.toUpperCase()}" class="form-control" style="max-width:300px; margin:0;" placeholder="Cari judul artikel…" value="${copywriterEscape(state.query)}" onchange="changeCopywriterTraffic('${kind}',this.value)"><small style="color:var(--text-muted);">${count} artikel • ${kind === 'gsc' ? 'Impresi' : 'Views'} tertinggi dahulu</small></div><div style="overflow:auto; max-height:480px; margin-top:12px;"><table style="width:100%; font-size:12px; border-collapse:collapse;"><thead style="position:sticky; top:0; background:var(--bg-card, #fff);"><tr>${labels.map(label => `<th style="${style}">${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${labels.length}" style="${style}">Tidak ada artikel yang cocok.</td></tr>`}</tbody></table></div><div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;"><small>10 artikel per halaman • ${state.page} / ${pages}</small><div style="display:flex; gap:8px;"><button class="btn-sm bg-dark" onclick="pageCopywriterTraffic('${kind}',-1)" ${state.page===1 ? 'disabled' : ''}>← Sebelumnya</button><button class="btn-sm bg-dark" onclick="pageCopywriterTraffic('${kind}',1)" ${state.page===pages ? 'disabled' : ''}>Berikutnya →</button></div></div></details>`;
}
function refreshCopywriterTraffic(kind) {
    const month = document.getElementById('copywriter-month').value;
    const data = kind === 'gsc' ? copywriterPerformance(copywriterDB.articles,month) : copywriterAnalytics(month);
    const element = document.getElementById(`copywriter-table-${kind}`);
    if (data && element) element.outerHTML = renderCopywriterTrafficTable(kind,data);
}
function changeCopywriterTraffic(kind, query) {
    copywriterTables[kind].query=query;
    copywriterTables[kind].page=1;
    copywriterTables[kind].open=true;
    refreshCopywriterTraffic(kind);
}
function pageCopywriterTraffic(kind, delta) {
    copywriterTables[kind].page+=delta;
    copywriterTables[kind].open=true;
    refreshCopywriterTraffic(kind);
}
async function syncCopywriterAll() {
    if (copywriterBusy) return;
    const year = copywriterYear();
    if (!Number.isInteger(year) || year<2000 || year>2100) return copywriterStatus('Tahun harus antara 2000 dan 2100.',true);
    const config = getGHConfig();
    if (!config.token || !config.user || !config.repo) return copywriterStatus('Isi konfigurasi GitHub dan token di pengaturan aplikasi untuk menjalankan sinkronisasi.',true);
    copywriterSetBusy(true);
    try {
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(config.user)}/${encodeURIComponent(config.repo)}/actions/workflows/sync-copywriter.yml/dispatches`, {
            method:'POST', headers:{Authorization:`token ${config.token}`,'Content-Type':'application/json'},
            body:JSON.stringify({ref:'main',inputs:{year:String(year)}})
        });
        if (!response.ok) throw new Error(`Sinkronisasi tidak dapat dijalankan (HTTP ${response.status}). Token GitHub perlu akses Actions write.`);
        copywriterStatus(`Sinkronisasi WordPress, GSC, dan GA4 tahun ${year} sudah diminta. Proses berjalan di server; klik Muat Database setelah workflow selesai.`);
    } catch(error) { copywriterStatus(error.message,true); }
    finally { copywriterSetBusy(false); }
}
