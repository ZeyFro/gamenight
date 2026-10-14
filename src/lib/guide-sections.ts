import { isRoulettePlayerFilterEnabled } from "@/lib/roulette-draw";
import { isVoteVetoEnabled } from "@/lib/session-veto";
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

const VETO_LINE = "Un veto par soirée : les vetos sont anonymes (seul leur nombre est affiché) ; le jeu vetoé ne peut pas être retenu (sauf si c'est le dernier possible).";

const ROULETTE_VETO_LINE = "Roulette : tant que la soirée n'a pas eu lieu, chaque participant peut vetoer le jeu tiré une fois ; la roue relance sans lui.";
const ROULETTE_FILTER_LINE = "Roulette : seuls les jeux qui acceptent le nombre de joueurs sont tirés (sinon, tous les jeux).";

export function guideSections(input: GuideSection[]): GuideSection[] {
  const soireesLines = [
    ...(isVoteVetoEnabled() ? [VETO_LINE, ROULETTE_VETO_LINE] : []),
    ...(isRoulettePlayerFilterEnabled() ? [ROULETTE_FILTER_LINE] : []),
  ];
  const base = soireesLines.length
    ? input.map((s) => (s.title === "Soirées" ? { ...s, lines: [...s.lines, ...soireesLines] } : s))
    : input;
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
