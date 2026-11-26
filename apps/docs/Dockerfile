# The docs site (usefileway.dev) as a static export served by nginx. Build
# from the repository root:
#   docker build -f apps/docs/Dockerfile -t fileway-docs .

FROM node:22-alpine AS build
WORKDIR /repo
# git: the lastModified plugin reads each page's commit date (sitemap dates).
RUN apk add --no-cache git && corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@fileway/docs..."
ENV NEXT_TELEMETRY_DISABLED=1
# Umami's website ID (public, set by CI). Empty: the site is built without analytics.
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID=""
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID
RUN pnpm --filter @fileway/docs build

FROM nginx:1.27-alpine
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/docs/out /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
