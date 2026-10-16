import type { IgdbGameDetails } from "@/lib/igdb";

export interface CommunityQuizGame {
  name: string;
  details: IgdbGameDetails | null;
}

export interface CommunityGameQuizRound {
  answer: string;
  clues: string[];
}

export function buildCommunityGameQuizRound(
  games: CommunityQuizGame[],
  rng: () => number = Math.random
): CommunityGameQuizRound | null {
  const eligible = games.flatMap((game) => {
    const details = game.details;
    if (!details) return [];
    const facts = [
      details.genres?.[0] ? `Genre : ${details.genres[0]}` : null,
      details.themes?.[0] ? `Thème : ${details.themes[0]}` : details.platforms?.[0] ? `Plateforme : ${details.platforms[0]}` : null,
      details.developers?.[0] ? `Studio : ${details.developers[0]}` : details.publishers?.[0] ? `Éditeur : ${details.publishers[0]}` : null,
      details.releaseDate?.match(/^\d{4}/)?.[0] ? `Sorti en ${details.releaseDate.slice(0, 4)}` : null,
    ].filter((fact): fact is string => Boolean(fact));
    const clues = [...new Set(facts)].slice(0, 3);
    return clues.length === 3 ? [{ answer: game.name, clues }] : [];
  });

  if (eligible.length === 0) return null;
  return eligible[Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))];
}

export function normalizeGameAnswer(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function isCorrectGameAnswer(guess: string, answer: string): boolean {
  return normalizeGameAnswer(guess) === normalizeGameAnswer(answer);
}
