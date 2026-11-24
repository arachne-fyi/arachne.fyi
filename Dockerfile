# One image for the server and the built dashboard. Works on x86 PCs and on a Raspberry Pi 5
# (arm64): there are no native modules, SQLite comes with Node itself (node:sqlite).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    PORT=8787
WORKDIR /app/server
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist /app/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
