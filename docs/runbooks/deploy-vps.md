# Deploy to a single VPS (staging or production)

Topology: `infra/compose.prod.yml` (caddy, migrate, seed, api, worker, web, console, mobile, postgres, valkey, clamav, storage; optional mailpit) behind `infra/caddy/Caddyfile` (booklet ch. 30.2). Secrets live only in `infra/.env.prod` on the server (booklet ch. 35.1 rule 6).

## Prerequisites

- Linux VPS, 4 GB RAM or more (the first build compiles the Next.js apps and Flutter web).
- Docker Engine and the compose plugin (`docker compose version`), outbound internet for the build (npm, GitHub, `storage.googleapis.com` for the Flutter SDK).
- Ports 80, 443/tcp and 443/udp open to the internet (ACME HTTP-01 and HTTP/3). Nothing else is published.
- Six DNS A records pointing at the server: web, api, admin, dev (Developer Panel), mobile, file storage (`WEB_HOST`, `API_HOST`, `ADMIN_HOST`, `DEV_HOST`, `MOBILE_HOST`, `STORAGE_HOST`). Caddy obtains the certificates on first request.

## First deploy

```sh
git clone <repo-url> unitravel && cd unitravel
cp infra/.env.prod.example infra/.env.prod && chmod 600 infra/.env.prod
$EDITOR infra/.env.prod        # hosts, APP_ENV, every CHANGE_ME (incl. REDIS_PASSWORD); generation commands are in the file
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml up -d --build
# Once, on a new database: the first owner (later staff are added in the Developer Panel).
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml run --rm seed node dist/create-owner.js --email you@yourdomain --name "First Last"
```

The API and worker refuse to start (and `docker compose logs api` lists why) while any secret is still a `CHANGE_ME` placeholder or too short, while `DATABASE_URL` points at a superuser or the schema owner, and in production while Valkey has no password or a public URL is not https (ADR-0017). The first owner signs in on the Admin Panel with an email code and sets up an authenticator on that first sign-in; if they later lose it, another owner uses Developer Panel > Users > Reset second factor.

Order is enforced by compose: postgres, migrate (owner role; creates `app_rw`/`app_ro` and sets their passwords from `DATABASE_URL`/`DATABASE_RO_URL`), seed (idempotent), then api and worker (they create the storage buckets, CORS and encryption on start). With a mail sink for staging add `--profile mail-sink` to every compose command and set `SMTP_URL=smtp://mailpit:1025`; the UI is on `127.0.0.1:8025` (tunnel with `ssh -L 8025:127.0.0.1:8025`).

Keep `MASTER_ENCRYPTION_KEY`, the JWT keys and `RUSTFS_SSE_S3_MASTER_KEY` backed up outside the server: losing them makes MFA secrets, provider credentials and identity scans unreadable.

## Smoke checks

```sh
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml ps        # migrate and seed: Exited (0); the rest Up/healthy
curl -fsS https://$API_HOST/health
curl -fsSI https://$WEB_HOST/en | head -1
curl -fsSI https://$ADMIN_HOST/ | head -1
curl -fsSI https://$DEV_HOST/ | head -1
curl -fsSI https://$MOBILE_HOST/ | head -1
```

All should answer 200 (the console may redirect to its sign-in page). The first request to each host can take a few seconds while the certificate is issued.

## Logs

```sh
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml logs -f --tail=100 api worker
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml logs migrate seed
```

## Update

```sh
git pull --ff-only
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml up -d --build
```

Migrations and the seed run again before api/worker are recreated. Take a database backup first when a migration is included ([backup-restore](backup-restore.md)).

## Rollback

Application only: `git checkout <previous-tag-or-sha>` and run the same `up -d --build`. Migrations are forward-only; if the release changed the schema, restore the pre-release database backup instead of rolling the code back alone ([backup-restore](backup-restore.md)).

## Backups

Postgres (`pg` volume) and object storage (`storage` volume) are the state; Valkey holds BullMQ jobs (AOF on). The `db-maintenance` service writes a nightly `pg_dump` to the `backups` volume (keeps `BACKUP_KEEP_DAYS`, default 14) and creates the coming months' audit and provider-call partitions; check it with `docker compose ... logs --tail 5 db-maintenance`. Copy the `backups` volume and the `storage` volume off the server on a schedule of your own. Procedure and restore test: [backup-restore](backup-restore.md).

## Test sign-in (staging only, until real email exists)

Prefer **`TEST_SIGN_IN=customers`** (ADR-0017): customer accounts sign in with an email alone, staff still need a code and their second factor. **`TEST_SIGN_IN=on` lets anyone sign in to any account, staff included, with an email address alone, with no OTP and no second factor.** It stays available on staging until real email (SMTP) is configured (owner, 27 Oct 2026; removal tracked in ADR-0014), because testers cannot receive codes otherwise. It is never allowed in production: the API refuses to start with `APP_ENV=production` and `TEST_SIGN_IN=on` (ADR-0012). Do not point real customers or real supplier credentials at a stack where it is on. Demo users are seeded only locally (ADR-0013): keep `SEED_DEMO=0` on every deployed host.

## Known limits

- Demo users (`owner@unitravel.example` and the others in `docs/LOCAL-DEV.md`) exist only on local stacks (ADR-0013). Keep `SEED_DEMO=0` on every deployed host; if an older deploy already seeded them, deactivate them in Developer Panel > Users.
- Pre-signed uploads go to `https://$STORAGE_HOST`, which Caddy routes to the bundled `storage` service. With managed S3, set `OBJECT_STORAGE_ENDPOINT` and `OBJECT_STORAGE_PUBLIC_ENDPOINT` instead.
