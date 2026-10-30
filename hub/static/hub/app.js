const TAGS = { Design: '#ec4899', Backend: '#3b82f6', Bug: '#ef4444', Frontend: '#14b8a6' };
const COLS = [['To Do', 'todo', '#6b7280'], ['In Progress', 'progress', '#3b82f6'], ['Review', 'review', '#a855f7'], ['Done', 'done', '#22c55e']];
const TITLES = { kanban: 'Kanban Board', tasks: 'My Tasks List', pomodoro: 'Pomodoro & Time Tracker', calendar: 'Calendar', analytics: 'Analytics Dashboard' };
const PRI = ['High', 'Medium', 'Low'];

const S = { view: 'kanban', tasks: [], projects: [], theme: 'dark', sel: null, month: localMonth(), q: '', fp: '', ft: '', fs: '' };
const P = { mode: 'work', left: 1500, run: false, iv: null, pending: 0, sessions: 0 };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const opts = (arr, val) => arr.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('');
const colName = k => COLS.find(c => c[1] === k)[0];
function localDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function localMonth() { return localDate(new Date()).slice(0, 7); }
const todayISO = () => localDate(new Date());
const csrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';

async function api(method, url, data) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
    body: data ? JSON.stringify(data) : undefined
  });
  if (r.status === 401) { location.href = '/login/'; return null; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j.error;
    alert(typeof e === 'string' ? e : (Object.values(e || {}).flat().join('\n') || 'Request failed'));
    return null;
  }
  return j;
}

async function load() {
  const [t, p, pr] = await Promise.all([api('GET', '/api/tasks/'), api('GET', '/api/projects/'), api('GET', '/api/preferences/')]);
  if (!t || !p || !pr) return;
  S.tasks = t.tasks; S.projects = p.projects; S.theme = pr.theme;
  render();
}

function render() {
  document.documentElement.dataset.theme = S.theme;
  $('tg').textContent = S.theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  document.querySelectorAll('.nav[data-v]').forEach(n => n.classList.toggle('active', n.dataset.v === S.view));
  $('title').textContent = TITLES[S.view];
  const V = { kanban: vKanban, tasks: vTasks, pomodoro: vPomodoro, calendar: vCal, analytics: vAnalytics };
  $('content').innerHTML = V[S.view]();
  if (S.view === 'analytics') loadAnalytics();
  updPomo();
}

/* ---------- Kanban ---------- */
function cardHTML(t) {
  const d = t.subtasks.filter(s => s.done).length;
  return `<div class="card" draggable="true" data-id="${t.id}" onclick="openTask(${t.id})">
    <b>${esc(t.title)}</b>
    <div class="tags"><span class="tag" style="background:${TAGS[t.tag]}">${t.tag}</span></div>
    <div class="meta"><span class="pri-${t.priority}">● ${t.priority}</span>
    <span>${t.subtasks.length ? d + '/' + t.subtasks.length + ' · ' : ''}${t.due_date || ''}</span></div></div>`;
}
function vKanban() {
  return `<div class="board">${COLS.map(([n, k, c]) => {
    const list = S.tasks.filter(t => t.status === k);
    return `<div class="col"><h3><span><span class="dot" style="background:${c}"></span>${n}</span><span>${list.length}</span></h3>
      <div class="drop" data-col="${k}">${list.map(cardHTML).join('')}</div></div>`;
  }).join('')}</div>`;
}

/* ---------- My Tasks ---------- */
function rowsHTML() {
  const f = S.tasks.filter(t =>
    (!S.q || t.title.toLowerCase().includes(S.q.toLowerCase())) &&
    (!S.fp || t.priority === S.fp) && (!S.ft || t.tag === S.ft) && (!S.fs || t.status === S.fs));
  if (!f.length) return `<tr><td colspan="5" class="meta">No tasks found</td></tr>`;
  return f.map(t => `<tr style="cursor:pointer" onclick="openTask(${t.id})">
    <td>${esc(t.title)}</td><td>${t.due_date || ''}</td>
    <td><span class="pri-${t.priority}">● ${t.priority}</span></td>
    <td><span class="tag" style="background:${TAGS[t.tag]}">${t.tag}</span></td>
    <td>${colName(t.status)}</td></tr>`).join('');
}
function rows() { $('rows').innerHTML = rowsHTML(); }
function vTasks() {
  return `<div class="bar">
    <input placeholder="Search tasks..." value="${esc(S.q)}" oninput="S.q=this.value;rows()">
    <select onchange="S.fp=this.value;rows()"><option value="">All priorities</option>${opts(PRI, S.fp)}</select>
    <select onchange="S.ft=this.value;rows()"><option value="">All tags</option>${opts(Object.keys(TAGS), S.ft)}</select>
    <select onchange="S.fs=this.value;rows()"><option value="">All statuses</option>${COLS.map(c => `<option value="${c[1]}" ${S.fs === c[1] ? 'selected' : ''}>${c[0]}</option>`).join('')}</select>
  </div>
  <table><thead><tr><th>Task</th><th>Due Date</th><th>Priority</th><th>Tag</th><th>Status</th></tr></thead>
  <tbody id="rows">${rowsHTML()}</tbody></table>`;
}

