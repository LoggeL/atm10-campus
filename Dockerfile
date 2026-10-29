FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
# Runs as uid 1000 (node) like the Minecraft server, so the world mount stays read-only and readable.
USER node
ENV PORT=3000 DATA_DIR=/data WORLD_DIR=/minecraft/atm10/data/world
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
