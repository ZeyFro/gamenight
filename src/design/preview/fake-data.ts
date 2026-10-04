/**
 * Données FICTIVES de l'écran de prévisualisation. Rien ne vient de la base,
 * ni de l'utilisateur connecté : prénoms inventés, chiffres figés (chaînes
 * déjà formatées, pour un rendu identique serveur/client). À remplacer par de
 * vraies données seulement quand l'accueil sera réellement migré.
 */

export const ME = { name: "Léo", level: 14, rank: "Diamant II", nextRank: "Diamant III" } as const;

export const NEXT_SESSION = {
  when: "Vendredi · 20 h 30",
  countdown: "Dans 2 j 4 h",
  game: "Mario Kart 8 Deluxe",
  confirmed: 4,
  total: 6,
  attendees: ["Maëlys", "Théo", "Inès", "Nolan"],
} as const;

export const XP = { current: 2450, target: 3000, currentLabel: "2 450", targetLabel: "3 000", missingLabel: "550" } as const;

export const STATS = {
  streak: { value: "6", hint: "soirées d'affilée" },
  wins: { value: "23", delta: "+3 ce mois-ci" },
} as const;

export interface LeaderboardRow {
  rank: number;
  name: string;
  xp: string;
  isMe?: boolean;
}

export const LEADERBOARD: readonly LeaderboardRow[] = [
  { rank: 1, name: "Maëlys", xp: "3 890" },
  { rank: 2, name: "Théo", xp: "3 410" },
  { rank: 3, name: "Inès", xp: "2 980" },
  { rank: 4, name: "Léo", xp: "2 450", isMe: true },
  { rank: 5, name: "Nolan", xp: "1 720" },
];

export type FriendStatus = "playing" | "online" | "away";

export interface Friend {
  name: string;
  status: FriendStatus;
  label: string;
}

export const FRIENDS: readonly Friend[] = [
  { name: "Théo", status: "playing", label: "En jeu · Rocket League" },
  { name: "Camille", status: "online", label: "En ligne" },
  { name: "Inès", status: "online", label: "En ligne" },
  { name: "Nolan", status: "away", label: "Vu il y a 2 h" },
];

export const WEEKLY_CHALLENGE = {
  title: "Gagne 3 parties de Mario Kart",
  done: 2,
  total: 3,
  reward: "+150 XP",
} as const;

export const SHEET_OPTIONS = [
  { id: "quick", title: "Lancer une partie rapide", hint: "Choisis un jeu, tes potes sont prévenus" },
  { id: "invite", title: "Inviter les potes en ligne", hint: "3 potes sont connectés en ce moment" },
  { id: "roulette", title: "Tirer un jeu au sort", hint: "La roulette décide pour vous" },
] as const;
