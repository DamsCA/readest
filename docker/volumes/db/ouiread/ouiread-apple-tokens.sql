-- Lis et Lead, 25 Nov 2026: Sign in with Apple refresh tokens, kept only to
-- revoke the authorization when the reader deletes the account (App Store
-- Review Guideline 5.1.1(v)). Read and written by the server (service role)
-- only: RLS on, no policy.
CREATE TABLE IF NOT EXISTS public.apple_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.apple_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_tokens FROM anon, authenticated;
