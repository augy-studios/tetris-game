-- Short replay links: /?s=<id> stands for a replay link's packed game,
-- kept here. Paste into the Supabase SQL editor and run once, after 001.
-- Safe to run again.
--
-- The id is the start of a hash of the data, so the same game shared twice
-- is one row. Rows are small: a ten minute game packs to about 1 KB.

create table if not exists uwutetris_replays (
  id text primary key check (id ~ '^[0-9A-Za-z]{8,16}$'),
  data text not null check (length(data) <= 100000),
  created_at timestamptz not null default now()
);

alter table uwutetris_replays enable row level security;
