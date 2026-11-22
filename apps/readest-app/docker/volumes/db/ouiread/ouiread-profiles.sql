-- Lis et Lead : profil public des lecteurs (pseudo + avatar), pour le futur
-- classement des lecteurs (22 nov. 2026). À exécuter une fois dans l'éditeur
-- SQL de Supabase (projet ouiread). Rejouable sans risque.
--
-- Le pseudo et l'avatar sont publics pour les autres lecteurs connectés ;
-- tout le reste du compte reste privé. Les écritures passent par le serveur
-- (api/profile, clé de service), qui vérifie le format et l'unicité du pseudo.
-- L'image de l'avatar est dans R2 (avatars/<user_id>) ; avatar_version change
-- à chaque nouvelle image, pour que les navigateurs ne gardent pas l'ancienne.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pseudo text,
  avatar_version bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_pseudo_length check (pseudo is null or char_length(pseudo) between 3 and 20)
);

-- Un pseudo n'appartient qu'à un lecteur, sans tenir compte des majuscules.
create unique index if not exists profiles_pseudo_unique on public.profiles (lower(pseudo))
  where pseudo is not null;

alter table public.profiles enable row level security;

drop policy if exists "profils publics lisibles par les lecteurs" on public.profiles;
create policy "profils publics lisibles par les lecteurs" on public.profiles
  for select to authenticated using (true);

grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
