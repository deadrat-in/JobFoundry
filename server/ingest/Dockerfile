FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/ingest/package.json server/ingest/

RUN npm ci --omit=dev

COPY server/ingest/ server/ingest/

WORKDIR /app/server/ingest

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.mjs"]