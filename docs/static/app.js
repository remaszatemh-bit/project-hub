const TAGS = {
  Design: "#ec4899",
  Backend: "#3b82f6",
  Bug: "#ef4444",
  Frontend: "#14b8a6",
};
const COLS = [
  ["To Do", "todo", "#6b7280"],
  ["In Progress", "progress", "#3b82f6"],
  ["Review", "review", "#a855f7"],
  ["Done", "done", "#22c55e"],
];
const TITLES = {
  kanban: "Kanban Board",
  tasks: "My Tasks List",
  pomodoro: "Pomodoro & Time Tracker",
  calendar: "Calendar",
  analytics: "Analytics Dashboard",
};
const PRI = ["High", "Medium", "Low"];

/* ---------- Groq AI assistant ---------- */
/* The key is NOT stored in the code (GitHub blocks pushes containing secret
   keys). Instead, each visitor enters their own free key once — it is saved
   in their browser only (localStorage) and never uploaded anywhere.
   Get a free key at: https://console.groq.com/keys */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const AI_MODEL = "openai/gpt-oss-20b";

function getGroqKey() {
  return localStorage.getItem("projecthub_groq_key") || "";
}

async function aiChat(messages, maxTokens = 600) {
  const key = getGroqKey();
  if (!key) {
    const entered = prompt(
      "The AI assistant needs a free Groq API key.\n" +
        "Get one at console.groq.com/keys and paste it here (it is saved in your browser only):",
    );
    if (!entered || !entered.trim()) throw new Error("No Groq API key provided");
    localStorage.setItem("projecthub_groq_key", entered.trim());
  }
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${getGroqKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.4, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error("AI service unavailable (" + r.status + ")");
  return (await r.json()).choices[0].message.content;
}
function aiParse(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    const start = content.indexOf("{"), end = content.lastIndexOf("}") + 1;
    if (start === -1 || end === 0) return null;
    try {
      return JSON.parse(content.slice(start, end));
    } catch (e2) {
      return null;
    }
  }
}
const aiSafe = (text, fallback) => {
  text = (text || "").trim();
  return text.slice(0, 200) || fallback;
};

/* Break a task into 3-5 subtasks. Returns array of strings or null. */
async function aiSubdivideTitles(title) {
  const content = await aiChat([
    { role: "system", content: 'You are a project planning assistant. Break the given task into 3 to 5 small, concrete, actionable subtasks. Answer ONLY with JSON: {"subtasks": ["...", "..."]}' },
    { role: "user", content: `Task: ${title}` },
  ], 400);
  const data = aiParse(content);
  const subs = data && Array.isArray(data.subtasks) ? data.subtasks : null;
  if (!subs) return null;
  return subs.filter((s) => typeof s === "string" && s.trim()).slice(0, 5);
}

/* Estimate Pomodoro sessions for a task. Returns {sessions, reason} or null. */
async function aiEstimatePomodoros(title) {
  const content = await aiChat([
    { role: "system", content: 'You estimate how many 25-minute Pomodoro sessions a task needs. Answer ONLY with JSON: {"sessions": <integer between 1 and 16>, "reason": "<max 15 words>"}. Skip any reasoning; output the JSON directly.' },
    { role: "user", content: `Task: ${title}` },
  ], 500);
  const data = aiParse(content);
  if (!data || typeof data !== "object") return null;
  const sessions = parseInt(data.sessions, 10);
  if (isNaN(sessions)) return null;
  return { sessions: Math.max(1, Math.min(sessions, 16)), reason: aiSafe(data.reason, "") };
}

/* Suggest an improved, shorter title for a task. Returns string or null. */
async function aiSuggestTitle(title) {
  const content = await aiChat([
    { role: "system", content: 'You improve short task titles into clearer, more concise ones. Answer ONLY with JSON: {"title": "<improved concise title, max 12 words>"}' },
    { role: "user", content: `Task title: ${title}` },
  ], 300);
  const data = aiParse(content);
  if (!data || !data.title || typeof data.title !== "string") return null;
  return aiSafe(data.title, "");
}

