import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import { accessibleSessionWhereFor, getSessionAccessRole, inviteToSession, revokeSessionInvite } from "@/lib/session-access";
import { createVotingSessionInTransaction } from "@/lib/session-creation";
import { resolveSessionSchedule } from "@/lib/session-schedule";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, parseDateAndTime } from "@/lib/wallclock";
import { resolveGameId } from "@/lib/discord-team-commands";
import { gameNightLine } from "@/lib/discord-links";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/soiree` — soirées GameNight, pilotées depuis Discord.
 *
 * AUCUN second système : la soirée créée ici est une `Session` ordinaire
 * (statut `VOTING`), créée par `createVotingSessionInTransaction` — la même
 * fonction que le formulaire `/sessions` — et les inscriptions sont des
 * `SessionInvite` `ACTIVE`, exactement les lignes écrites par le site. Les
 * soirées créées depuis Discord sont donc visibles, votables et gérables dans
 * GameNight, et inversement.
 *
 * Choix explicites :
 * - le jeu demandé devient une `Proposal` du créateur (la soirée reste en vote,
 *   comme sur le site ; on ne force pas un `decidedGameId` sans clôture) ;
 * - la fenêtre de vote passe par `resolveSessionSchedule` (règles existantes :
 *   refus d'une soirée trop proche, deadline ajustée) ;
 * - `announceViaBot: false` : une commande Discord ne déclenche aucune annonce
 *   ni notification en masse dans cette v1 ;
 * - capacité : `Session.attendanceCapacity` (le champ existant), contrôlée à
 *   l'inscription ; jamais un compteur parallèle ;
 * - fuseau : les dates/heures sont interprétées par `parseDateAndTime`, donc
 *   dans le fuseau de l'application (Europe/Paris), pas celui du serveur.
 *
 * Ce qui n'existe pas dans le modèle et n'est donc pas accepté ici : un titre
 * et une description libres de soirée. Les ajouter exigerait une migration
 * (`Session.title`, `Session.description`) — bloquée sans autorisation.
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const MAX_LISTED = 10;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);

const SUBCOMMANDS = ["liste", "voir", "creer", "rejoindre", "quitter"] as const;
const WRITE_SUBCOMMANDS = new Set<string>(["creer", "rejoindre", "quitter"]);

const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z
    .object({
      user: z.object({ id: snowflake, username: z.string().min(1).max(100), bot: z.literal(false).optional() }).optional(),
    })
    .optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("soiree"),
    options: z
      .array(
        z.object({
          name: z.enum(SUBCOMMANDS),
          type: z.literal(1).optional(),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                type: z.number().optional(),
                value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
              })
            )
            .max(6)
            .optional(),
        })
      )
      .max(1)
      .optional(),
  }),
});

const quiet = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

export function sessionCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_SESSION_COMMAND_ENABLED === "true";
}

/** Écritures (création, inscription, désinscription) : interrupteur distinct. */
export function sessionWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_SESSION_WRITE_ENABLED === "true";
}

/** Soirée telle que lue par `/soiree` — aucune donnée privée hors communauté. */
export interface SessionView {
  id: string;
  date: Date;
  status: string;
  statusLabel: string;
  game: string | null;
  proposals: number;
  creatorName: string;
  invitees: string[];
  capacity: number | null;
  isCreator: boolean;
  isInvited: boolean;
}

export type SessionContext =
  | { status: "OK"; userId: string; communityId: string; communityName: string }
  | { status: "NOT_MEMBER" }
  | { status: "INVALID" };

/** Contexte serveur : serveur Discord → communauté GameNight → membre actif. */
export async function resolveSessionContext(input: {
  guildId: string;
  discordId: string;
}): Promise<SessionContext> {
  const parsed = z.object({ guildId: snowflake, discordId: snowflake }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  const community = await prisma.community.findFirst({
    where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!community) return { status: "NOT_MEMBER" };
  const user = await prisma.user.findUnique({ where: { discordId: parsed.data.discordId }, select: { id: true } });
  if (!user) return { status: "NOT_MEMBER" };
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };
  return { status: "OK", userId: user.id, communityId: community.id, communityName: community.name };
}

const sessionSelect = {
  id: true,
  date: true,
  status: true,
  attendanceCapacity: true,
  createdById: true,
  createdBy: { select: { discordName: true } },
  decidedGame: { select: { name: true } },
  _count: { select: { proposals: true, invites: { where: { status: "ACTIVE" as const } } } },
  invites: { where: { status: "ACTIVE" as const }, select: { userId: true, user: { select: { discordName: true } } } },
} as const;

type SessionRow = {
  id: string;
  date: Date;
  status: string;
  attendanceCapacity: number | null;
  createdById: string;
  createdBy: { discordName: string };
  decidedGame: { name: string } | null;
  _count: { proposals: number; invites: number };
  invites: Array<{ userId: string; user: { discordName: string } }>;
};

function toView(row: SessionRow, userId: string): SessionView {
  return {
    id: row.id,
    date: row.date,
    status: row.status,
    statusLabel: SESSION_STATUS_LABELS[row.status as keyof typeof SESSION_STATUS_LABELS]?.label ?? row.status,
    game: row.decidedGame?.name ?? null,
    proposals: row._count.proposals,
    creatorName: row.createdBy.discordName,
    invitees: row.invites.map((invite) => invite.user.discordName),
    capacity: row.attendanceCapacity,
    isCreator: row.createdById === userId,
    isInvited: row.invites.some((invite) => invite.userId === userId),
  };
}

/** Prochaines soirées accessibles : créateur ou invité ACTIF (règle du site). */
export async function loadUpcomingSessions(input: {
  userId: string;
  communityId: string;
  now?: Date;
}): Promise<SessionView[]> {
  const rows = await prisma.session.findMany({
    where: {
      AND: [
        await accessibleSessionWhereFor(input.userId),
        { communityId: input.communityId },
        { status: { in: ["VOTING", "SCHEDULED"] } },
        { date: { gte: input.now ?? new Date() } },
      ],
    },
    select: sessionSelect,
    orderBy: { date: "asc" },
    take: MAX_LISTED,
  });
  return rows.map((row) => toView(row as SessionRow, input.userId));
}

/** Détail d'une soirée — refusé (null) si l'accès n'est pas établi côté serveur. */
export async function loadSessionDetail(input: { userId: string; sessionId: string }): Promise<SessionView | null> {
  if (!z.string().min(1).max(40).safeParse(input.sessionId).success) return null;
  if (!(await getSessionAccessRole(input.userId, input.sessionId))) return null;
  const row = await prisma.session.findUnique({ where: { id: input.sessionId }, select: sessionSelect });
  return row ? toView(row as SessionRow, input.userId) : null;
}

export function renderSessionList(sessions: SessionView[], communityName: string): string {
  if (sessions.length === 0) {
    return `Aucune soirée accessible sur **${communityName}** pour le moment. Crée la tienne avec \`/soiree creer\`.`;
  }
  return [
    `🎲 **Prochaines soirées — ${communityName}**`,
    ...sessions.map((session) => {
      const places = session.capacity ? ` · ${session.invitees.length + 1}/${session.capacity}` : ` · ${session.invitees.length + 1} participant(s)`;
      const mine = session.isCreator ? " · tu organises" : session.isInvited ? " · inscrit" : "";
      return `• **${session.game ?? "jeu à définir"}** — ${formatDateTimeFr(session.date)}${places}${mine} · \`${session.id}\``;
    }),
    "Utilise `/soiree voir` ou `/soiree rejoindre` avec l’identifiant affiché.",
  ].join("\n").slice(0, MAX_CONTENT);
}

