# ADR-0022 · Staff session limits, remembered devices and the installable console

Status: accepted (owner request and plan approval, 1 Nov 2026). Amends ch. 16.1 and 25.2 for console re-authentication.

## Context
The owner asked for three things together: staff sessions end after 30 minutes of inactivity and 12 hours at most, a device that has signed in is not asked to sign in again unless the user signs out, and the Admin Panel can be installed as an app. With one credential the first two contradict each other.

OBSERVED defect: the idle timeout never fired. `refresh()` had no idle check and access tokens (10 minutes) expire before the guard's idle check runs, and refreshes and background polling both updated `last_seen_at`.

## Decision
Two layers.

| Layer | Lifetime | At expiry |
|---|---|---|
| Session | 30 minutes idle, 12 hours absolute (server enforced) | Session is revoked |
| Remembered device (`trusted_devices`) | 30 days rolling, 90 days hard cap (`AUTH.staffDeviceIdleDays`, `staffDeviceMaxDays`) | Full sign-in with second factor |

- **Activity.** Only real input counts. The console flags requests made without recent input with `x-ut-background: 1`, which does not extend the session; the staff event stream and refresh never do. A client can only misreport activity to keep its own session open, up to the 12-hour limit.
- **Resume.** A remembered device silently opens a new session after the old one ends. The new session keeps second-factor level 1 but has no `mfa_verified_at`, so every step-up action asks for the second factor again.
- **Credential.** Opaque, hashed at rest, rotated on use. The previous token presented again outside the ADR-0009 grace (10 seconds, same client) revokes the device and its sessions (`security.device_reuse`). Cookie `ut_dt`: HttpOnly, Secure on https, SameSite=Strict, host-only, path `/api/v1/auth/device`. A readable companion cookie `ut_dh=1` holds no secret and has the same lifetime; it tells the page a resume is worth trying, so signed-out visitors make no request that must fail.
- **Binding.** Issued only once the second factor is satisfied. Bound to the console host it was issued on. Resume and forget need a matching Origin and the `x-ut-device` header. Resume refuses suspended users and, when the second factor is required, staff without a confirmed factor (test sign-in excepted, ADR-0012).
- **Revocation.** Sign-out, revoking a session or device, revoke-all, suspension, staff removal, merge, account deletion and refresh-token reuse all revoke the device. Idle and absolute expiry do not.
- **Audit.** `session.device_trusted`, `session.device_resumed`, `session.device_revoked`, `security.device_reuse`.
- **Idle screen.** After an idle timeout the console hides its content behind a veil. Any input resumes; forms stay mounted, so drafts survive.
- **Customers.** Unchanged. Website and mobile already stay signed in with use, up to 90 days from sign-in (`REMEMBER_DEVICE_DAYS`, stage 17). The 30-minute and 12-hour limits are staff only.
- **Install.** Per-host web manifest and a service worker that caches only content-hashed static files, icons and an offline page. It never handles `/api` and never stores HTML, so no customer data is written to disk by it and data is never served stale.

## Consequences
- Accepted by the owner: anyone using an unlocked, remembered computer reaches the panel without a prompt, including customer data that is not behind step-up. The operating-system lock screen is the barrier on that device. Step-up actions still need the second factor.
- A stolen browser profile yields non-step-up access until the device is revoked or the legitimate browser uses the token next, which triggers reuse detection.
- An open event stream can outlive its session by up to 5 minutes, because streams re-enter the guard when they reconnect.
- Installing needs HTTPS outside `*.localhost`.
