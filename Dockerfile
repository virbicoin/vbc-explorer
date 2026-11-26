# VBC Explorer: one image for the web app and the sync tools (see docker-compose.yml).
#
# config.json is read at build time (page metadata, image hosts) and at run time, so create
# it from config.example.json before building. Secrets (MONGODB_URI) come from the
# environment, never from the image (.dockerignore keeps .env files out).
FROM node:24-bookworm-slim

WORKDIR /app

# mongodb-memory-server is a test dependency; do not download a MongoDB binary into the image
ENV NEXT_TELEMETRY_DISABLED=1 \
    MONGOMS_DISABLE_POSTINSTALL=1

COPY package.json package-lock.json ./
# Dev dependencies stay: the background jobs and the tools run through tsx
RUN npm ci --include=dev && npm cache clean --force

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
