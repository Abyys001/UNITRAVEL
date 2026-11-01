# ADR-0018 · Customer activity telemetry (sign-in, sign-out, last seen, last screen)

Status: accepted for local and staging; production use needs counsel and DPIA sign-off (docs/compliance/DPIA-draft.md §Activity telemetry). Source: owner brief of 31 Oct 2026 (plan J4).

## Context

Staff want a customer list showing who signed in, when they last used the app and which screen they were on. The booklet has no activity feed. This is personal data about behaviour, so it needs a stated purpose, a minimum field set and a retention limit.

## Decision

- **Purpose**: let staff help a customer ("online now", "last seen") and see sign-in history. Not marketing, not profiling, not shared with third parties.
- **What is stored** (`customer_activity`, migration 0015): user, session, `kind` (SIGN_IN, SIGN_OUT, SCREEN_VIEW), a **screen name from a fixed allow-list** (`ACTIVITY_SCREENS` in `packages/contracts`), an optional request or invoice reference, client (WEB, MOBILE, CONSOLE), the /24 (IPv4) or /48 (IPv6) network prefix, and the time. **No content, no form values, no search terms, no free text, no full IP, no user agent.**
- **Opt-out**: the API ignores `POST /v1/me/activity` (answers 204, stores nothing) when the browser sends `DNT: 1` or `Sec-GPC: 1`, or the customer set `notificationPrefs.activity_tracking = false`. Sign-in and sign-out rows are security records and are kept either way.
- **Retention**: 90 days, pruned daily by the worker job `activity.prune` on the `maintenance` queue. `users.last_active_at` (a single timestamp) stays.
- **Access**: `customer.read` (new, not privileged) lists customers with masked email and phone; the activity timeline of one customer needs the same permission and every read of it is audited (`customer.activity_viewed`). Staff accounts are not listed.
- **Throttling**: one screen event per user per 2 s is stored (Valkey key), and the route is rate limited per user.
- **Sign-out** writes the audit action `user.signed_out`.

## Consequences

- "Online" means activity in the last 5 minutes. It is derived from `users.last_active_at`, written at most once a minute in `SessionsService.touch()`.
- Lawful basis (legitimate interest vs consent) and the customer-facing notice text are UNKNOWN until counsel answers; the API ships with the opt-out so either choice can be applied in the clients without a backend change.
