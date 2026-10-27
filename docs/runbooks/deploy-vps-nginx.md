# Deploy behind an existing host nginx (shared VPS)

Variant of [deploy-vps](deploy-vps.md) for a server where nginx already owns ports 80/443 and other sites run beside
UniTravel. The bundled Caddy is disabled (`infra/compose.vps.yml`); containers listen on `127.0.0.1:3080-3085` only;
nginx terminates TLS with certbot certificates and routes by host and path.

## Hosts (three public domains, plus the Developer Panel)

| Host | Serves | Upstream |
|---|---|---|
| `demo.unitravels.co.uk` (`WEB_HOST`) | Customer website `/en`, `/fa` | web `:3080` |
| | `/unitravel-documents*`: pre-signed S3 uploads/downloads (`STORAGE_HOST`) | storage `:3084` |
| `admin.unitravels.co.uk` (`ADMIN_HOST`) | Admin Panel | console `:3081` |
| `mobile.unitravels.co.uk` (`MOBILE_HOST`, also `API_HOST`) | `/`: device-frame shell (`infra/mobile-shell`); phones and windows under 640 px are sent straight to `/app/` | mobile `:3083` |
| | `/app/`: Flutter web build (hash routes) | mobile `:3083` |
| | `/v1/*`, `/health`: public API (same origin as the app, so no CORS) | api `:3082` |
| `dev.unitravels.co.uk` (`DEV_HOST`) | Developer Panel | console `:3081` |

The website and console reach the API server-side through their own `/api` proxy, so only the Flutter app uses the
public `/v1` path. Stripe and SMS webhooks resolve to `https://$API_HOST/v1/webhooks/...`.

**Developer Panel.** The console and the API serve the Developer Panel only on `DEV_HOST`, never on the admin host
(ch. 16.1, 29.2). Add a DNS A record for `dev.unitravels.co.uk`, then run `scripts/vps-deploy.sh nginx`: it issues
the certificate and enables the host. Until then the deploy script skips that host.

## First deploy / update

```sh
git clone https://github.com/Abyys001/UNITRAVEL.git /root/UniTravel && cd /root/UniTravel
scripts/vps-deploy.sh                 # first run writes infra/.env.prod with fresh secrets (chmod 600)
```

On later runs (`git pull --ff-only && scripts/vps-deploy.sh`) the script keeps `infra/.env.prod`, rebuilds, restarts
(migrate and seed run first) and rewrites the nginx site. Other commands:

```sh
scripts/vps-deploy.sh status          # container state + HTTPS smoke checks
scripts/vps-deploy.sh nginx           # only rewrite nginx (template: infra/nginx/unitravel.conf.template) and certificates
```

To override the hosts on a fresh server, set `WEB_HOST`, `ADMIN_HOST`, `MOBILE_HOST`, `DEV_HOST` and `ACME_EMAIL` in
the environment before the first run. If `MOBILE_HOST` changes, regenerate the QR code in `infra/mobile-shell/index.html`.

Compose by hand:
```sh
docker compose --env-file infra/.env.prod -f infra/compose.prod.yml -f infra/compose.vps.yml --profile mail-sink <cmd>
```

## Current configuration (staging)

- `APP_ENV=staging`: demo users are seeded (`owner@unitravel.example` and the rest of the list in [LOCAL-DEV](../LOCAL-DEV.md)).
- `TEST_SIGN_IN=on` (ADR-0012): anyone who can reach a host can sign in as any account, staff included, with an
  email address alone. Test data only. Set `TEST_SIGN_IN=off` and run `scripts/vps-deploy.sh` before any real data.
- Mail goes to Mailpit, not to real inboxes: `ssh -L 3085:127.0.0.1:3085 <server>`, then open http://localhost:3085.
  Set `SMTP_URL` to a real relay for real email OTPs.
- The FAKE flight supplier is refused outside `local` (CLAUDE.md rule 2), so flight searches return results only
  after real supplier credentials are added in the Developer Panel.
- Back up `MASTER_ENCRYPTION_KEY`, `JWT_PRIVATE_KEY` and `RUSTFS_SSE_S3_MASTER_KEY` from `infra/.env.prod` off the server.

## Certificates

certbot (webroot `/var/www/acme`, served for any host by the nginx default site) issues them. The system
`certbot.timer` renews them, and `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` reloads nginx afterwards.
