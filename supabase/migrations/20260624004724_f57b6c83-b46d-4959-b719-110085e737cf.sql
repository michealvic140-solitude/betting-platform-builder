-- Claimable gifts from admin to users
CREATE TABLE public.user_gifts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX idx_user_gifts_user ON public.user_gifts(user_id, status);

GRANT SELECT, UPDATE ON public.user_gifts TO authenticated;
GRANT ALL ON public.user_gifts TO service_role;

ALTER TABLE public.user_gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own gifts" ON public.user_gifts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all gifts" ON public.user_gifts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Admin sends a claimable gift to one user (NULL = all users)
CREATE OR REPLACE FUNCTION public.admin_send_gift(_user_id uuid, _amount bigint, _message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF _user_id IS NULL THEN
    INSERT INTO public.user_gifts (user_id, amount, message, created_by)
    SELECT id, _amount, _message, auth.uid() FROM public.profiles;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    INSERT INTO public.user_gifts (user_id, amount, message, created_by)
    VALUES (_user_id, _amount, _message, auth.uid());
    v_count := 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'sent', v_count);
END;
$$;

-- User claims a pending gift -> credits balance (token_transactions auto-logged by trigger)
CREATE OR REPLACE FUNCTION public.claim_gift(_gift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_gift public.user_gifts%ROWTYPE; v_new bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_gift FROM public.user_gifts WHERE id = _gift_id FOR UPDATE;
  IF v_gift.id IS NULL THEN RAISE EXCEPTION 'Gift not found'; END IF;
  IF v_gift.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your gift'; END IF;
  IF v_gift.status <> 'pending' THEN RAISE EXCEPTION 'Gift already claimed'; END IF;

  UPDATE public.profiles SET token_balance = token_balance + v_gift.amount
  WHERE id = v_gift.user_id RETURNING token_balance INTO v_new;

  UPDATE public.user_gifts SET status = 'claimed', claimed_at = now() WHERE id = _gift_id;

  RETURN jsonb_build_object('ok', true, 'amount', v_gift.amount, 'balance', v_new);
END;
$$;

-- Lucky spin: respects spin_enabled + cooldown, random reward, credits user
CREATE OR REPLACE FUNCTION public.spin_wheel()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_cooldown integer;
  v_min bigint;
  v_max bigint;
  v_last timestamptz;
  v_reward bigint;
  v_new bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT spin_enabled, COALESCE(spin_cooldown_hours,24), COALESCE(spin_min_reward,0), COALESCE(spin_max_reward,0)
  INTO v_enabled, v_cooldown, v_min, v_max
  FROM public.app_settings WHERE id = 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'The lucky spin is currently disabled';
  END IF;
  IF v_max <= 0 OR v_max < v_min THEN
    RAISE EXCEPTION 'Spin rewards are not configured';
  END IF;

  SELECT max(created_at) INTO v_last FROM public.spins WHERE user_id = v_uid;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(hours => v_cooldown) THEN
    RAISE EXCEPTION 'You can spin again after the cooldown ends';
  END IF;

  v_reward := v_min + floor(random() * (v_max - v_min + 1))::bigint;

  UPDATE public.profiles SET token_balance = token_balance + v_reward
  WHERE id = v_uid RETURNING token_balance INTO v_new;

  INSERT INTO public.spins (user_id, amount) VALUES (v_uid, v_reward);

  RETURN jsonb_build_object('ok', true, 'reward', v_reward, 'balance', v_new, 'next_in_hours', v_cooldown);
END;
$$;