/* ---------- helpers needed before the data layer ---------- */
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayISO = () => localDate(new Date());
function localMonth() {
  return localDate(new Date()).slice(0, 7);
}

/* ---------- Supabase data layer ---------- */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const THEME_KEY = "projecthub_theme";

/* In-memory cache of the signed-in user's rows. */
let DB = { tasks: [], projects: [] };

/* All writes go to Supabase; localStorage is no longer used for data. */
async function reloadDB() {
  const uid = (await sb.auth.getUser()).data.user?.id;
  if (!uid) return;
  const [tasks, projects] = await Promise.all([
    sb.from("tasks").select("*, subtasks(*)").order("id"),
    sb.from("projects").select("*").order("id"),
  ]);
  DB.projects = projects.data || [];
  DB.tasks = (tasks.data || []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    tag: t.tag,
    due_date: t.due_date,
    time_spent: t.time_spent,
    project_id: t.project_id,
    completed_at: t.completed_at,
    subtasks: (t.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: s.done })),
  }));
}

function sbErr(res) {
  if (res.error) throw new Error(res.error.message);
}

/* Refresh the in-memory cache from the server, then re-render. */
async function reloadDBAndRender() {
  await reloadDB();
  render();
}

/* Returns the numeric id of the inserted row. */
async function dbInsertTask(t) {
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    /* Session missing/expired — send the user to log in again. */
    location.href = "auth.html";
    throw new Error("Session expired. Please log in again.");
  }
  const res = await sb
    .from("tasks")
    .insert({
      user_id: userData.user.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      tag: t.tag,
      due_date: t.due_date,
      time_spent: t.time_spent,
      project_id: t.project_id,
      completed_at: t.completed_at,
    })
    .select("id")
    .single();
  sbErr(res);
  return res.data.id;
}

async function dbUpdateTask(id, fields) {
  const clean = { ...fields };
  delete clean.id;
  delete clean.subtasks;
  const res = await sb.from("tasks").update(clean).eq("id", id);
  sbErr(res);
}

async function dbDeleteTask(id) {
  sbErr(await sb.from("tasks").delete().eq("id", id));
}

async function dbInsertSub(taskId, title) {
  const res = await sb.from("subtasks").insert({ task_id: taskId, title }).select("id").single();
  sbErr(res);
  return res.data.id;
}

async function dbUpdateSub(subId, fields) {
  sbErr(await sb.from("subtasks").update(fields).eq("id", subId));
}

async function dbInsertProject(name) {
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    location.href = "auth.html";
    throw new Error("Session expired. Please log in again.");
  }
  const res = await sb.from("projects").insert({ user_id: userData.user.id, name }).select("id").single();
  sbErr(res);
  return res.data.id;
}

/* Guard: redirects to the login page when there is no session. */
async function requireLogin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    location.href = "auth.html";
    throw new Error("not signed in");
  }
}

