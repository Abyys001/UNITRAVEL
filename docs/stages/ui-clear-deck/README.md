# Console rebuild "Clear deck": verification (2026-10-25)

Owner request (2026-10-25): the admin panel and its sidebar were cluttered and hard to read; rebuild the console front end
completely without reducing access, and fix other parts with the same problems. Direction: docs/design/DESIGN.md, "Console rebuild: Clear deck".

## What changed
- Shell (`components/shell.tsx`, `admin-frame.tsx`, `dev-frame.tsx`): flat rail of destinations (Admin: Home, Requests, Compliance,
  Identity checks, Invoices, Flight search; Developer: Health, People, Integrations, Configuration, Settings & flags, Audit log);
  related pages are hub tabs under the header; full-height navy rail; light top bar; phone bottom bar + More sheet.
- Access: every nav item and tab keeps its previous `can(...)` check; all old URLs still resolve; backend authorisation unchanged.
  Removed from the rail only: duplicates (queue tabs, saved views, account), which remain on the Requests page / user menu / palette.
- Shared list kit `components/data-list.tsx` (toolbar, chips, pager, `.data-table`); quieter `.cap`, pill `Tag`, roomier `PageHead`.
- Pages rebuilt: admin dashboard (one counts strip, no repeated numbers), request/cargo/customer/quote workspaces (header summary,
  primary next command, unavailable commands in a collapsed disclosure with the server's reason), queues, compliance cases /
  policies (type + status chips, paged) / lists / case, verifications, invoices, staff search, all Developer Panel pages
  (health verdict first, paged users/audit/templates/dead letters, config step flow).

## Verification (OBSERVED)
| Check | Result |
|---|---|
| `tsc --noEmit` (console) | 0 errors |
| `next build` (console) | ok |
| Console functional e2e `console.spec.ts` (live API) | 15/15 passed |
| Visual + axe (WCAG 2.2 AA serious/critical) `visual.spec.ts`, en/fa × desktop/phone, 18 screens | 72/72 passed, snapshots re-baselined on purpose |
| `@unitravel/ui` tests (tokens up to date) | passed |

Fixed during verification: chip counts below 4.5:1 (opacity removed), small "Dead letters" links below the 24 px target size.

## Open (UNKNOWN / follow-up)
- Persian strings added by this change are machine-drafted; a native review is owed.
- Older page copy that was English-only stays English-only (pre-existing; not regressed).
- Customer web/mobile audit done (report in the session); targeted cleanup proposed, not yet approved.
