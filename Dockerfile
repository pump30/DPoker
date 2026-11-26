# Stage 1: build
FROM node:20-alpine AS build

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.base.json tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src

RUN npm run build

# Stage 2: runtime
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini \
    && apk add --no-cache --virtual .build-deps python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && apk del .build-deps

COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/data"]

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
