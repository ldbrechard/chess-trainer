-- Optional main-line flag per sibling group (for train / export ordering).
alter table public.moves
  add column if not exists is_main_line boolean not null default false;
