# Project Hub

A task and productivity web app: Kanban board, task list, Pomodoro timer, calendar, and analytics. Built with plain HTML/CSS/JavaScript — **no server, no Python, no build step**. All data is stored in the browser's `localStorage`.

## Setup — Supabase backend

The app now uses a real database (Supabase) with user accounts:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase Dashboard open **SQL Editor → New query**, paste the contents of `supabase_schema.sql` and click **Run**. This creates the `projects`, `tasks`, `subtasks` and `preferences` tables with Row Level Security, so every user only sees their own data.
3. Copy your **Project URL** and **anon public key** from **Settings → API**, and put them in `docs/static/config.js`.
4. Done — registration and login happen on the `auth.html` page (Supabase Auth). If sign-ups should be confirmed by email, disable that in **Authentication → Providers → Email → Confirm email** for a smoother demo.

## Run it locally

```bash
cd docs
python -m http.server 8000
# open http://localhost:8000/
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, pick the branch `main` and the folder **`/docs`**, then Save.
4. Wait a minute, then open `https://<your-username>.github.io/<repo-name>/` — the site opens directly as a normal link.

## Features

- **Kanban Board** — four stages (To Do, In Progress, Review, Done); drag cards between them and the change is saved instantly.
- **My Tasks** — searchable table with filters for priority, tag, and status.
- **Pomodoro & Time Tracker** — 25-minute focus / 5-minute break cycles; tracked time is saved on the selected task.
- **Accounts & cloud sync** — register/log in with email (Supabase Auth); tasks are stored in Postgres with Row Level Security, so the same account shows the same data on any device.
- **Task Details** — edit title, priority, tag, due date, status, and project; checklist with a progress bar; delete tasks.
- **AI assistant (Groq)** — one-click helpers inside the task dialog: break a task into subtasks, estimate how many Pomodoro sessions it needs, and improve the task title.
- **Contact form (EmailJS)** — the landing page, privacy page, and a dedicated contact page send messages straight to the project inbox.
- **Calendar** — monthly grid of tasks by due date.
- **Analytics** — active tasks, average time per task, completion rate, a donut chart by status, and a weekly completion line chart.
- **Dark / light theme** — toggled from the sidebar and remembered.

## Structure

```
docs/
├── index.html        # landing page
├── auth.html         # login / register (Supabase Auth)
├── app.html          # the app itself
├── contact.html      # contact form (EmailJS)
├── privacy.html      # privacy policy + contact form
├── supabase_schema.sql  # database schema (run in Supabase SQL editor)
└── static/
    ├── config.js     # SUPABASE_URL + SUPABASE_ANON_KEY
    ├── auth.js       # login/register logic
    ├── style.css     # shared styles
    ├── landing.css   # landing page styles
    ├── app.js        # app logic (Supabase data layer)
    └── favicon.ico, logo_*.png
```

Demo video: https://youtu.be/iPW8tFYjmiw
