# Data Protection Impact Assessment (DPIA): UniTravel platform

**DRAFT — requires DPO/counsel review.** Not legal advice and not approved. Structure follows the ICO DPIA template. Source of truth: implementation booklet (docs/booklet.txt), chiefly ch. 4.7, 8, 25, 27, 28 and 30. Labels used in the booklet are kept: items marked UNKNOWN, PROPOSED or INFERRED have not been verified and must be resolved before sign-off.

Booklet ch. 28.6 states a DPIA is required before launch because of passport data, sanctions screening, data about people in Iran and international transfers.

| Field | Value |
|---|---|
| Controller | Uni Travel (ch. 28.6). Legal entity details: UNKNOWN (decision U-2, ch. 34.1) |
| DPO or contact point | UNKNOWN; to be named |
| ICO registration and fee | Required (ch. 28.6); status UNKNOWN (Stage 0, ch. 31.2) |
| Version / date | Draft 0.1, 23 Oct 2026 |
| Reviewers | Counsel and DPO: not yet reviewed |

## 1. Need for a DPIA

The processing combines several triggers: special handling of identity documents (passport numbers), automated screening of individuals against sanctions lists with effects on service availability, processing about people in or connected with Iran (potentially vulnerable, with safety consequences if data is disclosed), and transfers of phone numbers and message content to processors outside the UK, including Iranian SMS providers. A DPIA is required by the booklet (ch. 28.6) and is good practice under UK GDPR Art. 35.

## 2. Description of the processing

### 2.1 Nature
UniTravel is a request-based travel and cargo service (ch. 1.2). Customers search itineraries without an account, sign in with a one-time code (ch. 25.1), submit flight and cargo requests, receive quotes, supply traveller details after a quote is accepted, and track progress. Staff (admins, cargo, compliance, developers, owners) handle requests in the Admin and Developer Panels. Staff reserve and ticket in existing tools and record the results; no online payments in v1 (D-03, ch. 1.3).

