-- Client-side conflict hints for sync (optional but recommended).
alter table public.repertoires add column if not exists updated_at timestamptz not null default now();
alter table public.moves add column if not exists updated_at timestamptz not null default now();