let uid = null; // set after login; ids come from the database now
const S = {
  view: "kanban",
  theme: localStorage.getItem(THEME_KEY) || "dark",
  sel: null,
  month: localMonth(),
  q: "",
  fp: "",
  ft: "",
  fs: "",
};
const P = {
  mode: "work",
  left: 1500,
  run: false,
  iv: null,
  pending: 0,
  sessions: 0,
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (s) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const opts = (arr, val) =>
  arr
    .map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`)
    .join("");
const colName = (k) => COLS.find((c) => c[1] === k)[0];

function findTask(id) {
  return DB.tasks.find((t) => t.id == id);
}
function findSub(subId) {
  for (const t of DB.tasks) {
    const s = t.subtasks.find((x) => x.id == subId);
    if (s) return { t, s };
  }
  return {};
}

/* ---------- rendering ---------- */
function render() {
  document.documentElement.dataset.theme = S.theme;
  $("tg").textContent = S.theme === "dark" ? "Light Mode" : "Dark Mode";
  document
    .querySelectorAll(".nav[data-v]")
    .forEach((n) => n.classList.toggle("active", n.dataset.v === S.view));
  $("title").textContent = TITLES[S.view];
  const V = {
    kanban: vKanban,
    tasks: vTasks,
    pomodoro: vPomodoro,
    calendar: vCal,
    analytics: vAnalytics,
  };
  $("content").innerHTML = V[S.view]();
  if (S.view === "analytics") loadAnalytics();
  updPomo();
}

/* ---------- Kanban ---------- */
function cardHTML(t) {
  const d = t.subtasks.filter((s) => s.done).length;
  return `<div class="card" draggable="true" data-id="${t.id}" onclick="openTask(${t.id})">
    <b>${esc(t.title)}</b>
    <div class="tags"><span class="tag" style="background:${TAGS[t.tag]}">${t.tag}</span></div>
    <div class="meta"><span class="pri-${t.priority}">● ${t.priority}</span>
    <span>${t.subtasks.length ? d + "/" + t.subtasks.length + " · " : ""}${t.due_date || ""}</span></div></div>`;
}
function vKanban() {
  return `<div class="board">${COLS.map(([n, k, c]) => {
    const list = DB.tasks.filter((t) => t.status === k);
    return `<div class="col"><h3><span><span class="dot" style="background:${c}"></span>${n}</span><span>${list.length}</span></h3>
      <div class="drop" data-col="${k}">${list.map(cardHTML).join("")}</div></div>`;
  }).join("")}</div>`;
}

/* ---------- My Tasks ---------- */
function rowsHTML() {
  const f = DB.tasks.filter(
    (t) =>
      (!S.q || t.title.toLowerCase().includes(S.q.toLowerCase())) &&
      (!S.fp || t.priority === S.fp) &&
      (!S.ft || t.tag === S.ft) &&
      (!S.fs || t.status === S.fs),
  );
  if (!f.length)
    return `<tr><td colspan="5" class="meta">No tasks found</td></tr>`;
  return f
    .map(
      (t) => `<tr style="cursor:pointer" onclick="openTask(${t.id})">
    <td>${esc(t.title)}</td><td>${t.due_date || ""}</td>
    <td><span class="pri-${t.priority}">● ${t.priority}</span></td>
    <td><span class="tag" style="background:${TAGS[t.tag]}">${t.tag}</span></td>
    <td>${colName(t.status)}</td></tr>`,
    )
    .join("");
}
function rows() {
  $("rows").innerHTML = rowsHTML();
}
function vTasks() {
  return `<div class="bar">
    <input placeholder="Search tasks..." value="${esc(S.q)}" oninput="S.q=this.value;rows()">
    <select onchange="S.fp=this.value;rows()"><option value="">All priorities</option>${opts(PRI, S.fp)}</select>
    <select onchange="S.ft=this.value;rows()"><option value="">All tags</option>${opts(Object.keys(TAGS), S.ft)}</select>
    <select onchange="S.fs=this.value;rows()"><option value="">All statuses</option>${COLS.map((c) => `<option value="${c[1]}" ${S.fs === c[1] ? "selected" : ""}>${c[0]}</option>`).join("")}</select>
  </div>
  <table><thead><tr><th>Task</th><th>Due Date</th><th>Priority</th><th>Tag</th><th>Status</th></tr></thead>
  <tbody id="rows">${rowsHTML()}</tbody></table>`;
}

/* ---------- Pomodoro ---------- */
function vPomodoro() {
  const open = DB.tasks.filter((t) => t.status !== "done");
  if (!open.find((t) => t.id == S.sel)) S.sel = open[0] ? open[0].id : null;
  return `<div class="pomo"><div class="panel">
    <select style="width:100%" onchange="flushPomo();S.sel=+this.value;render()">
      ${open.map((t) => `<option value="${t.id}" ${t.id == S.sel ? "selected" : ""}>${esc(t.title)}</option>`).join("") || "<option>No open tasks</option>"}
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
  const c = $("pclock");
  if (!c) return;
  c.textContent = `${String(Math.floor(P.left / 60)).padStart(2, "0")}:${String(P.left % 60).padStart(2, "0")}`;
  $("pmode").textContent =
    P.mode === "work" ? "Focus · 25 min" : "Break · 5 min";
  $("pbtn").textContent = P.run ? "Pause" : "Start";
  const cur = findTask(S.sel);
  $("ptrk").textContent = cur ? fmt(cur.time_spent + P.pending) : "0m";
  $("psess").textContent = P.sessions;
}
function flushPomo() {
  if (!P.pending || !S.sel) return;
  const t = findTask(S.sel);
  if (t) {
    t.time_spent += P.pending;
    dbUpdateTask(t.id, { time_spent: t.time_spent }).catch(console.error);
  }
  P.pending = 0;
  updPomo();
}
function pomToggle() {
  if (P.run) {
    clearInterval(P.iv);
    P.run = false;
    flushPomo();
  } else {
    P.iv = setInterval(pomTick, 1000);
    P.run = true;
  }
  updPomo();
}
function pomTick() {
  P.left--;
  if (P.mode === "work" && S.sel) P.pending++;
  if (P.left <= 0) {
    if (P.mode === "work") {
      P.sessions++;
      P.mode = "break";
      P.left = 300;
      flushPomo();
    } else {
      P.mode = "work";
      P.left = 1500;
    }
  }
  if (P.pending >= 15) flushPomo();
  updPomo();
}
function pomReset() {
  clearInterval(P.iv);
  P.run = false;
  P.mode = "work";
  P.left = 1500;
  flushPomo();
  updPomo();
}