/* ---------- Pomodoro ---------- */
function vPomodoro() {
  const open = S.tasks.filter(t => t.status !== 'done');
  if (!open.find(t => t.id == S.sel)) S.sel = open[0] ? open[0].id : null;
  return `<div class="pomo"><div class="panel">
    <select style="width:100%" onchange="flushPomo();S.sel=+this.value;render()">
      ${open.map(t => `<option value="${t.id}" ${t.id == S.sel ? 'selected' : ''}>${esc(t.title)}</option>`).join('') || '<option>No open tasks</option>'}
    </select>
    <div class="mode" id="pmode"></div>
    <div class="clock" id="pclock"></div>
    <div class="ctr"><button class="btn" id="pbtn" onclick="pomToggle()"></button>
    <button class="btn ghost" onclick="pomReset()">Reset</button></div>
  </div>
  <div class="panel"><div class="mode">Time tracked on task</div>
    <div style="font-size:26px;margin:10px 0" id="ptrk"></div>
    <div class="meta" style="margin-top:14px">Sessions completed: <span id="psess"></span></div>
  </div></div>`;
}
function updPomo() {
  const c = $('pclock'); if (!c) return;
  c.textContent = `${String(Math.floor(P.left / 60)).padStart(2, '0')}:${String(P.left % 60).padStart(2, '0')}`;
  $('pmode').textContent = P.mode === 'work' ? 'Focus · 25 min' : 'Break · 5 min';
  $('pbtn').textContent = P.run ? 'Pause' : 'Start';
  const cur = S.tasks.find(t => t.id == S.sel);
  $('ptrk').textContent = cur ? fmt(cur.time_spent + P.pending) : '0m';
  $('psess').textContent = P.sessions;
}
async function flushPomo() {
  if (!P.pending || !S.sel) return;
  const id = S.sel, sec = P.pending;
  P.pending = 0;
  const r = await api('POST', `/api/tasks/${id}/time/`, { seconds: sec });
  if (r) { const t = S.tasks.find(x => x.id == id); if (t) t.time_spent = r.time_spent; }
  updPomo();
}
function pomToggle() {
  if (P.run) { clearInterval(P.iv); P.run = false; flushPomo(); }
  else { P.iv = setInterval(pomTick, 1000); P.run = true; }
  updPomo();
}
function pomTick() {
  P.left--;
  if (P.mode === 'work' && S.sel) P.pending++;
  if (P.left <= 0) {
    if (P.mode === 'work') { P.sessions++; P.mode = 'break'; P.left = 300; flushPomo(); }
    else { P.mode = 'work'; P.left = 1500; }
  }
  if (P.pending >= 15) flushPomo();
  updPomo();
}
function pomReset() {
  clearInterval(P.iv); P.run = false; P.mode = 'work'; P.left = 1500;
  flushPomo(); updPomo();
}

