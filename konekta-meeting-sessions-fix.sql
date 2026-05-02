-- Konekta Co-Construction — Fix transcription/traduction
-- Ajoute la colonne speech_enabled manquante qui faisait planter l'INSERT
-- → toutes les sessions étaient créées sans id valide → 400 en boucle sur les GET notes
-- À exécuter dans Supabase SQL Editor (projet dcnqauxppjusyinxqrgj)

alter table public.konekta_meeting_sessions
  add column if not exists speech_enabled boolean not null default false;

-- (Optionnel) Backfill pour les anciennes sessions
-- update public.konekta_meeting_sessions set speech_enabled = false where speech_enabled is null;
