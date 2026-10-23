# syntax=docker/dockerfile:1.7
# One build for the whole workspace; targets: api (also the worker), migrate, web, console (booklet ch. 30.2).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ARG APPS="api web console"
RUN pnpm --filter "./packages/*" run build \
 && for a in $APPS; do [ -d apps/$a ] && pnpm --filter @unitravel/$a run build; done \
 && pnpm --filter @unitravel/api deploy --prod --legacy /out/api \
 && pnpm --filter @unitravel/db deploy --prod --legacy /out/db

FROM node:24-slim AS runtime-base
ENV NODE_ENV=production
RUN useradd --system --uid 10001 app
WORKDIR /app

# The API image also runs the worker: `node dist/main.worker.js` (separate deployment, same artefact).
FROM runtime-base AS api
COPY --from=build --chown=app /out/api ./
USER app
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.api.js"]

# Runs migrations and grants with the owner role, then exits (a release step, never part of app start-up).
FROM runtime-base AS migrate
COPY --from=build --chown=app /out/db ./
COPY --from=build --chown=app /repo/packages/db/migrations ./migrations
USER app
CMD ["node", "dist/migrate.js"]

FROM runtime-base AS web
COPY --from=build --chown=app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
ENV PORT=4000 HOSTNAME=0.0.0.0
EXPOSE 4000
CMD ["node", "apps/web/server.js"]

FROM runtime-base AS console
COPY --from=build --chown=app /repo/apps/console/.next/standalone ./
COPY --from=build --chown=app /repo/apps/console/.next/static ./apps/console/.next/static
USER app
ENV PORT=4200 HOSTNAME=0.0.0.0
EXPOSE 4200
CMD ["node", "apps/console/server.js"]
