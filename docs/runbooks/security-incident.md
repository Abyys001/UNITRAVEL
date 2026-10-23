# Runbook: security incident

Booklet ch. 30.7, 28.1, 28.5, 28.6. Trigger: suspected breach (unauthorised access to, or loss, alteration or disclosure of, personal data or systems). Includes ICO 72-hour notification steps (UK GDPR Art. 33).

DRAFT procedure: requires owner and counsel review. Names, contact routes and decision-makers are not defined in the booklet and are UNKNOWN until Uni Travel assigns them (incident lead, DPO or data protection contact, counsel).

## Impact
Personal data at risk includes names, contact details, passport numbers (AES-256-GCM field encryption; only last4 in clear; decryption only through the audited Reveal action, ch. 28.3), documents in object storage (private, signed URLs of 5 minutes), request and payment records, and screening data.

## Phase 1: first 15 minutes (contain, preserve, assign)
1. Declare an incident; name an incident lead and a scribe; start the incident record with UTC timestamps. Record the time Uni Travel first became aware: the 72-hour clock runs from awareness of a breach of personal data, not from confirmation of all facts.
2. Preserve evidence before changing anything: take volume snapshots or logs copy; do not delete logs (application logs are kept 30 days, ch. 28.6).
3. Contain proportionately:
   - Compromised account: `POST /v1/dev/users/{id}/suspend`, `/sessions/revoke`, `/force-reverify`; remove roles `PUT /v1/dev/users/{id}/roles`.
   - Refresh-token reuse or token theft: rotate the JWT signing key (public keys of old tokens stay valid only until expiry; revoke sessions to force sign-in).
   - Provider credentials exposed: rotate via `PUT /v1/dev/providers/{id}/credentials` and `PUT /v1/dev/vendors/{vendor}/credentials` (step-up), then disable the provider if needed.
   - Master encryption key or database credentials exposed: treat as severe; rotate secrets in the host secrets store, redeploy (`infra/compose.prod.yml` reads them from the environment) and re-encrypt under a new key id (field encryption carries `key_id` for rotation, ch. 28.3).
   - Active attack on the edge: block at Caddy/host firewall; consider taking `web`, `console` or `api` offline.
4. Do not wipe or rebuild a host before evidence is captured.

## Phase 2: diagnosis
- Audit log: `GET /v1/dev/audit-log`; verify integrity with `GET /v1/dev/audit-log/verify` (hash chain); export with `POST /v1/dev/audit-log/export`. Look at Reveal actions on passport numbers, role changes, policy overrides, credential changes, failed OTP bursts, refresh-token reuse (ch. 28.5 security events).
- Access logs from Caddy (JSON) and API logs (redacted by design: no phone numbers beyond country code and last two digits, no document numbers, no OTP codes, no tokens).
- Scope: which data subjects, which categories, which period, whether data was encrypted and whether keys were affected, whether the access was read-only or modified data.
- Decide: is this a "personal data breach" under UK GDPR (Art. 4(12))? If yes, continue with the notification steps.

## Phase 3: ICO notification (UK GDPR Art. 33) and data subjects (Art. 34)
Uni Travel is the controller (ch. 28.6). The following are legal requirements; counsel confirms the application to the facts.
1. Assess risk to individuals' rights and freedoms (identity theft or fraud, discrimination, safety, particularly for people in or connected with Iran). Record the assessment and reasoning, including when the conclusion is "unlikely to result in a risk".
2. If the breach is NOT unlikely to result in a risk: notify the ICO without undue delay and, where feasible, within 72 hours of becoming aware (Art. 33(1)). Use the ICO's personal data breach reporting route (online form or helpline as published by the ICO at the time). If notification is later than 72 hours, give reasons for the delay.
3. The notification must include (Art. 33(3)): nature of the breach with categories and approximate numbers of data subjects and records; name and contact details of the DPO or other contact point; likely consequences; measures taken or proposed. If not all information is available, provide it in phases without undue further delay (Art. 33(4)).
4. If the breach is likely to result in a HIGH risk to individuals: inform the affected individuals without undue delay, in clear language (English and Persian), describing the nature of the breach, contact point, likely consequences and measures (Art. 34). Exceptions (encryption rendering data unintelligible, subsequent measures, disproportionate effort) need counsel's sign-off. Passport numbers are field-encrypted, which may be relevant if keys were not exposed; documents in storage need separate analysis.
5. If a processor (SMS, email, hosting, push provider) suffered the breach, they must notify Uni Travel without undue delay (Art. 33(2)); the 72 hours runs from Uni Travel becoming aware. Data processing agreements should require this: status of those agreements is UNKNOWN (docs/stages/STAGE-0.md).
6. Document every breach, whether or not notified, with facts, effects and remedial action (Art. 33(5)). Keep this in the incident record.
7. Consider other duties with counsel: other regulators (e.g. EU supervisory authorities for EU residents), card/payment parties (no online payments in v1, D-03), insurers, law enforcement.

Timeline guide (from awareness, T0): T+1 h incident lead named and containment under way; T+24 h scope assessment and risk decision; T+48 h draft ICO notification and subject notice reviewed by counsel; T+72 h ICO notification submitted at the latest. These milestones are PROPOSED; only the 72-hour limit is a legal requirement.

## Phase 4: eradication and recovery
Patch or fix root cause; rotate all credentials in scope; rebuild from clean images (`infra/docker/node.Dockerfile`); restore data only if integrity was affected (backup-restore runbook); verify the audit hash chain; re-enable services in stages; watch for re-entry.

## Comms
- Internal: owners, counsel, DPO or contact point.
- ICO and data subjects: per Phase 3, wording approved by counsel.
- Customers in Iran: SMS and in-app; avoid detail that increases risk to them.
- Partners and suppliers: only what contracts require.

## Follow-up
Post-incident review within 5 working days (PROPOSED): root cause, detection gap, control changes, tests added. Update the threat model (ch. 28.1) and DPIA (docs/compliance/DPIA-draft.md). Independent penetration test status: not done in this build (docs/stages/STAGE-6.md).
