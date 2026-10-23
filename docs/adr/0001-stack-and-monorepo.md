# ADR-0001 · Stack, monorepo and approved additions (decision D-06)

Status: accepted (owner instruction, 22 Oct 2026)

The booklet (ch. 18.5) lists the Engineering Kit stack plus proposals. The owner told us to use the kit stack,
"updating it if necessary". Decisions:

| Proposal | Decision | Why |
|---|---|---|
| pnpm workspaces + Turborepo | Accepted | Shared packages (contracts, domain, engine) need one dependency graph and cached builds |
| Zod contracts + OpenAPI from schemas | Accepted | Kit already does Zod 4 → OpenAPI 3.1 (`backend/http/zod.ts`) |
| TanStack Query | Accepted | Kit default |
| Pino + OpenTelemetry | Accepted | Kit `backend/logging` |
| Docker Compose + Caddy | Accepted | Kit infra default |
| Expo / React Native | **Rejected → Flutter** | The kit's mobile stack is Flutter + go_router (`starters/flutter-app`, `kit_ui`). The booklet assumed the kit "excluded Flutter"; the actual kit prescribes it. See ADR-0002 |
| Valkey instead of Redis | Accepted | Kit infra uses Valkey 8 (BSD-3, Redis-protocol compatible) |
| RustFS for local S3 | Accepted | Kit infra; production uses any S3-compatible EU bucket |
| Better Auth (kit) | **Not used** | Booklet ch. 25 specifies phone OTP, EdDSA JWT with `perm_version`, rotating refresh families and staff step-up. Implemented directly in `modules/identity` |
| Stripe (kit) | Parked | Decision D-03 |
