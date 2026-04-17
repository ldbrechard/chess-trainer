-- Repertoires and moves with RLS (owner = auth.uid() via repertoires.user_id).
-- Apply in Supabase: SQL Editor → New query → paste → Run, or use `supabase db push`.

create table if not exists public.repertoires (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  side text not null check (side in ('white', 'black')),
  created_at timestamptz not null default now()
);

create table if not exists public.moves (
  id uuid primary key default gen_random_uuid(),
  repertoire_id uuid not null references public.repertoires (id) on delete cascade,
  parent_id uuid references public.moves (id) on delete cascade,
  fen text not null,
  notation text not null,
  nag text,
  comment text not null default '',
  eval double precision,
  created_at timestamptz not null default now()
);

create index if not exists moves_repertoire_parent_idx on public.moves (repertoire_id, parent_id);
create index if not exists moves_repertoire_created_idx on public.moves (repertoire_id, created_at);

alter table public.repertoires enable row level security;
alter table public.moves enable row level security;

drop policy if exists "repertoires_select_own" on public.repertoires;
create policy "repertoires_select_own" on public.repertoires for select using (auth.uid() = user_id);

drop policy if exists "repertoires_insert_own" on public.repertoires;
create policy "repertoires_insert_own" on public.repertoires for insert with check (auth.uid() = user_id);

drop policy if exists "repertoires_update_own" on public.repertoires;
create policy "repertoires_update_own" on public.repertoires for update using (auth.uid() = user_id);

drop policy if exists "repertoires_delete_own" on public.repertoires;
create policy "repertoires_delete_own" on public.repertoires for delete using (auth.uid() = user_id);

drop policy if exists "moves_select" on public.moves;
create policy "moves_select" on public.moves for select using (
  exists (select 1 from public.repertoires r where r.id = moves.repertoire_id and r.user_id = auth.uid())
);

drop policy if exists "moves_insert" on public.moves;
create policy "moves_insert" on public.moves for insert with check (
  exists (select 1 from public.repertoires r where r.id = moves.repertoire_id and r.user_id = auth.uid())
);

drop policy if exists "moves_update" on public.moves;
create policy "moves_update" on public.moves for update using (
  exists (select 1 from public.repertoires r where r.id = moves.repertoire_id and r.user_id = auth.uid())
);

drop policy if exists "moves_delete" on public.moves;
create policy "moves_delete" on public.moves for delete using (
  exists (select 1 from public.repertoires r where r.id = moves.repertoire_id and r.user_id = auth.uid())
);
