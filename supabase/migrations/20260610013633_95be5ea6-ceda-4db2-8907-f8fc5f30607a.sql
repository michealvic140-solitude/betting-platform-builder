-- Players: gang/team optional for shooters
ALTER TABLE public.players ALTER COLUMN team_id DROP NOT NULL;

-- Matches: shooter match + marketing support
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_kind text NOT NULL DEFAULT 'gang',
  ADD COLUMN IF NOT EXISTS home_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS away_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_match_kind_check') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_match_kind_check CHECK (match_kind IN ('gang', 'shooter', 'future'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_match_kind ON public.matches(match_kind);
CREATE INDEX IF NOT EXISTS idx_matches_home_player_id ON public.matches(home_player_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_player_id ON public.matches(away_player_id);

-- Odds: futures / seasonal tournament fields
ALTER TABLE public.odds
  ADD COLUMN IF NOT EXISTS future_candidate_type text,
  ADD COLUMN IF NOT EXISTS future_emblem_url text,
  ADD COLUMN IF NOT EXISTS future_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS future_next_title text,
  ADD COLUMN IF NOT EXISTS future_next_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS future_progress jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'odds_future_status_check') THEN
    ALTER TABLE public.odds
      ADD CONSTRAINT odds_future_status_check CHECK (future_status IN ('active','qualified','disqualified','lost','winner','settled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_odds_future_status ON public.odds(future_status);

-- App settings: futures controls
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS futures_section_title text NOT NULL DEFAULT 'SEASONAL TOURNAMENT',
  ADD COLUMN IF NOT EXISTS futures_min_stake bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS futures_max_payout bigint NOT NULL DEFAULT 100000000,
  ADD COLUMN IF NOT EXISTS futures_max_selections integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_futures_max_selections_check') THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_futures_max_selections_check CHECK (futures_max_selections BETWEEN 1 AND 3);
  END IF;
END $$;

-- Admin: refund a ticket (void + return stake)
CREATE OR REPLACE FUNCTION public.admin_refund_bet(_bet_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO b FROM public.bets WHERE id = _bet_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF b.status = 'void' THEN RAISE EXCEPTION 'Already refunded'; END IF;
  UPDATE public.profiles SET token_balance = token_balance + b.stake WHERE id = b.user_id;
  UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = _bet_id;
  INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (b.user_id, 'Ticket refunded', COALESCE(_reason, 'Your ticket stake of '||b.stake||' tokens has been refunded.'), '/ticket/'||_bet_id);
  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'refund_bet', 'bet', _bet_id::text, jsonb_build_object('reason', _reason, 'stake', b.stake));
END $$;
REVOKE ALL ON FUNCTION public.admin_refund_bet(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_bet(uuid, text) TO authenticated;

-- Admin: void a ticket, optionally refunding the stake
CREATE OR REPLACE FUNCTION public.admin_void_bet(_bet_id uuid, _refund boolean DEFAULT false, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO b FROM public.bets WHERE id = _bet_id FOR UPDATE;
  IF b IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF b.status = 'void' THEN RAISE EXCEPTION 'Already voided'; END IF;
  IF _refund THEN
    UPDATE public.profiles SET token_balance = token_balance + b.stake WHERE id = b.user_id;
  END IF;
  UPDATE public.bets SET status = 'void', settled_at = now() WHERE id = _bet_id;
  INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (b.user_id, 'Ticket voided',
      COALESCE(_reason, CASE WHEN _refund THEN 'Your ticket was voided and the stake of '||b.stake||' tokens refunded.' ELSE 'Your ticket was voided.' END),
      '/ticket/'||_bet_id);
  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'void_bet', 'bet', _bet_id::text, jsonb_build_object('reason', _reason, 'refund', _refund, 'stake', b.stake));
END $$;
REVOKE ALL ON FUNCTION public.admin_void_bet(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_bet(uuid, boolean, text) TO authenticated;