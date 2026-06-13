ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS closed_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_message text NOT NULL DEFAULT 'The website is currently closed. Please check back later.';