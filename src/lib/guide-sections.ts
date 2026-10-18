import { isRoulettePlayerFilterEnabled } from "@/lib/roulette-draw";
import { isVoteVetoEnabled } from "@/lib/session-veto";
import { isTournamentScoresEnabled } from "@/lib/tournament-scores";
import { isSessionChroniclesEnabled } from "@/lib/session-chronicle-input";
import { isTournamentPredictionsEnabled } from "@/lib/tournament-prediction-rules";

export type GuideSection = { icon: string; title: string; lines: string[] };

/**
 * Le glossaire est toujours disponible dans le guide. « Jouer maintenant »
 * et les tournois restent derrière `GUIDE_V2_ENABLED`.
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
const GLOSSARY_SECTION: GuideSection = {
  icon: "📖",
  title: "Glossaire débutants",
  lines: [
    "Aggro : l’attention d’un ennemi. Prendre l’aggro, c’est devenir sa cible : préviens les potes si ça chauffe !",
    "Tank : le rôle qui encaisse et protège l’équipe. Reste près de lui quand les ennemis débarquent.",
    "GG : « Good game », ou « bien joué ». Un petit GG pour saluer la partie, même après une défaite.",
    "Carry : porter l’équipe vers la victoire grâce à une grosse performance. Pense à remercier les potes qui t’ont aidé !",
  ],
};

export function guideSections(input: GuideSection[]): GuideSection[] {
  const soireesLines = [
    ...(isSessionChroniclesEnabled() ? ["Après une soirée terminée, son créateur peut écrire une chronique privée. Les invités actifs la retrouvent dans Lore du groupe → Chroniques. Son texte conserve la soirée malgré le nettoyage automatique ; effacer la chronique permet à nouveau ce nettoyage."] : []),
    ...(process.env.SESSION_PREPARATION_ENABLED === "true" ? ["Sur une soirée prévue, chaque participant confirme pour lui-même : installé, mis à jour, micro testé et lobby prêt. La checklist affiche la préparation collective."] : []),
    ...(isVoteVetoEnabled() ? [VETO_LINE, ROULETTE_VETO_LINE] : []),
    ...(isRoulettePlayerFilterEnabled() ? [ROULETTE_FILTER_LINE] : []),
  ];
  const base = soireesLines.length
    ? input.map((s) => (s.title === "Soirées" ? { ...s, lines: [...s.lines, ...soireesLines] } : s))
    : input;
  const withGlossary = [...base, GLOSSARY_SECTION,
    ...(process.env.COMMUNITY_HIGHLIGHTS_ENABLED === "true" ? [{ icon: "🏆", title: "Exploits et fails", lines: ["Dans Profil → Lore du groupe → Exploits et fails, publie un souvenir du serveur avec une description et un lien HTTPS facultatif vers une image ou un clip. L’auteur et les modérateurs du serveur peuvent le modifier ou le supprimer."] }] : []),
  ];
  if (process.env.GUIDE_V2_ENABLED !== "true") return withGlossary;
  return [
    ...withGlossary,
    ...EXTRA_SECTIONS.map((s) =>
      s.title === "Tournois"
        ? { ...s, lines: [...s.lines,
          ...(isTournamentScoresEnabled() ? ["Tu peux ajouter le score du match (facultatif) : il s'affiche dans le bracket."] : []),
          ...(isTournamentPredictionsEnabled() ? ["Pronostique le champion avant le lancement, puis chaque match dont les deux joueurs sont connus avant son résultat. Un choix définitif par cible, sans mise ni gain d’XP."] : []),
        ] }
        : s
    ),
  ];
}