/* ---------- Task detail modal ---------- */
function openTask(id) {
  const t = S.tasks.find(x => x.id == id); if (!t) return;
  const d = t.subtasks.filter(s => s.done).length;
  // A completed task is 100% done even if it has no checklist items.
  const pct = t.status === 'done' ? 100 : (t.subtasks.length ? Math.round(d / t.subtasks.length * 100) : 0);
  const projOpts = '<option value="">No project</option>' +
    S.projects.map(p => `<option value="${p.id}" ${t.project && t.project.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') +
    '<option value="__new">+ New project…</option>';
  $('modal').innerHTML = `<div class="box">
    <div class="mh"><input class="ttl" value="${esc(t.title)}" onchange="upd(${id},'title',this.value)"><button class="x" onclick="closeM()">✕</button></div>
    <div class="frow">
      <label>Priority<select onchange="upd(${id},'priority',this.value)">${opts(PRI, t.priority)}</select></label>
      <label>Tag<select onchange="upd(${id},'tag',this.value)">${opts(Object.keys(TAGS), t.tag)}</select></label>
      <label>Due date<input type="date" value="${t.due_date || ''}" onchange="upd(${id},'due_date',this.value)"></label>
      <label>Status<select onchange="upd(${id},'status',this.value)">${COLS.map(c => `<option value="${c[1]}" ${t.status === c[1] ? 'selected' : ''}>${c[0]}</option>`).join('')}</select></label>
      <label>Project<select onchange="changeProject(${id},this.value)">${projOpts}</select></label>
    </div>
    <div>
      <div class="meta" style="margin:0 0 6px"><span>Progress</span><span>${pct}% · ${fmt(t.time_spent)} tracked</span></div>
      <div class="prog"><div style="width:${pct}%"></div></div>
    </div>
    <div><b>Checklist</b>
      <div class="frow" style="margin-bottom:6px">
        <span class="meta" style="flex:1">AI assistant:</span>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiSubdivide(${id})">✨ Break down</button>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiPomodoros(${id})">⏱ Estimate</button>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiEnhance(${id})">📝 Enhance</button>
      </div>
      ${t.subtasks.map(s => `<label class="sub"><input type="checkbox" ${s.done ? 'checked' : ''} onchange="togSub(${id},${s.id},${!s.done})"><span class="${s.done ? 'strike' : ''}">${esc(s.title)}</span></label>`).join('') || '<div class="meta">No subtasks yet</div>'}
      <div class="frow" style="margin-top:8px"><input id="ns" placeholder="Add subtask..." style="flex:1" onkeydown="if(event.key==='Enter')addSub(${id})"><button class="btn ghost" onclick="addSub(${id})">Add</button></div>
    </div>
    <div class="frow end"><button class="btn danger" onclick="delTask(${id})">Delete</button><button class="btn" onclick="closeM()">Done</button></div>
  </div>`;
  $('modal').classList.add('show');
}
function closeM() { $('modal').classList.remove('show'); }
async function upd(id, field, value) {
  await api('PATCH', `/api/tasks/${id}/`, { [field]: value });
  await load();
  if ($('modal').classList.contains('show')) openTask(id);
}
async function changeProject(id, value) {
  if (value === '__new') {
    const name = prompt('Project name:');
    if (!name || !name.trim()) { await load(); openTask(id); return; }
    const p = await api('POST', '/api/projects/', { name: name.trim() });
    if (!p) return;
    return upd(id, 'project_id', p.id);
  }
  return upd(id, 'project_id', value);
}
async function togSub(taskId, subId, done) {
  await api('PATCH', `/api/subtasks/${subId}/`, { done });
  await load(); openTask(taskId);
}
async function addSub(taskId) {
  const v = $('ns').value.trim(); if (!v) return;
  await api('POST', `/api/tasks/${taskId}/subtasks/`, { title: v });
  await load(); openTask(taskId);
}
async function delTask(id) {
  if (!confirm('Delete this task?')) return;
  await api('DELETE', `/api/tasks/${id}/`);
  closeM(); await load();
}
async function newTask() {
  const r = await api('POST', '/api/tasks/', { title: 'New task', due_date: todayISO() });
  if (!r) return;
  await load(); openTask(r.id);
}

/* ---------- AI assistant (Groq/Llama) ---------- */
async function aiCall(action, title) {
  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = 'AI thinking…'; }
  const r = await api('POST', `/api/ai/${action}/`, { title });
  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old; }
  return r;
}

async function aiSubdivide(taskId) {
  const t = S.tasks.find(x => x.id == taskId); if (!t) return;
  const r = await aiCall('subdivide', t.title);
  if (!r || !r.subtasks || !r.subtasks.length) return;
  for (const s of r.subtasks) {
    await api('POST', `/api/tasks/${taskId}/subtasks/`, { title: s });
  }
  await load(); openTask(taskId);
}

async function aiPomodoros(taskId) {
  const t = S.tasks.find(x => x.id == taskId); if (!t) return;
  const r = await aiCall('pomodoros', t.title);
  if (!r) return;
  alert(`AI suggests ${r.sessions} Pomodoro session${r.sessions > 1 ? 's' : ''} (25 min each)${r.reason ? ': ' + r.reason : ''}`);
}

async function aiEnhance(taskId) {
  const t = S.tasks.find(x => x.id == taskId); if (!t) return;
  const r = await aiCall('enhance', t.title);
  if (!r) return;
  const extra = r.bullets && r.bullets.length ? '\n\n• ' + r.bullets.join('\n• ') : '';
  await upd(taskId, 'title', r.title || t.title);
  await load(); openTask(taskId);
  if (r.description || extra) alert('AI enhanced description:\n\n' + (r.description || '') + extra);
}

/* ---------- Calendar ---------- */
function shiftM(n) {
  const [y, m] = S.month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  S.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  render();
}
function vCal() {
  const [y, m] = S.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), n = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<div class="day blank"></div>');
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ts = S.tasks.filter(t => t.due_date === k);
    cells.push(`<div class="day"><span class="dn">${d}</span>${ts.map(t =>
      `<div class="chip" style="background:${TAGS[t.tag]}" onclick="event.stopPropagation();openTask(${t.id})">${esc(t.title)}</div>`).join('')}</div>`);
  }
  return `<div class="calhead"><button class="btn ghost" onclick="shiftM(-1)">‹</button>
    <b>${first.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</b>
    <button class="btn ghost" onclick="shiftM(1)">›</button></div>
    <div class="grid7">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="wd">${d}</div>`).join('')}${cells.join('')}</div>`;
}

/* ---------- Analytics (data from /api/analytics/) ---------- */
function vAnalytics() {
  return `<div class="stats" id="an-stats"></div>
  <div class="row2">
    <div class="panel"><b>Task Breakdown</b>
      <div class="donut" id="an-donut"><span id="an-rate"></span></div>
      <div class="legend">${COLS.map(c => `<span><span class="dot" style="background:${c[2]}"></span>${c[0]}</span>`).join('')}</div>
    </div>
    <div class="panel"><b>Weekly Completion</b>
      <svg id="an-line" viewBox="0 0 490 190" width="100%" style="margin-top:14px"></svg>
    </div>
  </div>`;
}
async function loadAnalytics() {
  const a = await api('GET', '/api/analytics/'); if (!a || !$('an-stats')) return;
  $('an-stats').innerHTML = `
    <div class="stat">Active Tasks<b>${a.active}</b></div>
    <div class="stat">Avg. Time / Task<b>${fmt(a.avg_time)}</b></div>
    <div class="stat">Completion Rate<b>${a.completion_rate}%</b></div>`;
  const n = a.total || 1; let acc = 0;
  const grad = a.total ? COLS.map(c => {
    const s = acc; acc += (a.by_status[c[1]] || 0) / n * 100;
    return `${c[2]} ${s}% ${acc}%`;
  }).join(',') : '#383e4f 0 100%';
  $('an-donut').style.background = `conic-gradient(${grad})`;
  $('an-rate').textContent = a.completion_rate + '%';
  const mx = Math.max(1, ...a.weekly.map(w => w.done));
  const pts = a.weekly.map((w, i) => `${i * 70 + 20},${150 - (w.done / mx) * 120}`).join(' ');
  const dots = a.weekly.map((w, i) => {
    const x = i * 70 + 20, y = 150 - (w.done / mx) * 120;
    return `<circle cx="${x}" cy="${y}" r="4" fill="#4f8cff"/><text x="${x}" y="175" text-anchor="middle" font-size="11" fill="var(--muted)">${w.label}</text>`;
  }).join('');
  $('an-line').innerHTML = `<polyline points="${pts}" fill="none" stroke="#4f8cff" stroke-width="3"/>${dots}`;
}

/* ---------- Drag & drop (delegated on #content so it survives re-renders) ---------- */
const C = $('content');
let dragMoved = false; // suppress the click that fires right after a drop
C.addEventListener('dragstart', e => {
  const c = e.target.closest('.card'); if (!c) return;
  dragMoved = false;
  e.dataTransfer.setData('text/plain', c.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  c.classList.add('dragging');
});
C.addEventListener('dragend', e => { const c = e.target.closest('.card'); if (c) c.classList.remove('dragging'); });
C.addEventListener('dragover', e => {
  const d = e.target.closest('.drop'); if (!d) return;
  e.preventDefault();
  document.querySelectorAll('.drop.over').forEach(x => x.classList.remove('over'));
  d.classList.add('over');
});
C.addEventListener('dragleave', e => { const d = e.target.closest('.drop'); if (d) d.classList.remove('over'); });
C.addEventListener('drop', async e => {
  const d = e.target.closest('.drop'); if (!d) return;
  e.preventDefault();
  dragMoved = true;
  document.querySelectorAll('.drop.over').forEach(x => x.classList.remove('over'));
  const t = S.tasks.find(x => x.id == e.dataTransfer.getData('text/plain'));
  if (t && t.status !== d.dataset.col) {
    t.status = d.dataset.col;
    render();
    const r = await api('PATCH', `/api/tasks/${t.id}/`, { status: t.status });
    if (r) await load();
    else { t.status = ''; await load(); } // server rejected: reload true state
  } else render();
});
// A drop triggers a click on the card underneath; ignore it once.
C.addEventListener('click', e => {
  if (!dragMoved) return;
  dragMoved = false;
  if (e.target.closest('.card')) { e.stopPropagation(); e.preventDefault(); }
}, true);

/* ---------- Wiring ---------- */
document.querySelectorAll('.nav[data-v]').forEach(n => n.addEventListener('click', () => { S.view = n.dataset.v; render(); }));
$('tg').onclick = async () => {
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  await api('PUT', '/api/preferences/', { theme: S.theme });
  render();
};
$('newBtn').onclick = newTask;
$('modal').onclick = e => { if (e.target === $('modal')) closeM(); };
window.addEventListener('pagehide', flushPomo);

load();
