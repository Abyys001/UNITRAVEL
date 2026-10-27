# ADR-0016 · Customer club (باشگاه مشتریان)

Status: accepted (owner instruction, 27 Oct 2026: "admin adds customers, gives discounts and bonuses"). Spec: `docs/CONTENT-MENU-LIVE-DATA.md` §4.4, decision O12. Flag `loyalty.enabled`, default off.

## Context

The owner wants staff to enrol customers in a club and give them discounts and bonuses. Invoice amounts are frozen after issue (ADR-0006), customers see no amounts before a sent quote (ADR-0004), supplier prices must never be altered, and the VAT treatment of discounts is UNKNOWN (accountant).

## Decision

- **Tables** (migration 0011): `loyalty_tiers`, `loyalty_members` (one row per user; ACTIVE, SUSPENDED, REMOVED), `loyalty_benefits` (DISCOUNT_PERCENT, DISCOUNT_FIXED, BONUS_CREDIT, PERK; for one tier or one member; validity window; status), and `loyalty_ledger`, insert-only like the audit log (credit granted, used, expired, reversed).
- **Permissions**: `loyalty.read` (staff), `loyalty.manage` (privileged), `loyalty.benefit.approve` (privileged), `loyalty.read.own` (customer, for `/club`). Every change is audited.
- **Four eyes**: a benefit whose value is above the existing refund four-eyes threshold (DISCOUNT_FIXED, BONUS_CREDIT) or any DISCOUNT_PERCENT above 10 starts `PENDING_APPROVAL` and must be approved by a different holder of `loyalty.benefit.approve`.
- **Money only through a quote line**: staff apply a benefit while building a quotation, as its own line («تخفیف باشگاه مشتریان» / "Customer club discount") that names the benefit. Supplier prices are never changed; issued invoices are never changed; bonus credit has no cash value, cannot be withdrawn and is used only by staff on an invoice, which writes a `USED` ledger entry.
- **Customer**: `/club` shows tier, active benefits and credit balance; non-members see a short explanation. Adding someone sends an inbox and email notice. Marketing consent stays separate and is not implied by membership.

## Consequences

- VAT on discounted invoices is UNKNOWN until the accountant answers (O12); until then discounts are shown as a separate line and the invoice total is the net amount.
- With the flag off nothing is visible to customers and the console hides the club pages.
