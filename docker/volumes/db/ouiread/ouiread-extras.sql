-- ============================================================
-- Ouiread : compléments pour un projet Supabase hébergé.
-- À exécuter après le schéma de base et ses migrations
-- (voir assembler.mjs, qui produit ouiread-hosted.sql).
-- ============================================================

-- 1. Une ligne « plans » par lecteur : sa formule, le stockage acheté,
--    et la date à laquelle il a reçu le livre offert à l'inscription.
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  user_id uuid GENERATED ALWAYS AS (id) STORED,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  storage_purchased_bytes bigint NOT NULL DEFAULT 0,
  welcome_gift_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_own_plan ON public.plans;
CREATE POLICY select_own_plan ON public.plans
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);

-- Écoute des voix premium sans plafond mensuel (le compte du propriétaire,
-- pour le classement des lecteurs). Posée à la main dans la base, jamais par
-- l'appli : aucune politique n'ouvre l'écriture de plans aux lecteurs.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS voice_unlimited boolean NOT NULL DEFAULT false;

-- La ligne est créée en même temps que le compte.
CREATE OR REPLACE FUNCTION public.ouiread_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.plans (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ouiread_on_auth_user_created ON auth.users;
CREATE TRIGGER ouiread_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ouiread_handle_new_user();

-- 2. Jeton d'accès enrichi. L'appli lit trois informations dans le jeton
--    (src/utils/access.ts) : la formule, l'espace utilisé et l'espace acheté.
--    À activer dans Authentication > Hooks > « Customize Access Token (JWT) Claims ».
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  v_uid uuid := (event ->> 'user_id')::uuid;
  v_plan text;
  v_purchased bigint;
  v_usage bigint;
BEGIN
  SELECT p.plan, p.storage_purchased_bytes INTO v_plan, v_purchased
    FROM public.plans p WHERE p.id = v_uid;
  SELECT COALESCE(SUM(f.file_size), 0) INTO v_usage
    FROM public.files f WHERE f.user_id = v_uid AND f.deleted_at IS NULL;

  claims := jsonb_set(claims, '{plan}', to_jsonb(COALESCE(v_plan, 'free')));
  claims := jsonb_set(claims, '{storage_usage_bytes}', to_jsonb(COALESCE(v_usage, 0)));
  claims := jsonb_set(claims, '{storage_purchased_bytes}', to_jsonb(COALESCE(v_purchased, 0)));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.plans TO supabase_auth_admin;
GRANT SELECT ON public.files TO supabase_auth_admin;

DROP POLICY IF EXISTS auth_admin_read_plans ON public.plans;
CREATE POLICY auth_admin_read_plans ON public.plans
  FOR SELECT TO supabase_auth_admin USING (true);
DROP POLICY IF EXISTS auth_admin_read_files ON public.files;
CREATE POLICY auth_admin_read_files ON public.files
  FOR SELECT TO supabase_auth_admin USING (true);

-- Stockage : seul le serveur écrit la table files (routes storage/*, livre
-- offert). Avant, un lecteur pouvait changer la taille de ses fichiers
-- (file_size = 0) et remettre son compteur de stockage à zéro.
REVOKE INSERT, UPDATE, DELETE ON public.files FROM anon, authenticated;
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_size_not_negative;
ALTER TABLE public.files ADD CONSTRAINT files_size_not_negative CHECK (file_size >= 0);

-- Stockage réellement utilisé, lu par la route d'envoi (le jeton peut avoir
-- une heure de retard). Réservé au serveur.
CREATE OR REPLACE FUNCTION public.ouiread_storage_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(file_size), 0)::bigint
    FROM public.files
   WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ouiread_storage_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ouiread_storage_usage(uuid) TO service_role;

-- La fonction du déclencheur de création de compte n'a pas à être appelable
-- de l'extérieur (alerte du Security Advisor de Supabase).
REVOKE EXECUTE ON FUNCTION public.ouiread_handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ouiread_handle_new_user() TO supabase_auth_admin;
