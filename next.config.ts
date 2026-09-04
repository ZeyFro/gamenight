import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
      {
        protocol: "https",
        hostname: "cdn.akamai.steamstatic.com",
      },
      {
        protocol: "https",
        hostname: "images.igdb.com",
      },
    ],
    // Infra (Sprint 5 suite, I1) — les covers IGDB/Steam se rechargeaient à
    // chaque visite : `next/image` sert déjà ces domaines via l'optimiseur
    // intégré (`remotePatterns` ci-dessus, en place depuis la 1ère PR), mais
    // sans `minimumCacheTTL` explicite l'optimiseur ne garde le fichier
    // optimisé en cache que quelques heures par défaut. Une cover IGDB/Steam
    // ne change quasiment jamais une fois résolue (même `igdbId`/`appid`
    // stable en base) — 30 jours de cache est un choix sûr, pas juste une
    // optimisation cosmétique.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
