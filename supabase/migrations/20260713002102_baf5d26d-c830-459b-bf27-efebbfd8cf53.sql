REVOKE EXECUTE ON FUNCTION public.notify_admins(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.display_name_for(uuid) FROM PUBLIC, anon, authenticated;