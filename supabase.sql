-- Выполните в SQL Editor проекта Supabase один раз.
create extension if not exists pgcrypto;

create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.game_events(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);

create index if not exists game_sessions_event_id_idx on public.game_sessions(event_id);

create table if not exists public.game_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 28),
  token_hash text not null unique,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  elapsed_seconds integer check (elapsed_seconds between 1 and 14400),
  score integer check (score between 0 and 900),
  missions jsonb not null default '[]'::jsonb
);

create index if not exists game_attempts_session_id_idx on public.game_attempts(session_id);

-- Браузер не получает ключ service_role. Доступ к таблицам только через API Vercel.
alter table public.game_events enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_attempts enable row level security;
