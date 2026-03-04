/**
 * app.js — Main application controller
 * Handles: navigation, all CRUD pages, timetable generation UI,
 * heatmap, conflict report, exports, CSV upload
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const COLORS = 12; // number of subject color classes

// ──────────────────────────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────────────────────────
function navigate(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
    const nav = document.querySelector(`[data-page="${pageId}"]`);
    if (nav) nav.classList.add('active');
    document.querySelector('.topbar h1').textContent = nav?.dataset?.label || pageId;
    window._currentPage = pageId;
    loadPage(pageId);
}

function loadPage(id) {
    switch (id) {
        case 'dashboard': loadDashboard(); break;
        case 'faculty': loadFaculty(); break;
        case 'subjects': loadSubjects(); break;
        case 'rooms': loadRooms(); break;
        case 'classes': loadClasses(); break;
        case 'settings': loadSettings(); break;
        case 'generate': loadGeneratePage(); break;
        case 'logs': loadLogs(); break;
    }
}

// ──────────────────────────────────────────────────────────────────
// THEME TOGGLE
// ──────────────────────────────────────────────────────────────────
function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme');
    const next = curr === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const btn = document.getElementById('theme-btn');
    if (btn) btn.innerHTML = next === 'light'
        ? '<span>🌙</span> Dark Mode'
        : '<span>☀️</span> Light Mode';
}

// ──────────────────────────────────────────────────────────────────
// SIDEBAR BADGE UPDATER
// ──────────────────────────────────────────────────────────────────
async function refreshNavBadges() {
    const [fac, sub, rm, cls] = await Promise.all([
        DB.count('faculty'), DB.count('subjects'), DB.count('rooms'), DB.count('classes')
    ]);
    set('faculty-count-badge', fac);
    set('subjects-count-badge', sub);
    set('rooms-count-badge', rm);
    set('classes-count-badge', cls);
    // Also update inline page badges
    set('faculty-total-badge', fac + ' faculty');
}

// ──────────────────────────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────────────────────────
async function loadDashboard() {
    const [fac, sub, rm, cls] = await Promise.all([
        DB.count('faculty'), DB.count('subjects'), DB.count('rooms'), DB.count('classes')
    ]);
    const logs = await DB.getAll('genLog');
    const lastLog = logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

    set('stat-faculty', fac);
    set('stat-subjects', sub);
    set('stat-rooms', rm);
    set('stat-classes', cls);
    set('stat-gens', logs.length);
    set('stat-score', lastLog ? lastLog.softScore : '—');

    // Update sidebar badges
    await refreshNavBadges();

    // Recent generations table
    const tbody = document.getElementById('recent-gens-tbody');
    if (tbody) {
        tbody.innerHTML = logs.slice(0, 5).map(l => `
      <tr>
        <td style="font-family:monospace;font-size:11px">${l.id}</td>
        <td>${new Date(l.timestamp).toLocaleString()}</td>
        <td>${l.execTimeMs}ms</td>
        <td>${l.softScore}/100</td>
        <td>${l.totalSlots}</td>
        <td><span class="badge ${l.valid ? 'badge-valid' : 'badge-invalid'}">${l.status}</span></td>
      </tr>`).join('') || '<tr><td colspan="6" class="text-muted text-sm" style="text-align:center;padding:20px">No generations yet. Click "Load Demo Data" to get started!</td></tr>';
    }
}

function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ──────────────────────────────────────────────────────────────────
// FACULTY
// ──────────────────────────────────────────────────────────────────
async function loadFaculty() {
    const faculty = await DB.getAll('faculty');
    const tbody = document.getElementById('faculty-tbody');
    if (!tbody) return;
    tbody.innerHTML = faculty.map(f => `
    <tr>
      <td><span class="badge badge-theory">${f.id}</span></td>
      <td><strong>${f.name}</strong></td>
      <td>${(f.subjects || []).map(s => `<span class="badge badge-lab" style="margin:1px">${s}</span>`).join(' ') || '—'}</td>
      <td><span class="badge badge-theory">${(f.subjects || []).length} subject(s)</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editFaculty('${f.id}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFaculty('${f.id}')">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No faculty added yet</td></tr>';
    set('faculty-count-badge', faculty.length);
    set('faculty-total-badge', faculty.length + ' faculty');
    refreshNavBadges();
}

function showFacultyModal(faculty) {
    const isEdit = !!faculty;
    const subs = faculty?.subjects || [];
    const avail = faculty?.availability || Array.from({ length: 6 }, () => Array(8).fill(true));

    document.getElementById('faculty-modal-title').textContent = isEdit ? 'Edit Faculty' : 'Add Faculty';
    document.getElementById('fm-id').value = faculty?.id || '';
    document.getElementById('fm-name').value = faculty?.name || '';
    document.getElementById('fm-subs').value = (faculty?.subjects || []).join(', ');
    document.getElementById('fm-edit-id').value = isEdit ? faculty.id : '';

    // Build availability matrix
    buildAvailMatrix('fm-avail', avail);
    openModal('faculty-modal');
}

function buildAvailMatrix(containerId, avail) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const periods = 8;
    let html = '<table><thead><tr><th>Day</th>';
    for (let p = 0; p < periods; p++) html += `<th>P${p + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let d = 0; d < 6; d++) {
        html += `<tr><td style="font-size:11px;color:var(--text-muted);font-weight:600">${days[d]}</td>`;
        for (let p = 0; p < periods; p++) {
            const isAvail = avail[d]?.[p] !== false;
            html += `<td><div class="avail-cell ${isAvail ? 'available' : 'unavailable'}"
        onclick="toggleAvail(this,${d},${p})" data-d="${d}" data-p="${p}"
        data-avail="${isAvail}" title="${days[d]} P${p + 1}">
        ${isAvail ? '✓' : '✗'}</div></td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function toggleAvail(el, d, p) {
    const isAvail = el.dataset.avail === 'true';
    el.dataset.avail = !isAvail;
    el.className = `avail-cell ${!isAvail ? 'available' : 'unavailable'}`;
    el.textContent = !isAvail ? '✓' : '✗';
}

function readAvailMatrix(containerId) {
    const container = document.getElementById(containerId);
    const avail = Array.from({ length: 6 }, () => Array(8).fill(true));
    container.querySelectorAll('.avail-cell').forEach(el => {
        const d = parseInt(el.dataset.d);
        const p = parseInt(el.dataset.p);
        avail[d][p] = el.dataset.avail === 'true';
    });
    return avail;
}

async function saveFaculty() {
    const id = document.getElementById('fm-id').value.trim();
    const name = document.getElementById('fm-name').value.trim();
    const subs = document.getElementById('fm-subs').value.split(',').map(s => s.trim()).filter(Boolean);
    const editId = document.getElementById('fm-edit-id').value;
    const availability = readAvailMatrix('fm-avail');

    if (!id || !name) return showToast('Faculty ID and Name are required.', 'warning');

    // Duplicate check
    const existing = await DB.getOne('faculty', id);
    if (existing && existing.id !== editId) return showToast('Faculty ID already exists.', 'warning');

    await DB.put('faculty', { id, name, subjects: subs, availability });
    closeModal('faculty-modal');
    loadFaculty();
    showToast(`Faculty "${name}" saved.`, 'success');
}

async function deleteFaculty(id) {
    if (!confirm('Delete this faculty member?')) return;
    await DB.del('faculty', id);
    loadFaculty();
    showToast('Faculty deleted.', 'success');
}

async function editFaculty(id) {
    const f = await DB.getOne('faculty', id);
    if (f) showFacultyModal(f);
}

// Faculty CSV Upload
async function parseFacultyCSV(text) {
    const lines = text.trim().split('\n').slice(1); // skip header
    let added = 0, skipped = 0;
    for (const line of lines) {
        const cols = parseCSVLine(line);
        if (cols.length < 2) { skipped++; continue; }
        const [id, name, subsRaw] = cols;
        if (!id || !name) { skipped++; continue; }
        const existing = await DB.getOne('faculty', id.trim());
        if (existing) { skipped++; continue; }
        const subs = subsRaw ? subsRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
        const avail = Array.from({ length: 6 }, () => Array(8).fill(true));
        await DB.put('faculty', { id: id.trim(), name: name.trim(), subjects: subs, availability: avail });
        added++;
    }
    showToast(`CSV: ${added} faculty added, ${skipped} skipped.`, added > 0 ? 'success' : 'warning');
    loadFaculty();
}

// ──────────────────────────────────────────────────────────────────
// SUBJECTS
// ──────────────────────────────────────────────────────────────────
async function loadSubjects() {
    const subjects = await DB.getAll('subjects');
    const tbody = document.getElementById('subjects-tbody');
    if (!tbody) return;
    tbody.innerHTML = subjects.map(s => `
    <tr>
      <td><span class="badge badge-${s.type === 'Lab' ? 'lab' : 'theory'}">${s.code}</span></td>
      <td>${s.name}</td>
      <td><span class="badge badge-${s.type === 'Lab' ? 'lab' : 'theory'}">${s.type}</span></td>
      <td>${s.weeklyHours}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editSubject('${s.code}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s.code}')">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No subjects added yet</td></tr>';
    set('subjects-count-badge', subjects.length);
}

async function saveSubject() {
    const code = document.getElementById('sm-code').value.trim().toUpperCase();
    const name = document.getElementById('sm-name').value.trim();
    const type = document.getElementById('sm-type').value;
    const hrs = parseInt(document.getElementById('sm-hours').value) || 1;
    const editCode = document.getElementById('sm-edit-code').value;

    if (!code || !name) return showToast('Subject Code and Name are required.', 'warning');

    const existing = await DB.getOne('subjects', code);
    if (existing && existing.code !== editCode) return showToast('Subject code already exists.', 'warning');

    await DB.put('subjects', { code, name, type, weeklyHours: hrs });
    closeModal('subject-modal');
    loadSubjects();
    showToast(`Subject "${name}" saved.`, 'success');
}

async function deleteSubject(code) {
    if (!confirm('Delete this subject?')) return;
    await DB.del('subjects', code);
    loadSubjects();
    showToast('Subject deleted.', 'success');
}

async function editSubject(code) {
    const s = await DB.getOne('subjects', code);
    if (!s) return;
    document.getElementById('subject-modal-title').textContent = 'Edit Subject';
    document.getElementById('sm-code').value = s.code;
    document.getElementById('sm-name').value = s.name;
    document.getElementById('sm-type').value = s.type;
    document.getElementById('sm-hours').value = s.weeklyHours;
    document.getElementById('sm-edit-code').value = s.code;
    openModal('subject-modal');
}

async function parseSubjectCSV(text) {
    const lines = text.trim().split('\n').slice(1);
    let added = 0, skipped = 0;
    for (const line of lines) {
        const cols = parseCSVLine(line);
        if (cols.length < 3) { skipped++; continue; }
        const [code, name, type, hrsRaw] = cols;
        if (!code || !name) { skipped++; continue; }
        const existing = await DB.getOne('subjects', code.trim().toUpperCase());
        if (existing) { skipped++; continue; }
        const hrs = parseInt(hrsRaw) || 1;
        const t = type?.trim() === 'Lab' ? 'Lab' : 'Theory';
        await DB.put('subjects', { code: code.trim().toUpperCase(), name: name.trim(), type: t, weeklyHours: hrs });
        added++;
    }
    showToast(`CSV: ${added} subjects added, ${skipped} skipped.`, added > 0 ? 'success' : 'warning');
    loadSubjects();
}

// ──────────────────────────────────────────────────────────────────
// ROOMS
// ──────────────────────────────────────────────────────────────────
async function loadRooms() {
    const rooms = await DB.getAll('rooms');
    const tbody = document.getElementById('rooms-tbody');
    if (!tbody) return;
    tbody.innerHTML = rooms.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${r.name}</td>
      <td><span class="badge badge-${r.type === 'Lab' ? 'lab' : 'theory'}">${r.type}</span></td>
      <td>${r.capacity}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editRoom('${r.id}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRoom('${r.id}')">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No rooms added yet</td></tr>';
    set('rooms-count-badge', rooms.length);
}

async function saveRoom() {
    const id = document.getElementById('rm-id').value.trim();
    const name = document.getElementById('rm-name').value.trim();
    const type = document.getElementById('rm-type').value;
    const cap = parseInt(document.getElementById('rm-cap').value) || 30;
    const editId = document.getElementById('rm-edit-id').value;

    if (!id || !name) return showToast('Room ID and Name required.', 'warning');
    const existing = await DB.getOne('rooms', id);
    if (existing && existing.id !== editId) return showToast('Room ID already exists.', 'warning');

    await DB.put('rooms', { id, name, type, capacity: cap });
    closeModal('room-modal');
    loadRooms();
    showToast(`Room "${name}" saved.`, 'success');
}

async function deleteRoom(id) {
    if (!confirm('Delete this room?')) return;
    await DB.del('rooms', id);
    loadRooms();
    showToast('Room deleted.', 'success');
}

async function editRoom(id) {
    const r = await DB.getOne('rooms', id);
    if (!r) return;
    document.getElementById('room-modal-title').textContent = 'Edit Room';
    document.getElementById('rm-id').value = r.id;
    document.getElementById('rm-name').value = r.name;
    document.getElementById('rm-type').value = r.type;
    document.getElementById('rm-cap').value = r.capacity;
    document.getElementById('rm-edit-id').value = r.id;
    openModal('room-modal');
}

async function parseRoomCSV(text) {
    const lines = text.trim().split('\n').slice(1);
    let added = 0, skipped = 0;
    for (const line of lines) {
        const cols = parseCSVLine(line);
        if (cols.length < 3) { skipped++; continue; }
        const [id, name, type, capRaw] = cols;
        if (!id || !name) { skipped++; continue; }
        const existing = await DB.getOne('rooms', id.trim());
        if (existing) { skipped++; continue; }
        const t = type?.trim() === 'Lab' ? 'Lab' : 'Theory';
        await DB.put('rooms', { id: id.trim(), name: name.trim(), type: t, capacity: parseInt(capRaw) || 30 });
        added++;
    }
    showToast(`CSV: ${added} rooms added, ${skipped} skipped.`, added > 0 ? 'success' : 'warning');
    loadRooms();
}

// ──────────────────────────────────────────────────────────────────
// CLASSES
// ──────────────────────────────────────────────────────────────────
async function loadClasses() {
    const [classes, subjects] = await Promise.all([DB.getAll('classes'), DB.getAll('subjects')]);
    const tbody = document.getElementById('classes-tbody');
    if (!tbody) return;
    tbody.innerHTML = classes.map(c => `
    <tr>
      <td><span class="badge badge-theory">${c.id}</span></td>
      <td>${c.section}</td>
      <td>${c.strength || '—'}</td>
      <td>${(c.subjects || []).join(', ') || '—'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editClass('${c.id}')">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClass('${c.id}')">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No classes added yet</td></tr>';
    set('classes-count-badge', classes.length);
}

async function populateSubjectCheckboxes(selected = []) {
    const subjects = await DB.getAll('subjects');
    const container = document.getElementById('cm-subjects');
    if (!container) return;
    container.innerHTML = subjects.map(s => `
    <label style="display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer;">
      <input type="checkbox" value="${s.code}" ${selected.includes(s.code) ? 'checked' : ''}>
      <span class="badge badge-${s.type === 'Lab' ? 'lab' : 'theory'}">${s.code}</span> ${s.name}
    </label>`).join('') || '<span class="text-muted text-sm">No subjects yet</span>';
}

async function saveClass() {
    const id = document.getElementById('cm-id').value.trim();
    const section = document.getElementById('cm-section').value.trim();
    const strength = parseInt(document.getElementById('cm-strength').value) || 30;
    const editId = document.getElementById('cm-edit-id').value;
    const subs = [...document.querySelectorAll('#cm-subjects input:checked')].map(c => c.value);

    if (!id || !section) return showToast('Class ID and Section required.', 'warning');
    const existing = await DB.getOne('classes', id);
    if (existing && existing.id !== editId) return showToast('Class ID already exists.', 'warning');

    await DB.put('classes', { id, section, strength, subjects: subs });
    closeModal('class-modal');
    loadClasses();
    showToast(`Class "${section}" saved.`, 'success');
}

async function deleteClass(id) {
    if (!confirm('Delete this class?')) return;
    await DB.del('classes', id);
    loadClasses();
    showToast('Class deleted.', 'success');
}

async function editClass(id) {
    const c = await DB.getOne('classes', id);
    if (!c) return;
    document.getElementById('class-modal-title').textContent = 'Edit Class';
    document.getElementById('cm-id').value = c.id;
    document.getElementById('cm-section').value = c.section;
    document.getElementById('cm-strength').value = c.strength || 30;
    document.getElementById('cm-edit-id').value = c.id;
    await populateSubjectCheckboxes(c.subjects || []);
    openModal('class-modal');
}

async function parseClassCSV(text) {
    const lines = text.trim().split('\n').slice(1);
    let added = 0, skipped = 0;
    for (const line of lines) {
        const cols = parseCSVLine(line);
        if (cols.length < 2) { skipped++; continue; }
        const [id, section, strengthRaw, subsRaw] = cols;
        if (!id || !section) { skipped++; continue; }
        const existing = await DB.getOne('classes', id.trim());
        if (existing) { skipped++; continue; }
        const subs = subsRaw ? subsRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
        await DB.put('classes', { id: id.trim(), section: section.trim(), strength: parseInt(strengthRaw) || 30, subjects: subs });
        added++;
    }
    showToast(`CSV: ${added} classes added, ${skipped} skipped.`, added > 0 ? 'success' : 'warning');
    loadClasses();
}

// ──────────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────────
async function loadSettings() {
    const keys = ['workingDays', 'periodsPerDay', 'periodDuration', 'breakAfter', 'lunchAfter', 'labConsecutive'];
    const defaults = [5, 7, 50, 2, 4, 3];
    for (let i = 0; i < keys.length; i++) {
        const val = await DB.getSetting(keys[i], defaults[i]);
        const el = document.getElementById('set-' + keys[i]);
        if (el) el.value = val;
    }
}

async function saveSettings() {
    const keys = ['workingDays', 'periodsPerDay', 'periodDuration', 'breakAfter', 'lunchAfter', 'labConsecutive'];
    for (const key of keys) {
        const el = document.getElementById('set-' + key);
        if (el) await DB.setSetting(key, parseInt(el.value));
    }
    showToast('Settings saved.', 'success');
}

// ──────────────────────────────────────────────────────────────────
// TIMETABLE GENERATION PAGE
// ──────────────────────────────────────────────────────────────────
let _lastGenResult = null;

async function loadGeneratePage() {
    // Just restore last result if any
    const logs = await DB.getAll('genLog');
    const lastLog = logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    if (lastLog) {
        const tt = await DB.getOne('timetable', lastLog.id);
        if (tt) {
            _lastGenResult = tt;
            renderTimetableResults(tt);
        }
    }
}

async function runGeneration() {
    const btn = document.getElementById('gen-btn');
    btn.disabled = true;
    clearLog();

    setProgress(0);
    document.getElementById('gen-status').innerHTML = '<span class="badge badge-warn pulse">⚙️ Generating...</span>';

    try {
        const result = await Scheduler.generate(
            pct => setProgress(pct),
            (level, msg) => appendLog(level, msg)
        );

        if (!result.ok) {
            appendLog('err', result.error);
            document.getElementById('gen-status').innerHTML = `<span class="badge badge-invalid">❌ Error: ${result.error}</span>`;
            showToast(result.error, 'danger');
            return;
        }

        _lastGenResult = result;
        document.getElementById('gen-status').innerHTML = result.valid
            ? `<span class="badge badge-valid">✅ VALID — Score: ${result.softScore}/100</span>`
            : `<span class="badge badge-invalid">⚠️ INVALID — ${result.conflicts.length} violation(s)</span>`;

        renderTimetableResults(result);
        showToast('Timetable generated!', 'success');

    } catch (e) {
        appendLog('err', 'Fatal error: ' + e.message);
        document.getElementById('gen-status').innerHTML = `<span class="badge badge-invalid">❌ Fatal Error</span>`;
    } finally {
        btn.disabled = false;
    }
}

function setProgress(pct) {
    const fill = document.getElementById('progress-fill');
    const pct2 = document.getElementById('progress-pct');
    if (fill) fill.style.width = pct + '%';
    if (pct2) pct2.textContent = pct + '%';
}

function clearLog() {
    const log = document.getElementById('gen-log');
    if (log) log.innerHTML = '';
}

function appendLog(level, msg) {
    const log = document.getElementById('gen-log');
    if (!log) return;
    const now = new Date().toLocaleTimeString();
    const cls = { ok: 'log-ok', warn: 'log-warn', err: 'log-err', info: 'log-info' }[level] || '';
    log.innerHTML += `<div class="log-line"><span class="log-time">[${now}]</span><span class="${cls}">${escHtml(msg)}</span></div>`;
    log.scrollTop = log.scrollHeight;
}

function renderTimetableResults(gen) {
    // gen may be a full result or stored { generationId, slots, conflicts, softScore, valid }
    const slots = gen.result || gen.slots || [];
    const conflicts = gen.conflicts || [];
    const softScore = gen.softScore || 0;
    const valid = gen.valid !== false;
    const execTime = gen.execTimeMs || '—';
    const genId = gen.genId || gen.generationId || '—';

    // Summary
    const sumEl = document.getElementById('gen-summary');
    if (sumEl) {
        sumEl.innerHTML = `
      <div class="summary-row"><span class="sr-label">Generation ID</span><span class="sr-value">${genId}</span></div>
      <div class="summary-row"><span class="sr-label">Status</span><span class="sr-value ${valid ? 'text-success' : 'text-danger'}">${valid ? '✅ VALID' : '❌ INVALID'}</span></div>
      <div class="summary-row"><span class="sr-label">Soft Score</span><span class="sr-value">${softScore}/100 ${scoreEmoji(softScore)}</span></div>
      <div class="summary-row"><span class="sr-label">Execution Time</span><span class="sr-value">${execTime}ms</span></div>
      <div class="summary-row"><span class="sr-label">Total Slots Placed</span><span class="sr-value">${slots.length}</span></div>
      <div class="summary-row"><span class="sr-label">Hard Violations</span><span class="sr-value ${conflicts.length ? 'text-danger' : 'text-success'}">${conflicts.length}</span></div>
      <div class="summary-row"><span class="sr-label">Generated At</span><span class="sr-value">${new Date().toLocaleString()}</span></div>
    `;
    }

    // Show results section
    const resSection = document.getElementById('results-section');
    if (resSection) resSection.style.display = 'block';

    // Load first tab (class-wise)
    switchTimetableTab('class');
}

function scoreEmoji(s) {
    if (s >= 90) return '🏆';
    if (s >= 75) return '⭐';
    if (s >= 60) return '👍';
    return '⚠️';
}

function switchTimetableTab(tab) {
    document.querySelectorAll('.tt-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tt-tab-panel').forEach(p => p.classList.remove('active'));
    const btn = document.getElementById(`tab-${tab}-btn`);
    const panel = document.getElementById(`tab-${tab}-panel`);
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');

    if (!_lastGenResult) return;
    const slots = _lastGenResult.result || _lastGenResult.slots || [];

    switch (tab) {
        case 'class': renderClassTimetable(slots, _lastGenResult); break;
        case 'faculty': renderFacultyTimetable(slots, _lastGenResult); break;
        case 'room': renderRoomTimetable(slots, _lastGenResult); break;
        case 'heatmap': renderHeatmap(slots, _lastGenResult); break;
        case 'conflict': renderConflicts(_lastGenResult); break;
    }
}

// ─── Class-wise timetable ──────────────────────────────────────
async function renderClassTimetable(slots, gen) {
    const container = document.getElementById('tab-class-panel');
    if (!container) return;

    const classes = await DB.getAll('classes');
    const DAYS = gen.DAYS || await DB.getSetting('workingDays', 5);
    const teachingPeriods = gen.teachingPeriods || buildTeachingPeriods(gen);
    const breakP = gen.breakPeriod ?? -1;
    const lunchP = gen.lunchPeriod ?? -1;
    const TPERIODS = await DB.getSetting('periodsPerDay', 7);
    const allPeriods = Array.from({ length: TPERIODS }, (_, i) => i);

    // Build subject color map
    const subCodes = [...new Set(slots.map(s => s.subjectCode))];
    const colorMap = {};
    subCodes.forEach((c, i) => colorMap[c] = i % COLORS);

    let html = '';

    for (const cls of classes) {
        const clsSlots = slots.filter(s => s.classId === cls.id);
        const grid = {};
        clsSlots.forEach(s => grid[`${s.day}-${s.period}`] = s);

        html += `<div class="mb-24">
      <div class="flex items-center gap-12 mb-12">
        <h3 style="font-size:16px;font-weight:700">📚 ${cls.section}</h3>
        <span class="badge badge-theory">${clsSlots.length} slots</span>
      </div>
      <div class="tt-grid-wrap"><table class="tt-table">
        <thead><tr><th>Day</th>`;
        allPeriods.forEach(p => {
            if (p === breakP) html += `<th class="text-warning">☕ Break</th>`;
            else if (p === lunchP) html += `<th class="text-success">🍽️ Lunch</th>`;
            else html += `<th>P${p + 1}</th>`;
        });
        html += `</tr></thead><tbody>`;

        for (let d = 0; d < DAYS; d++) {
            html += `<tr><td class="day-label">${DAY_NAMES[d]}</td>`;
            allPeriods.forEach(p => {
                if (p === breakP) { html += `<td><div class="tt-cell break-cell">Break</div></td>`; return; }
                if (p === lunchP) { html += `<td><div class="tt-cell lunch-cell">Lunch</div></td>`; return; }
                const s = grid[`${d}-${p}`];
                if (s) {
                    const col = colorMap[s.subjectCode] || 0;
                    const labClass = s.isLab ? ' lab-cell' : '';
                    html += `<td title="${s.subjectName} | ${s.facultyName} | ${s.roomName}">
            <div class="tt-cell sub-color-${col}${labClass}">
              <div class="sub-code">${s.subjectCode}</div>
              <div class="sub-info">${s.facultyName.split(' ')[0]}<br>${s.roomName}</div>
            </div></td>`;
                } else {
                    html += `<td><div class="tt-cell free-cell">—</div></td>`;
                }
            });
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;

        // Legend
        const subInClass = [...new Set(clsSlots.map(s => s.subjectCode))];
        html += `<div class="legend mt-8">`;
        subInClass.forEach(code => {
            const s = clsSlots.find(sl => sl.subjectCode === code);
            const col = colorMap[code] || 0;
            html += `<div class="legend-item">
        <div class="legend-color sub-color-${col}" style="width:14px;height:14px;border-radius:3px;display:inline-block"></div>
        <span>${code} — ${s?.subjectName || ''}</span>
      </div>`;
        });
        html += `</div></div>`;
    }

    container.innerHTML = html || '<div class="empty-state"><div class="es-icon">📭</div><p>No timetable generated yet</p></div>';
}

// ─── Faculty-wise timetable ────────────────────────────────────
async function renderFacultyTimetable(slots, gen) {
    const container = document.getElementById('tab-faculty-panel');
    if (!container) return;
    const faculty = await DB.getAll('faculty');
    const DAYS = gen.DAYS || await DB.getSetting('workingDays', 5);
    const TPERIODS = await DB.getSetting('periodsPerDay', 7);
    const allPeriods = Array.from({ length: TPERIODS }, (_, i) => i);
    const breakP = gen.breakPeriod ?? -1;
    const lunchP = gen.lunchPeriod ?? -1;

    let html = '';
    for (const fac of faculty) {
        const facSlots = slots.filter(s => s.facultyId === fac.id);
        if (facSlots.length === 0) continue;
        const grid = {};
        facSlots.forEach(s => grid[`${s.day}-${s.period}`] = s);

        html += `<div class="mb-24">
      <div class="flex items-center gap-12 mb-12">
        <h3 style="font-size:16px;font-weight:700">👤 ${fac.name}</h3>
        <span class="badge badge-theory">${fac.id}</span>
        <span class="badge badge-lab">${facSlots.length} periods/week</span>
      </div>
      <div class="tt-grid-wrap"><table class="tt-table">
        <thead><tr><th>Day</th>`;
        allPeriods.forEach(p => {
            if (p === breakP) html += `<th class="text-warning">☕ Break</th>`;
            else if (p === lunchP) html += `<th class="text-success">🍽️ Lunch</th>`;
            else html += `<th>P${p + 1}</th>`;
        });
        html += `</tr></thead><tbody>`;

        for (let d = 0; d < DAYS; d++) {
            html += `<tr><td class="day-label">${DAY_NAMES[d]}</td>`;
            allPeriods.forEach(p => {
                if (p === breakP) { html += `<td><div class="tt-cell break-cell">Break</div></td>`; return; }
                if (p === lunchP) { html += `<td><div class="tt-cell lunch-cell">Lunch</div></td>`; return; }
                const s = grid[`${d}-${p}`];
                if (s) {
                    html += `<td><div class="tt-cell sub-color-${s.isLab ? 1 : 3}">
            <div class="sub-code">${s.subjectCode}</div>
            <div class="sub-info">${s.className}<br>${s.roomName}</div>
          </div></td>`;
                } else {
                    html += `<td><div class="tt-cell free-cell">—</div></td>`;
                }
            });
            html += `</tr>`;
        }
        html += `</tbody></table></div></div>`;
    }
    container.innerHTML = html || '<div class="empty-state"><div class="es-icon">👤</div><p>No faculty schedule found</p></div>';
}

// ─── Room-wise timetable ───────────────────────────────────────
async function renderRoomTimetable(slots, gen) {
    const container = document.getElementById('tab-room-panel');
    if (!container) return;
    const rooms = await DB.getAll('rooms');
    const DAYS = gen.DAYS || await DB.getSetting('workingDays', 5);
    const TPERIODS = await DB.getSetting('periodsPerDay', 7);
    const allPeriods = Array.from({ length: TPERIODS }, (_, i) => i);
    const breakP = gen.breakPeriod ?? -1;
    const lunchP = gen.lunchPeriod ?? -1;

    let html = '';
    for (const room of rooms) {
        const rmSlots = slots.filter(s => s.roomId === room.id);
        if (rmSlots.length === 0) continue;
        const grid = {};
        rmSlots.forEach(s => grid[`${s.day}-${s.period}`] = s);
        const utilPct = Math.round(rmSlots.length / (DAYS * allPeriods.length) * 100);

        html += `<div class="mb-24">
      <div class="flex items-center gap-12 mb-12">
        <h3 style="font-size:16px;font-weight:700">🏛️ ${room.name}</h3>
        <span class="badge badge-${room.type === 'Lab' ? 'lab' : 'theory'}">${room.type}</span>
        <span class="badge badge-theory">Cap: ${room.capacity}</span>
        <span class="badge badge-warn">Util: ${utilPct}%</span>
      </div>
      <div class="tt-grid-wrap"><table class="tt-table">
        <thead><tr><th>Day</th>`;
        allPeriods.forEach(p => {
            if (p === breakP) html += `<th class="text-warning">☕ Break</th>`;
            else if (p === lunchP) html += `<th class="text-success">🍽️ Lunch</th>`;
            else html += `<th>P${p + 1}</th>`;
        });
        html += `</tr></thead><tbody>`;

        for (let d = 0; d < DAYS; d++) {
            html += `<tr><td class="day-label">${DAY_NAMES[d]}</td>`;
            allPeriods.forEach(p => {
                if (p === breakP) { html += `<td><div class="tt-cell break-cell">Break</div></td>`; return; }
                if (p === lunchP) { html += `<td><div class="tt-cell lunch-cell">Lunch</div></td>`; return; }
                const s = grid[`${d}-${p}`];
                if (s) {
                    html += `<td><div class="tt-cell sub-color-${s.isLab ? 1 : 2}">
            <div class="sub-code">${s.subjectCode}</div>
            <div class="sub-info">${s.className}<br>${s.facultyName.split(' ')[0]}</div>
          </div></td>`;
                } else {
                    html += `<td><div class="tt-cell free-cell">—</div></td>`;
                }
            });
            html += `</tr>`;
        }
        html += `</tbody></table></div></div>`;
    }
    container.innerHTML = html || '<div class="empty-state"><div class="es-icon">🏛️</div><p>No room schedule found</p></div>';
}

// ─── Heatmap ──────────────────────────────────────────────────
async function renderHeatmap(slots, gen) {
    const container = document.getElementById('tab-heatmap-panel');
    if (!container) return;
    const rooms = await DB.getAll('rooms');
    const DAYS = gen.DAYS || await DB.getSetting('workingDays', 5);
    const TPERIODS = await DB.getSetting('periodsPerDay', 7);

    // Room utilization per day
    const roomUtil = {};
    rooms.forEach(r => {
        roomUtil[r.id] = { name: r.name, days: Array(DAYS).fill(0), total: 0 };
    });
    slots.forEach(s => {
        if (roomUtil[s.roomId]) {
            roomUtil[s.roomId].days[s.day]++;
            roomUtil[s.roomId].total++;
        }
    });

    const maxSlots = TPERIODS;

    let html = `<h4 style="font-size:14px;font-weight:600;margin-bottom:12px">🔥 Room Utilization Heatmap</h4>
  <div class="heatmap-wrap"><table class="heatmap-table">
    <thead><tr><th>Room</th>`;
    for (let d = 0; d < DAYS; d++) html += `<th>${DAY_NAMES[d]}</th>`;
    html += `<th>Total</th><th>Util%</th></tr></thead><tbody>`;

    Object.values(roomUtil).forEach(r => {
        const totalPossible = DAYS * maxSlots;
        const utilPct = Math.round(r.total / totalPossible * 100);
        html += `<tr><td style="font-weight:600;font-size:12px;padding:4px 8px">${r.name}</td>`;
        r.days.forEach(cnt => {
            const pct = Math.min(cnt / maxSlots, 1);
            const alpha = 0.15 + pct * 0.75;
            const bg = `rgba(99,102,241,${alpha.toFixed(2)})`;
            const textCol = pct > 0.6 ? '#fff' : 'var(--text-primary)';
            html += `<td class="heatmap-cell" style="background:${bg};color:${textCol}">${cnt}</td>`;
        });
        const bg2 = `rgba(99,102,241,${Math.min(0.15 + r.total / totalPossible * 0.75, 0.9).toFixed(2)})`;
        html += `<td class="heatmap-cell" style="background:${bg2}">${r.total}</td>
             <td class="heatmap-cell" style="background:${bg2}">${utilPct}%</td></tr>`;
    });

    html += `</tbody></table></div>`;

    // Faculty load chart
    const facLoad = {};
    slots.forEach(s => {
        if (!facLoad[s.facultyId]) facLoad[s.facultyId] = { name: s.facultyName, count: 0 };
        facLoad[s.facultyId].count++;
    });
    const maxLoad = Math.max(...Object.values(facLoad).map(f => f.count), 1);

    html += `<h4 style="font-size:14px;font-weight:600;margin:24px 0 12px">👤 Faculty Workload</h4>
  <div style="display:flex;flex-direction:column;gap:8px;max-width:600px">`;
    Object.values(facLoad).sort((a, b) => b.count - a.count).forEach(f => {
        const pct = Math.round(f.count / maxLoad * 100);
        html += `<div>
      <div class="flex items-center gap-8 mb-4">
        <span style="font-size:12px;min-width:160px">${f.name}</span>
        <span style="font-size:11px;color:var(--text-muted)">${f.count} periods</span>
      </div>
      <div class="progress-track" style="height:6px">
        <div class="progress-fill" style="width:${pct}%;animation:none;background:linear-gradient(90deg,var(--accent),var(--accent2))"></div>
      </div>
    </div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}

// ─── Conflict Report ────────────────────────────────────────────
function renderConflicts(gen) {
    const container = document.getElementById('tab-conflict-panel');
    if (!container) return;
    const conflicts = gen.conflicts || [];
    if (conflicts.length === 0) {
        container.innerHTML = `<div class="alert alert-success">✅ No hard constraint violations found. Timetable is VALID.</div>`;
        return;
    }
    let html = `<div class="alert alert-danger">❌ ${conflicts.length} violation(s) found. Timetable is INVALID.</div>`;
    conflicts.forEach(c => {
        html += `<div class="conflict-item">
      <span class="ci-icon">⚠️</span>
      <div class="ci-text">
        <strong>${c.type.replace(/_/g, ' ')}</strong>
        <span>${c.desc}</span>
        ${c.class ? `<br><span>Class: ${c.class}${c.subject ? ' | Subject: ' + c.subject : ''}</span>` : ''}
      </div>
    </div>`;
    });
    container.innerHTML = html;
}

function buildTeachingPeriods(gen) {
    // Fallback builder when gen doesn't have teachingPeriods cached
    const PERIODS = gen.PERIODS || 7;
    const breakP = gen.breakPeriod ?? -1;
    const lunchP = gen.lunchPeriod ?? -1;
    return Array.from({ length: PERIODS }, (_, i) => i).filter(p => p !== breakP && p !== lunchP);
}

// ──────────────────────────────────────────────────────────────────
// GENERATION LOGS
// ──────────────────────────────────────────────────────────────────
async function loadLogs() {
    const logs = await DB.getAll('genLog');
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;
    const sorted = logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    tbody.innerHTML = sorted.map(l => `
    <tr>
      <td style="font-family:monospace;font-size:11px">${l.id}</td>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.execTimeMs}ms</td>
      <td>${l.softScore}/100</td>
      <td>${l.totalSlots}</td>
      <td>${l.conflicts}</td>
      <td><span class="badge ${l.valid ? 'badge-valid' : 'badge-invalid'}">${l.status}</span></td>
      <td><button class="btn btn-secondary btn-sm" onclick="restoreGen('${l.id}')">👁 View</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty-msg">No generation logs yet</td></tr>';
}

async function restoreGen(genId) {
    const tt = await DB.getOne('timetable', genId);
    if (!tt) return showToast('Timetable data not found.', 'warning');
    _lastGenResult = tt;
    navigate('generate');
    renderTimetableResults(tt);
    showToast('Previous timetable loaded.', 'success');
}

async function clearLogs() {
    if (!confirm('Clear all generation logs? This cannot be undone.')) return;
    await DB.clear('genLog');
    await DB.clear('timetable');
    _lastGenResult = null;
    loadLogs();
    showToast('Logs cleared.', 'success');
}

// ──────────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────────
async function exportTimetableCSV() {
    if (!_lastGenResult) return showToast('No timetable to export.', 'warning');
    const slots = _lastGenResult.result || _lastGenResult.slots || [];
    const rows = slots.map(s => ({
        Class: s.className, Day: DAY_NAMES[s.day] || `Day${s.day + 1}`,
        Period: `P${s.period + 1}`, SubjectCode: s.subjectCode,
        SubjectName: s.subjectName, Type: s.subjectType,
        Faculty: s.facultyName, Room: s.roomName,
        IsLab: s.isLab ? 'Yes' : 'No'
    }));
    Exporter.exportCSV(rows, 'timetable.csv');
    showToast('CSV downloaded.', 'success');
}

async function exportTimetablePDF() {
    if (!_lastGenResult) return showToast('No timetable to export.', 'warning');
    const slots = _lastGenResult.result || _lastGenResult.slots || [];
    const classes = await DB.getAll('classes');
    const DAYS = _lastGenResult.DAYS || await DB.getSetting('workingDays', 5);
    const PERIODS = _lastGenResult.PERIODS || await DB.getSetting('periodsPerDay', 7);
    const tp = _lastGenResult.teachingPeriods || buildTeachingPeriods(_lastGenResult);
    Exporter.exportPDF(
        slots, classes, DAYS, PERIODS, DAY_NAMES, tp,
        _lastGenResult.softScore, _lastGenResult.genId || _lastGenResult.generationId, _lastGenResult.execTimeMs || 0
    );
    showToast('PDF downloaded.', 'success');
}

// ──────────────────────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────────────────────
function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('open');
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const icon = { success: '✅', warning: '⚠️', danger: '❌', info: 'ℹ️' }[type] || 'ℹ️';
    toast.innerHTML = `${icon} ${escHtml(msg)}`;
    toast.className = `toast toast-${type} show`;
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseCSVLine(line) {
    const result = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; }
        else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
}

function setupDropzone(zoneId, inputId, parser) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) readAndParse(file, parser);
    });
    input.addEventListener('change', () => {
        if (input.files[0]) readAndParse(input.files[0], parser);
    });
}

function readAndParse(file, parser) {
    if (!file.name.endsWith('.csv')) return showToast('Please upload a CSV file.', 'warning');
    const reader = new FileReader();
    reader.onload = e => parser(e.target.result);
    reader.readAsText(file);
}

// ──────────────────────────────────────────────────────────────────
// DEMO DATA SEEDER
// ──────────────────────────────────────────────────────────────────
async function seedDemoData() {
    if (!confirm('This will add sample faculty, subjects, rooms and classes. Continue?')) return;

    // Subjects
    const subjects = [
        { code: 'CS101', name: 'Data Structures', type: 'Theory', weeklyHours: 4 },
        { code: 'CS102', name: 'Algorithms', type: 'Theory', weeklyHours: 3 },
        { code: 'CS103', name: 'OS Concepts', type: 'Theory', weeklyHours: 3 },
        { code: 'CS104', name: 'DBMS', type: 'Theory', weeklyHours: 3 },
        { code: 'CS105', name: 'Computer Networks', type: 'Theory', weeklyHours: 3 },
        { code: 'CSL101', name: 'Data Structures Lab', type: 'Lab', weeklyHours: 3 },
        { code: 'CSL102', name: 'DBMS Lab', type: 'Lab', weeklyHours: 3 },
        { code: 'MA101', name: 'Engineering Math', type: 'Theory', weeklyHours: 4 },
        { code: 'PH101', name: 'Applied Physics', type: 'Theory', weeklyHours: 3 },
        { code: 'PHL101', name: 'Physics Lab', type: 'Lab', weeklyHours: 3 },
    ];
    for (const s of subjects) await DB.put('subjects', s);

    // Faculty
    const faculty = [
        { id: 'F001', name: 'Dr. Anika Sharma', subjects: ['CS101', 'CS102'], availability: null },
        { id: 'F002', name: 'Prof. Rajesh Kumar', subjects: ['CS103', 'CS104'], availability: null },
        { id: 'F003', name: 'Dr. Priya Nair', subjects: ['CS105', 'MA101'], availability: null },
        { id: 'F004', name: 'Mr. Vikram Singh', subjects: ['CSL101'], availability: null },
        { id: 'F005', name: 'Ms. Divya Patel', subjects: ['CSL102'], availability: null },
        { id: 'F006', name: 'Dr. Suresh Reddy', subjects: ['PH101', 'PHL101'], availability: null },
        { id: 'F007', name: 'Prof. Meera Iyer', subjects: ['MA101', 'PH101'], availability: null },
    ];
    const defaultAvail = Array.from({ length: 6 }, () => Array(8).fill(true));
    // F002 unavailable Thursday
    const f2avail = JSON.parse(JSON.stringify(defaultAvail));
    f2avail[3] = Array(8).fill(false);
    for (const f of faculty) {
        f.availability = f.id === 'F002' ? f2avail : JSON.parse(JSON.stringify(defaultAvail));
        await DB.put('faculty', f);
    }

    // Rooms
    const rooms = [
        { id: 'R101', name: 'Room 101', type: 'Theory', capacity: 60 },
        { id: 'R102', name: 'Room 102', type: 'Theory', capacity: 60 },
        { id: 'R103', name: 'Room 103', type: 'Theory', capacity: 60 },
        { id: 'L101', name: 'CS Lab 1', type: 'Lab', capacity: 40 },
        { id: 'L102', name: 'CS Lab 2', type: 'Lab', capacity: 40 },
        { id: 'L103', name: 'Physics Lab', type: 'Lab', capacity: 30 },
    ];
    for (const r of rooms) await DB.put('rooms', r);

    // Classes
    const classes = [
        { id: 'CLS_A', section: 'CS-A (3rd Sem)', strength: 55, subjects: ['CS101', 'CS102', 'CS103', 'CSL101'] },
        { id: 'CLS_B', section: 'CS-B (3rd Sem)', strength: 52, subjects: ['CS101', 'CS102', 'CS104', 'CSL102'] },
        { id: 'CLS_C', section: 'CS-C (3rd Sem)', strength: 50, subjects: ['CS103', 'CS105', 'MA101', 'CSL101'] },
        { id: 'CLS_D', section: 'CE-A (1st Sem)', strength: 58, subjects: ['MA101', 'PH101', 'PHL101'] },
    ];
    for (const c of classes) await DB.put('classes', c);

    await refreshNavBadges();
    showToast('✅ Demo data loaded! Navigate to Generate to create a timetable.', 'success');
    navigate('dashboard');
}

// ──────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────
async function init() {
    await DB.seedDefaults();

    // Restore theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.innerHTML = savedTheme === 'light'
        ? '<span>🌙</span> Dark Mode' : '<span>☀️</span> Light Mode';

    // Wire nav
    document.querySelectorAll('.nav-item').forEach(el => {
        el.addEventListener('click', () => {
            navigate(el.dataset.page);
            // mobile: close sidebar
            document.querySelector('.sidebar')?.classList.remove('open');
        });
    });

    // Setup CSV dropzones
    setupDropzone('faculty-drop', 'faculty-csv-input', parseFacultyCSV);
    setupDropzone('subjects-drop', 'subjects-csv-input', parseSubjectCSV);
    setupDropzone('rooms-drop', 'rooms-csv-input', parseRoomCSV);
    setupDropzone('classes-drop', 'classes-csv-input', parseClassCSV);

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });

    navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
