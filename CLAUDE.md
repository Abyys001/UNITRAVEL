# UniTravel: project rules for AI sessions

Read `docs/PLAN.md` first (scope, stack, ports, progress). The full specification is the implementation booklet in `docs/booklet.txt`; grep it by chapter number (for example `13.3`, `27.4`). Cite chapters when you report. Deviations from the booklet need a short ADR in `docs/adr/` before code (ch. 35.1 rule 10); existing ADRs: 0001 stack, 0002 Flutter, 0003 state machine interpretations.

## Rules (booklet ch. 35.1, condensed)
1. **Stack.** Engineering-kit stack plus approved additions (ADR-0001). No .NET, microservices or extra infrastructure without a stated requirement and owner approval. The booklet's "no Flutter" clause is superseded by ADR-0002: mobile is Flutter.
2. **Data integrity.** Never display fabricated, scraped or unverified flights as options. No scraping, undocumented endpoints, or bypassing authentication, bot detection or rate limits. Fake data only through the FAKE adapter, which is local/test only and must never run in production.
3. **Truth model.** Keep search result, offer snapshot, request, quote, reservation, ticket and payment separate. Never infer baggage or fare conditions: they are tri-state (known / not included / UNKNOWN) and an UNKNOWN attribute blocks sending a quote. Payment success never implies a booking.
4. **Authority.** All permission and state decisions live in the backend. Every protected route declares a permission (the route table is tested fail-closed and by the permission matrix). Check ownership on every customer lookup; return 404 on failure. State changes go through the domain state machines (`packages/domain`), never free-form status updates.
5. **Compliance.** Never weaken or bypass carrier, party, goods or lane policies in code. Policies are data, changed by authorised staff with the required approvals (Iran carriers BLOCK, Iran lanes disabled pending counsel). Do not hard-code overrides, allowlists or "temporary" bypasses.
6. **Secrets.** Never in code, commits, logs, fixtures, reports or screenshots. Provider credentials are write-only through the Developer Panel; the only committed secret-like value is the local demo TOTP secret (seeded only when `APP_ENV=local`).
7. **Evidence labels.** Report findings as OBSERVED, DOCUMENTED, INFERRED, UNKNOWN or BLOCKED. Anything the booklet marks UNKNOWN/PROPOSED/counsel-owed stays marked; do not invent facts about Uni Travel's business.
8. **Discovery tasks** are read-only (no form submissions, bookings, payments, installs).
9. **Gates.** The booklet says to stop at each stage gate. The owner's instruction on 22 Oct 2026 (docs/PLAN.md) replaced this with a recorded verification per stage in `docs/stages/STAGE-N.md`. Do not start a stage that is not in the plan without asking.
10. **Change control.** ADR before deviating from the booklet.

## Working method (ch. 35.2)
- Update the Zod contract and invariant tests first (state machines, engine), then implement; small vertical slices.
- `packages/domain` and `packages/engine` stay free of framework imports.
- Update the OpenAPI document, permission catalogue and en/fa message catalogues in the same change as the code.
- Every new feature that users see needs Persian (RTL) and English strings.

## Practicalities
- Run and test: `docs/LOCAL-DEV.md`. Start and stop local processes only with `scripts/svc.sh` (pid files in `.run/`); never `pkill` patterns.
- Rebuild the API after changes: `cd apps/api && npx tsc -p tsconfig.build.json`, then `scripts/svc.sh restart api worker`.
- Wrap noisy commands in `rtk`.
- Never commit unless the user asks. Docs live under `docs/`; do not scatter notes elsewhere.
- Operations: `docs/runbooks/`. Data protection: `docs/compliance/DPIA-draft.md`. Open external items: `docs/stages/STAGE-0.md`.
- UI work follows `docs/design/DESIGN.md` (and the kit UI policy referenced there); no Google services (fonts, maps, reCAPTCHA) on user-facing paths; fonts are self-hosted.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- Mandatory for every session and subagent: run `graphify query "<question>"` before your first grep, search or source-file read, and put this rule in every subagent prompt. A hook (`scripts/graphify-gate.py`) denies code searches and reads until the agent has queried. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- A background watcher rebuilds the graph from code changes, including uncommitted edits, within a few minutes of files going quiet. Run `graphify update .` yourself only if you need your edit in the graph sooner.
- When the session-start message reports changed documents, run `/graphify . --update` before other work, then `rm graphify-out/needs_update`.
- Use grep for exact strings once the graph has located the area. How the graph stays current: `docs/runbooks/graphify.md`.
