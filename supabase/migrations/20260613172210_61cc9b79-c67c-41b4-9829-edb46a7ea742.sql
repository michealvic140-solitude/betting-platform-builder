-- Re-apply futures rebet logic. Future matches always allow multiple tickets
-- (only blocking the exact same contender when restrict_repeat_contender is on).
-- Regular matches keep the one-open-ticket rule.
CREATE OR REPLACE FUNCTION public.enforce_one_open_bet_per_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid;
  existing_count int;
  m_kind text;
  m_restrict boolean;
BEGIN
  IF NEW.match_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id INTO uid FROM public.bets WHERE id = NEW.bet_id;
  IF uid IS NULL THEN RETURN NEW; END IF;

  SELECT match_kind, COALESCE(restrict_repeat_contender, false)
    INTO m_kind, m_restrict
    FROM public.matches WHERE id = NEW.match_id;

  -- Futures: always permit multiple tickets on the same match.
  IF m_kind = 'future' THEN
    IF m_restrict THEN
      -- Only block staking the exact same contender twice.
      SELECT COUNT(*) INTO existing_count
      FROM public.bet_selections bs
      JOIN public.bets b ON b.id = bs.bet_id
      WHERE bs.match_id = NEW.match_id
        AND bs.odd_id = NEW.odd_id
        AND b.user_id = uid
        AND b.status IN ('open','suspended')
        AND bs.bet_id <> NEW.bet_id;
      IF existing_count > 0 THEN
        RAISE EXCEPTION 'You already backed this contender. Pick a different one.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Default (regular matches): one open ticket per match.
  SELECT COUNT(*) INTO existing_count
  FROM public.bet_selections bs
  JOIN public.bets b ON b.id = bs.bet_id
  WHERE bs.match_id = NEW.match_id
    AND b.user_id = uid
    AND b.status IN ('open','suspended')
    AND bs.bet_id <> NEW.bet_id;
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'You already have an active ticket on this match. Each match can only be staked once until it settles.';
  END IF;
  RETURN NEW;
END $function$;