### 2.2 Data and data subjects
| Category | Examples | Data subjects | Notes |
|---|---|---|---|
| Account and contact | Phone number, email, name (Latin and Persian), locale | Customers, travellers | Phone verified by OTP |
| Traveller identity | Date of birth, nationality, passport/ID number, expiry, issuing country | Travellers (may differ from the account holder; may be minors) | Collected only after a quote is accepted (ch. 28.6). Passport number AES-256-GCM field-encrypted with key id; only last4 in clear; decrypted only by the audited Reveal action (ch. 28.3) |
| Request and booking | Routes, dates, quotes, reservations, tickets, payment status, messages and notes | Customers | Free-text may contain unexpected data; medical details discouraged (ch. 28.6) |
| Passport scans (Phase B, ADR-0005) | Image of the passport photo page: face, name, number, date of birth, nationality | Travellers (may differ from the account holder; may be minors) | Uploaded by the customer; JPEG or PNG only; virus-scanned, camera and location metadata stripped before it is available; stored in a separate private bucket with server-side encryption (SSE-S3); opened only by holders of `customer.read.documents`, every open audited. A passport photo is a facial image: biometric data only if processed for unique identification, which the platform does not do (UNKNOWN: counsel to confirm). |
| Address (Phase B) | Residential address lines, city, postcode, country | Customers | Optional (owner decision 9); requested only when an invoice or a cargo request needs it |
| Quotations and invoices (Phase C, ADR-0006) | Document number, request reference, line descriptions and amounts, bill-to name and address (if given), issue and expiry dates, status history, generated PDF | Customers | The email vendor is unchanged (existing sender; Brevo listed, not contracted). Email carries the document number and a short link, never the PDF or an amount; the link needs a sign-in. Without a verified email the same notice goes by SMS (number and link only) and in-app. PDFs sit in the private document bucket and open through 5-minute signed URLs after an ownership check. Company registration, VAT and address printed on the PDFs are UNKNOWN until the accountant answers (owner decision 5). Retention of invoices (statutory accounting period): UNKNOWN, accountant and counsel |
| Online card payment (Phase D, ADR-0007, test mode only) | Checkout Session id, PaymentIntent and charge ids, amount, currency, payer name as given to Stripe (else the customer's name), payment and refund status, webhook event ids and types. **No card number, expiry or CVC ever reaches Uni Travel**: the card form is Stripe's embedded checkout in Stripe's frames | Customers | Stripe Payments Europe/Stripe, Inc. acts as processor (and independent controller for its own fraud and compliance duties: counsel to confirm the roles). The feature flag is off by default and live mode is blocked in code, so no real cardholder data is processed today. Stripe keys are encrypted at rest, write-only. Stripe event rows store ids, types and outcomes, not payloads. Retention of payment records follows the accounting period: UNKNOWN (accountant, counsel) |
| Cargo | Consignor, consignee, goods descriptions, documents | Customers, third-party consignees | Documents scanned for malware; private object storage |
| Screening | Names, nationalities used for matching; matches, cases, decisions, list versions | Customers, travellers, consignees, partners | Names only for matching; no inference of ethnicity or religion |
| Technical | IP address, device id, session records, OTP challenge records, audit log | All users, staff | Logs redact phone numbers, emails, names, document numbers, OTP codes, tokens (ch. 28.5) |
| Staff | Staff identity, roles, TOTP secrets (encrypted), passkeys, audit actions | Employees | |

Special category data is not collected deliberately (ch. 28.6). Nationality and travel patterns may nevertheless correlate with protected characteristics; see risks.

### 2.3 Scope
Volume targets are not stated in the booklet: UNKNOWN. Geography: UK customers and customers in Iran, Türkiye, Armenia and EU countries (ch. 1.1, U-3). Retention follows the proposal in ch. 28.6 (schedule below), which counsel has not yet approved.

### 2.4 Context
Customers include people in Iran for whom disclosure could carry personal risk; they are reachable only by constrained channels during shutdowns (ch. 8.5). Expectations: customers expect travel data to be used to arrange travel and for legal checks. Sanctions strict liability (ch. 1.1) drives mandatory screening.

### 2.5 Purposes and lawful bases (ch. 28.6)
| Purpose | Lawful basis (proposed, counsel to confirm) |
|---|---|
| Handling requests, quotes and bookings | Contract (Art. 6(1)(b)) |
| Sanctions screening, record keeping | Legal obligation (Art. 6(1)(c)) |
| Fraud prevention, service security, OTP abuse controls | Legitimate interests (Art. 6(1)(f)); assessment to be written |
| Marketing | Consent only; not part of v1 scope as built |
| Passport numbers | Contract and legal obligation; no special category condition needed unless Art. 9 data are present |

### 2.6 Processors and transfers
Controller-processor agreements are required with hosting, SMS, push and email providers (ch. 28.6). Status of every agreement: UNKNOWN (Stage 0). A processor register is to be kept in docs/ (ch. 28.6; docs/vendors.md is referenced by ch. 30.1, not yet created).
| Processor / recipient | Role | Data | Location per booklet | Status |
|---|---|---|---|---|
| Hosting (UK/EU; Hetzner non-German region possible, OVHcloud after terms review; DigitalOcean unsuitable; Vercel not used) | Hosting, database, backups, object storage | All | Region UNKNOWN (ch. 30.1, 34.4) | Selection and terms UNKNOWN |
| Kavenegar, SMS.ir | SMS to +98 numbers (OTP and notifications) | Phone number, message content | Iran | Contract route and payment to be confirmed with counsel (ch. 8.6); terms for foreign customers UNKNOWN (ch. 34.4) |
| Sinch (Stockholm) or Infobip (London) | SMS elsewhere | Phone number, message content | EU/UK per booklet; Iranian number support UNKNOWN | Sanctions terms to be confirmed in writing |
| Stripe (Payments Europe Ltd / Stripe, Inc.) | Card payments, refunds, disputes (test mode only until live is approved) | Payer name, amount, currency, ids, card data entered in Stripe's own form (not seen by us), email if the customer enters one at checkout | Ireland/US per Stripe terms (UNKNOWN until the agreement is reviewed) | **BLOCKED for live**: Stripe's written approval for this business and counsel's advice on sanctions exposure, Iran-connected customers and the processor/controller roles are outstanding. Data processing agreement and transfer mechanism UNKNOWN |
| Brevo (Paris), fallback Mailjet | Email | Email address, message content | EU | Customer organisation must not be Iran-based (ch. 8.3) |
| Expo (iOS and Android outside Iran), Pushy (Android in Iran, pilot) | Push | Device token, notification text | Not stated in booklet | Delivery inside Iran UNKNOWN (ch. 34.4); processing terms UNKNOWN |
| Flight suppliers (Amadeus, Duffel) | Search and, in later stages, booking | Search criteria; passenger data at booking (Stage 7) | Not stated | Contracts BLOCKED/pending (STAGE-0.md) |
| Sanctions list publishers (UK FCDO, OFAC, EU) | Source of list data | None sent (lists fetched; no personal data transmitted) | | |
| Cargo partners | Fulfilment | Consignor, consignee, goods details | Varies | Due diligence needed (ch. 14.8) |

International transfers: phone numbers and message content sent to an Iranian provider, and data held by any non-UK processor, are restricted transfers needing a documented basis and risk assessment; Iran has no UK adequacy decision (INFERRED; counsel to confirm, ch. 28.6). Mechanisms to evaluate: Art. 49 derogations (e.g. necessity for the contract, explicit consent) versus alternatives; transfer risk assessment; data minimisation in SMS bodies.

### 2.7 Retention (ch. 28.6, proposal for counsel)
| Data | Retention |
|---|---|
| Search queries and results | 30 days (aggregates anonymised) |
| Supplier call payloads | 14 days |
| OTP challenges | 90 days |
| Requests, quotes, reservations, tickets, payments | 6 years after travel or closure, then deleted or anonymised |
| Passport numbers | Until 12 months after last travel date unless the customer keeps the profile |
| Passport scans (ADR-0005) | **UNKNOWN** (owner decision 7, DPIA owner to set). The platform has a configurable `identityScanRetentionDays` setting (Developer Panel, settings), default unset: while unset, scans are kept until the customer replaces or deletes the traveller, or deletes the account, and no automatic deletion runs. When set, a daily maintenance job deletes the stored object and marks the row erased for scans older than that many days from upload. A replaced scan is deleted at once |
| Compliance screenings, cases, decisions, list versions | 6 years after the relationship ends |
| Audit log | 6 years (partition dropped) |
| Application logs | 30 days |
| Backups | 35 days rolling |

Implementation status of automated deletion jobs for each row has not been verified in this draft: check before sign-off. Passport-scan retention is the one row with an implemented job (inactive until a value is set).

### 2.8 Data flows
Customer devices -> Caddy edge (TLS 1.2+, HSTS) -> web/console/api -> PostgreSQL, Valkey (queues, rate-limit state), object storage (documents, signed URLs of 5 minutes) -> processors above. Worker sends SMS, email and push via the notification router; the inbox is always written first. Compliance module downloads public lists and screens locally; no customer data is sent to list publishers.

## 3. Consultation

| Who | Status |
|---|---|
| DPO / data protection contact | To be named; review pending |
| Counsel | Questions in ch. 4.8 (including Iranian SMS providers and screening standards) owed; position on D-01 represented as policy data awaiting sign-off |
| Customers or representatives | Not consulted. Consider a small panel of Iran-connected users or a diaspora organisation (PROPOSED) |
| Processors | Security and sanctions terms to be requested from each vendor |
| Information security | Independent penetration test pending (not done in this build; see STAGE-6.md) |
| ICO | Prior consultation (Art. 36) only if residual risk stays high after measures |

## 4. Necessity and proportionality

- Lawful basis and purpose limitation: see 2.5. Data used for travel service, legal compliance and security only.
- Minimisation: passport details only after quote acceptance; search without account; free-text medical details discouraged; logs redacted; names only for screening.
- Accuracy: customers edit profiles; staff can request information through the AWAITING_CUSTOMER step; travellers' document validity checked at acceptance.
- Storage limitation: schedule in 2.7.
- Transparency: privacy notice to be written (owner of Persian copy: UNKNOWN, ch. 34.1 U-6); notices in English and Persian at collection points.
- Data subject rights: self-service export and deletion request, staff workflow with a 30-day clock; deletion respects legal retention (ch. 28.6).
- Automated decision-making: sanctions screening flags matches and holds requests for human decision (COMPLIANCE_HOLD, cases decided by compliance staff); no purely automated adverse decision, except the policy rule that blocks Iranian carriers (a service restriction, not a decision about the person). Art. 22 analysis to be confirmed by counsel.
- Processor compliance: agreements and sanctions clauses (Stage 0).
- International transfers: see 2.6.

## 5. Risks to individuals

Likelihood and severity are the author's initial assessment (Remote / Possible / Probable; Minimal / Significant / Severe), for the DPO to challenge. Residual risk is assessed after the measures in section 6.

| # | Risk | Likelihood | Severity | Inherent | Measures (section 6) | Residual |
|---|---|---|---|---|---|---|
| R1 | Passport or identity-document disclosure leads to identity fraud | Possible | Severe | High | M1, M2, M3, M4 | Medium |
| R2 | Disclosure of identities or travel plans of people in Iran creating personal risk | Possible | Severe | High | M1-M5, M16 | Medium |
| R3 | SMS content or phone numbers exposed at an Iranian provider or on Iranian networks | Probable | Significant | High | M6, M7 | Medium (accepted only with counsel sign-off) |
| R4 | Restricted transfer without a valid basis or risk assessment | Possible | Significant | Medium | M6, M7, M15 | Low if completed |
| R5 | False positive sanctions match causes unfair refusal or delay | Possible | Significant | Medium | M8, M9 | Low-Medium |
| R6 | Screening bias against Persian/Arabic names (transliteration variance) | Possible | Significant | Medium | M8, M9 | Medium |
| R7 | False negative: missed designated party (legal exposure, not a rights risk per se) | Remote | Severe | Medium | M8, M10 | Low |
| R8 | Insider browsing of customer data | Possible | Significant | Medium | M2, M11 | Low |
| R9 | Account takeover (SIM swap, OTP interception) exposes bookings and documents | Possible | Significant | Medium | M12 | Low-Medium |
| R10 | SMS pumping and abuse create data and cost exposure | Probable | Minimal | Medium | M12 | Low |
| R11 | Excess retention or inability to delete | Possible | Significant | Medium | M13 | Low if implemented |
| R12 | Backup or log leakage | Remote | Severe | Medium | M3, M4, M14 | Low |
| R13 | Customers unreachable during shutdowns miss time-critical notices | Probable | Significant | High | M5, M16 | Medium |
| R14 | Incident not notified within 72 hours | Remote | Significant | Low-Medium | M17 | Low |
| R15 | Third-party consignee or traveller data collected without their knowledge | Probable | Minimal | Medium | M18 | Low |
| R16 | Processor changes terms or excludes Iran; data stranded | Possible | Significant | Medium | M15 | Medium |

## 6. Measures to address risk

Implemented measures cite the platform; planned ones are marked.

| # | Measure | Status |
|---|---|---|
| M1 | Field-level AES-256-GCM encryption for passport/ID numbers, TOTP secrets and provider credentials, with key id for rotation; only last4 in clear (ch. 28.3) | Implemented |
| M2 | Reveal-on-click with audit and permission scoping; periodic access reviews (ch. 28.1) | Reveal and audit implemented; access reviews are a process owed by Uni Travel |
| M3 | Database and backups encrypted; private buckets; signed URLs of 5 minutes (ch. 28.3) | Design; hosting-level controls UNKNOWN until host chosen |
| M4 | Least-privilege database roles; insert-only audit grants; append-only hash-chained audit log; log redaction (ch. 28.5) | Implemented |
| M5 | Fail-soft channels: inbox first, SMS and polling fallback, alternative contacts, honest status (ch. 8.5) | Implemented in part; Iran push delivery UNKNOWN |
| M6 | Data minimisation in SMS (no passport data, short bodies); +98 only via Iranian providers; transfer risk assessment | Routing rule implemented; assessment PLANNED |
| M7 | Counsel decision on Iranian SMS providers (ch. 4.8) and written vendor terms | OWED |
| M8 | Matcher tuned and evaluated (recall >= 0.98 on labelled true pairs; common-name false positives kept below threshold; real false positive found and fixed, STAGE-6.md); human review of every flag | Implemented |
| M9 | Case workflow with reason codes and a customer message | Implemented; review and complaints wording to be written |
| M10 | Live list ingestion every 6 hours with failure alerts (runbook sanctions-ingestion-failure) | Implemented |
| M11 | Role-based access with server-side permission guards, permission matrix test over every route and role, fail-closed routes (ch. 32.3) | Implemented and tested |
| M12 | OTP limits, proof-of-work challenge, country allowlist, staff second factor, session revocation (ch. 25) | Implemented |
| M13 | Retention schedule and deletion/anonymisation jobs; data subject export/deletion workflow | Schedule PROPOSED; job coverage to verify |
| M14 | Backup encryption with separate key; restore tested (scripts/backup-restore-drill.sh; ch. 30.6) | Drill implemented; production backups PLANNED |
| M15 | Processor register, DPAs, sanctions clause review, exit plan per vendor | OWED |
| M16 | Plain-language bilingual notices; no detail in SMS beyond need | Templates seeded (en/fa); wording review owed |
| M17 | Incident response runbook with ICO 72-hour steps (docs/runbooks/security-incident.md) | Drafted |
| M18 | Privacy notice covers third-party data; collect only what the service needs | Notice owed |
| M19 | Online card payment: test mode only, feature flag off by default, live mode impossible in code (domain constant, database CHECK, key-prefix refusal), eligibility policy as compliance data (default deny), webhook signature verified on the raw body, events deduplicated, only verified events settle an invoice, refunds with four-eyes above the existing threshold, audit of refunds and mode changes (ADR-0007) | Implemented (test mode); live BLOCKED |

## 7. Sign-off and outcomes

| Item | Name / date | Notes |
|---|---|---|
| Measures approved by | [placeholder] | Integrate actions into build and process plan |
| Residual risks approved by | [placeholder] | If high residual risk remains, consult the ICO before processing (Art. 36) |
| DPO advice provided | [placeholder] | DPO to advise on compliance, measures and whether processing can proceed |
| Summary of DPO advice | [placeholder] | |
| DPO advice accepted or overruled by | [placeholder] | If overruled, record reasons |
| Consultation responses reviewed by | [placeholder] | If decision departs from individuals' views, record reasons |
| This DPIA will be kept under review by | [placeholder] | Review at each release that adds data categories, processors or countries |

### Open actions before sign-off
1. Name the DPO or contact point; confirm ICO registration and fee (Stage 0).
2. Counsel to confirm lawful bases, Art. 22 position, Art. 49 or other transfer mechanism for Iranian SMS routes, and the retention schedule.
3. Obtain and review processor agreements and sanctions terms for hosting, SMS, push and email; build the processor register.
4. Choose hosting region and provider (UNKNOWN); document backup encryption key custody.
5. Verify deletion/anonymisation jobs against 2.7.
6. Complete the independent penetration test and review findings (not done in this build).
7. Write the Persian and English privacy notices.
8. Set the passport-scan retention period (`identityScanRetentionDays`) or record why scans are kept longer; confirm with counsel whether passport photos are biometric data in this use (ADR-0005, owner decision 7). Status: UNKNOWN.
9. Review who needs `customer.read.documents` (passport scans and Reveal): `cargo_admin` holds it from table 10.1 and can open scans (audited). Candidate for removal at the next access review (ch. 28.1).
