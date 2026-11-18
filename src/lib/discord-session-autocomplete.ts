import { z } from "zod";
import { resolveSessionContext, loadUpcomingSessions, type SessionView } from "@/lib/discord-session-commands";

/**
 * Autocomplétion de `/soiree voir|rejoindre|quitter`.
 *
 * Réutilise `loadUpcomingSessions` : l'accessibilité (organisateur, invités,
 * communauté) est donc exactement celle de `/soiree liste`, sans requête
 * parallèle. Les choix ne contiennent jamais d'identifiant Discord ni d'e-mail ;
 * la valeur reste l'identifiant de la soirée, relu avant toute écriture.
 */
const MAX_CHOICES = 25;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const MODES = ["voir", "rejoindre", "quitter"] as const;
export type SessionAutocompleteMode = (typeof MODES)[number];

const schema = z.object({
  type: z.literal(4),
  application_id: snowflake,
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake }).optional() }).optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("soiree"),
    options: z
      .array(
        z.object({
          name: z.string().min(1).max(40),
          focused: z.boolean().optional(),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
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

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export interface SessionChoice {
  name: string;
  value: string;
}

/** Nombre de places réellement libres ; `null` quand la capacité est illimitée. */
export function remainingSeats(session: SessionView): number | null {
  const taken = session.invitees.length + 1; // +1 : l'organisateur occupe une place.
  return session.capacity === null ? null : Math.max(0, session.capacity - taken);
}

export function filterSessionCandidates(sessions: SessionView[], query: string): SessionView[] {
  const normalize = (value: string) =>
    value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
  const needle = normalize(query);
  if (!needle) return sessions;
  return sessions.filter((session) =>
    normalize(`${session.game ?? "jeu a definir"} ${session.creatorName}`).includes(needle)
  );
}

export function toSessionChoices(sessions: SessionView[], mode: SessionAutocompleteMode): SessionChoice[] {
  return sessions
    .filter((session) => (mode === "rejoindre" ? !session.isCreator && !session.isInvited : true))
    .filter((session) => (mode === "quitter" ? session.isInvited : true))
    .slice(0, MAX_CHOICES)
    .map((session) => {
      const seats = remainingSeats(session);
      const places = seats === null ? `${session.invitees.length + 1} participant(s)` : `${seats} place(s) libre(s)`;
      return {
        name: `${session.game ?? "jeu à définir"} · ${dateFormatter.format(session.date)} · ${places}`.slice(0, 100),
        value: session.id,
      };
    });
}

/** Réponse d'autocomplétion (type 8). Aucune écriture, aucun accès avant validation. */
export async function buildSessionAutocompleteResponse(body: unknown, timestamp: string | null) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { status: 400 as const };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID ||
    !interaction.guild_id
  ) {
    return { status: 400 as const };
  }
  const sub = interaction.data.options?.[0];
  if (!sub || !(MODES as readonly string[]).includes(sub.name)) return { status: 400 as const };
  const mode = sub.name as SessionAutocompleteMode;

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 as const };
  const context = await resolveSessionContext({ guildId: interaction.guild_id, discordId });
  if (context.status !== "OK") return { status: 200 as const, body: { type: 8, data: { choices: [] } } };

  const focused = sub.options?.find((option) => option.focused)?.value;
  const query = typeof focused === "string" ? focused : "";
  const sessions = await loadUpcomingSessions({ userId: context.userId, communityId: context.communityId });
  return {
    status: 200 as const,
    body: { type: 8, data: { choices: toSessionChoices(filterSessionCandidates(sessions, query), mode) } },
  };
}
