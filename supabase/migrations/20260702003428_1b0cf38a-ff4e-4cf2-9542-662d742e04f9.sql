-- Scheduled push blasts
CREATE TABLE public.scheduled_pushes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '/',
  role text NOT NULL DEFAULT 'any',
  locale text NOT NULL DEFAULT '',
  last_active_days integer,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  error text,
  created_by uuid NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_pushes TO authenticated;
GRANT ALL ON public.scheduled_pushes TO service_role;

ALTER TABLE public.scheduled_pushes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage scheduled pushes"
ON public.scheduled_pushes FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_scheduled_pushes_due ON public.scheduled_pushes (status, scheduled_for);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_scheduled_pushes_updated_at
BEFORE UPDATE ON public.scheduled_pushes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();