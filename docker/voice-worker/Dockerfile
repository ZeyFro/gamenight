# Image du worker de présence vocale (hôte auto-hébergé).
# Contexte de build = racine du dépôt : docker build -f docker/voice-worker/Dockerfile .
# Aucun secret n'est copié ni intégré : toutes les variables arrivent à l'exécution.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
# Jamais `npm run build` : il lance `prisma migrate deploy`. Pas de DATABASE_URL au build.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    VOICE_PRESENCE_WORKER_MODE=standalone \
    VOICE_PRESENCE_ENABLED=false
COPY --from=build --chown=root:root /app /app
# Code en lecture seule pour l'utilisateur d'exécution ; seul le cache Next est inscriptible.
RUN chmod -R go-w /app && install -d -o node -g node -m 0750 /app/.next/cache
USER node
# Le serveur n'écoute que sur 127.0.0.1:3000 : le test est une connexion TCP locale.
# Le serveur ne démarre qu'après l'enregistrement du worker (voir scripts/gamenight-server.mjs).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "const s=require('node:net').connect(3000,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),4000)"]
STOPSIGNAL SIGTERM
CMD ["node", "scripts/gamenight-server.mjs"]
