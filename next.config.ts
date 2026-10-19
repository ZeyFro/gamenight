import type { NextConfig } from "next";
import { buildCsp, isCspReportEnabled } from "./src/lib/csp-policy";

// CSP en Report-Only : observée dans la console du navigateur avant de
// devenir bloquante. `'unsafe-inline'` (scripts/styles) : Next injecte des
// scripts inline sans nonce — à resserrer avec des nonces si on passe en
// mode bloquant. `img-src https:` : covers IGDB/Steam, avatars Discord et
// bannières déjà enregistrées sur d'anciens hôtes.
const isDev = process.env.NODE_ENV !== "production";
const csp = buildCsp({ isDev, reportEnabled: isCspReportEnabled() });

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
      // Fix bug remonté (bannières GIF invisibles) — klipy.com est un
      // hébergeur de GIF possible pour une bannière de profil
      // (`User.bannerUrl`, URL externe arbitraire). N'empêche PAS le
      // blocage `Cross-Origin-Resource-Policy` que klipy.com pose déjà
      // sur ses réponses (hors de notre contrôle, voir
      // `BannerImage.tsx`) — ajouté par cohérence si une future feature a
      // besoin de charger un GIF klipy.com via `next/image`.
      {
        protocol: "https",
        hostname: "klipy.com",
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