export function renderSessionDetail(session: SessionView): string {
  const participants = [session.creatorName, ...session.invitees].slice(0, 15);
  const places = session.capacity ? `${participants.length}/${session.capacity} places` : `${participants.length} participant(s)`;
  return [
    `🎲 **Soirée ${session.game ? `· ${session.game}` : ""}**`,
    `${formatDateTimeFr(session.date)} · ${session.statusLabel} · ${places}`,
    `Organisateur : ${session.creatorName}${session.isCreator ? " (toi)" : ""}`,
    `Participants : ${participants.join(", ")}`,
    session.proposals > 0 ? `Jeux proposés : ${session.proposals} — le vote se fait sur GameNight.` : "Aucun jeu proposé pour l’instant.",
    session.isCreator ? "Tu peux gérer cette soirée sur GameNight." : session.isInvited ? "Tu es inscrit : `/soiree quitter` pour te désinscrire." : "`/soiree rejoindre` pour t’inscrire.",
    gameNightLine("/sessions"),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CONTENT);
}

/** Inscription idempotente, dans la limite de `attendanceCapacity`. */
export async function joinSession(input: { userId: string; sessionId: string }): Promise<
  "joined" | "already" | "creator" | "full" | "missing" | "unavailable"
> {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      createdById: true,
      status: true,
      attendanceCapacity: true,
      communityId: true,
      _count: { select: { invites: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!session) return "missing";
  if (session.createdById === input.userId) return "creator";
  if (session.status === "DONE" || session.status === "CANCELLED") return "unavailable";
  const existing = await prisma.sessionInvite.findUnique({
    where: { sessionId_userId: { sessionId: session.id, userId: input.userId } },
    select: { status: true },
  });
  if (existing?.status === "ACTIVE") return "already";
  // +1 : le créateur occupe une place sans ligne d'invitation.
  if (session.attendanceCapacity !== null && session._count.invites + 2 > session.attendanceCapacity) return "full";
  const invite = await inviteToSession(session.id, session.createdById, input.userId);
  return invite ? "joined" : "unavailable";
}

/** Désinscription idempotente ; un créateur ne « quitte » pas sa propre soirée. */
export async function leaveSession(input: { userId: string; sessionId: string }): Promise<
  "left" | "creator" | "missing" | "not_invited"
> {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { createdById: true },
  });
  if (!session) return "missing";
  if (session.createdById === input.userId) return "creator";
  const revoked = await revokeSessionInvite(input.sessionId, input.userId, input.userId);
  return revoked ? "left" : "not_invited";
}

