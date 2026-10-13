import { isTournamentScoresEnabled } from "@/lib/tournament-scores";

export type GuideSection = { icon: string; title: string; lines: string[] };

/**
 * Sections ajoutées au guide (`/guide`) pour « Jouer maintenant » et les
 * tournois. Derrière le drapeau `GUIDE_V2_ENABLED` (éteint par défaut, actif
 * uniquement si la valeur vaut exactement `true`) : éteint, le guide garde ses
 * six sections d'origine.
 */
const EXTRA_SECTIONS: GuideSection[] = [
  {
    icon: "🎮",
    title: "Jouer maintenant",
    lines: [
      "Lance une session spontanée : choisis un jeu et les potes à prévenir.",
      "Les autres rejoignent librement, sans invitation préalable.",
      "La session se termine seule au bout de sa durée (3 h maximum).",
    ],
  },
  {
    icon: "⚔️",
    title: "Tournois",
    lines: [
      "Crée un tournoi sur un jeu et invite tes potes.",
      "Le créateur lance le tournoi, puis saisit les résultats.",
      "Le résultat final est annoncé et rapporte de l'XP.",
    ],
  },
];

export function guideSections(base: GuideSection[]): GuideSection[] {
  if (process.env.GUIDE_V2_ENABLED !== "true") return base;
  if (!isTournamentScoresEnabled()) return [...base, ...EXTRA_SECTIONS];
  return [
    ...base,
    ...EXTRA_SECTIONS.map((s) =>
      s.title === "Tournois"
        ? { ...s, lines: [...s.lines, "Tu peux ajouter le score du match (facultatif) : il s'affiche dans le bracket."] }
        : s
    ),
  ];
}
