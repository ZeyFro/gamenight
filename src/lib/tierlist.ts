import type { Tier } from "@prisma/client";

/** Ordre d'affichage S en haut, D en bas — cohérent avec une tierlist classique. */
export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

/**
 * Une seule teinte (l'accent violet de l'app) déclinée en intensité
 * décroissante de S à D, plutôt qu'un jeu de 5 couleurs arbitraires — le
 * rouge/destructive est volontairement réservé aux actions destructives
 * ailleurs dans l'app (voir le commentaire sur `--accent` dans
 * globals.css), donc pas de rouge/vert ici.
 */
export const TIER_INTENSITY_CLASSES: Record<Tier, string> = {
  S: "bg-accent text-accent-foreground",
  A: "bg-accent/70 text-accent-foreground",
  B: "bg-accent/45 text-foreground",
  C: "bg-accent/25 text-foreground",
  D: "bg-accent/10 text-foreground",
};
