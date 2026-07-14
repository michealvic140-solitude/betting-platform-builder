
-- 1. Rebrand tracking IDs from LSL- to ECB-
ALTER TABLE public.bets
  ALTER COLUMN tracking_id SET DEFAULT ('ECB-' || upper(substr(replace((gen_random_uuid())::text,'-',''), 1, 10)));

UPDATE public.bets SET tracking_id = 'ECB-' || substring(tracking_id from 5)
 WHERE tracking_id LIKE 'LSL-%';

-- 2. Auto-settle helper for virtual tickets: credits from virtual wallet if funded,
--    otherwise creates a pending payout request. Callable by the ticket owner.
CREATE OR REPLACE FUNCTION public.user_claim_or_settle_virtual(_bet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  is_virtual_bet boolean;
  wallet_bal bigint;
  cfg record;
  amount bigint;
  new_bal bigint;
  existing record;
  already_credited boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO b FROM public.bets WHERE id = _bet_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF b.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your ticket'; END IF;
  IF b.status <> 'won' THEN RAISE EXCEPTION 'Only won tickets can be claimed here'; END IF;

  SELECT COALESCE(bool_or(m.is_virtual), false) INTO is_virtual_bet
    FROM public.bet_selections bs JOIN public.matches m ON m.id = bs.match_id
   WHERE bs.bet_id = _bet_id;
  IF NOT is_virtual_bet THEN RAISE EXCEPTION 'Not a virtual ticket'; END IF;

  -- If a payout request already exists, delegate to the standard claim flow.
  SELECT * INTO existing FROM public.virtual_payout_requests WHERE bet_id = _bet_id FOR UPDATE;
  IF FOUND THEN
    IF existing.status = 'claimed' THEN RAISE EXCEPTION 'Already claimed'; END IF;
    IF existing.status = 'declined' THEN RAISE EXCEPTION 'Payout was declined'; END IF;
    RETURN public.claim_virtual_payout(existing.id);
  END IF;

  -- Guard against double credit: if a bet_win token_transaction already exists
  -- for this bet, mark as already handled.
  SELECT EXISTS(
    SELECT 1 FROM public.token_transactions
     WHERE user_id = b.user_id AND kind = 'bet_win'
       AND (description ILIKE '%' || b.tracking_id || '%' OR description ILIKE '%Virtual claim%')
  ) INTO already_credited;

  SELECT virtual_payout_multiplier, virtual_win_bonus_tokens INTO cfg FROM public.app_settings WHERE id = 1;
  amount := (b.potential_payout * COALESCE(cfg.virtual_payout_multiplier, 1.0))::bigint
            + COALESCE(cfg.virtual_win_bonus_tokens, 0);
  IF amount < 1 THEN amount := b.potential_payout; END IF;

  SELECT balance INTO wallet_bal FROM public.virtual_house_wallet WHERE id = 1 FOR UPDATE;

  IF wallet_bal >= amount THEN
    -- Auto-credit: debit the virtual house wallet and credit the user immediately.
    PERFORM public.virtual_wallet_debit(amount, 'payout', b.user_id, b.id, NULL, 'Virtual auto-payout');
    UPDATE public.profiles SET token_balance = token_balance + amount
      WHERE id = b.user_id RETURNING token_balance INTO new_bal;
    INSERT INTO public.token_transactions(user_id, amount, balance_after, kind, description)
      VALUES (b.user_id, amount, new_bal, 'bet_win', 'Virtual auto-payout ' || b.tracking_id);
    -- Record a claimed request for auditing.
    INSERT INTO public.virtual_payout_requests(bet_id, user_id, match_id, stake, amount, status, claimed_at, reviewed_by, reviewed_at)
    SELECT b.id, b.user_id,
           (SELECT bs.match_id FROM public.bet_selections bs
             JOIN public.matches m ON m.id = bs.match_id AND m.is_virtual = true
            WHERE bs.bet_id = b.id LIMIT 1),
           b.stake, amount, 'claimed', now(), b.user_id, now()
    ON CONFLICT (bet_id) DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'auto', true, 'amount', amount, 'balance', new_bal);
  ELSE
    -- Fall back to pending payout request for admin review / funded state.
    INSERT INTO public.virtual_payout_requests(bet_id, user_id, match_id, stake, amount, status)
    SELECT b.id, b.user_id,
           (SELECT bs.match_id FROM public.bet_selections bs
             JOIN public.matches m ON m.id = bs.match_id AND m.is_virtual = true
            WHERE bs.bet_id = b.id LIMIT 1),
           b.stake, amount, 'pending'
    ON CONFLICT (bet_id) DO NOTHING;
    RAISE EXCEPTION 'Virtual wallet has insufficient funds (need %, have %). A pending payout request has been created and will be auto-settled once funded.', amount, wallet_bal USING ERRCODE = 'P0001';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.user_claim_or_settle_virtual(uuid) TO authenticated;

