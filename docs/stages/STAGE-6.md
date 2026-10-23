# Stage 6 record: hardening

Source: booklet ch. 31.8 (Stage 6), ch. 32 (testing and quality), ch. 28 (security), ch. 30 (operations). Measurements below were taken locally on 22-23 Oct 2026 and are not production figures.

## Permission matrix (ch. 32.3)
- `apps/api/test/matrix.e2e.ts`: every permission-guarded route is called as each of the 5 staff roles, a customer and an anonymous caller; 401, 403 and 404 are asserted per cell.
- One declared handler rule: policy approval is owner-only.
- API e2e total: 48/48 (incl. timer rebuild, staff directory, admin SSE). SLA timers had never been scheduled (BullMQ rejects `:` in job ids); fixed, and a reconcile job now rebuilds timers after Valkey loss.

## Property tests (ch. 32.2)
- Engine: 5 invariants.
- State machine: TICKETED requires issued tickets; RESERVED requires a record locator; no UNKNOWN quote attribute can be sent.
- Payments: sums.
- Customer serialisers never emit internal fields (new `apps/api/src/serialisers.spec.ts`); customer responses are now parsed through strict Zod customer schemas.

## Compliance matcher evaluation (ch. 32.5)
- `packages/domain/src/name-matcher.spec.ts`: recall >= 0.98 on labelled true pairs; common-name false positives kept below the threshold.
- A real false positive against the live UK list was found during the build ("Arash Foureyes" ~ "Firas al-Akhras", score 0.89). Fixed by tuning and added to the evaluation set.

## Benchmarks (ch. 32.4)
- THR to LON, TBZ to MAN, MHD to FRA, EVN to LON must return options; gateway results for Iran origins; no blocked carriers; self-transfers flagged; layovers in bounds; first results within 8 s.
- Finding: the FAKE network previously returned zero results for TBZ to MAN and MHD to FRA and the test tolerated it. Network fixed (30-minute IST connection replaced; afternoon IST to FRA/MAN added) and the test made strict.

## Load test (k6, `infra/load/search.k6.js`; SLOs ch. 30.5)
| Rate | Result |
|---|---|
| 0.5 searches/s for 90 s | p95 first results 2.53 s; 100% with results; start p95 19 ms; locations p95 6.5 ms; 0% errors. SLO met |
| 1 search/s | p95 11.2 s. SLO missed |
| 2 searches/s | p95 19.3 s |

Cause: provider limits (FAKE: 8 concurrent, 20 requests/s, about 0.6 s per call; about 15 calls per cold search, giving a ceiling near 0.9 cold searches/s). The gateway queues by design. An attempt to prioritise first-wave calls made p95 worse (27 s) and was reverted. Capacity levers: provider `maxConcurrent` per contract, leg-cache hit rate, more providers. The booklet gives no volume target: the owner must set one.

## Accessibility
axe WCAG 2.2 AA, 7 pages on desktop and mobile viewports, 0 serious or critical issues (`apps/web/e2e/a11y.spec.ts`). Manual screen-reader passes are still to do, per release.

## Security headers and dependencies
- CSP with per-request nonce, nosniff, referrer policy, HSTS, permissions policy (test in `apps/web/e2e/customer.spec.ts`).
- Next.js upgraded 16.4.0 to 16.4.2 for two critical RCE advisories and one high advisory. Note: the engineering kit's starter still pins 16.4.0.
- `pnpm audit`: 0 high or critical, 1 moderate.

## Images
`infra/docker/node.Dockerfile` targets `api`, `migrate`, `web`, `console`.
- api image 560 MB, smoke-tested: ready, database and Redis ok, FAKE adapter refused in the production build.
- web image 389 MB, smoke-tested through its API proxy.
- migrate image applied all migrations to an empty database (82 tables).

## Backup restore drill
`scripts/backup-restore-drill.sh`: dump 0.6 s, restore 2.7 s, 82 tables, identical row counts. Logical dump only; WAL archiving and PITR (ch. 30.6) are production design, not exercised. See docs/runbooks/backup-restore.md.

## CI
`.github/workflows/ci.yml`: static, secrets (gitleaks), e2e with services, mobile, images. The static job was validated locally; the full workflow has not run on a hosted runner.

## Runbooks and DPIA
Runbooks for ch. 30.7 and backup (ch. 30.6): docs/runbooks/. DPIA draft: docs/compliance/DPIA-draft.md (requires DPO/counsel review).

## Not done here, and why
These are gate items for real people (ch. 28.7, 31.8). None is claimed complete.
- Independent penetration test by an external firm (web, console, API, mobile).
- DAST (for example ZAP) against staging: no staging environment exists.
- UAT with admins.
- Pilot.
- Counsel sign-off (Stage 0 register: docs/stages/STAGE-0.md).
- Owner approval.
