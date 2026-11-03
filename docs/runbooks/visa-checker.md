# Visa checker (ADR-0033)

## Turn on research
1. Developer Panel → Providers → **Visa research (Anthropic)** (card at the end): paste an Anthropic API key (`sk-ant-…`). Write-only, encrypted at rest, needs a fresh second factor. Without a key every answer stays *unconfirmed* (grey) with official links; nothing is guessed.
2. Admin → Visa → **Sources**: add official pages per destination (immigration authority, official eVisa/ETA portal, embassy). Tiers 1-5 can decide an answer; IATA and third-party sources are shown as "supporting" and never decide.
3. Settings `visa.ruleTtlDays` (default 14) and `visa.searchOfficialDomains` (default on: Claude's web search restricted to the official domains already known for the destination).

## Daily review
- Admin → Visa → **Overview**: stale rules, conflicts, failed runs (24 h), stale destinations.
- **Conflicts**: two official sources disagree. The customer sees *unconfirmed* until staff override with a reason and an official URL, or the sources agree on a later run.
- **Research runs**: each fetch with HTTP status (`HTTP_418`/`HTTP_403` = the site blocks automated readers; add a different official page or confirm by hand), dropped claims (quotes the model gave that were not on the page), tokens, errors.

## Overrides
An override needs a reason and at least one official URL; it is audited (`visa_rule.overridden`), research never overwrites it, and it shows to customers as confirmed by staff with that date. Withdraw (`visa_rule.withdrawn`) to hand the row back to research. Set an expiry on an override when the source has one.

## Cost and limits
One run per rule key at a time (job dedupe), at most 8 pages per run, one extraction call plus an optional search call on `claude-opus-5-5`. Customer checks: 20 per 10 minutes per user or IP; a fresh verification needs sign-in and is limited to once per 10 minutes per rule key per user.

## After deploying migration 0020
Clear Valkey `perm:*` so admin, owner and compliance officer pick up `visa.read` / `visa.write`.
