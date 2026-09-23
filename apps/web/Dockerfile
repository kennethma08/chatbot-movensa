FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/widget/package.json apps/widget/package.json
RUN pnpm install --frozen-lockfile --filter @movensa/web... --filter @movensa/widget... --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/widget apps/widget
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_API_URL
ARG VITE_WIDGET_URL
RUN pnpm --filter @movensa/shared build && pnpm --filter @movensa/web build && pnpm --filter @movensa/widget build && mkdir -p apps/web/dist/widget && cp apps/widget/dist/movensa-widget.js apps/web/dist/widget/movensa-widget.js

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
