-- ============ TOURNAMENTS ============
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tagline text DEFAULT 'ONE LEAGUE. NO MERCY. RESPECT THE GAME.',
  event_date date,
  status text NOT NULL DEFAULT 'draft',
  is_featured boolean NOT NULL DEFAULT false,
  champion_id uuid,
  futures_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tournaments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments TO authenticated;
GRANT ALL ON public.tournaments TO service_role;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tournaments are viewable by everyone" ON public.tournaments FOR SELECT USING (true);
CREATE POLICY "Admins manage tournaments" ON public.tournaments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ============ PARTICIPANTS ============
CREATE TABLE public.tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_url text,
  seed int,
  current_round int NOT NULL DEFAULT 1,
  is_eliminated boolean NOT NULL DEFAULT false,
  eliminated_round int,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tournament_participants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_participants TO authenticated;
GRANT ALL ON public.tournament_participants TO service_role;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants viewable by everyone" ON public.tournament_participants FOR SELECT USING (true);
CREATE POLICY "Admins manage participants" ON public.tournament_participants FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- champion FK now that participants exists
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_champion_fk FOREIGN KEY (champion_id)
  REFERENCES public.tournament_participants(id) ON DELETE SET NULL;

-- ============ MATCHES ============
CREATE TABLE public.tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round int NOT NULL,
  round_name text,
  slot int NOT NULL DEFAULT 0,
  label text,
  participant_a_id uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  participant_b_id uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  score_a int,
  score_b int,
  winner_id uuid REFERENCES public.tournament_participants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  next_match_id uuid REFERENCES public.tournament_matches(id) ON DELETE SET NULL,
  next_slot text,
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tournament_matches TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches TO authenticated;
GRANT ALL ON public.tournament_matches TO service_role;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bracket matches viewable by everyone" ON public.tournament_matches FOR SELECT USING (true);
CREATE POLICY "Admins manage bracket matches" ON public.tournament_matches FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX idx_tmatch_tournament ON public.tournament_matches(tournament_id);
CREATE INDEX idx_tpart_tournament ON public.tournament_participants(tournament_id);

-- updated_at triggers
CREATE TRIGGER trg_tournaments_updated BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tmatches_updated BEFORE UPDATE ON public.tournament_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ RESULT + AUTO-ADVANCE ============
CREATE OR REPLACE FUNCTION public.set_tournament_result(_match_id uuid, _score_a int, _score_b int, _winner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; loser uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT * INTO m FROM public.tournament_matches WHERE id = _match_id FOR UPDATE;
  IF m IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF _winner_id IS NOT NULL AND _winner_id <> m.participant_a_id AND _winner_id <> m.participant_b_id THEN
    RAISE EXCEPTION 'Winner must be one of the two participants';
  END IF;

  UPDATE public.tournament_matches
    SET score_a = _score_a, score_b = _score_b, winner_id = _winner_id,
        status = CASE WHEN _winner_id IS NOT NULL THEN 'completed' ELSE 'live' END,
        updated_at = now()
    WHERE id = _match_id;

  IF _winner_id IS NOT NULL THEN
    loser := CASE WHEN _winner_id = m.participant_a_id THEN m.participant_b_id ELSE m.participant_a_id END;
    IF loser IS NOT NULL THEN
      UPDATE public.tournament_participants SET is_eliminated = true, eliminated_round = m.round WHERE id = loser;
    END IF;
    UPDATE public.tournament_participants SET current_round = m.round + 1, is_eliminated = false WHERE id = _winner_id;

    IF m.next_match_id IS NOT NULL THEN
      IF m.next_slot = 'a' THEN
        UPDATE public.tournament_matches SET participant_a_id = _winner_id, updated_at = now() WHERE id = m.next_match_id;
      ELSE
        UPDATE public.tournament_matches SET participant_b_id = _winner_id, updated_at = now() WHERE id = m.next_match_id;
      END IF;
    ELSE
      UPDATE public.tournaments SET champion_id = _winner_id, status = 'completed', updated_at = now() WHERE id = m.tournament_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_matches;