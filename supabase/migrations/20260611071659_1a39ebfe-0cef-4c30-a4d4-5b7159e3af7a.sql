CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted backend (service role) and admins may set sensitive fields directly.
  IF auth.role() = 'service_role' OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.token_balance := OLD.token_balance;
  NEW.is_banned := OLD.is_banned;
  NEW.ban_reason := OLD.ban_reason;
  NEW.is_muted := OLD.is_muted;
  NEW.mute_reason := OLD.mute_reason;
  NEW.is_restricted := OLD.is_restricted;
  NEW.restrict_reason := OLD.restrict_reason;
  NEW.vip_tier := OLD.vip_tier;
  NEW.xp := OLD.xp;
  NEW.streak_days := OLD.streak_days;
  NEW.longest_streak := OLD.longest_streak;
  NEW.last_login_date := OLD.last_login_date;
  NEW.referral_code := OLD.referral_code;
  NEW.referred_by := OLD.referred_by;
  NEW.emblem_status := OLD.emblem_status;
  RETURN NEW;
END;
$function$;