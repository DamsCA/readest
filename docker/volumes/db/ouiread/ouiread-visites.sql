-- Audience of the web reader (23 Nov 2026). The owner: « c'est pas normal de
-- pas savoir s'il y a des visiteurs ». One row per page shown and per step of
-- the sign-up invitation, written by /api/stats/evenement with the service key.
-- No IP is kept and nothing is stored on the device: « visiteur » is a hash of
-- the day, the IP, the browser and a server secret, so it counts unique
-- visitors per day without following anyone from one day to the next.
create table if not exists public.visites (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  evenement text not null,
  chemin text,
  provenance text,
  pays text,
  visiteur text,
  connecte boolean not null default false
);
create index if not exists visites_at_idx on public.visites (at desc);
-- « iPhone · TikTok », « Android », « ordinateur »… (added 24 Nov 2026).
alter table public.visites add column if not exists appareil text;
alter table public.visites enable row level security;
revoke all on public.visites from anon, authenticated;

-- The owner is not counted (24 Nov 2026: « il faut arrêter de me compter
-- moi »). « reseau » is a hash of the day, the network (IPv4 address or IPv6
-- /64) and a server secret. When the owner opens /stats, today's network is
-- listed here and stats_visites leaves it out, the owner's phone on the same
-- connection included (utils/empreinte.ts).
alter table public.visites add column if not exists reseau text;
create table if not exists public.reseaux_proprietaire (
  reseau text primary key,
  le timestamptz not null default now()
);
alter table public.reseaux_proprietaire enable row level security;
revoke all on public.reseaux_proprietaire from anon, authenticated;

-- Who may read the figures on /stats. Filled by hand in the SQL editor.
create table if not exists public.admins_stats (user_id uuid primary key);
alter table public.admins_stats enable row level security;
revoke all on public.admins_stats from anon, authenticated;

