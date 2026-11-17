import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveTournamentContext } from "@/lib/discord-tournament-commands";

/**
 * Autocomplétion de `/tournoi inscription|desinscription`.
 *
 * Adaptateur ISOLÉ : `src/lib/discord-interactions.ts` est réservé par #408,
 * donc le routage des interactions de type 4 n'est pas branché ici. Le module
 * est complet et testé ; le patch `docs/patches/20261117-autocomplete-routage.patch`
 * montre les trois lignes à ajouter côté routeur pour l'activer.
 *
 * Choix proposés :
 * - `inscription` : tournois en `REGISTRATION` de la communauté, où le joueur
 *   n'est pas encore inscrit et où il reste de la place ;
 * - `desinscription` : tournois en `REGISTRATION` où le joueur est inscrit.
 *
 * Un joueur ne peut donc jamais sélectionner — ni inscrire — quelqu'un d'autre :
 * l'identité vient de `resolveTournamentContext` (session Discord + base), pas
 * du choix renvoyé par le navigateur Discord.
 */
const MAX_CHOICES = 25;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);

const autocompleteSchema = z.object({
  type: z.literal(4),
  application_id: snowflake,
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake }).optional() }).optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("tournoi"),
    options: z
      .array(
        z.object({
          name: z.string().min(1).max(40),
          type: z.number().optional(),
          focused: z.boolean().optional(),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                type: z.number().optional(),
                value: z.union([z.string(), z.number()]).optional(),
                focused: z.boolean().optional(),
              })
            )
            .max(2)
            .optional(),
        })
      )
      .max(1)
      .optional(),
  }),
});

export type AutocompleteMode = "inscription" | "desinscription";

export interface TournamentChoice {
  name: string;
  value: string;
}

interface CandidateRow {
  id: string;
  name: string;
  status: string;
  maxPlayers: number;
  game: { name: string };
  _count: { participants: number };
}

/** Recherche insensible aux accents et à la casse, comme le sélecteur du site. */
export function filterTournamentCandidates(rows: CandidateRow[], query: string): CandidateRow[] {
  const normalize = (value: string) =>
    value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
  const needle = normalize(query);
  if (!needle) return rows;
  return rows.filter((row) => normalize(`${row.name} ${row.game.name}`).includes(needle));
}

export async function listAutocompleteCandidates(input: {
  communityId: string;
  userId: string;
  mode: AutocompleteMode;
}): Promise<CandidateRow[]> {
  const rows = await prisma.tournament.findMany({
    where: {
      communityId: input.communityId,
      status: "REGISTRATION",
      participants: input.mode === "inscription" ? { none: { userId: input.userId } } : { some: { userId: input.userId } },
    },
    select: {
      id: true,
      name: true,
      status: true,
      maxPlayers: true,
      game: { select: { name: true } },
      _count: { select: { participants: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: MAX_CHOICES,
  });
  return rows;
}

export function toTournamentChoices(rows: CandidateRow[], mode: AutocompleteMode): TournamentChoice[] {
  return rows
    .filter((row) => (mode === "inscription" ? row._count.participants < row.maxPlayers : true))
    .slice(0, MAX_CHOICES)
    .map((row) => ({
      // La valeur reste l'identifiant : le handler relit l'état réel avant d'écrire.
      name: `${row.name} · ${row.game.name} · ${row._count.participants}/${row.maxPlayers}`.slice(0, 100),
      value: row.id,
    }));
}

/** Réponse d'autocomplétion (type 8). Aucune écriture. */
export async function buildAutocompleteResponse(body: unknown, timestamp: string | null) {
  const parsed = autocompleteSchema.safeParse(body);
  if (!parsed.success) return { status: 400 as const };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID
  ) {
    return { status: 400 as const };
  }
  const sub = interaction.data.options?.[0];
  if (sub?.name !== "inscription" && sub?.name !== "desinscription") return { status: 400 as const };
  const mode: AutocompleteMode = sub.name;
  if (!interaction.guild_id) return { status: 400 as const };

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 as const };
  const context = await resolveTournamentContext({ guildId: interaction.guild_id, discordId });
  if (context.status !== "OK") return { status: 200 as const, body: { type: 8, data: { choices: [] } } };

  const focused = sub?.options?.find((option) => option.focused)?.value;
  const query = typeof focused === "string" ? focused : "";
  const rows = await listAutocompleteCandidates({
    communityId: context.communityId,
    userId: context.userId,
    mode,
  });
  return {
    status: 200 as const,
    body: { type: 8, data: { choices: toTournamentChoices(filterTournamentCandidates(rows, query), mode) } },
  };
}
