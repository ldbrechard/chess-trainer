create table if not exists public.shared_repertoires (
  id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  repertoire_title text not null,
  side text not null check (side in ('white', 'black')),
  pgn_text text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false
);

create index if not exists shared_repertoires_owner_idx on public.shared_repertoires(owner_user_id);
create index if not exists shared_repertoires_expires_idx on public.shared_repertoires(expires_at);

alter table public.shared_repertoires enable row level security;

drop policy if exists shared_repertoires_select_public on public.shared_repertoires;
create policy shared_repertoires_select_public
on public.shared_repertoires
for select
to anon, authenticated
using (revoked = false and (expires_at is null or expires_at > now()));

drop policy if exists shared_repertoires_insert_owner on public.shared_repertoires;
create policy shared_repertoires_insert_owner
on public.shared_repertoires
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists shared_repertoires_update_owner on public.shared_repertoires;
create policy shared_repertoires_update_owner
on public.shared_repertoires
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists shared_repertoires_delete_owner on public.shared_repertoires;
create policy shared_repertoires_delete_owner
on public.shared_repertoires
for delete
to authenticated
using (owner_user_id = auth.uid());

