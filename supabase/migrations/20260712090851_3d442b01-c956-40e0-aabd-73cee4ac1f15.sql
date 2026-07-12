CREATE OR REPLACE FUNCTION public.place_real_ticket(_selections jsonb, _stake bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  p record; cfg record;
  total_odds numeric := 1; payout bigint; bet_id uuid; tracking text; new_bal bigint;
  s jsonb; o record; mk record; m record;
  sel_count int; cap bigint; is_future_ticket boolean := true;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  sel_count := jsonb_array_length(_selections);
  IF sel_count IS NULL OR sel_count = 0 THEN RAISE EXCEPTION 'No selections'; END IF;

  SELECT * INTO p FROM public.profiles WHERE id = uid FOR UPDATE;
  IF p.is_banned OR p.is_restricted THEN RAISE EXCEPTION 'Account restricted'; END IF;

  SELECT min_stake, max_payout, max_selections_per_ticket,
         futures_min_stake, futures_max_payout, futures_max_selections
    INTO cfg FROM public.app_settings WHERE id = 1;

  -- Validate every selection against authoritative DB rows and lock odds.
  FOR s IN SELECT * FROM jsonb_array_elements(_selections) LOOP
    SELECT * INTO o FROM public.odds WHERE id = (s->>'odd_id')::uuid;
    IF o IS NULL THEN RAISE EXCEPTION 'Bad selection'; END IF;
    SELECT * INTO mk FROM public.markets WHERE id = o.market_id;
    SELECT * INTO m FROM public.matches WHERE id = mk.match_id;
    IF m.is_virtual THEN RAISE EXCEPTION 'Virtual picks must be placed on the virtual slip'; END IF;
    IF COALESCE(m.match_kind, 'normal') <> 'future' THEN is_future_ticket := false; END IF;
    IF m.status <> 'scheduled' OR (m.lock_time IS NOT NULL AND m.lock_time <= now()) OR NOT mk.is_open THEN
      RAISE EXCEPTION 'Betting is closed: %', m.name;
    END IF;
    total_odds := total_odds * o.value;
  END LOOP;

  IF is_future_ticket THEN
    IF _stake < COALESCE(cfg.futures_min_stake, 1) THEN RAISE EXCEPTION 'Stake below minimum'; END IF;
    IF sel_count > COALESCE(cfg.futures_max_selections, 1) THEN RAISE EXCEPTION 'Too many selections'; END IF;
    cap := COALESCE(NULLIF(cfg.futures_max_payout, 0), 100000000);
  ELSE
    IF sel_count < 2 THEN RAISE EXCEPTION 'Minimum 2 selections required'; END IF;
    IF _stake < COALESCE(cfg.min_stake, 2000000) THEN RAISE EXCEPTION 'Stake below minimum'; END IF;
    IF sel_count > COALESCE(cfg.max_selections_per_ticket, 20) THEN RAISE EXCEPTION 'Too many selections'; END IF;
    cap := COALESCE(NULLIF(cfg.max_payout, 0), 100000000);
  END IF;

  IF p.token_balance < _stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  payout := LEAST((total_odds * _stake)::bigint, cap);

  INSERT INTO public.bets(user_id, stake, total_odds, potential_payout, status)
    VALUES (uid, _stake, total_odds, payout, 'open') RETURNING id, tracking_id INTO bet_id, tracking;

  FOR s IN SELECT * FROM jsonb_array_elements(_selections) LOOP
    SELECT * INTO o FROM public.odds WHERE id = (s->>'odd_id')::uuid;
    SELECT * INTO mk FROM public.markets WHERE id = o.market_id;
    INSERT INTO public.bet_selections(bet_id, match_id, market_id, odd_id, locked_odds, selection_label)
      VALUES (bet_id, mk.match_id, mk.id, o.id, o.value, o.label);
  END LOOP;

  UPDATE public.profiles SET token_balance = token_balance - _stake WHERE id = uid RETURNING token_balance INTO new_bal;

  INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (uid, 'Bet placed', 'Ticket ' || tracking || ' - ' || _stake || ' tokens staked.', '/ticket/' || bet_id);

  RETURN jsonb_build_object('bet_id', bet_id, 'tracking_id', tracking, 'stake', _stake, 'payout', payout, 'balance', new_bal, 'max_payout_cap', cap);
END;
$$;

REVOKE ALL ON FUNCTION public.place_real_ticket(jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_real_ticket(jsonb, bigint) TO authenticated;