# Runbook: identity verification (staff procedure)

Source: ADR-0005, owner decisions 4 and 7. Surface: Admin Panel, "Passport verification" (needs `identity.verify`; opening the scan or revealing the number also needs `customer.read.documents`).

## Routine review
1. Open **Passport verification**; the queue lists customers who confirmed their details, oldest first.
2. Open a row. Fields are on the right, the scan on the left. **Show scan** and **Reveal** are deliberate clicks: each writes an audit entry (`document.downloaded`, `customer.document_revealed`). Do not open them out of curiosity.
3. Compare name, date of birth, nationality, number, issuing country and expiry with the scan.
4. Decide:
   - **Verify** when everything matches.
   - **Needs correction** when the customer can fix it (typo, wrong date). Pick a reason and write the message the customer will see. Never put the passport number or other personal data in the message.
   - **Reject** when the document cannot be accepted as submitted (not a passport page, unreadable beyond a better scan, expired).
5. A **409 "customer changed their details"** means the customer edited after you opened the page. Reload and review again.
You cannot review a traveller profile that belongs to your own account.

## Ticketing
`record_tickets` is refused with `IDENTITY_NOT_VERIFIED` until every traveller on the request is VERIFIED. The request detail lists the offending travellers. Quotes can still be accepted. If the customer changes the passport number, names, date of birth, nationality, issuing country or expiry, or replaces the scan, a VERIFIED record returns to SUBMITTED and must be reviewed again (a Persian-name edit does not).

## After deploying migration 0004
Existing admin and owner sessions learn about `identity.verify` only after a token refresh. The migration bumps `perm_version` in PostgreSQL, but the permission-version cache in Redis (`perm:<userId>`) is written at sign-in and refresh, so delete the keys once after migrating (`valkey-cli --scan --pattern 'perm:*' | xargs valkey-cli del`) or ask staff to sign in again.

## Storage and retention
- Scans live in the `<bucket>-identity` bucket, encrypted at rest (SSE-S3). The object store must be configured for SSE-S3 (RustFS needs `RUSTFS_SSE_S3_MASTER_KEY`; see `infra/compose.dev.yml`). If it is not, uploads fail instead of storing plaintext: that is intended (OBSERVED on RustFS without the key: `InvalidRequest: SSE-S3 requires RUSTFS_SSE_S3_MASTER_KEY`). Check `HeadObject` shows `ServerSideEncryption: AES256`.
- Retention is `settings.identityScanRetentionDays` (Developer Panel, settings). Unset (UNKNOWN) means no automatic deletion; set it once the DPIA owner decides. The job `identity.scan-retention` runs daily (Developer Panel, jobs).
- A customer who deletes a traveller or the account has their scans deleted immediately.

## If a scan is opened without need
Treat as an insider-access incident (`security-incident.md`): the audit log (`GET /v1/dev/audit-log?action=document.downloaded`) shows who, when and which document.
