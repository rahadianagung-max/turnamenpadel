-- ============================================================
-- Fase 4 — Klaim profil saat pendaftaran, via verifikasi email.
--
-- CATATAN: TIDAK menyentuh player_auth / profile_claims (sistem login/passport
-- Trekkr). Konfirmasi klaim hanya menandai player.verified + player.claim_email
-- (mengikuti perilaku claimProfile yang sudah ada). Additive → aman.
-- ============================================================

create table if not exists reg_claims (
  id            bigint generated always as identity primary key,
  token         text,
  player_name   text,
  email         text,
  event_id      text,
  status        text,   -- pending | confirmed | expired
  created_at    text,
  expires_at    text,
  confirmed_at  text
);

alter table reg_claims enable row level security;
