# syntax=docker/dockerfile:1
# One image for app, worker and migrate (different commands). See docs/platform/deployment.md.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Web app. Speech clips (Piper via uv/Python) add minutes and ~210 MB; JACKAPP_SKIP_SPEECH=1 skips them
# (the app then falls back to in-browser speech without bundled voices).
FROM deps AS web
ARG JACKAPP_SKIP_SPEECH=0
RUN if [ "$JACKAPP_SKIP_SPEECH" != "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
      && rm -rf /var/lib/apt/lists/*; fi
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=cache,target=/app/.voices \
    JACKAPP_SKIP_SPEECH=$JACKAPP_SKIP_SPEECH npm run build

FROM deps AS server
COPY . .
RUN npm run build:server

# Runtime: bundled server (no node_modules), built web app, migrations, poppler for PDF rendering.
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIST_DIR=/app/dist
WORKDIR /app
COPY --from=server /app/dist-server ./dist-server
# sharp is native and external to the bundle (worker image processing): install the locked version.
RUN npm install --no-save --no-audit --no-fund --omit=dev "sharp@$(cat dist-server/sharp-version)" \
    && npm cache clean --force
COPY --from=server /app/server/db/migrations ./server/db/migrations
COPY --from=web /app/dist ./dist
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist-server/main.js"]