/* ---------- Task detail modal ---------- */
function openTask(id) {
  const t = findTask(id);
  if (!t) return;
  const d = t.subtasks.filter((s) => s.done).length;
  const pct =
    t.status === "done"
      ? 100
      : t.subtasks.length
        ? Math.round((d / t.subtasks.length) * 100)
        : 0;
  const projOpts =
    '<option value="">No project</option>' +
    DB.projects
      .map(
        (p) =>
          `<option value="${p.id}" ${t.project_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`,
      )
      .join("") +
    '<option value="__new">+ New project…</option>';
  $("modal").innerHTML = `<div class="box">
    <div class="mh"><input class="ttl" value="${esc(t.title)}" onchange="upd(${id},'title',this.value)"><button class="x" onclick="closeM()">✕</button></div>
    <div class="frow">
      <label>Priority<select onchange="upd(${id},'priority',this.value)">${opts(PRI, t.priority)}</select></label>
      <label>Tag<select onchange="upd(${id},'tag',this.value)">${opts(Object.keys(TAGS), t.tag)}</select></label>
      <label>Due date<input type="date" value="${t.due_date || ""}" onchange="upd(${id},'due_date',this.value)"></label>
      <label>Status<select onchange="upd(${id},'status',this.value)">${COLS.map((c) => `<option value="${c[1]}" ${t.status === c[1] ? "selected" : ""}>${c[0]}</option>`).join("")}</select></label>
      <label>Project<select onchange="changeProject(${id},this.value)">${projOpts}</select></label>
    </div>
    <div>
      <div class="meta" style="margin:0 0 6px"><span>Progress</span><span>${pct}% · ${fmt(t.time_spent)} tracked</span></div>
      <div class="prog"><div style="width:${pct}%"></div></div>
    </div>
    <div><b>Checklist</b>
      <div class="frow" style="margin-bottom:6px">
        <span class="meta" style="flex:1;margin:0">AI assistant:</span>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiBreakdown(${id})">✨ Break down</button>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiEstimate(${id})">⏱ Estimate</button>
        <button class="btn ghost" style="padding:4px 8px;font-size:12px" onclick="aiImproveTitle(${id})">📝 Improve title</button>
      </div>
      ${t.subtasks.map((s) => `<label class="sub"><input type="checkbox" ${s.done ? "checked" : ""} onchange="togSub(${id},${s.id},${!s.done})"><span class="${s.done ? "strike" : ""}">${esc(s.title)}</span></label>`).join("") || '<div class="meta">No subtasks yet</div>'}
      <div class="frow" style="margin-top:8px"><input id="ns" placeholder="Add subtask..." style="flex:1" onkeydown="if(event.key==='Enter')addSub(${id})"><button class="btn ghost" onclick="addSub(${id})">Add</button></div>
    </div>
    <div class="frow end"><button class="btn danger" onclick="delTask(${id})">Delete</button><button class="btn" onclick="closeM()">Done</button></div>
  </div>`;
  $("modal").classList.add("show");
}
function closeM() {
  $("modal").classList.remove("show");
}
async function upd(id, field, value) {
  const t = findTask(id);
  if (!t) return;
  if (field === "due_date") t.due_date = value || null;
  else if (field === "project_id") t.project_id = value ? +value : null;
  else t[field] = value;
  if (field === "status")
    t.completed_at = t.status === "done" ? t.completed_at || todayISO() : null;
  try {
    await dbUpdateTask(id, { [field]: t[field] === undefined ? t.due_date : t[field], completed_at: t.completed_at });
  } catch (e) {
    alert("Save failed: " + e.message);
  }
  render();
  if ($("modal").classList.contains("show")) openTask(id);
}
async function changeProject(id, value) {
  if (value === "__new") {
    const name = prompt("Project name:");
    if (!name || !name.trim()) {
      openTask(id);
      return;
    }
    try {
      const pid = await dbInsertProject(name.trim());
      DB.projects.push({ id: pid, name: name.trim() });
      return upd(id, "project_id", pid);
    } catch (e) {
      alert("Could not create project: " + e.message);
      openTask(id);
      return;
    }
  }
  return upd(id, "project_id", value);
}
async function togSub(taskId, subId, done) {
  const { s } = findSub(subId);
  if (!s) return;
  s.done = done;
  try {
    await dbUpdateSub(subId, { done });
  } catch (e) {
    alert("Save failed: " + e.message);
    s.done = !done;
  }
  render();
  openTask(taskId);
}
async function addSub(taskId) {
  const v = $("ns").value.trim();
  if (!v) return;
  const t = findTask(taskId);
  if (!t) return;
  try {
    const sid = await dbInsertSub(taskId, v);
    t.subtasks.push({ id: sid, title: v, done: false });
  } catch (e) {
    alert("Could not add subtask: " + e.message);
  }
  render();
  openTask(taskId);
}
async function delTask(id) {
  if (!confirm("Delete this task?")) return;
  try {
    await dbDeleteTask(id);
  } catch (e) {
    alert("Delete failed: " + e.message);
    return;
  }
  DB.tasks = DB.tasks.filter((t) => t.id != id);
  closeM();
  render();
}
async function newTask() {
  const t = {
    title: "New task",
    status: "todo",
    priority: "Medium",
    tag: "Frontend",
    due_date: todayISO(),
    time_spent: 0,
    project_id: null,
    completed_at: null,
    subtasks: [],
  };
  try {
    t.id = await dbInsertTask(t);
  } catch (e) {
    alert("Could not create task: " + e.message);
    return;
  }
  DB.tasks.push(t);
  render();
  openTask(t.id);
}

