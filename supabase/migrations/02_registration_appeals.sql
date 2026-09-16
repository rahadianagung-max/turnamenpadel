-- ============================================================
-- Fase 0 — Fondasi form pendaftaran (Opsi 2) & appeal/kurasi.
-- DATABASE YANG SAMA dengan Trekkr. Semua additive → aman.
--
-- reg_forms & registrations SUDAH ada (dibuat saat migrasi Trekkr) dengan
-- kolom yang dipakai turnamenpadel, jadi tidak dibuat ulang di sini.
-- ============================================================

-- players.phone: pencocokan DB via nomor HP (cek 4-metode: nama/HP/email/IG).
alter table players add column if not exists phone text;

-- Appeals: laporan appeal peserta terhadap pasangan lain di kategorinya.
--   against_reg_id / against_label : registrasi/pasangan yang di-appeal
--   appellant_*                    : pelapor (HP di-resolve dari registrasinya)
--   status  : baru | lolos | reject | levelup
create table if not exists appeals (
  id                bigint generated always as identity primary key,
  appeal_id         text,
  event_id          text,
  category          text,
  against_reg_id    text,
  against_label     text,
  appellant_name    text,
  appellant_email   text,
  appellant_phone   text,
  reason            text,
  proof_url         text,
  created_at        text,
  status            text,
  decision          text,
  decided_at        text,
  decided_by        text
);

-- Keamanan: kunci tabel baru (RLS), seperti tabel lain. Service key (backend)
-- tetap bisa akses; anon/authenticated tidak, sampai ada policy.
alter table appeals enable row level security;
