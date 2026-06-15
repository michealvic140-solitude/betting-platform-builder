ALTER TYPE public.bet_status ADD VALUE IF NOT EXISTS 'refunded';

CREATE OR REPLACE FUNCTION public.sync_future_contender_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  home_player_name text;
  away_player_name text;
  home_team_name text;
  away_team_name text;
  home_name text;
  away_name text;
BEGIN
  SELECT NULLIF(trim(p.name), ''), NULLIF(trim(t.name), '')
    INTO home_player_name, home_team_name
  FROM (SELECT NEW.home_player_id AS player_id, NEW.home_team_id AS team_id) s
  LEFT JOIN public.players p ON p.id = s.player_id
  LEFT JOIN public.teams t ON t.id = s.team_id;

  SELECT NULLIF(trim(p.name), ''), NULLIF(trim(t.name), '')
    INTO away_player_name, away_team_name
  FROM (SELECT NEW.away_player_id AS player_id, NEW.away_team_id AS team_id) s
  LEFT JOIN public.players p ON p.id = s.player_id
  LEFT JOIN public.teams t ON t.id = s.team_id;

  home_name := COALESCE(home_player_name, home_team_name, 'Home');
  away_name := COALESCE(away_player_name, away_team_name, 'Away');

  UPDATE public.odds o
  SET
    future_match_id = NEW.id,
    future_match_side = CASE
      WHEN lower(trim(o.label)) IN (lower(home_player_name), lower(home_team_name)) THEN 'home'
      WHEN lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name)) THEN 'away'
      ELSE NULL
    END,
    future_live_score = CASE
      WHEN lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name))
        THEN COALESCE(NEW.away_score,0) || '-' || COALESCE(NEW.home_score,0)
      ELSE COALESCE(NEW.home_score,0) || '-' || COALESCE(NEW.away_score,0)
    END,
    future_live_opponent = CASE
      WHEN lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name)) THEN home_name
      ELSE away_name
    END,
    future_live_outcome = CASE
      WHEN NEW.status::text NOT IN ('ended','completed','settled') THEN 'pending'
      WHEN NEW.winner_team_id IS NOT NULL
        AND lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name))
        AND NEW.winner_team_id = NEW.away_team_id THEN 'won'
      WHEN NEW.winner_team_id IS NOT NULL
        AND lower(trim(o.label)) IN (lower(home_player_name), lower(home_team_name))
        AND NEW.winner_team_id = NEW.home_team_id THEN 'won'
      WHEN NEW.winner_team_id IS NOT NULL THEN 'lost'
      WHEN lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name))
        AND COALESCE(NEW.away_score,0) > COALESCE(NEW.home_score,0) THEN 'won'
      WHEN lower(trim(o.label)) IN (lower(home_player_name), lower(home_team_name))
        AND COALESCE(NEW.home_score,0) > COALESCE(NEW.away_score,0) THEN 'won'
      WHEN COALESCE(NEW.home_score,0) <> COALESCE(NEW.away_score,0) THEN 'lost'
      ELSE 'pending'
    END,
    updated_at = now()
  FROM public.markets mk
  JOIN public.matches fm ON fm.id = mk.match_id
  WHERE o.market_id = mk.id
    AND fm.match_kind = 'future'
    AND fm.is_archived = false
    AND (
      lower(trim(o.label)) IN (lower(home_player_name), lower(home_team_name))
      OR lower(trim(o.label)) IN (lower(away_player_name), lower(away_team_name))
    );

  RETURN NEW;
END;
$function$;