/* Daily activity records are independent of WordPress article production points. */
const SiskaActivity = (() => {
    const types = ['Menulis Artikel', 'Membuat Script Konten', 'Membuat Caption', 'Upload / Menjadwalkan Konten', 'Koordinasi Talent', 'Pendampingan Shooting', 'Revisi Artikel / Script / Caption', 'Report MKT', 'Voice Over', 'Lainnya'];
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const el = id => document.getElementById(id);
    const defaultPath = year => `json/${year}/activity-log-siska-${year}.json`;
    const path = year => {
        try { return JSON.parse(localStorage.getItem('honda_siska_activity_paths') || '{}')[year] || defaultPath(year); }
        catch { return defaultPath(year); }
    };
    const key = year => `honda_siska_activity_${year}${path(year) === defaultPath(year) ? '' : '_' + path(year)}`;
    const localDate = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
    let state = null, editing = null, busy = false;
    const reportLoads = new Map();
    function validate(data, year) {
        if (data?.year !== year || !Array.isArray(data.activities)) throw Error('Format log aktivitas tidak sesuai.');
        const ids = new Set();
        for (const row of data.activities) {
            if (typeof row.id !== 'string' || ids.has(row.id) || !validDate(row.date) || !row.date.startsWith(`${year}-`) || !types.includes(row.type) || typeof row.title !== 'string' || !row.title.trim() || (row.description !== undefined && typeof row.description !== 'string') || (row.proof !== undefined && typeof row.proof !== 'string')) throw Error('Data aktivitas tidak valid.');
            ids.add(row.id);
        }
        return data;
    }
    function cache(year) {
        try { const value = JSON.parse(localStorage.getItem(key(year))); if (value) { validate(value.database, year); return value; } } catch { /* Invalid cache is not used. */ }
        return {database:{version:1,year,activities:[]}, pending:{}};
    }
    function persist(value = state) { localStorage.setItem(key(value.database.year), JSON.stringify(value)); }
    let messageTimer;
    function message(text, kind = 'info') {
        clearTimeout(messageTimer);
        const node = el('github-status-activity');
        node.textContent = text;
        node.style.color = kind === 'error' ? '#e74c3c' : kind === 'success' ? 'green' : 'var(--text-muted)';
        if (kind !== 'loading') messageTimer = setTimeout(() => { node.textContent = ''; }, 5000);
    }
    function setPath(value) {
        if (busy) return;
        const year = Number(el('activity-year').value), selected = value.trim();
        if (!selected.endsWith('.json') || selected.startsWith('/') || selected.split('/').includes('..')) {
            el('gh-path-activity').value = path(year);
            return message('Gunakan file path JSON relatif terhadap repository.', 'error');
        }
        const paths = JSON.parse(localStorage.getItem('honda_siska_activity_paths') || '{}');
        paths[year] = selected;
        localStorage.setItem('honda_siska_activity_paths', JSON.stringify(paths));
        reportLoads.delete(year); state = null;
        load(true);
    }
    let editor = null;
    function initializeEditor() {
        if (editor || !window.CKEDITOR) return;
        editor = CKEDITOR.replace('activity-description', {
            versionCheck:false,
            height:240,
            resize_enabled:true,
            removePlugins:'exportpdf',
            toolbar:[
                {name:'document',items:['Source','Preview']},
                {name:'clipboard',items:['Cut','Copy','Paste','PasteText','PasteFromWord','-','Undo','Redo']},
                {name:'basicstyles',items:['Bold','Italic','Underline','Strike','Subscript','Superscript','-','RemoveFormat']},
                '/',
                {name:'paragraph',items:['NumberedList','BulletedList','-','Outdent','Indent','Blockquote','-','JustifyLeft','JustifyCenter','JustifyRight','JustifyBlock']},
                {name:'links',items:['Link','Unlink']},
                {name:'insert',items:['Table','HorizontalRule','SpecialChar']},
                '/',
                {name:'styles',items:['Format','Font','FontSize']},
                {name:'colors',items:['TextColor','BGColor']},
                {name:'tools',items:['Maximize']}
            ]
        });
        editor.on('instanceReady', () => editor.setReadOnly(busy));
    }
    const editorData = () => editor ? editor.getData() : el('activity-description').value;
    function setEditorData(value) {
        el('activity-description').value = value;
        if (editor) editor.setData(value);
    }
    function setBusy(value) { busy = value; document.querySelectorAll('#siska-activity-section button, #siska-activity-section input, #siska-activity-section select, #siska-activity-section textarea').forEach(node => node.disabled = value); if (editor?.status === 'ready') editor.setReadOnly(value); }
    async function remote(year) {
        const config = getGHConfig();
        const url = `https://api.github.com/repos/${encodeURIComponent(config.user)}/${encodeURIComponent(config.repo)}/contents/${path(year)}`;
        const headers = config.token ? {Authorization:`token ${config.token}`} : {};
        const response = await fetch(url, {headers,cache:'no-store'});
        if (response.status === 404) return {database:{version:1,year,activities:[]},sha:null,url};
        if (!response.ok) throw Error(`Gagal membaca GitHub (HTTP ${response.status}).`);
        const file = await response.json();
        return {database:validate(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0)))),year),sha:file.sha,url};
    }
    async function read(year) {
        try {
            const saved = await remote(year);
            if (saved.sha) return saved;
        } catch { /* Read the deployed JSON when GitHub is unavailable. */ }
        const response = await fetch(`${path(year)}?v=${Date.now()}`, {cache:'no-store'});
        if (!response.ok) throw Error(`JSON aktivitas belum dapat dimuat (HTTP ${response.status}). Perubahan lokal tetap tersimpan.`);
        return {database:validate(await response.json(),year)};
    }
    function merge(saved, local) {
        const rows = new Map(saved.activities.map(row=>[row.id,row]));
        for (const [id, change] of Object.entries(local.pending)) {
            const latest = rows.get(id) || null;
            if (JSON.stringify(latest) !== JSON.stringify(change.base) && JSON.stringify(latest) !== JSON.stringify(change.row)) throw Error('Aktivitas yang sama berubah di perangkat lain. Data lokal tetap tersimpan; selesaikan perbedaan sebelum sinkronisasi.');
            if (change.row === null) rows.delete(id);
            else rows.set(id, change.row);
        }
        return {...saved,activities:[...rows.values()]};
    }
    async function load(force = false) {
        if (busy) return;
        const year = Number(el('activity-year').value);
        el('gh-path-activity').value = path(year);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return message('Tahun harus antara 2000 dan 2100.');
        if (state?.database.year === year && !force) return render();
        state = cache(year); reset(); render(); setBusy(true);
        message('Menarik data JSON... ⏳', 'loading');
        try {
            const saved = await read(year);
            state.database = merge(saved.database,state); persist();
            message('✅ Log aktivitas berhasil dimuat.', 'success');
        } catch (error) { message(`${error.message} Menggunakan data lokal.`, 'error'); }
        finally { setBusy(false); render(); report(); }
    }
    function reset() {
        editing = null; el('activity-form').reset(); setEditorData('');
        const today = localDate(); el('activity-date').value = today.startsWith(`${el('activity-year').value}-`) ? today : `${el('activity-year').value}-01-01`;
        el('activity-form-title').textContent = 'Tambah aktivitas';
    }
    function save(event) {
        event.preventDefault(); if (busy || !state) return;
        const original = state.database.activities.find(item=>item.id===editing);
        if (editing && !canManageOwnedRecord(original)) return message('Hanya pembuat data atau Superadmin yang dapat mengedit.', 'error');
        const createdBy = original?.createdBy || sessionStorage.getItem('auth_user');
        if (!createdBy) return message('Login terlebih dahulu untuk menyimpan aktivitas.', 'error');
        const row = {createdBy,id:editing || crypto.randomUUID(),date:el('activity-date').value,type:el('activity-type').value,title:el('activity-title').value.trim(),description:sanitize(editorData())};
        try {
            validate({year:state.database.year,activities:[row]},state.database.year);
            const next = JSON.parse(JSON.stringify(state));
            const previous = next.database.activities.find(item=>item.id===row.id) || null;
            next.pending[row.id] = {base:next.pending[row.id] ? next.pending[row.id].base : previous,row};
            next.database.activities = next.database.activities.filter(item=>item.id!==row.id).concat(row);
            persist(next); state = next; reset(); render(); report(); message('✅ Aktivitas tersimpan secara lokal.', 'success');
        } catch (error) { message(error.message, 'error'); }
    }
    function edit(id) {
        if (busy) return;
        const row = state.database.activities.find(item=>item.id===id); if (!row) return;
        if (!canManageOwnedRecord(row)) return message('Hanya pembuat data atau Superadmin yang dapat mengedit.', 'error');
        editing = id;
        for (const field of ['date','type','title']) el(`activity-${field}`).value = row[field];
        setEditorData(description(row));
        el('activity-form-title').textContent = 'Edit aktivitas'; el('activity-form').scrollIntoView({behavior:'smooth',block:'start'});
    }
    async function sync() {
        if (busy || !state) return;
        const config = getGHConfig();
        if (!config.token || !config.user || !config.repo) return message('Isi konfigurasi GitHub di Pengaturan Global terlebih dahulu.');
        if (Object.values(state.pending).some(change => !canManageOwnedRecord(change.base || change.row))) return message('Ada perubahan milik user lain. Hanya pembuat data atau Superadmin yang dapat menyimpannya.', 'error');
        setBusy(true); message('Menyimpan log aktivitas ke GitHub…', 'loading');
        try {
            const saved = await remote(state.database.year);
            const database = merge(saved.database,state);
            const bytes = new TextEncoder().encode(JSON.stringify(database,null,2)+'\n');
            const body = {message:`Update Siska activity log ${database.year}`,content:btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''))};
            if (saved.sha) body.sha = saved.sha;
            const response = await fetch(saved.url,{method:'PUT',headers:{Authorization:`token ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
            if (!response.ok) throw Error(response.status===409 || response.status===422 ? 'Database berubah saat disimpan. Coba Simpan ke GitHub lagi.' : `Gagal menyimpan (HTTP ${response.status}).`);
            state = {database,pending:{}}; persist(); message('✅ Berhasil tersimpan di GitHub!', 'success');
        } catch (error) { message(error.message, 'error'); }
        finally { setBusy(false); render(); report(); }
    }
    function sanitize(html) {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const allowed = new Set(['P','DIV','SPAN','BR','B','STRONG','I','EM','U','S','SUB','SUP','UL','OL','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','A','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CAPTION','HR']);
        const walk = node => {
            if (node.nodeType === 3) return esc(node.textContent);
            if (node.nodeType !== 1) return '';
            if (['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName)) return '';
            const content = Array.from(node.childNodes,walk).join('');
            if (!allowed.has(node.tagName)) return content;
            const tag = node.tagName.toLowerCase();
            let attributes = '';
            if (tag === 'a') {
                try {
                    const url = new URL(node.getAttribute('href'));
                    if (['https:','http:','mailto:','tel:'].includes(url.protocol)) attributes += ` href="${esc(url.href)}" target="_blank" rel="noopener noreferrer"`;
                } catch { /* Unsafe links have no href. */ }
            }
            const styles = [];
            for (const property of ['text-align','color','background-color','font-size','font-family','font-weight','font-style','text-decoration','text-decoration-line','vertical-align','line-height','white-space','margin-left','padding-left','list-style-type','width','height','border','border-collapse','border-width','border-style','border-color','padding']) {
                const value = node.style.getPropertyValue(property);
                if (value && !/url|expression|[<>]/i.test(value)) styles.push(`${property}:${value}`);
            }
            if (styles.length) attributes += ` style="${esc(styles.join(';'))}"`;
            if (['ol','ul'].includes(tag)) {
                const start = node.getAttribute('start');
                if (tag === 'ol' && /^-?\d{1,6}$/.test(start || '')) attributes += ` start="${start}"`;
            }
            for (const attr of ['colspan','rowspan']) {
                const value = node.getAttribute(attr);
                if (['td','th'].includes(tag) && /^[1-9]\d?$/.test(value || '')) attributes += ` ${attr}="${value}"`;
            }
            return ['br','hr'].includes(tag) ? `<${tag}>` : `<${tag}${attributes}>${content}</${tag}>`;
        };
        return Array.from(doc.body.childNodes,walk).join('');
    }
    const description = row => row.description !== undefined ? sanitize(row.description) : esc(row.proof || '').replace(/\n/g,'<br>');
    function detail(id, year) {
        const database = state?.database.year === Number(year) ? state.database : cache(Number(year)).database;
        const row = database.activities.find(item=>item.id===id); if (!row) return;
        el('activity-detail-title').textContent = row.title;
        el('activity-detail-meta').textContent = `${row.date} • ${row.type}`;
        el('activity-detail-description').innerHTML = description(row) || '<p>Belum ada keterangan.</p>';
        el('activity-detail-modal').showModal();
    }
    function remove(id) {
        if (busy || !state) return;
        const row = state.database.activities.find(item=>item.id===id);
        if (!canManageOwnedRecord(row)) return message('Hanya pembuat data atau Superadmin yang dapat menghapus.', 'error');
        if (!row || !confirm(`Hapus aktivitas "${row.title}"?`)) return;
        try {
            const next = JSON.parse(JSON.stringify(state));
            if (next.pending[id] && next.pending[id].base === null) delete next.pending[id];
            else next.pending[id] = {base:next.pending[id] ? next.pending[id].base : row,row:null};
            next.database.activities = next.database.activities.filter(item=>item.id!==id);
            persist(next); state = next;
            if (editing === id) reset();
            render(); report(); message('Aktivitas dihapus lokal. Simpan JSON untuk memperbarui GitHub.', 'success');
        } catch (error) { message(error.message, 'error'); }
    }
    function table(rows, editable = false, year = state?.database.year) {
        return `<div class="table-responsive"><table class="data-table"><thead><tr><th>Tanggal</th><th>Jenis pekerjaan</th><th>Judul pekerjaan</th><th>Aksi</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.date)}</td><td>${esc(row.type)}</td><td>${esc(row.title)}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn-sm bg-dark" data-activity-action="detail" data-activity-year="${year}" data-activity-id="${esc(row.id)}">Detail</button>${editable && canManageOwnedRecord(row) ? `<button type="button" class="btn-sm bg-info" data-activity-action="edit" data-activity-id="${esc(row.id)}">Edit</button><button type="button" class="btn-sm bg-red" data-activity-action="remove" data-activity-id="${esc(row.id)}">Hapus</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;">Belum ada aktivitas untuk filter ini.</td></tr>'}</tbody></table></div>`;
    }
    function render(resetPage = false) {
        if (resetPage) tableState.activity.page = 1;
        if (!state) return;
        const rows = state.database.activities.filter(row=>(!el('activity-filter-month').value || Number(row.date.slice(5,7))===Number(el('activity-filter-month').value)) && (!el('activity-filter-type').value || row.type===el('activity-filter-type').value));
        setUnsavedChange('activity', Object.keys(state.pending).length > 0);
        const search = el('activity-search').value.trim().toLocaleLowerCase('id-ID');
        const filtered = rows.filter(row => `${row.title} ${row.type} ${new DOMParser().parseFromString(description(row), 'text/html').body.textContent}`.toLocaleLowerCase('id-ID').includes(search)).sort((a,b)=>b.date.localeCompare(a.date));
        const paginated = paginateData(filtered, 'activity');
        el('activity-history').innerHTML = `<p>${filtered.length} pekerjaan • ${Object.keys(state.pending).length} perubahan belum disimpan ke GitHub</p>`+table(paginated,true);
    }
    function report() {
        const target = el('activity-report'); if (!target) return;
        const year = Number(el('copywriter-year').value), month = el('copywriter-month').value;
        const local = state?.database.year===year ? state : cache(year);
        const rows = local.database.activities.filter(row=>month==='All' || Number(row.date.slice(5,7))===Number(month));
        target.innerHTML = `<div class="creator-overview-box" style="padding:20px;margin-top:20px;"><h3>📝 Aktivitas Pendukung Siska</h3><p>${rows.length} aktivitas tercatat</p><p style="color:var(--text-muted);">Rekap aktivitas belum memengaruhi skor KPI artikel.</p>${types.map(type=>{const total=rows.filter(row=>row.type===type).length;return total?`<p><b>${esc(type)}:</b> ${total} aktivitas</p>`:'';}).join('')}${table(rows,false,year)}<button class="btn-sm bg-blue" onclick="openTool('siska-activity')">Buka Log Aktivitas</button></div>`;
        if (!reportLoads.has(year) && !busy) {
            reportLoads.set(year,true);
            read(year).then(saved=>{const cached=cache(year);cached.database=merge(saved.database,cached);persist(cached);if(state?.database.year===year)state=cached;report();}).catch(()=>{target.insertAdjacentHTML('beforeend','<p>Rekap memakai data lokal; buka Log Aktivitas untuk menarik data terbaru.</p>');});
        }
    }
    document.addEventListener('DOMContentLoaded',()=>{
        el('activity-year').value = localDate().slice(0,4);
        el('gh-path-activity').value = path(Number(el('activity-year').value));
        el('activity-type').innerHTML = types.map(type=>`<option>${esc(type)}</option>`).join('');
        el('activity-filter-type').innerHTML = '<option value="">Semua Jenis</option>'+el('activity-type').innerHTML;
        el('activity-filter-month').innerHTML = '<option value="">Semua Bulan</option>'+Array.from({length:12},(_,i)=>`<option value="${i+1}">${new Intl.DateTimeFormat('id-ID',{month:'long'}).format(new Date(2026,i,1))}</option>`).join('');
        el('activity-filter-month').value = String(Number(localDate().slice(5,7)));
        el('activity-form').addEventListener('submit',save);
        document.addEventListener('click',event=>{
            const button = event.target.closest('[data-activity-action]'); if (!button) return;
            const {activityAction:action,activityId:id,activityYear:year} = button.dataset;
            if (action === 'detail') detail(id,year);
            else if (action === 'edit') edit(id);
            else if (action === 'remove') remove(id);
        });
        initializeEditor();
        reset();
    });
    return {load,sync,reset,render,report,validate,merge,setPath};
})();
