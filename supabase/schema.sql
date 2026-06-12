-- AIVIO Supabase séma
-- Futtasd: Supabase Dashboard → SQL Editor → New query → Run

-- Leadek, időpontok, beszélgetések, CMS napló (egy tábla, collection alapján)
create table if not exists public.aivio_records (
  collection text not null,
  id text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists idx_aivio_records_list
  on public.aivio_records (collection, updated_at desc);

-- Robot CMS felülírások (egy sor, összes robot)
create table if not exists public.aivio_cms_config (
  id text primary key default 'robot_overrides',
  overrides jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- RLS: backend service_role kulccsal ír/olvas (Netlify function)
alter table public.aivio_records enable row level security;
alter table public.aivio_cms_config enable row level security;

-- Anon kulcs csak olvasás (opcionális, ha később frontendről kell)
create policy "aivio_records_read" on public.aivio_records
  for select using (true);

create policy "aivio_cms_read" on public.aivio_cms_config
  for select using (true);

-- Service role key megkerüli az RLS-t — íráshoz azt használd a Netlify-on.
