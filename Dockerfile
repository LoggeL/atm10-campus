FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
# Runs as nobody: the world mounts (owned by uid 1000, mode 644/755) are readable but not writable.
RUN mkdir -p /data && chown 65534:65534 /data
USER 65534:65534
ENV PORT=3000 DATA_DIR=/data WORLD_DIR=/worlds/live
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