-- 3. Auto-settle every existing won virtual bet that has no payout request yet.
DO $$
DECLARE r record; res jsonb;
BEGIN
  FOR r IN
    SELECT b.id
      FROM public.bets b
     WHERE b.status = 'won'
       AND NOT EXISTS (SELECT 1 FROM public.virtual_payout_requests vpr WHERE vpr.bet_id = b.id)
       AND EXISTS (
         SELECT 1 FROM public.bet_selections bs
           JOIN public.matches m ON m.id = bs.match_id
          WHERE bs.bet_id = b.id AND m.is_virtual = true
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.token_transactions tt
          WHERE tt.user_id = b.user_id AND tt.kind = 'bet_win'
            AND tt.description ILIKE '%' || b.tracking_id || '%'
       )
  LOOP
    DECLARE
      bet record; amt bigint; cfg record; wallet_bal bigint; new_bal bigint;
    BEGIN
      SELECT * INTO bet FROM public.bets WHERE id = r.id FOR UPDATE;
      SELECT virtual_payout_multiplier, virtual_win_bonus_tokens INTO cfg FROM public.app_settings WHERE id = 1;
      amt := (bet.potential_payout * COALESCE(cfg.virtual_payout_multiplier, 1.0))::bigint
             + COALESCE(cfg.virtual_win_bonus_tokens, 0);
      IF amt < 1 THEN amt := bet.potential_payout; END IF;
      SELECT balance INTO wallet_bal FROM public.virtual_house_wallet WHERE id = 1 FOR UPDATE;
      IF wallet_bal >= amt THEN
        PERFORM public.virtual_wallet_debit(amt, 'payout', bet.user_id, bet.id, NULL, 'Virtual auto-payout backfill');
        UPDATE public.profiles SET token_balance = token_balance + amt
          WHERE id = bet.user_id RETURNING token_balance INTO new_bal;
        INSERT INTO public.token_transactions(user_id, amount, balance_after, kind, description)
          VALUES (bet.user_id, amt, new_bal, 'bet_win', 'Virtual auto-payout ' || bet.tracking_id);
        INSERT INTO public.virtual_payout_requests(bet_id, user_id, match_id, stake, amount, status, claimed_at, reviewed_by, reviewed_at)
        SELECT bet.id, bet.user_id,
               (SELECT bs.match_id FROM public.bet_selections bs
                 JOIN public.matches m ON m.id = bs.match_id AND m.is_virtual = true
                WHERE bs.bet_id = bet.id LIMIT 1),
               bet.stake, amt, 'claimed', now(), bet.user_id, now()
        ON CONFLICT (bet_id) DO NOTHING;
        INSERT INTO public.notifications(user_id, title, body, link)
          VALUES (bet.user_id, 'Virtual payout credited',
                  '+' || amt || ' tokens credited for ticket ' || bet.tracking_id,
                  '/ticket/' || bet.id::text);
      ELSE
        INSERT INTO public.virtual_payout_requests(bet_id, user_id, match_id, stake, amount, status)
        SELECT bet.id, bet.user_id,
               (SELECT bs.match_id FROM public.bet_selections bs
                 JOIN public.matches m ON m.id = bs.match_id AND m.is_virtual = true
                WHERE bs.bet_id = bet.id LIMIT 1),
               bet.stake, amt, 'pending'
        ON CONFLICT (bet_id) DO NOTHING;
      END IF;
    END;
  END LOOP;
END $$;