/* ---------- AI assistant actions ---------- */
async function aiCall(taskId, btn, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "AI thinking…";
  try {
    await fn();
  } catch (e) {
    alert("AI assistant unavailable, try again later\n(" + e.message + ")");
  }
  btn.disabled = false;
  btn.textContent = old;
}

function aiBreakdown(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  aiCall(taskId, event.target, async () => {
    const subs = await aiSubdivideTitles(t.title);
    if (!subs) {
      alert("The AI could not break this task down, try again.");
      return;
    }
    for (const s of subs) {
      try {
        const sid = await dbInsertSub(taskId, aiSafe(s, "Subtask"));
        t.subtasks.push({ id: sid, title: aiSafe(s, "Subtask"), done: false });
      } catch (e) {
        alert("Could not save subtask: " + e.message);
      }
    }
    render();
    openTask(taskId);
  });
}

function aiEstimate(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  aiCall(taskId, event.target, async () => {
    const est = await aiEstimatePomodoros(t.title);
    if (!est) {
      alert("The AI could not estimate this task, try again.");
      return;
    }
    alert(`AI suggests ${est.sessions} Pomodoro session${est.sessions > 1 ? "s" : ""} (25 min each)${est.reason ? ": " + est.reason : ""}`);
  });
}

function aiImproveTitle(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  aiCall(taskId, event.target, async () => {
    const better = await aiSuggestTitle(t.title);
    if (!better) {
      alert("The AI could not improve this title, try again.");
      return;
    }
    t.title = better;
    await upd(taskId, "title", better);
    openTask(taskId);
  });
}

