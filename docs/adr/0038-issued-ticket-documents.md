# ADR-0038 · Issued ticket documents: provider PDFs, branded wrapper, code-integrity check

Status: accepted. Requested by the owner on 19 Nov 2026 (brief "Implement Flight Ticket Issuing System – Admin Dashboard"); plan and decisions approved the same day. Stage record: `docs/stages/STAGE-29.md`.

ADR-0006 (commercial documents), ADR-0026 (mobile paused) and booklet 13.7 (tickets are issued in external tools, then recorded) stay in force.

## Context
- Tickets are bought from airlines, consolidators and agencies outside the platform. The provider's PDF (e-ticket receipt or boarding pass) carries the PNR, ticket numbers and, for boarding passes, a QR / PDF417 / Aztec code in IATA BCBP format. We do not issue airline tickets and must never generate or alter those codes. (DOCUMENTED, booklet 13.7)
- `tickets` holds one ISSUED 13-digit ticket per traveller with a single `documentId`. That field cannot track replace or reissue, and the console never sends a PDF. (OBSERVED)
- The documents pipeline already gives presigned upload, ClamAV scan, magic-byte check, sha256, publish and signed download. It has no staff-on-behalf upload and no write-once guard. (OBSERVED)
- `EmailSender` accepts attachments, but the notification pipeline passes only one. Email delivery tracking stops at SENT/FAILED unless the provider reports more. (OBSERVED)
- No QR or barcode library exists in the repo. (OBSERVED)

## Decisions

| # | Decision |
|---|---|
| D1 | New aggregate **ticket document** (`ticket_documents` plus `ticket_document_travellers`). It belongs to a flight request and reservation, has kind E_TICKET or BOARDING_PASS, a version, `supersedes_id`, and status DRAFT → ISSUED → SUPERSEDED or REVOKED, driven by a domain state machine in `packages/domain`. A single provider PDF may cover several travellers. `tickets.documentId` stays for compatibility and points at the current branded file. |
| D2 | **Originals are write-once.** They are stored under the `tickets/original/` key prefix. Storage refuses to overwrite a key that exists. The sha256 recorded at upload is checked again before every download, and a mismatch fails closed (an integrity alert is audited). Replace and reissue create a new version. No row and no object is ever updated in place. |
| D3 | **Branded wrapper.** Page 1 is a cover drawn with pdf-lib: logo, company particulars from settings, customer, passengers, segments, PNR and ticket numbers. The provider's pages follow, copied with `copyPages` so their content streams and images are carried over unchanged, and the original file is also embedded byte-for-byte as a PDF attachment. If the original is signed (`/Sig` or `/ByteRange`), encrypted or fails D4, the branded file is the cover only. Every delivery and portal view always offers the unchanged original as its own file. |
| D4 | **Code-integrity check before issue.** `pdfjs-dist` with `@napi-rs/canvas` renders every page of the original and of the branded file. `zxing-wasm` decodes QR, PDF417, Aztec, Data Matrix and 1-D codes. Issue is blocked (409 `CODE_INTEGRITY_FAILED`) unless every code found in the original is found with identical bytes in the branded file. The result is stored on the version. The PNR and ticket numbers entered by staff are also matched against the PDF text, and any mismatch is shown as a warning that staff must acknowledge. The portal's "show QR" is an enlarged crop rendered from the original page. A code is never re-encoded. |
| D5 | **Records first.** If the request lacks a reservation or tickets, the issue wizard runs the existing `record_reservation` and `record_tickets` commands with all their validation (locator format, 13-digit prefix, payment rule). It never writes `tickets` directly. |
| D6 | **Delivery.** The `ticket.issued` email goes to the customer account holder, with the branded file and the original attached. Staff can add one passenger email per issue, stored with the delivery and audited. Resend uses the same templates. Each send is a `notification_deliveries` row linked to the version. If Brevo is configured, its webhook moves the delivery to DELIVERED or BOUNCED. Otherwise SENT is the last known state. |
| D7 | **Branding.** Settings gain `company.logoDocumentId` (PNG or SVG, uploaded by the owner) plus brand colours. The bundled brand mark is the default. |
| D8 | **Permissions.** `ticket.document.issue` (upload, preview, issue, replace, reissue, revoke) and `ticket.document.resend` go to the admin and owner roles. Reading uses `ticket.record` for staff. Customers see only their own requests, and any other lookup returns 404. Every staff and customer download is audited. |

## Consequences
- Three runtime dependencies: `pdfjs-dist`, `@napi-rs/canvas` (a prebuilt native canvas, so no system packages are needed in the image) and `zxing-wasm`. `bwip-js` is a dev dependency used only to build test fixtures. No existing dependency can render PDFs or decode codes.
- A passing D4 proves that the codes are byte-identical and machine-readable after processing. Acceptance by a specific airport scanner stays UNKNOWN until a live pass is tried.
- Agency e-ticket receipts usually carry no gate-scannable code. Gate-usable passes come from the airline at check-in and are uploaded as BOARDING_PASS. (INFERRED)
