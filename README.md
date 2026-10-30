# Project Hub

Project Hub is a single-page task and productivity web application built with Django on the back end and vanilla JavaScript (Fetch API) on the front end. I designed and implemented this project to help users manage tasks on a Kanban board, track time with a Pomodoro timer, view deadlines on a calendar, and review productivity on an analytics dashboard. After the initial page load, every interaction uses `fetch()` and the page never reloads.

## Setup

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py makemigrations hub
python manage.py migrate
python manage.py runserver
Open http://127.0.0.1:8000/, register an account, and start creating tasks.

Optional: AI assistant (Groq) and online database (PostgreSQL)
Bash
# AI assistant (Groq, free key at console.groq.com)
$env:GROQ_API_KEY = "gsk_your_key"                      # PowerShell
export GROQ_API_KEY="gsk_your_key"                      # bash

# Online database (any PostgreSQL, e.g. Neon / Supabase)
$env:DJANGO_DB_URL = "postgresql://user:pass@host/db?sslmode=require"
Without these variables, the app runs on local SQLite and automatically hides the AI buttons.

For production, set DJANGO_SECRET_KEY and DJANGO_DEBUG=0, and add your domain to ALLOWED_HOSTS in projecthub/settings.py.

Features
Kanban Board: Four columns (To Do, In Progress, Review, Done). Drag cards between columns; each move is saved to the database immediately.

My Tasks List: A searchable table with filters for priority, tag, and status.

Pomodoro & Time Tracker: 25-minute focus and 5-minute break cycles. Focus time is saved to the selected task in batches of about 15 seconds through the API.

Task Detail: Edit title, priority, tag, due date, status, and project; manage a checklist with a progress bar; delete tasks.

Calendar: Monthly grid showing each task on its due date. Click a task to open its details.

Analytics Dashboard: Summary cards (active tasks, average time per task, completion rate), a donut chart of tasks by status, and a line chart of tasks completed over the last seven days. All values come directly from database queries.

AI Assistant (Groq / Llama): Three one-click helpers inside the task details modal:

Break down — sends the task title to /api/ai/subdivide/ and adds 3-5 generated subtasks straight to the checklist.

Estimate — /api/ai/pomodoros/ suggests how many 25-minute sessions the task needs, with a short reason.

Enhance — /api/ai/enhance/ rewrites the title, adds a clear description and bullet points.
All AI views are @api_login protected, degrade gracefully to 503 with a friendly message if Groq is unreachable, and are hidden when GROQ_API_KEY is not set.

Dark and light themes: Toggled from the sidebar and saved per user.

Accounts: Registration, login, and logout. Unauthenticated visitors are redirected to the login page.

Landing page with demo video: Visitors see a marketing page with the site logo, a how-it-works section, and an embedded demo video.

Data model
Model	Purpose
Project	Groups tasks; belongs to one user
Task	Title, status, priority, tag, due date, tracked seconds, completion date; optional project
Subtask	Checklist items inside a task
Preference	One row per user, stores the theme preference
REST API
All endpoints require login and return JSON. Unauthenticated calls get 401. Every query is filtered by request.user, so users cannot read or change each other's data. Requests that change data require the CSRF token in the X-CSRFToken header.

Method	URL	Description
GET, POST	/api/tasks/	List or create tasks
GET, PUT, PATCH, DELETE	/api/tasks/<id>/	Read, update, or delete a task
POST	/api/tasks/<id>/subtasks/	Add a checklist item
POST	/api/tasks/<id>/time/	Add tracked seconds ({"seconds": n})
PATCH, DELETE	/api/subtasks/<id>/	Toggle or remove a checklist item
GET, POST	/api/projects/	List or create projects
GET	/api/analytics/	Aggregated stats for the dashboard
GET, PUT	/api/preferences/	Read or set the theme
POST	/api/ai/subdivide/	AI: break a task into 3-5 subtasks
POST	/api/ai/pomodoros/	AI: estimate Pomodoro sessions
POST	/api/ai/enhance/	AI: improve title + description
Project structure
projecthub/
├── manage.py
├── requirements.txt
├── README.md
├── projecthub/            # settings, root URLs, WSGI
└── hub/
    ├── models.py          # Project, Task, Subtask, Preference
    ├── services.py        # Groq AI helpers (subdivide / estimate / enhance)
    ├── views.py           # auth pages + JSON API with ownership checks
    ├── urls.py
    ├── tests.py           # auth, CRUD, isolation, 401 tests
    ├── templates/hub/     # landing.html, index.html (app shell), auth.html
    └── static/hub/        # style.css, landing.css, app.js, favicon, logo, demo.mp4
