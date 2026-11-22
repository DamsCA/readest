-- ============================================================
-- Lis et Lead : compteurs d'usage et abonnements (Stripe).
-- À exécuter dans l'éditeur SQL du projet Supabase, après ouiread-hosted.sql.
-- Ré-exécutable : chaque objet est créé « s'il n'existe pas » ou remplacé.
-- ============================================================

-- 1. Compteurs d'usage par jour (traductions IA, voix premium...).
--    Écrits et lus seulement par le serveur (clé d'administration) ;
--    un lecteur peut lire les siens.
CREATE TABLE IF NOT EXISTS public.usage_stats (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  usage_type text NOT NULL,
  usage_date date NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_type, usage_date)
);

ALTER TABLE public.usage_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_own_usage ON public.usage_stats;
CREATE POLICY select_own_usage ON public.usage_stats
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.increment_daily_usage(
  p_user_id uuid,
  p_usage_type text,
  p_usage_date date,
  p_increment bigint,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.usage_stats (user_id, usage_type, usage_date, count, metadata)
  VALUES (p_user_id, p_usage_type, p_usage_date, p_increment, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, usage_type, usage_date)
  DO UPDATE SET count = public.usage_stats.count + EXCLUDED.count,
                metadata = EXCLUDED.metadata,
                updated_at = now()
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- Somme du jour (UTC) ou du mois en cours.
CREATE OR REPLACE FUNCTION public.get_current_usage(
  p_user_id uuid,
  p_usage_type text,
  p_period text DEFAULT 'daily'
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(count), 0)::bigint
    FROM public.usage_stats
   WHERE user_id = p_user_id
     AND usage_type = p_usage_type
     AND usage_date >= CASE
           WHEN p_period = 'monthly' THEN date_trunc('month', (now() AT TIME ZONE 'utc'))::date
           ELSE (now() AT TIME ZONE 'utc')::date
         END;
$$;

REVOKE ALL ON FUNCTION public.increment_daily_usage(uuid, text, date, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_current_usage(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_daily_usage(uuid, text, date, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_usage(uuid, text, text) TO service_role;

-- 2. Clients et abonnements Stripe (écrits par le serveur, via le webhook).
CREATE TABLE IF NOT EXISTS public.customers (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text UNIQUE NOT NULL,
  stripe_price_id text,
  status text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  amount integer,
  currency text,
  status text NOT NULL,
  payment_method text,
  product_id text,
  storage_gb integer NOT NULL DEFAULT 0,
  metadata jsonb,
  stripe_customer_id text,
  stripe_checkout_id text,
  stripe_payment_intent_id text UNIQUE,
  apple_transaction_id text UNIQUE,
  apple_original_transaction_id text,
  google_order_id text UNIQUE,
  google_purchase_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_subscriptions ON public.subscriptions;
CREATE POLICY select_own_subscriptions ON public.subscriptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS select_own_payments ON public.payments;
CREATE POLICY select_own_payments ON public.payments
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
