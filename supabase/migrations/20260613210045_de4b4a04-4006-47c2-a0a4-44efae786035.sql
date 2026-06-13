-- Add reaction counters to highlights
ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS likes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dislikes integer NOT NULL DEFAULT 0;

-- Per-user reactions on highlights
CREATE TABLE IF NOT EXISTS public.highlight_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id uuid NOT NULL REFERENCES public.highlights(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like','dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (highlight_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlight_reactions TO authenticated;
GRANT SELECT ON public.highlight_reactions TO anon;
GRANT ALL ON public.highlight_reactions TO service_role;

ALTER TABLE public.highlight_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view highlight reactions"
  ON public.highlight_reactions FOR SELECT
  USING (true);

CREATE POLICY "Users manage their own highlight reactions"
  ON public.highlight_reactions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Keep highlight like/dislike counters in sync
CREATE OR REPLACE FUNCTION public.sync_highlight_reaction_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid := COALESCE(NEW.highlight_id, OLD.highlight_id);
BEGIN
  UPDATE public.highlights h SET
    likes = (SELECT count(*) FROM public.highlight_reactions r WHERE r.highlight_id = target AND r.reaction = 'like'),
    dislikes = (SELECT count(*) FROM public.highlight_reactions r WHERE r.highlight_id = target AND r.reaction = 'dislike')
  WHERE h.id = target;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_highlight_reactions ON public.highlight_reactions;
CREATE TRIGGER trg_sync_highlight_reactions
  AFTER INSERT OR UPDATE OR DELETE ON public.highlight_reactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_highlight_reaction_counts();