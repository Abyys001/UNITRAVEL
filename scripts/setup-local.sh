#!/usr/bin/env bash
# One command from a fresh clone to a running local stack (docs/LOCAL-DEV.md):
#   scripts/setup-local.sh            infra + install + build + migrate + seed + api/worker, then waits for /ready
#   scripts/setup-local.sh --all      also builds and starts the website and the console
# Safe to re-run: .env is created once, migrations and the seed are idempotent, services are restarted.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
ALL=0; [ "${1:-}" = "--all" ] && ALL=1
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is required"
docker info >/dev/null 2>&1 || die "The Docker daemon is not running"
command -v pnpm >/dev/null || die "pnpm is required (corepack enable)"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || die "Node.js 22 or newer is required"

if [ ! -f .env ]; then
  log "Creating .env from .env.example (local-only placeholders; a fresh storage encryption key)"
  umask 077
  sed "s|^RUSTFS_SSE_S3_MASTER_KEY=.*|RUSTFS_SSE_S3_MASTER_KEY=$(openssl rand -base64 32)|" .env.example > .env
fi
grep -q '^APP_ENV=local' .env || die ".env is not a local configuration (APP_ENV must be local); this script is for development machines"
set -a; . ./.env; set +a

log "Starting PostgreSQL, Valkey, object storage and Mailpit"
docker compose --env-file .env -f infra/compose.dev.yml up -d
for _ in $(seq 1 60); do
  docker compose --env-file .env -f infra/compose.dev.yml exec -T postgres pg_isready -q 2>/dev/null && break; sleep 1
done

log "Installing dependencies"
pnpm install --frozen-lockfile
log "Building shared packages"
pnpm --filter "./packages/*" run build
log "Migrating and seeding the database"
pnpm db:migrate
pnpm db:seed
log "Building the API"
(cd apps/api && npx tsc -p tsconfig.build.json)
services=(api worker)
if [ "$ALL" = 1 ]; then
  log "Building the website and the console"
  pnpm --filter @unitravel/web build
  pnpm --filter @unitravel/console build
  services+=(web console)
fi
scripts/svc.sh restart "${services[@]}"

log "Waiting for the API"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${PORT:-4100}/ready" 2>/dev/null | grep -q '"ready":true'; then
    log "Ready. API http://localhost:${PORT:-4100}  Mailpit http://localhost:8035  Logs .run/*.log"
    [ "$ALL" = 1 ] && log "Website http://localhost:4000/en  Admin http://admin.localhost:4200  Developer http://dev.localhost:4200"
    log "Demo sign-in addresses: docs/LOCAL-DEV.md (Signing in)"
    exit 0
  fi
  sleep 1
done
tail -20 .run/api.log >&2
die "The API did not become ready; see .run/api.log"
