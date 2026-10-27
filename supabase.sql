-- Sent-mail history for the YC outreach app. Run once in the Supabase SQL editor.
create table if not exists yc_sent_mail (
  email    text primary key,                 -- lowercase; the primary key blocks duplicates
  founder  text,
  company  text,
  batch    text,
  kind     text,                             -- site | guess
  status   text not null default 'sent',     -- sent | failed
  detail   text,
  sent_at  timestamptz not null default now()
);
create index if not exists yc_sent_mail_batch_idx on yc_sent_mail (batch);

-- No policies: the public key can read nothing. Only the server's secret key can.
alter table yc_sent_mail enable row level security;

-- Batches you have finished mailing: the "Sent by batch" table shows them as 100% done
create table if not exists yc_batch_done (
  batch      text primary key,
  marked_at  timestamptz not null default now()
);
alter table yc_batch_done enable row level security;

insert into yc_batch_done (batch) values
  ('Fall 2026'), ('Summer 2026'), ('Summer 2027'), ('Winter 2027'),
  ('Fall 2025'), ('Fall 2024'), ('Summer 2018'), ('Summer 2007')
on conflict do nothing;

-- Per batch: how many companies there are and how many of them have an email address to send to.
-- The "Sent by batch" bar counts against "mailable"; it is filled when a batch is fully loaded.
create table if not exists yc_batch_stats (
  batch       text primary key,
  total       integer not null,
  mailable    integer not null,
  scanned_at  timestamptz not null default now()
);
alter table yc_batch_stats enable row level security;
