# syntax=docker/dockerfile:1.7
# Flutter web build of the mobile app, served as static files with SPA fallback. Build context: apps/mobile.
# FLUTTER_VERSION matches the Dart constraint in pubspec.yaml (sdk ^3.13.1 -> Flutter 3.47.x).
FROM debian:bookworm-slim AS build
ARG FLUTTER_VERSION=3.47.1
ARG API_URL
ARG WEB_URL
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV FLUTTER_ROOT=/opt/flutter PATH=/opt/flutter/bin:$PATH CI=true
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git ${FLUTTER_ROOT} \
 && git config --global --add safe.directory ${FLUTTER_ROOT} \
 && flutter config --no-analytics --enable-web && flutter precache --web
WORKDIR /app
COPY pubspec.yaml pubspec.lock ./
COPY packages ./packages
RUN flutter pub get
COPY . .
RUN flutter pub get && flutter build web --release --no-web-resources-cdn \
    --dart-define=API_URL=${API_URL:?build arg API_URL} --dart-define=WEB_URL=${WEB_URL:?build arg WEB_URL}

FROM caddy:2.10-alpine
RUN printf '{\n\tadmin off\n\tauto_https off\n}\n:80 {\n\troot * /srv\n\tencode zstd gzip\n\ttry_files {path} /index.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
COPY --from=build /app/build/web /srv
EXPOSE 80
