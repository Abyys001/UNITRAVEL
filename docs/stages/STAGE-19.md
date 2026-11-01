# Stage 19 record: staff session limits, remembered devices, installable console (1 Nov 2026)

Source: owner request and approved plan, ADR-0022. Booklet ch. 16.1 and 25.2 amended for console re-authentication.

## What changed (DOCUMENTED)
- **Idle timeout now works.** OBSERVED before this change: `refresh()` had no idle check and access tokens expire before the guard's idle check, so an idle session never ended; refreshes and polling also counted as activity. Now refresh enforces idle, and refresh, resume, forget, the staff event stream and requests flagged `x-ut-background: 1` do not extend a session.
- **Remembered devices.** Migration `0018_trusted_devices`. `POST /v1/auth/device/resume`, `POST /v1/auth/device/forget`, `POST /v1/auth/activity`, `GET` and `DELETE /v1/me/trusted-devices`. `AUTH.staffDeviceIdleDays` (30), `AUTH.staffDeviceMaxDays` (90).
- **Console.** Activity tracking and heartbeat, silent resume with one retry, idle veil that keeps forms mounted, Remembered devices on Account, sign-out that revokes the device even after the session ended.
- **Install.** Per-host manifest, icons, service worker that stores no data, offline page and banner, Install app menu item; console Docker stage now copies `public/`.
- OpenAPI regenerated; en and fa strings; DPIA R19 and M22; runbook and LOCAL-DEV.

## Not done or not verified
- UNKNOWN: installing through the real browser install dialog and using the installed window. Chrome reports no installability errors on both hosts, but no window was installed.
- NOT DEPLOYED to the VPS, nothing committed.
- Installing on a deployed host needs HTTPS; not tested on one.

## Separate finding (OBSERVED, not changed)
`ComplianceService.screen()` returns CLEAR when no sanctions list is active (`active.length` zero means no candidates, score 0). A new database has no active list until the first `compliance.lists-sync` run, which downloads all lists. Needs an owner and compliance decision on failing closed.
