# ADR-0009 · Audit hash canonicalisation and refresh-rotation grace window

Status: accepted (build decision, 24 Oct 2026). Owner confirmation owed with the other ADRs.

## Audit hash chain (ch. 28.5)

Context: ch. 28.5 describes an optional hash-chained audit log. `record()` hashed `JSON.stringify` of objects whose key order Postgres jsonb rewrites on storage, so `verify()` recomputed a different hash and reported the chain broken at entry 14. This is a defect in the implementation, not a change to the booklet's intent (tamper evidence).

Decision:
- New rows are hashed over canonical JSON (recursively key-sorted) and carry `audit_log.hash_version = 2` (migration `0008_audit_hash_version.sql`). Existing rows are insert-only and cannot be rehashed; they keep `hash_version = 1`.
- `verify()` always checks every row's link to its predecessor. Version 2 rows are also content-checked; a mismatch is `brokenAt`. Version 1 rows whose content hash does not reproduce are counted as `legacyUnverifiable` (with `firstLegacyUnverifiable`), never as verified and never as broken. `ok` means no broken link or version 2 mismatch; callers must show `legacyUnverifiable` beside it.
- Consequence: content of legacy rows cannot be proven untampered from the chain alone; their links still are.

## Refresh-token reuse grace (ch. 25.2, OWASP session management)

Context: two tabs sharing one cookie refresh at once; the second presents a token the first just rotated, and the whole family was revoked as theft.

Decision: a rotated token presented again within 10 seconds (`REFRESH_REUSE_GRACE_SECONDS`) of its rotation, from the same IP and user agent as the rotation (hash kept in Valkey for those 10 seconds), receives a sibling token in the same family. Tokens are stored hashed, so the already-issued successor cannot be returned; a sibling is equivalent. Anything later, from another client, or with a revoked token revokes the family and the session as before (`security.refresh_reuse` audit entry). The window is a constant, not configuration, so it cannot be widened from the panel.