Distinctiveness and complexity
Project Hub is not a clone of any course project. I combined several advanced features that each have their own data flow and interface:

Five connected views share one data store. Changing a task's status updates the Kanban board, the task list, the calendar, and the analytics charts in real time.

Server-side time tracking. The Pomodoro timer runs in the browser, but elapsed seconds are batched and sent to Django, then shown back in the task details. Time survives page reloads and logouts.

Drag and drop with persistence. Moving a card updates the UI immediately, then sends a PATCH request. The server keeps completed_at in sync with the status, and that date feeds the weekly chart.

Analytics computed on the server. Aggregations (status counts, tag counts, weekly completions, average time) run as database queries, not in the browser.

Security enforced in the back end. Every API view checks ownership using filter(owner=request.user). The ownership helper returns a 404 (not 403) so task IDs are not leakable, and a custom decorator turns Django's default login redirect into the JSON 401 response expected by JavaScript.

AI planning built in. The Groq-powered assistant breaks big tasks into subtasks, estimates Pomodoro sessions, and rewrites descriptions with strict JSON prompts and graceful 503 fallback mechanisms.

Tests
Bash
python manage.py test hub
The automated suite includes 30 tests covering registration/login, task and subtask CRUD, time tracking, data isolation between users, project assignment validation, and 401 responses for unauthenticated requests.

Notes and limits
The default database is SQLite. To use an online PostgreSQL database (Neon, Supabase, etc.), set DJANGO_DB_URL as shown above; psycopg2-binary is included in requirements.txt.

The AI assistant requires a free Groq API key (GROQ_API_KEY).

Pomodoro time is flushed on pause, reset, session end, and every 15 seconds.

Demo video
A short walkthrough of Project Hub (creating tasks, dragging cards, Pomodoro tracking, analytics):

YouTube: https://youtu.be/6MxyFW_Cy8w

The same demo video is bundled in the repository at hub/static/hub/demo.mp4 and displayed on the landing page.

File-by-file walkthrough
manage.py — Django's command-line utility for running the development server, migrations, and tests.

requirements.txt — Pins the three dependencies: Django, psycopg2-binary, and requests.

projecthub/settings.py — Global configuration. Handles environment variables and manages the database switch between SQLite and PostgreSQL.

hub/models.py — Defines the four database models: Project, Task, Subtask, and Preference.

hub/services.py — The AI integration layer that handles API calls to Groq safely and parses responses.

hub/views.py — The core back-end file. Contains authentication logic, task CRUD operations, time tracking, analytics queries, and AI endpoint handlers with strict permission checks.

hub/urls.py — Maps page routes and API endpoints.

hub/tests.py — Automated unit tests covering authentication, isolation, validation, and CRUD operations.

hub/templates/hub/ — HTML templates for the landing page, main app shell, and authentication forms.

hub/static/hub/ — Static assets including styling (CSS), client-side logic (app.js), images, and the demo video.

Challenges and design decisions
Database connectivity. Connecting to an online database was a major technical challenge due to external connection timeouts and DNS issues with early attempts. I wrote a diagnosis script to inspect host/port connections, identified provider-side issues, and migrated the database to Neon PostgreSQL. I designed settings.py to support both worlds: SQLite by default for offline evaluation and PostgreSQL when DJANGO_DB_URL is configured.

Security and data isolation. To ensure complete multi-tenant security, I made every database query owner-scoped (filter(owner=request.user)). Unauthorised access attempts receive a 404 response to prevent ID enumeration. Writing isolation unit tests early helped catch and fix edge-case bugs in project assignment validation.

AI Integration Resilience. External AI services can be unpredictable or rate-limited. I designed the service layer defensively using strict parsing and fail-soft error handling (503 status with user-friendly alerts), ensuring that temporary API outages never disrupt the core application features.
```
