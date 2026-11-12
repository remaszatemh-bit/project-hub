-- Project Hub schema for Supabase
-- Run this whole file in: Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists public.projects (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (
        char_length(name) between 1 and 100
    ),
    created_at timestamptz not null default now()
);

create table if not exists public.tasks (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    project_id bigint references public.projects (id) on delete set null,
    title text not null check (
        char_length(title) between 1 and 200
    ),
    status text not null default 'todo' check (
        status in (
            'todo',
            'progress',
            'review',
            'done'
        )
    ),
    priority text not null default 'Medium' check (
        priority in ('High', 'Medium', 'Low')
    ),
    tag text not null default 'Frontend' check (
        tag in (
            'Design',
            'Backend',
            'Bug',
            'Frontend'
        )
    ),
    due_date date,
    time_spent bigint not null default 0 check (time_spent >= 0),
    completed_at date,
    created_at timestamptz not null default now()
);

create table if not exists public.subtasks (
    id bigint generated always as identity primary key,
    task_id bigint not null references public.tasks (id) on delete cascade,
    title text not null check (
        char_length(title) between 1 and 200
    ),
    done boolean not null default false
);

create table if not exists public.preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    theme text not null default 'dark' check (theme in ('dark', 'light'))
);

create index if not exists idx_projects_user on public.projects (user_id);

create index if not exists idx_tasks_user on public.tasks (user_id);

create index if not exists idx_tasks_project on public.tasks (project_id);

create index if not exists idx_subtasks_task on public.subtasks (task_id);

-- Row Level Security: users can only see and touch their own rows.
alter table public.projects enable row level security;

alter table public.tasks enable row level security;

alter table public.subtasks enable row level security;

alter table public.preferences enable row level security;

create policy "own projects" on public.projects for all using (auth.uid () = user_id)
with
    check (auth.uid () = user_id);

create policy "own tasks" on public.tasks for all using (auth.uid () = user_id)
with
    check (auth.uid () = user_id);

create policy "own subtasks" on public.subtasks for all using (
    exists (
        select 1
        from public.tasks t
        where
            t.id = task_id
            and t.user_id = auth.uid ()
    )
)
with
    check (
        exists (
            select 1
            from public.tasks t
            where
                t.id = task_id
                and t.user_id = auth.uid ()
        )
    );

create policy "own preferences" on public.preferences for all using (auth.uid () = user_id)
with
    check (auth.uid () = user_id);