-- Nama tim untuk pasangan yang di-input via tambah-peserta / import massal.
-- Additive: kolom baru setelah kolom Tournament, tidak menggeser indeks lama
-- yang dibaca tImport (Category f[1], nama f[2..5], Tournament f[7]).
alter table form_responses add column if not exists team_name text;