/** Création : même transaction et même service que le formulaire `/sessions`. */
export async function createSessionFromDiscord(input: {
  userId: string;
  communityId: string;
  gameQuery: string;
  dateStr: string;
  timeStr: string;
  places: number | null;
  now?: Date;
}): Promise<
  | { status: "CREATED"; sessionId: string; date: Date; game: string }
  | { status: "GAME_NOT_FOUND" }
  | { status: "GAME_AMBIGUOUS"; names: string[] }
  | { status: "INVALID_DATE" }
  | { status: "TOO_CLOSE" }
  | { status: "INVALID_PLACES" }
  | { status: "UNAVAILABLE" }
> {
  if (input.places !== null && (!Number.isInteger(input.places) || input.places < 2 || input.places > 20)) {
    return { status: "INVALID_PLACES" };
  }
  const game = await resolveGameId(input.gameQuery);
  if (game.kind === "NONE") return { status: "GAME_NOT_FOUND" };
  if (game.kind === "AMBIGUOUS") return { status: "GAME_AMBIGUOUS", names: game.names };
  const schedule = resolveSessionSchedule({
    dateStr: input.dateStr,
    timeStr: input.timeStr,
    deadlineDateStr: "",
    deadlineTimeStr: "",
    deadlineOffset: "2",
  });
  if (!schedule.ok) return schedule.error === "session_trop_proche" ? { status: "TOO_CLOSE" } : { status: "INVALID_DATE" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const session = await createVotingSessionInTransaction(tx, {
        createdById: input.userId,
        communityId: input.communityId,
        date: schedule.date,
        votingDeadline: schedule.votingDeadline,
        customReminderMessage: null,
        reminderTimings: [1440, 120],
        // Aucune annonce Discord déclenchée par une commande : explicitement false.
        announceViaBot: false,
        notifiedUserIds: [],
      });
      // Le jeu demandé devient une proposition du créateur : la soirée reste en
      // vote comme sur le site (aucun `decidedGameId` forcé hors clôture).
      await tx.proposal.create({ data: { sessionId: session.id, gameId: game.id, proposedById: input.userId } });
      await tx.session.update({
        where: { id: session.id },
        data: { attendanceCapacity: input.places },
      });
      return session;
    });
    return { status: "CREATED", sessionId: created.id, date: created.date, game: game.name };
  } catch (error) {
    logger.warn("discord-session", "Création de soirée refusée.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "UNAVAILABLE" };
  }
}

