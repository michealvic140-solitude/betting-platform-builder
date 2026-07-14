
-- Branding columns
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS platform_name text DEFAULT 'LSL',
  ADD COLUMN IF NOT EXISTS platform_tagline text DEFAULT 'Luxury Sports League',
  ADD COLUMN IF NOT EXISTS platform_description text DEFAULT 'Premium online betting experience.',
  ADD COLUMN IF NOT EXISTS platform_logo_url text,
  ADD COLUMN IF NOT EXISTS platform_logo_auth_url text,
  ADD COLUMN IF NOT EXISTS platform_logo_voucher_url text,
  ADD COLUMN IF NOT EXISTS platform_og_image_url text;

-- Push subscription unique on endpoint (dedupe first)
DELETE FROM public.push_subscriptions a USING public.push_subscriptions b
WHERE a.ctid < b.ctid AND a.endpoint = b.endpoint;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_endpoint_unique'
  ) THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);
  END IF;
END $$;

-- Prune dead subscriptions RPC
CREATE OR REPLACE FUNCTION public.prune_dead_push_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  WITH d AS (
    DELETE FROM public.push_subscriptions
    WHERE (last_error_at IS NOT NULL AND (last_success_at IS NULL OR last_error_at > last_success_at)
           AND last_error_at < now() - interval '14 days')
       OR (last_success_at IS NOT NULL AND last_success_at < now() - interval '90 days')
    RETURNING 1
  )
  SELECT count(*)::int INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_dead_push_subscriptions() TO authenticated;