/* ---------- Calendar ---------- */
function shiftM(n) {
  const [y, m] = S.month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  S.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  render();
}
function vCal() {
  const [y, m] = S.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1),
    n = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++)
    cells.push('<div class="day blank"></div>');
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const ts = DB.tasks.filter((t) => t.due_date === k);
    cells.push(
      `<div class="day"><span class="dn">${d}</span>${ts
        .map(
          (t) =>
            `<div class="chip" style="background:${TAGS[t.tag]}" onclick="event.stopPropagation();openTask(${t.id})">${esc(t.title)}</div>`,
        )
        .join("")}</div>`,
    );
  }
  return `<div class="calhead"><button class="btn ghost" onclick="shiftM(-1)">‹</button>
    <b>${first.toLocaleDateString("en", { month: "long", year: "numeric" })}</b>
    <button class="btn ghost" onclick="shiftM(1)">›</button></div>
    <div class="grid7">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="wd">${d}</div>`).join("")}${cells.join("")}</div>`;
}

/* ---------- Analytics ---------- */
function analyticsData() {
  const total = DB.tasks.length;
  const done = DB.tasks.filter((t) => t.status === "done").length;
  const spent = DB.tasks.reduce((a, t) => a + t.time_spent, 0);
  const today = new Date();
  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = localDate(d);
    weekly.push({
      label: d.toLocaleDateString("en", { weekday: "short" }),
      done: DB.tasks.filter((t) => t.completed_at === k).length,
    });
  }
  return {
    total,
    active: total - done,
    completion_rate: Math.round((done / total) * 100) || 0,
    avg_time: Math.round(spent / total) || 0,
    by_status: Object.fromEntries(
      COLS.map((c) => [c[1], DB.tasks.filter((t) => t.status === c[1]).length]),
    ),
  };
}
function vAnalytics() {
  return `<div class="stats" id="an-stats"></div>
  <div class="row2">
    <div class="panel"><b>Task Breakdown</b>
      <div class="donut" id="an-donut"><span id="an-rate"></span></div>
      <div class="legend">${COLS.map((c) => `<span><span class="dot" style="background:${c[2]}"></span>${c[0]}</span>`).join("")}</div>
    </div>
    <div class="panel"><b>Weekly Completion</b>
      <svg id="an-line" viewBox="0 0 490 190" width="100%" style="margin-top:14px"></svg>
    </div>
  </div>`;
}
function loadAnalytics() {
  if (!$("an-stats")) return;
  const a = analyticsData();
  $("an-stats").innerHTML = `
    <div class="stat">Active Tasks<b>${a.active}</b></div>
    <div class="stat">Avg. Time / Task<b>${fmt(a.avg_time)}</b></div>
    <div class="stat">Completion Rate<b>${a.completion_rate}%</b></div>`;
  const n = a.total || 1;
  let acc = 0;
  const grad = a.total
    ? COLS.map((c) => {
        const s = acc;
        acc += ((a.by_status[c[1]] || 0) / n) * 100;
        return `${c[2]} ${s}% ${acc}%`;
      }).join(",")
    : "#383e4f 0 100%";
  $("an-donut").style.background = `conic-gradient(${grad})`;
  $("an-rate").textContent = a.completion_rate + "%";
  const week = analyticsData ? lastWeek() : [];
  const mx = Math.max(1, ...week.map((w) => w.done));
  const pts = week
    .map((w, i) => `${i * 70 + 20},${150 - (w.done / mx) * 120}`)
    .join(" ");
  const dots = week
    .map((w, i) => {
      const x = i * 70 + 20,
        y = 150 - (w.done / mx) * 120;
      return `<circle cx="${x}" cy="${y}" r="4" fill="#4f8cff"/><text x="${x}" y="175" text-anchor="middle" font-size="11" fill="var(--muted)">${w.label}</text>`;
    })
    .join("");
  $("an-line").innerHTML =
    `<polyline points="${pts}" fill="none" stroke="#4f8cff" stroke-width="3"/>${dots}`;
}
function lastWeek() {
  const today = new Date();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = localDate(d);
    out.push({
      label: d.toLocaleDateString("en", { weekday: "short" }),
      done: DB.tasks.filter((t) => t.completed_at === k).length,
    });
  }
  return out;
}

/* ---------- Drag & drop ---------- */
const C = $("content");
let dragMoved = false;
C.addEventListener("dragstart", (e) => {
  const c = e.target.closest(".card");
  if (!c) return;
  dragMoved = false;
  e.dataTransfer.setData("text/plain", c.dataset.id);
  e.dataTransfer.effectAllowed = "move";
  c.classList.add("dragging");
});
C.addEventListener("dragend", (e) => {
  const c = e.target.closest(".card");
  if (c) c.classList.remove("dragging");
});
C.addEventListener("dragover", (e) => {
  const d = e.target.closest(".drop");
  if (!d) return;
  e.preventDefault();
  document
    .querySelectorAll(".drop.over")
    .forEach((x) => x.classList.remove("over"));
  d.classList.add("over");
});
C.addEventListener("dragleave", (e) => {
  const d = e.target.closest(".drop");
  if (d) d.classList.remove("over");
});
C.addEventListener("drop", (e) => {
  const d = e.target.closest(".drop");
  if (!d) return;
  e.preventDefault();
  dragMoved = true;
  document
    .querySelectorAll(".drop.over")
    .forEach((x) => x.classList.remove("over"));
  const t = findTask(e.dataTransfer.getData("text/plain"));
  if (t && t.status !== d.dataset.col) {
    const prevStatus = t.status, prevCompleted = t.completed_at;
    t.status = d.dataset.col;
    t.completed_at = t.status === "done" ? t.completed_at || todayISO() : null;
    render();
    dbUpdateTask(t.id, { status: t.status, completed_at: t.completed_at })
      .then(reloadDBAndRender)
      .catch((e) => {
        /* Roll back the optimistic move and tell the user. */
        t.status = prevStatus;
        t.completed_at = prevCompleted;
        alert("Save failed: " + e.message);
        render();
      });
  } else render();
});
C.addEventListener(
  "click",
  (e) => {
    if (!dragMoved) return;
    dragMoved = false;
    if (e.target.closest(".card")) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);

/* ---------- Wiring ---------- */
document.querySelectorAll(".nav[data-v]").forEach((n) =>
  n.addEventListener("click", () => {
    S.view = n.dataset.v;
    render();
  }),
);
$("tg").onclick = () => {
  S.theme = S.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, S.theme);
  render();
};
$("newBtn").onclick = newTask;
$("modal").onclick = (e) => {
  if (e.target === $("modal")) closeM();
};
window.addEventListener("pagehide", flushPomo);

/* ---------- boot: verify session, load data, then render ---------- */
(async () => {
  try {
    await requireLogin();
    await reloadDB();
    const { data } = await sb.auth.getUser();
    const meta = data.user?.user_metadata || {};
    const label = meta.full_name || (data.user?.email || "account").split("@")[0];
    $("who").textContent = label;
  } catch (e) {
    return; // requireLogin already redirected
  }
  render();
})();

$("logout").onclick = async () => {
  await sb.auth.signOut();
  location.href = "auth.html";
};