export function handleSignedSessionInteraction(body: unknown, timestamp: string | null): InteractionOutput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID
  ) {
    return { status: 400 };
  }
  if (!interaction.guild_id) return quiet("Utilise cette commande dans le serveur de la communauté.");
  if (!sessionCommandEnabled()) return quiet("La commande /soiree n’est pas encore ouverte sur ce serveur.");

  const sub = interaction.data.options?.[0];
  const subName = sub?.name ?? "liste";
  if (WRITE_SUBCOMMANDS.has(subName) && !sessionWriteEnabled()) {
    return quiet("Créer ou rejoindre une soirée depuis Discord n’est pas encore ouvert. Tu peux le faire sur GameNight.");
  }
  const options = sub?.options ?? [];
  const text = (name: string): string => {
    const value = options.find((option) => option.name === name)?.value;
    return typeof value === "string" ? value.trim() : "";
  };

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };
  const guildId = interaction.guild_id;
  const sessionId = text("soiree");

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runSession: async () => {
      let content: string;
      try {
        const context = await resolveSessionContext({ guildId, discordId });
        if (context.status !== "OK") {
          content =
            context.status === "NOT_MEMBER"
              ? "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une première fois sur le site."
              : "Cette demande est invalide. Réessaie depuis le serveur de la communauté.";
        } else if (subName === "liste") {
          content = renderSessionList(
            await loadUpcomingSessions({ userId: context.userId, communityId: context.communityId }),
            context.communityName
          );
        } else if (subName === "voir") {
          const detail = sessionId ? await loadSessionDetail({ userId: context.userId, sessionId }) : null;
          content = detail
            ? renderSessionDetail(detail)
            : "Soirée introuvable ou privée : elle n’apparaît que pour son organisateur et ses invités.";
        } else if (subName === "creer") {
          const rawPlaces = options.find((option) => option.name === "places")?.value;
          const created = await createSessionFromDiscord({
            userId: context.userId,
            communityId: context.communityId,
            gameQuery: text("jeu"),
            dateStr: text("date"),
            timeStr: text("heure"),
            places: typeof rawPlaces === "number" ? Math.trunc(rawPlaces) : null,
          });
          content = describeCreation(created);
        } else {
          content = await applyRegistrationChange({ subName, sessionId, userId: context.userId });
        }
      } catch (error) {
        logger.warn("discord-session", "Échec du traitement /soiree.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de traiter la soirée pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-session", "Réponse privée /soiree non livrée.", { kind: sent.kind });
    },
  };
}

function describeCreation(result: Awaited<ReturnType<typeof createSessionFromDiscord>>): string {
  switch (result.status) {
    case "CREATED":
      return [
        "✅ **Soirée créée**",
        `${formatDateTimeFr(result.date)} · jeu proposé : **${result.game}**`,
        "Elle est déjà visible dans GameNight (`/sessions`), où le vote et la gestion se font comme d’habitude.",
        "Fenêtre de vote ouverte : les participants peuvent voter sur place jusqu’à 2 h avant.",
      ].join("\n");
    case "GAME_NOT_FOUND":
      return "Jeu introuvable : précise le nom exact du jeu.";
    case "GAME_AMBIGUOUS":
      return `Plusieurs jeux correspondent : ${result.names.join(", ")}. Précise le nom exact.`;
    case "TOO_CLOSE":
      return "Cette soirée est trop proche : il faut au moins 30 minutes entre maintenant et l’heure choisie.";
    case "INVALID_PLACES":
      return "Le nombre de places doit être un entier entre 2 et 20.";
    case "INVALID_DATE":
      return "Date ou heure invalide : utilise `date:2026-12-05` et `heure:21:00`.";
    default:
      return "La soirée n’a pas pu être créée. Réessaie dans un instant.";
  }
}

async function applyRegistrationChange(input: {
  subName: string;
  sessionId: string;
  userId: string;
}): Promise<string> {
  if (!input.sessionId) {
    return input.subName === "rejoindre"
      ? "Indique la soirée : `/soiree rejoindre soiree:<identifiant>` (visible avec `/soiree liste`)."
      : "Indique la soirée : `/soiree quitter soiree:<identifiant>`.";
  }
  if (input.subName === "rejoindre") {
    switch (await joinSession({ userId: input.userId, sessionId: input.sessionId })) {
      case "joined":
        return "✅ Tu es inscrit. La soirée apparaît maintenant dans ton GameNight.";
      case "already":
        return "Tu es déjà inscrit à cette soirée.";
      case "creator":
        return "Tu organises cette soirée : aucune inscription n’est nécessaire.";
      case "full":
        return "Cette soirée est complète.";
      case "missing":
        return "Soirée introuvable.";
      default:
        return "Cette soirée n’accepte plus d’inscription.";
    }
  }
  switch (await leaveSession({ userId: input.userId, sessionId: input.sessionId })) {
    case "left":
      return "Tu as quitté la soirée : son accès est retiré, tes contributions passées restent visibles aux autres invités.";
    case "creator":
      return "Tu organises cette soirée : pour l’annuler, utilise GameNight (`/sessions`).";
    case "not_invited":
      return "Tu ne fais pas partie de cette soirée.";
    default:
      return "Soirée introuvable.";
  }
}

/** Réexport utilitaire : interprétation d'une date saisie, testable sans base. */
export function parseDiscordSessionDate(dateStr: string, timeStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{1,2}:\d{2}$/.test(timeStr)) return null;
  const parsed = parseDateAndTime(dateStr, timeStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
