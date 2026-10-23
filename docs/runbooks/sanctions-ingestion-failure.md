# Runbook: sanctions list ingestion failure

Booklet ch. 30.7, 26.2, 27.2. Trigger: list sync failed twice in a row.

## Impact
Screening continues on the last good list version (apps/api/src/modules/compliance/compliance.service.ts). The risk is staleness: a newly designated party may not be matched. UK sanctions breaches are strict liability (ch. 1.1), so staleness is a compliance matter, not only an operational one.

## Mechanics
- Job `compliance.lists-sync` (queue `compliance.lists-sync`, 5 attempts, 60 s exponential backoff) runs every 6 hours and on demand. `syncAll()` fetches UK (FCDO CSV), OFAC SDN and non-SDN (Sanctions List Service) and EU (consolidated CSV). A `TEST` list is synced only in local environments. Source URLs come from compliance settings (`sources`).
- Each download uses a 180 s timeout; a non-2xx is an error. Failure inserts a `sanction_lists` row with `status=FAILED`, logs `list sync failed`, and emits `provider.health_changed` (circuit `FAILED`) so developers are alerted.
- An unchanged list keeps its version hash; a changed one creates a new version and follows the design in ch. 27.2.

## First 15 minutes
1. Identify which list(s): `GET /v1/dev/health` dependencies and the latest `sanction_lists` rows (status, error, version hash, age of last good).
2. Tell the compliance officer (role holder is owed by Uni Travel, U-7, ch. 34.1; UNKNOWN until named): lists are stale since `<last good time>`.
3. Test the source URL from the worker host (curl). Distinguish publisher outage, URL/format change, or our egress.

## Diagnosis
| Symptom | Cause |
|---|---|
| HTTP 4xx/5xx from publisher | Publisher outage or moved URL: check the publisher site |
| Timeout | Large file, slow egress, 180 s limit |
| Parse error | Publisher changed the file format; see `list-parsers.ts` |
| Only EU failing | EU endpoints sometimes require a token or changed path: verify the configured source URL |

## Mitigation
- Fix configuration (source URLs are compliance settings, not code); re-run on demand with `POST /v1/admin/compliance/lists/sync` (permission `compliance.case.decide`); list status at `GET /v1/admin/compliance/lists`.
- Parser change needed: it is a code fix with tests; add a fixture from the new format. Do not edit policies in code to compensate.
- While stale beyond the compliance officer's tolerance (not defined in the booklet: PROPOSED to set one, e.g. 24 hours), consider manual review of new high-risk requests and pausing ticketing for new parties; this is a compliance decision, recorded.

## Recovery
Successful sync of every list; new version rows with `ACTIVE` status and expected entry counts (order of magnitude seen in the build: UK 6408, OFAC 19471, EU 6234 entries); confirm re-screening of open requests finished and no new matches were missed. Review cases created by the catch-up.

## Comms
Compliance officer and owners. No customer comms. If a match is found after the gap and a sale already proceeded, escalate to counsel (possible reporting obligations).

## Follow-up
Add a staleness alert if absent; record the staleness window; consider a second sync time; keep a fixture of each publisher format. The matcher evaluation (ch. 32.5) is separate and unchanged.
