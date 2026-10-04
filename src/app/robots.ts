import type { MetadataRoute } from "next";

/**
 * GameNight est réservé aux potes connectés : aucune page n'a vocation à être
 * indexée par un moteur de recherche. `Disallow: /` demande aux robots
 * respectueux de ne rien explorer (ce n'est pas un contrôle d'accès : l'accès
 * reste protégé par la connexion).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
