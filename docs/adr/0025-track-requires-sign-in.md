# ADR-0025: Purchase tracking requires sign-in

- Status: accepted (owner request, 1 Nov 2026: the Track a Purchase page must require the user to log in)
- Scope: `/track` on customer web and mobile, `POST /v1/track/lookup`, `POST /v1/track/verify`. Supersedes the signed-out part of `docs/CONTENT-MENU-LIVE-DATA.md` section 4.5.

## Context
Section 4.5 let a signed-out visitor enter a reference and a phone number, receive a code and read a status timeline. Hiding that form in the clients would not be enough: the two endpoints would still accept anonymous callers and send SMS (project rule 4, authority lives in the backend).

## Decision
- Both lookup endpoints stop being public and require `flight_request.read.own`, the permission `GET /v1/track` already uses. Anonymous calls answer 401.
- The reference + phone form stays for signed-in customers, for a reference that belongs to someone else's request. Its protections are unchanged: same answer whether or not the pair matched, a code to the phone on record, rate limits, proof of work, status timeline only.
- Web: signed-out visitors can still open `/track`, as on the other browse-open pages. It explains why an account is needed and what can be followed, and links to sign-in with `next` set. No tracking data or form is shown.
- Mobile: `/track` leaves the public routes, so signed-out users go to sign-in and return through `from`. The sign-in screen's tracking shortcut is removed.

## Consequences
- Someone without an account can no longer read a status with only a reference and phone number. They sign in first; signing in creates an account if they have none.
- App builds that call these endpoints with `auth: false` get 401 until updated.
