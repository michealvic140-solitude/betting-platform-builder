
-- =========================================================
-- 1) INDEXES to make bulk deletes fast
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_matches_home_team ON public.matches(home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_team ON public.matches(away_team_id);
CREATE INDEX IF NOT EXISTS idx_markets_match ON public.markets(match_id);
CREATE INDEX IF NOT EXISTS idx_odds_market ON public.odds(market_id);
CREATE INDEX IF NOT EXISTS idx_bet_selections_match ON public.bet_selections(match_id);
CREATE INDEX IF NOT EXISTS idx_bet_selections_market ON public.bet_selections(market_id);
CREATE INDEX IF NOT EXISTS idx_bet_selections_odd ON public.bet_selections(odd_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON public.players(team_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_a ON public.tournament_matches(participant_a_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_b ON public.tournament_matches(participant_b_id);

-- =========================================================
-- 2) FASTER delete_teams_bulk (collect ids once, delete via ANY(temp array))
-- =========================================================
CREATE OR REPLACE FUNCTION public.delete_teams_bulk(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_match_ids uuid[];
  v_market_ids uuid[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can bulk-delete teams';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0);
  END IF;
  SET LOCAL statement_timeout = '120s';

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_match_ids
    FROM public.matches
    WHERE home_team_id = ANY(p_ids) OR away_team_id = ANY(p_ids);

  IF array_length(v_match_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_market_ids
      FROM public.markets WHERE match_id = ANY(v_match_ids);

    DELETE FROM public.bet_selections WHERE match_id = ANY(v_match_ids);
    IF array_length(v_market_ids, 1) IS NOT NULL THEN
      DELETE FROM public.odds WHERE market_id = ANY(v_market_ids);
      DELETE FROM public.markets WHERE id = ANY(v_market_ids);
    END IF;
    DELETE FROM public.matches WHERE id = ANY(v_match_ids);
  END IF;

  DELETE FROM public.tournament_matches
    WHERE participant_a_id = ANY(p_ids) OR participant_b_id = ANY(p_ids);
  DELETE FROM public.players WHERE team_id = ANY(p_ids);
  DELETE FROM public.teams WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_count);
END;
$function$;

-- =========================================================
-- 3) BETS: add is_virtual + kind so vouchers can carry
--    Instant-Football and Championship tickets in the same table
-- =========================================================
ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sports',
  ADD COLUMN IF NOT EXISTS championship_bet_id uuid REFERENCES public.championship_bets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS virtual_round_id uuid REFERENCES public.user_virtual_rounds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meta jsonb;

CREATE INDEX IF NOT EXISTS idx_bets_is_virtual ON public.bets(is_virtual);
CREATE INDEX IF NOT EXISTS idx_bets_kind ON public.bets(kind);

-- Allow synthetic selections (championship / instant-football have no odds/market row)
ALTER TABLE public.bet_selections
  ALTER COLUMN market_id DROP NOT NULL,
  ALTER COLUMN odd_id DROP NOT NULL;

-- Backfill is_virtual for existing virtual sports tickets
UPDATE public.bets b
   SET is_virtual = true, kind = 'virtual_sports'
  FROM public.bet_selections bs
  JOIN public.matches m ON m.id = bs.match_id
 WHERE bs.bet_id = b.id AND m.is_virtual = true AND b.is_virtual = false;

-- =========================================================
-- 4) place_virtual_ticket: tag as virtual
-- =========================================================
CREATE OR REPLACE FUNCTION public.place_virtual_ticket(_selections jsonb, _stake bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid(); p record; cfg record;
  total_odds numeric := 1; payout bigint; bet_id uuid; tracking text; new_bal bigint;
  s jsonb; o record; mk record; m record;
  first_match uuid; sel_count int; cap bigint;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  sel_count := jsonb_array_length(_selections);
  SELECT * INTO p FROM public.profiles WHERE id = uid FOR UPDATE;
  IF p.is_banned OR p.is_restricted THEN RAISE EXCEPTION 'Account restricted'; END IF;
  SELECT virtual_min_stake, virtual_max_stake, max_payout, virtual_max_payout, virtual_min_selections, virtual_max_selections INTO cfg FROM public.app_settings WHERE id=1;
  IF sel_count < COALESCE(cfg.virtual_min_selections,1) THEN RAISE EXCEPTION 'Minimum % selections required', COALESCE(cfg.virtual_min_selections,1); END IF;
  IF sel_count > COALESCE(cfg.virtual_max_selections,20) THEN RAISE EXCEPTION 'Maximum % selections allowed', COALESCE(cfg.virtual_max_selections,20); END IF;
  IF _stake < COALESCE(cfg.virtual_min_stake,100000) THEN RAISE EXCEPTION 'Stake below minimum'; END IF;
  IF p.token_balance < _stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(_selections) LOOP
    SELECT * INTO o FROM public.odds WHERE id = (s->>'odd_id')::uuid;
    IF o IS NULL THEN RAISE EXCEPTION 'Bad selection'; END IF;
    SELECT * INTO mk FROM public.markets WHERE id = o.market_id;
    SELECT * INTO m FROM public.matches WHERE id = mk.match_id;
    IF NOT m.is_virtual THEN RAISE EXCEPTION 'Not virtual'; END IF;
    IF lower(mk.name) NOT LIKE '%match winner%' AND lower(mk.name) NOT LIKE '%win / draw / lose%' AND lower(mk.name) NOT LIKE '%first blood%' THEN
      RAISE EXCEPTION 'This virtual market is closed';
    END IF;
    IF m.status <> 'scheduled' OR (m.lock_time IS NOT NULL AND m.lock_time <= now()) OR NOT mk.is_open THEN
      RAISE EXCEPTION 'Round locked: %', m.name;
    END IF;
    total_odds := total_odds * o.value;
    IF first_match IS NULL THEN first_match := m.id; END IF;
  END LOOP;

  cap := COALESCE(NULLIF(cfg.virtual_max_payout, 0), cfg.max_payout, 100000000);
  payout := LEAST((total_odds * _stake)::bigint, cap);

  INSERT INTO public.bets(user_id, stake, total_odds, potential_payout, status, is_virtual, kind)
    VALUES (uid, _stake, total_odds, payout, 'open', true, 'virtual_sports')
    RETURNING id, tracking_id INTO bet_id, tracking;
  FOR s IN SELECT * FROM jsonb_array_elements(_selections) LOOP
    SELECT * INTO o FROM public.odds WHERE id = (s->>'odd_id')::uuid;
    SELECT * INTO mk FROM public.markets WHERE id = o.market_id;
    INSERT INTO public.bet_selections(bet_id, match_id, market_id, odd_id, locked_odds, selection_label)
      VALUES (bet_id, mk.match_id, mk.id, o.id, o.value, o.label);
  END LOOP;
  UPDATE public.profiles SET token_balance = token_balance - _stake WHERE id=uid RETURNING token_balance INTO new_bal;
  PERFORM public.virtual_wallet_credit(_stake, 'stake', uid, bet_id, first_match, 'Virtual ticket stake');
  INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (uid, 'Virtual ticket placed', tracking || ' - ' || _stake || ' tokens', '/ticket/' || bet_id);
  RETURN jsonb_build_object('bet_id', bet_id, 'tracking_id', tracking, 'stake', _stake, 'payout', payout, 'balance', new_bal, 'max_payout_cap', cap);
END;
$function$;

-- =========================================================
-- 5) start_user_virtual_round: also write a bets voucher
-- =========================================================
CREATE OR REPLACE FUNCTION public.start_user_virtual_round(p_home text, p_away text, p_side text, p_stake bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_bal BIGINT;
  v_home BOOLEAN[] := ARRAY[]::BOOLEAN[];
  v_away BOOLEAN[] := ARRAY[]::BOOLEAN[];
  v_hs INT := 0; v_as INT := 0; i INT;
  v_result TEXT; v_payout BIGINT := 0; v_odds NUMERIC := 1.90;
  v_id UUID; v_bet_id UUID; v_tracking TEXT; v_status public.bet_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_side NOT IN ('home','away') THEN RAISE EXCEPTION 'Invalid side'; END IF;
  IF p_stake <= 0 THEN RAISE EXCEPTION 'Invalid stake'; END IF;

  SELECT token_balance INTO v_bal FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_bal IS NULL OR v_bal < p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  UPDATE public.profiles SET token_balance = token_balance - p_stake WHERE id = v_user;

  FOR i IN 1..5 LOOP
    v_home := v_home || (random() < 0.75);
    v_away := v_away || (random() < 0.75);
    IF v_home[i] THEN v_hs := v_hs + 1; END IF;
    IF v_away[i] THEN v_as := v_as + 1; END IF;
  END LOOP;
  WHILE v_hs = v_as LOOP
    v_home := v_home || (random() < 0.75);
    v_away := v_away || (random() < 0.75);
    IF v_home[array_length(v_home,1)] THEN v_hs := v_hs + 1; END IF;
    IF v_away[array_length(v_away,1)] THEN v_as := v_as + 1; END IF;
  END LOOP;

  IF (p_side = 'home' AND v_hs > v_as) OR (p_side = 'away' AND v_as > v_hs) THEN
    v_result := 'won';
    v_payout := (p_stake * v_odds)::BIGINT;
    UPDATE public.profiles SET token_balance = token_balance + v_payout WHERE id = v_user;
    v_status := 'won';
  ELSE
    v_result := 'lost';
    v_status := 'lost';
  END IF;

  INSERT INTO public.user_virtual_rounds (
    user_id, match_label, side, stake, odds, home_kicks, away_kicks, home_score, away_score, result, payout
  ) VALUES (
    v_user, p_home || ' vs ' || p_away, p_side, p_stake, v_odds, v_home, v_away, v_hs, v_as, v_result, v_payout
  ) RETURNING id INTO v_id;

  -- Voucher bet
  INSERT INTO public.bets(user_id, stake, total_odds, potential_payout, status, is_virtual, kind, virtual_round_id, settled_at, meta)
  VALUES (v_user, p_stake, v_odds, (p_stake * v_odds)::bigint, v_status, true, 'virtual_football_instant', v_id, now(),
    jsonb_build_object('home', p_home, 'away', p_away, 'side', p_side, 'home_score', v_hs, 'away_score', v_as))
  RETURNING id, tracking_id INTO v_bet_id, v_tracking;

  INSERT INTO public.bet_selections(bet_id, selection_label, locked_odds)
  VALUES (v_bet_id, (CASE WHEN p_side='home' THEN p_home ELSE p_away END) || ' to win the shootout · ' || p_home || ' vs ' || p_away, v_odds);

  RETURN jsonb_build_object(
    'id', v_id,
    'bet_id', v_bet_id,
    'tracking_id', v_tracking,
    'home_kicks', v_home,
    'away_kicks', v_away,
    'home_score', v_hs,
    'away_score', v_as,
    'result', v_result,
    'payout', v_payout
  );
END;
$function$;

-- =========================================================
-- 6) place_championship_bet: also write a paired bets voucher
--    and cancel_championship_bet: remove the paired voucher
-- =========================================================
CREATE OR REPLACE FUNCTION public.place_championship_bet(p_tournament uuid, p_kind text, p_team uuid, p_stage text, p_match uuid, p_stake bigint, p_odds numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_bal BIGINT; v_id UUID; v_status TEXT; v_existing UUID;
  v_bet_id UUID; v_team_name TEXT; v_t_name TEXT; v_label TEXT; v_kind_label TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_stake <= 0 THEN RAISE EXCEPTION 'Invalid stake'; END IF;

  SELECT status, name INTO v_status, v_t_name FROM public.tournaments WHERE id = p_tournament;
  IF v_status <> 'booking' THEN
    RAISE EXCEPTION 'Booking is closed for this championship';
  END IF;

  SELECT id INTO v_existing FROM public.championship_bets
   WHERE user_id = v_user AND tournament_id = p_tournament LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already booked a bet for this championship';
  END IF;

  SELECT token_balance INTO v_bal FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_bal IS NULL OR v_bal < p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  UPDATE public.profiles SET token_balance = token_balance - p_stake WHERE id = v_user;

  INSERT INTO public.championship_bets (user_id, tournament_id, kind, team_id, stage, tournament_match_id, stake, odds)
  VALUES (v_user, p_tournament, p_kind, p_team, p_stage, p_match, p_stake, p_odds)
  RETURNING id INTO v_id;

  SELECT name INTO v_team_name FROM public.teams WHERE id = p_team;
  v_kind_label := CASE p_kind
    WHEN 'outright' THEN 'Outright champion'
    WHEN 'reach_final' THEN 'Reach Final'
    WHEN 'reach_semi' THEN 'Reach Semi-Final'
    WHEN 'reach_quarter' THEN 'Reach Quarter-Final'
    WHEN 'eliminated_at' THEN 'Eliminated at ' || COALESCE(p_stage,'stage')
    WHEN 'match_winner' THEN 'Match winner'
    ELSE p_kind
  END;
  v_label := v_kind_label || ' · ' || COALESCE(v_team_name,'team') || ' · ' || COALESCE(v_t_name,'Championship');

  INSERT INTO public.bets(user_id, stake, total_odds, potential_payout, status, is_virtual, kind, championship_bet_id, meta)
  VALUES (v_user, p_stake, p_odds, (p_stake * p_odds)::bigint, 'open', true, 'championship', v_id,
    jsonb_build_object('tournament', v_t_name, 'kind', p_kind, 'stage', p_stage, 'team', v_team_name))
  RETURNING id INTO v_bet_id;

  INSERT INTO public.bet_selections(bet_id, selection_label, locked_odds)
  VALUES (v_bet_id, v_label, p_odds);

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_championship_bet(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bet public.championship_bets%ROWTYPE;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  SELECT status INTO v_status FROM public.tournaments WHERE id = p_tournament;
  IF v_status IS DISTINCT FROM 'booking' THEN
    RAISE EXCEPTION 'Booking is closed for this championship';
  END IF;
  SELECT * INTO v_bet FROM public.championship_bets
    WHERE user_id = auth.uid() AND tournament_id = p_tournament LIMIT 1;
  IF v_bet.id IS NULL THEN
    RETURN jsonb_build_object('cancelled', 0);
  END IF;
  -- refund + remove paired voucher
  UPDATE public.profiles SET token_balance = token_balance + v_bet.stake WHERE id = auth.uid();
  DELETE FROM public.bets WHERE championship_bet_id = v_bet.id AND user_id = auth.uid();
  DELETE FROM public.championship_bets WHERE id = v_bet.id;
  RETURN jsonb_build_object('cancelled', 1, 'refunded', v_bet.stake);
END;
$function$;
