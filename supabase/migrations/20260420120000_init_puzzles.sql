-- Lichess puzzles import table (global, read-only from the app).
-- Designed for fast bulk import from `puzzles.csv` and querying by opening tags + rating.

create table if not exists public.puzzles (
  id text primary key,
  fen text not null,
  moves text not null,
  rating integer not null,
  rating_deviation integer,
  popularity integer,
  nb_plays integer,
  themes_raw text not null default '',
  opening_tags_raw text not null default '',
  game_url text,
  created_at timestamptz not null default now(),

  -- Convenience generated columns for filtering (space-separated in CSV).
  themes text[] generated always as (
    string_to_array(nullif(themes_raw, ''), ' ')
  ) stored,
  opening_tags text[] generated always as (
    string_to_array(nullif(opening_tags_raw, ''), ' ')
  ) stored,
  opening_tag_primary text generated always as (
    (string_to_array(nullif(opening_tags_raw, ''), ' '))[1]
  ) stored
);

create index if not exists puzzles_rating_idx on public.puzzles (rating);
create index if not exists puzzles_opening_tag_primary_idx on public.puzzles (opening_tag_primary);
create index if not exists puzzles_opening_tags_gin_idx on public.puzzles using gin (opening_tags);
create index if not exists puzzles_themes_gin_idx on public.puzzles using gin (themes);

alter table public.puzzles enable row level security;

-- Allow public read (anon/auth). Writes are intentionally not allowed from client.
drop policy if exists "puzzles_select_all" on public.puzzles;
create policy "puzzles_select_all" on public.puzzles for select using (true);

