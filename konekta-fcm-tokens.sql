-- Konekta — FCM tokens pour notifications natives Android (app Capacitor)
-- À exécuter dans Supabase SQL Editor (projet dcnqauxppjusyinxqrgj)
-- Distinct de konekta_push_subscriptions (qui sert au Web Push pour la PWA navigateur)

create table if not exists public.konekta_fcm_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  fcm_token    text not null unique,
  device_info  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists konekta_fcm_user_idx on public.konekta_fcm_tokens (user_id);

alter table public.konekta_fcm_tokens disable row level security;

create or replace function public.konekta_fcm_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_konekta_fcm_touch on public.konekta_fcm_tokens;
create trigger trg_konekta_fcm_touch
  before update on public.konekta_fcm_tokens
  for each row execute function public.konekta_fcm_touch();