-- The figures shown on /stats, in Réunion time. Readers who are signed in
-- (the owner included) are left out of the visitor counts, and so is every
-- network listed in reseaux_proprietaire; the owner's own accounts are left
-- out of the sign-ups.
create or replace function public.stats_visites(jours integer default 7)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with toutes as (
    select * from public.visites
    where reseau is null
       or reseau not in (select reseau from public.reseaux_proprietaire)
  ),
  v as (
    select (at at time zone 'Indian/Reunion')::date as jour, *
    from toutes
    where at > now() - make_interval(days => jours)
  ),
  admins as (select user_id from public.admins_stats),
  ins as (
    select (created_at at time zone 'Indian/Reunion')::date as jour, id
    from auth.users
    where created_at > now() - make_interval(days => jours)
      and id not in (select user_id from admins)
  )
  select json_build_object(
    'depuis_24h', json_build_object(
      'visiteurs', (select count(distinct visiteur) from v
        where evenement = 'vue' and not connecte and at > now() - interval '24 hours'),
      'pages', (select count(*) from v
        where evenement = 'vue' and not connecte and at > now() - interval '24 hours'),
      'invitations_vues', (select count(*) from v
        where evenement = 'invitation_vue' and at > now() - interval '24 hours'),
      'clics_inscription', (select count(*) from v
        where evenement in ('invitation_google', 'invitation_apple', 'invitation_email')
          and at > now() - interval '24 hours'),
      'inscriptions', (select count(*) from auth.users
        where created_at > now() - interval '24 hours' and id not in (select user_id from admins))
    ),
    -- The TikTok bio page (legenieendormi.web.app), over 24 hours and over
    -- the whole period asked for.
    'bio', (select json_build_object(
      'visiteurs_24h', count(distinct visiteur) filter (
        where evenement = 'bio_vue' and at > now() - interval '24 hours'),
      'visiteurs', count(distinct visiteur) filter (where evenement = 'bio_vue'),
      'kevin', count(*) filter (where evenement = 'bio_kevin'),
      'liseuse', count(*) filter (where evenement = 'bio_liseuse'),
      'cadeau', count(*) filter (where evenement = 'bio_cadeau'),
      'telegram', count(*) filter (where evenement = 'bio_telegram'),
      'arrivee', count(distinct visiteur) filter (where evenement = 'bio_arrivee')
    ) from v),
    -- The dashboard (24 Nov 2026): the funnel over the period asked for,
    -- one visitor counted once per step.
    'entonnoir', json_build_object(
      'visiteurs', (select count(distinct visiteur) from v where evenement = 'vue' and not connecte),
      'invitation', (select count(distinct visiteur) from v where evenement = 'invitation_vue'),
      'clic', (select count(distinct visiteur) from v
        where evenement in ('invitation_google', 'invitation_apple', 'invitation_email')),
      'inscrits', (select count(*) from ins)
    ),
    'appareils', coalesce((select json_agg(p) from (
      select coalesce(appareil, '?') as appareil, count(distinct visiteur) as visiteurs
      from v where evenement = 'vue' and not connecte
      group by 1 order by 2 desc limit 8
    ) p), '[]'::json),
    -- Who signed up: the owner's own accounts are marked « vous ».
    'inscrits', coalesce((select json_agg(x) from (
      select u.email,
        coalesce(u.raw_app_meta_data->>'provider', 'email') as via,
        to_char(u.created_at at time zone 'Indian/Reunion', 'DD/MM HH24:MI') as le,
        to_char(u.last_sign_in_at at time zone 'Indian/Reunion', 'DD/MM HH24:MI') as derniere,
        coalesce(pl.plan, 'free') as plan,
        (select count(*) from public.books b where b.user_id = u.id and b.deleted_at is null) as livres,
        u.id in (select user_id from admins) as vous
      from auth.users u
      left join public.plans pl on pl.user_id = u.id
      order by u.created_at desc limit 50
    ) x), '[]'::json),
    -- Stripe customers of Lis et Lead (the Stripe account also serves other
    -- products): the route keeps only their subscriptions and payments.
    'clients_stripe', coalesce((select json_agg(x) from (
      select c.stripe_customer_id, u.email, c.user_id in (select user_id from admins) as vous
      from public.customers c join auth.users u on u.id = c.user_id
      where c.stripe_customer_id is not null
    ) x), '[]'::json),
    'par_jour', coalesce((select json_agg(d order by d.jour desc) from (
      select j.jour,
        (select count(distinct visiteur) from v
          where v.jour = j.jour and evenement = 'vue' and not connecte) as visiteurs,
        (select count(*) from v
          where v.jour = j.jour and evenement in ('invitation_google', 'invitation_apple', 'invitation_email'))
          as clics_inscription,
        (select count(*) from ins where ins.jour = j.jour) as inscriptions
      from (
        select generate_series(
          (now() at time zone 'Indian/Reunion')::date - (jours - 1),
          (now() at time zone 'Indian/Reunion')::date,
          interval '1 day'
        )::date as jour
      ) j
    ) d), '[]'::json),
    'provenances', coalesce((select json_agg(p) from (
      select coalesce(provenance, 'lien direct') as provenance, count(distinct visiteur) as visiteurs
      from v where evenement = 'vue' and not connecte
      group by 1 order by 2 desc limit 8
    ) p), '[]'::json),
    'pays', coalesce((select json_agg(p) from (
      select coalesce(pays, '?') as pays, count(distinct visiteur) as visiteurs
      from v where evenement = 'vue' and not connecte
      group by 1 order by 2 desc limit 8
    ) p), '[]'::json),
    'derniers', coalesce((select json_agg(x) from (
      select to_char(at at time zone 'Indian/Reunion', 'DD/MM HH24:MI') as heure,
        evenement, chemin, provenance, pays, appareil
      from toutes where not connecte
      order by at desc limit 20
    ) x), '[]'::json)
  );
$$;
revoke all on function public.stats_visites(integer) from public, anon, authenticated;
grant execute on function public.stats_visites(integer) to service_role;
