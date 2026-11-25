-- Lis et Lead Plus bought in the phone apps (25 Nov 2026): App Store and
-- Google Play. /api/store/verify checks each purchase with Apple or Google and
-- writes it here; the token hook gives the « plus » plan while one is valid,
-- so an expired or refunded subscription ends by itself.
CREATE TABLE IF NOT EXISTS public.store_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  -- Apple: originalTransactionId. Google: the purchase token.
  original_id text NOT NULL,
  product_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  environment text NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, original_id)
);
CREATE INDEX IF NOT EXISTS store_subscriptions_user_idx ON public.store_subscriptions (user_id, expires_at DESC);
ALTER TABLE public.store_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.store_subscriptions TO supabase_auth_admin;
DROP POLICY IF EXISTS auth_admin_read_store ON public.store_subscriptions;
CREATE POLICY auth_admin_read_store ON public.store_subscriptions
  FOR SELECT TO supabase_auth_admin USING (true);

-- Same hook as ouiread-hosted.sql, plus: a valid store subscription means « plus ».
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
  IF COALESCE(v_plan, 'free') = 'free' AND EXISTS (
    SELECT 1 FROM public.store_subscriptions s
     WHERE s.user_id = v_uid AND s.status = 'active' AND s.expires_at > now()
  ) THEN
    v_plan := 'plus';
  END IF;
  SELECT COALESCE(SUM(f.file_size), 0) INTO v_usage
    FROM public.files f WHERE f.user_id = v_uid AND f.deleted_at IS NULL;

  claims := jsonb_set(claims, '{plan}', to_jsonb(COALESCE(v_plan, 'free')));
  claims := jsonb_set(claims, '{storage_usage_bytes}', to_jsonb(COALESCE(v_usage, 0)));
  claims := jsonb_set(claims, '{storage_purchased_bytes}', to_jsonb(COALESCE(v_purchased, 0)));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
