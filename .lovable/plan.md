## Remaining scope — one pass

### 1. Platform branding (name + logo) — admin-configurable

Add to `app_settings` (single-row config):
- `platform_name` text (default "LSL")
- `platform_tagline` text
- `platform_description` text
- `platform_logo_url` text (main logo used across app)
- `platform_logo_auth_url` text (login/register pages)
- `platform_logo_voucher_url` text (bet slips / vouchers / receipts)
- `platform_og_image_url` text (SEO share image)

Then:
- New admin panel section "Branding" (in reorganized settings) with text inputs + `ImageSettingControl` for each logo slot.
- Create a `useBranding()` hook that reads `app_settings` once and exposes `{ name, tagline, description, logos }`; cache in React Query.
- Replace hardcoded "LSL" / logo image references in: `Layout` (header/sidebar), `login.tsx`, `register.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `HomeContent`/index hero, `BetSlip` / `BetSuccessPopout` / `ticket.$id.tsx` (voucher), and `__root.tsx` head defaults (og:site_name, og:image).

### 2. Admin settings reorganization

`app_settings` has 120 columns spread across one giant panel. Group into tabs/accordions:
- Branding (name, logos, description, OG image)
- Platform (maintenance, feature flags, region)
- Betting (odds, limits, cashout, hot bets)
- Virtual (instant + championship flags, cadence)
- Wallet & Payments (min/max, fees, providers)
- Notifications & Push (VAPID status, broadcast defaults)
- Community (chat, gangs, polls, surveys)
- Rewards (VIP, streaks, referrals, spins, lottery)
- SEO & Meta (title, description, og image, sitemap)

Implementation: refactor the main admin settings screen to use a left rail (categories) + right pane (fields for that category), reusing existing field components. No new backend logic — just presentation.

### 3. Multi-select delete on admin lists

Add checkbox column + "Delete selected" action to:
- Clans admin (`ClansAdminPanel`)
- Bet tracker / Top bets (`TopBetsPanel`)
- Battle (Tournament + tournament_matches admin)
- Virtual (Instant rounds + Championship tournaments + Teams list)

Pattern: local `Set<string>` selection state, header checkbox for select-all-on-page, bulk `.in('id', [...])` delete with confirm dialog, then re-fetch. Reuse `ActionConfirmDialog`.

### 4. Push subscribers accuracy

Audit `push_subscriptions` counts:
- Deduplicate on endpoint (unique constraint if missing).
- Mark stale rows: on 404/410 delivery response, delete subscription (already partially done in `push-send.server.ts` — verify).
- Admin push panel should show `active` count = subs where `last_success_at` within 30 days OR never failed, not raw row count.
- Add cleanup RPC `prune_dead_push_subscriptions()` and a "Prune dead" button in `PushBroadcastPanel`.

### Technical notes

- One migration: add branding columns to `app_settings`, add unique constraint on `push_subscriptions.endpoint` (if missing), add `prune_dead_push_subscriptions()` function.
- No changes to server-function auth model or routing.
- All admin-only UI stays behind existing `has_role(admin)` checks.
- Keep component edits minimal — reuse existing panels; only the settings screen shell changes shape.

### Out of scope

- Rewriting the settings storage model (still one `app_settings` row).
- Redesigning individual admin panels beyond adding multi-select.
- Rebranding beyond text/logo swaps (no color/theme changes).
