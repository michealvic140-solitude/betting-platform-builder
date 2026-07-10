-- Atomic place_real_ticket: create bet, insert selections, and deduct stake in one transaction
CREATE OR REPLACE FUNCTION public.place_real_ticket(
  _selections json,
  _stake bigint,
  _total_odds numeric,
  _potential_payout bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  u uuid := auth.uid();
  b record;
  sel record;
  new_bal bigint;
  house_bal bigint;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _stake IS NULL OR _stake <= 0 THEN
    RAISE EXCEPTION 'Invalid stake';
  END IF;

  -- Lock and verify user balance
  SELECT token_balance INTO new_bal FROM public.profiles WHERE id = u FOR UPDATE;
  IF new_bal IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF new_bal < _stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Create the bet
  INSERT INTO public.bets(user_id, stake, total_odds, potential_payout, status)
  VALUES (u, _stake, _total_odds, _potential_payout, 'open')
  RETURNING * INTO b;

  -- Insert selections from JSON array of objects
  FOR sel IN SELECT * FROM json_to_recordset(_selections)
      AS (odd_id uuid, match_id uuid, market_id uuid, selection_label text, locked_odds numeric)
  LOOP
    INSERT INTO public.bet_selections(bet_id, odd_id, match_id, market_id, selection_label, locked_odds)
    VALUES (b.id, sel.odd_id, sel.match_id, sel.market_id, sel.selection_label, sel.locked_odds);
  END LOOP;

  -- Deduct user balance
  UPDATE public.profiles
    SET token_balance = token_balance - _stake
    WHERE id = u
    RETURNING token_balance INTO new_bal;

  -- Update house wallet accounting (stake inflow)
  UPDATE public.house_wallet
    SET balance = balance + _stake,
        total_in = total_in + _stake,
        updated_at = now()
    WHERE id = 1
    RETURNING balance INTO house_bal;

  INSERT INTO public.house_transactions(kind, amount, balance_after, user_id, bet_id, reason)
    VALUES ('stake', _stake, house_bal, u, b.id, 'Stake for ' || COALESCE(b.tracking_id::text, b.id::text));

  -- Notification
  INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (u, 'Bet placed', 'Ticket ' || COALESCE(b.tracking_id::text, b.id::text) || ' · ' || _stake || ' tokens staked.', '/ticket/' || b.id);

  RETURN json_build_object(
    'bet_id', b.id,
    'tracking_id', b.tracking_id,
    'booking_code', b.booking_code,
    'new_balance', new_bal
  );
EXCEPTION
  WHEN others THEN
    -- Re-raise to let client see the error
    RAISE;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.place_real_ticket(json, bigint, numeric, bigint) TO authenticated;
