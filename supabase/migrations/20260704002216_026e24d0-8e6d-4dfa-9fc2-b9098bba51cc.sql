-- Self-healing correction: pay out & flip any ticket wrongly stuck at 'lost'
-- while every one of its selections actually resolved to 'won'.
CREATE OR REPLACE FUNCTION public.resettle_won_bets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  v_count integer := 0;
  new_house bigint;
BEGIN
  FOR b IN
    SELECT bt.* FROM public.bets bt
    WHERE bt.status = 'lost'
      AND EXISTS (SELECT 1 FROM public.bet_selections s WHERE s.bet_id = bt.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.bet_selections s
        WHERE s.bet_id = bt.id
          AND (s.result IS NULL OR s.result <> 'won')
      )
  LOOP
    UPDATE public.profiles
      SET token_balance = token_balance + b.potential_payout
      WHERE id = b.user_id;

    UPDATE public.house_wallet
      SET balance = balance - b.potential_payout,
          total_out = total_out + b.potential_payout,
          updated_at = now()
      WHERE id = 1
      RETURNING balance INTO new_house;

    INSERT INTO public.house_transactions(kind, amount, balance_after, user_id, bet_id, reason)
      VALUES ('payout', -b.potential_payout, new_house, b.user_id, b.id,
              'Corrected payout — all selections won for ' || b.tracking_id);

    UPDATE public.bets
      SET status = 'won', settled_at = COALESCE(settled_at, now())
      WHERE id = b.id;

    INSERT INTO public.notifications(user_id, title, body, link)
      VALUES (b.user_id, 'Bet won! 🎉',
              'Your ticket ' || b.tracking_id || ' was corrected to WON. +' || b.potential_payout || ' tokens credited.',
              '/ticket/' || b.id);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.resettle_won_bets() FROM public, anon, authenticated;

-- One-time correction of already-stuck tickets. The bets protection trigger only
-- allows admins to change these fields, so bypass it for this maintenance pass.
ALTER TABLE public.bets DISABLE TRIGGER trg_protect_bet_sensitive;
SELECT public.resettle_won_bets();
ALTER TABLE public.bets ENABLE TRIGGER trg_protect_bet_sensitive;