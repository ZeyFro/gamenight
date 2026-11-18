import { prisma } from "@/lib/prisma";
import { filterTeamGameOptions, uniqueTeamGameOptions, type TeamGameOption } from "@/app/equipes/game-picker-rules";

export type GameLookup =
  | { kind: "FOUND"; id: string; name: string }
  | { kind: "NONE" }
  | { kind: "AMBIGUOUS"; names: string[] };

/** Réutilise les règles du sélecteur de jeu du site (dédup + recherche sans accent). */
export async function resolveGameId(query: string): Promise<GameLookup> {
  if (!query.trim()) return { kind: "NONE" };
  const games = await prisma.game.findMany({
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const choices: TeamGameOption[] = uniqueTeamGameOptions(games);
  const needle = query.trim().toLocaleLowerCase("fr-FR");
  const exact = choices.filter((game) => game.name.toLocaleLowerCase("fr-FR") === needle);
  if (exact.length === 1) return { kind: "FOUND", id: exact[0].id, name: exact[0].name };
  const matches = filterTeamGameOptions(choices, query);
  if (matches.length === 1) return { kind: "FOUND", id: matches[0].id, name: matches[0].name };
  if (matches.length === 0) return { kind: "NONE" };
  return { kind: "AMBIGUOUS", names: matches.slice(0, 5).map((game) => game.name) };
}
