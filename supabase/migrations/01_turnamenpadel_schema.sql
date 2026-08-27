-- ============================================================
-- turnamenpadel → Supabase (DATABASE YANG SAMA dengan Trekkr)
--
-- turnamenpadel & Trekkr berbagi satu Google Sheet, dan datanya sudah
-- ikut pindah saat migrasi Trekkr. Jadi di sini kita HANYA:
--   1) menambah kolom yang dipakai turnamenpadel tapi belum ada
--      (mesin turnamen memakai lebih banyak kolom), dan
--   2) membuat 2 tabel yang kemarin kosong sehingga belum dibuat.
-- Semua "add column if not exists" → aman, tidak menyentuh data Trekkr.
-- ============================================================

-- Tournament_Events: turnamenpadel memakai kolom A..V (admin + 4 jendela break)
alter table tournament_events add column if not exists admin_username text;
alter table tournament_events add column if not exists break1_start text;
alter table tournament_events add column if not exists break1_end   text;
alter table tournament_events add column if not exists break2_start text;
alter table tournament_events add column if not exists break2_end   text;
alter table tournament_events add column if not exists break3_start text;
alter table tournament_events add column if not exists break3_end   text;
alter table tournament_events add column if not exists break4_start text;
alter table tournament_events add column if not exists break4_end   text;

-- Tournaments: + playoff
alter table tournaments add column if not exists playoff_top_overall text;
alter table tournaments add column if not exists auto_playoff        text;

-- Entrants / Groups: + nama tim
alter table tournament_entrants add column if not exists team_name text;
alter table tournament_groups   add column if not exists team_name text;

-- Matches: + tanggal terjadwal
alter table tournament_matches add column if not exists scheduled_date text;

-- Form_Responses: + tournament
alter table form_responses add column if not exists tournament text;

-- Calculator_Results: turnamenpadel memakai 28 kolom (court_hours_full, rules_ref)
alter table calculator_results add column if not exists court_hours_full text;
alter table calculator_results add column if not exists rules_ref        text;

-- Draw_Results (baru) — audit hasil undian grup
create table if not exists draw_results (
  id               bigint generated always as identity primary key,
  timestamp        text,
  draw_id          text,
  tournament_id    text,
  tournament_name  text,
  mode             text,
  groups           text,
  pairs_per_group  text,
  random_key       text,
  random_key_hash  text,
  group_label      text,
  pot              text,
  pair_id          text,
  player1          text,
  player2          text,
  rating           text,
  team_name        text,
  status           text
);

-- Mexicano (baru)
create table if not exists mexicano (
  id           bigint generated always as identity primary key,
  mexicano_id  text,
  slug         text,
  data_json    text,
  updated_at   text
);

-- Keamanan: kunci 2 tabel baru (RLS), seperti tabel lain
alter table draw_results enable row level security;
alter table mexicano     enable row level security;
