-- Konekta Web Push — Table des abonnements push
-- À exécuter dans Supabase SQL Editor (projet dcnqauxppjusyinxqrgj)

create table if not exists public.konekta_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists konekta_push_subs_user_idx
  on public.konekta_push_subscriptions (user_id);

-- RLS désactivé : les endpoints Vercel utilisent la service_key.
alter table public.konekta_push_subscriptions disable row level security;

-- Trigger pour updated_at
create or replace function public.konekta_push_subs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_konekta_push_subs_touch on public.konekta_push_subscriptions;
create trigger trg_konekta_push_subs_touch
  before update on public.konekta_push_subscriptions
  for each row execute function public.konekta_push_subs_touch();
