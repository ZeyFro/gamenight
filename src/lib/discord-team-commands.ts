import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import {
  createCommunityTeamWithId,
  joinCommunityTeam,
  leaveCommunityTeam,
  listCommunityTeams,
  setCommunityTeamRecruitment,
} from "@/lib/community-teams";
import { provisionTeamSpace, syncTeamSpaceMember, type SpaceProvisionStatus } from "@/lib/discord-team-space-service";
import { createDiscordTeamSpaceApi } from "@/lib/discord-team-space-api";
import { reactivateTeamSpace, readTeamSpaceLink } from "@/lib/discord-team-space-service";
import { teamSpacesEnabled } from "@/lib/discord-team-spaces";
import { excludeCommunityTeamMember } from "@/lib/community-teams";
import { describeCaptainTransfer, transferTeamCaptain } from "@/lib/community-team-captain-service";
import { filterTeamGameOptions, uniqueTeamGameOptions, type TeamGameOption } from "@/app/equipes/game-picker-rules";
import { CAPTAIN_UNSET_LABEL, resolveEffectiveCaptain, teamCaptainId } from "@/lib/community-team-captain";
import { createPrismaCaptainStore, type CaptainStore } from "@/lib/community-team-captain-store";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/equipe` — équipes déjà gérées par GameNight (`CommunityTeam` /
 * `CommunityTeamMember`), avec UNE seule logique métier.
 *
 * - lecture : `liste`, `moi`, `voir` ;
 * - adhésion : `rejoindre`, `quitter` — délèguent à `joinCommunityTeam` /
 *   `leaveCommunityTeam`, jamais à une requête écrite à la main. Les règles
 *   (recrutement, capacité, capitaine) restent donc celles du service, y
 *   compris les évolutions des PR #370/#408 quand elles seront fusionnées.
 *
 * Interdits tenus ici :
 * - aucune création d'équipe, de salon ou de rôle depuis Discord ;
 * - aucune permission accordée, aucun mécanisme de droits parallèle ;
 * - aucune donnée privée : ni identifiant Discord, ni e-mail, ni jeton.
 *
 * La capitainerie vient de `@/lib/community-team-captain` (`createdById`),
 * jamais de la position d'un membre dans une liste.
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const MAX_LISTED_TEAMS = 12;
const MAX_LISTED_MEMBERS = 15;

/**
 * Traduction honnête du résultat d'espace : le message ne dit jamais qu'un
 * salon ou un rôle a été créé si le service ne l'a pas fait.
 */
export function describeSpaceOutcome(status: SpaceProvisionStatus | "still_active"): string {
  switch (status) {
    case "created":
      return " Espace Discord : rôle privé et salon créés.";
    case "reused":
      return " Espace Discord existant réutilisé.";
    case "partial":
      return " Espace Discord partiellement créé : vérifie la hiérarchie des rôles du bot.";
    case "quota":
      return " Espace Discord non créé : quota d’espaces de la communauté atteint.";
    case "unmanaged":
      return " Espace Discord non modifié : aucune ressource associée à cette équipe.";
    case "community_not_linked":
      return " Espace Discord non créé : cette communauté n’a pas de serveur relié.";
    case "migration_required":
      return " Espace Discord non créé : l’association persistante des ressources n’est pas encore migrée.";
    case "failed":
      return " Espace Discord non créé : Discord a refusé l’opération.";
    default:
      return "";
  }
}

/** Provisionnement uniquement si le flag est ouvert : aucune écriture implicite. */
async function provisionSpace(teamId: string, communityId: string): Promise<string> {
  if (!teamSpacesEnabled()) return "";
  try {
    const result = await provisionTeamSpace({ teamId, communityId, api: createDiscordTeamSpaceApi() });
    return describeSpaceOutcome(result.status);
  } catch (error) {
    logger.warn("discord-team", "Provisionnement d’espace impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return " Espace Discord non créé : erreur inattendue, l’équipe reste intacte.";
  }
}

async function syncSpaceMember(input: {
  teamId: string;
  communityId: string;
  discordId: string;
  action: "join" | "leave";
}): Promise<string> {
  if (!teamSpacesEnabled()) return "";
  try {
    const result = await syncTeamSpaceMember({ ...input, api: createDiscordTeamSpaceApi() });
    if (result.status === "updated") return " Accès au salon d’équipe accordé.";
    if (result.status === "removed") return " Accès Discord retiré (XP et étages conservés).";
    if (result.status === "not_provisioned") return " Espace Discord pas encore créé : aucun accès à modifier.";
    if (result.status === "failed") return " Discord n’a pas confirmé la mise à jour de tes accès : réessaie dans un instant.";
    return "";
  } catch (error) {
    logger.warn("discord-team", "Synchronisation d’accès impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return " Discord n’a pas confirmé la mise à jour de tes accès.";
  }
}

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const SUBCOMMANDS = [
  "liste",
  "moi",
  "voir",
  "rejoindre",
  "quitter",
  "creer",
  "recrutement",
  "capitaine",
  "transferer",
  "membres",
  "exclure",
  "invitations",
  "espace",
] as const;
const WRITE_SUBCOMMANDS = new Set<string>(["rejoindre", "quitter", "creer", "recrutement", "transferer", "exclure"]);

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
    name: z.literal("equipe"),
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
                value: z.union([z.string().max(1_000), z.number(), z.boolean()]).optional(),
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

export function teamsCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TEAM_COMMAND_ENABLED === "true";
}

/**
 * Adhérer ou quitter depuis Discord engage une écriture : interrupteur séparé,
 * fermé par défaut, même quand la lecture est ouverte.
 */
export function teamsWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TEAM_WRITE_ENABLED === "true";
}

/** Vue compacte : ce qui est déjà public sur `/equipes`, rien de plus. */
export interface CommunityTeamView {
  id: string;
  name: string;
  game: string;
  platform: string;
  description: string;
  isRecruiting: boolean;
  maxMembers: number;
  membersCount: number;
  /** `null` quand aucun capitaine ne peut être établi : jamais le premier membre. */
  captainId: string | null;
  captainName: string | null;
  memberNames: string[];
  memberIds: string[];
  members: Array<{ userId: string; name: string }>;
}

export type CommunityTeamsResult =
  | {
      status: "TEAMS";
      communityId: string;
      userId: string;
      communityName: string;
      teams: CommunityTeamView[];
    }
  | { status: "NOT_MEMBER" }
  | { status: "TEAMS_DISABLED" }
  | { status: "INVALID" };

export async function loadCommunityTeams(input: {
  guildId: string;
  discordId: string;
}): Promise<CommunityTeamsResult> {
  const parsed = z.object({ guildId: snowflake, discordId: snowflake }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  const { guildId, discordId } = parsed.data;

  const community = await prisma.community.findFirst({
    where: { discordGuildId: guildId, status: "ACTIVE" },
    select: { id: true, name: true, communityTeamsEnabled: true },
  });
  if (!community) return { status: "NOT_MEMBER" };

  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true } });
  if (!user) return { status: "NOT_MEMBER" };

  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };
  if (!community.communityTeamsEnabled) return { status: "TEAMS_DISABLED" };

  const teams = await listCommunityTeams(user.id, community.id);
  return {
    status: "TEAMS",
    communityId: community.id,
    userId: user.id,
    communityName: community.name,
    teams: await enrichCaptains(
      community.id,
      teams.map((team) => {
        const memberIds = team.members.map((member) => member.userId);
        return {
          id: team.id,
          createdById: team.createdById,
          memberIds,
          view: {
            id: team.id,
            name: team.name,
            game: team.game.name,
            platform: team.platform,
            description: team.description,
            isRecruiting: team.isRecruiting,
            maxMembers: team.maxMembers,
            membersCount: team.members.length,
            captainId: null as string | null,
            captainName: null as string | null,
            memberNames: team.members.map((member) => member.user.discordName),
            memberIds,
            members: team.members.map((member) => ({ userId: member.userId, name: member.user.discordName })),
          },
        };
      })
    ),
  };
}

/**
 * Capitaine effectif : `captainId` quand la source officielle est disponible,
 * sinon `createdById` (transition). Jamais l'ordre des membres, jamais un repli
 * silencieux si le capitaine désigné n'est plus actif.
 */
async function enrichCaptains(
  communityId: string,
  rows: Array<{ id: string; createdById: string; memberIds: string[]; view: CommunityTeamView }>
): Promise<CommunityTeamView[]> {
  let captains: Awaited<ReturnType<CaptainStore["load"]>> | null = null;
  try {
    captains = await (await createPrismaCaptainStore()).load(
      communityId,
      rows.map((row) => row.id)
    );
  } catch (error) {
    logger.warn("discord-team", "Capitaine officiel illisible : repli transitoire sur le créateur.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
  return rows.map(({ id, createdById, memberIds, view }) => {
    const row = captains?.get(id);
    const effective = row
      ? resolveEffectiveCaptain({ createdById: row.createdById, captainId: row.captainId, activeMemberIds: memberIds })
      : { kind: "CAPTAIN" as const, userId: teamCaptainId({ createdById, activeMemberIds: memberIds }) ?? "" };
    const captainId = effective.kind === "CAPTAIN" && effective.userId ? effective.userId : null;
    return {
      ...view,
      captainId,
      captainName: captainId ? view.members.find((member) => member.userId === captainId)?.name ?? null : null,
    };
  });
}

const short = (line: string, max = MAX_CONTENT) => (line.length > max ? `${line.slice(0, max - 1)}…` : line);

function teamLine(team: CommunityTeamView): string {
  const status = team.isRecruiting ? " · recrute" : "";
  const captain = team.captainName ?? CAPTAIN_UNSET_LABEL;
  return `• **${team.name}** (${team.game}) — ${team.membersCount}/${team.maxMembers}${status} · capitaine : ${captain}`;
}

/** Contenu de `/equipe liste` — pur. */
export function renderTeamList(teams: CommunityTeamView[], communityName: string): string {
  if (teams.length === 0) {
    return `Aucune équipe n’existe encore sur **${communityName}**. Crée la tienne avec \`/equipe creer\`.`;
  }
  const shown = teams.slice(0, MAX_LISTED_TEAMS);
  return short(
    [
      `🛡️ **Équipes de ${communityName}** — ${teams.length}`,
      ...shown.map(teamLine),
      teams.length > shown.length ? `… et ${teams.length - shown.length} autre(s) : précise un nom avec \`/equipe voir\`.` : "",
      "Lecture seule : aucune équipe, aucun salon et aucun rôle ne sont créés par cette commande.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/** Contenu de `/equipe moi` — pur. */
export function renderMyTeams(teams: CommunityTeamView[], userId: string): string {
  const mine = teams.filter((team) => team.memberIds.includes(userId));
  if (mine.length === 0) {
    return "Tu ne fais partie d’aucune équipe pour le moment. Tu peux en rejoindre une avec `/equipe rejoindre`.";
  }
  return short(
    [
      "🛡️ **Tes équipes**",
      ...mine.map((team) => `${teamLine(team)}${team.captainId === userId ? " · tu es capitaine" : ""}`),
      "La capitainerie est portée par le créateur de l’équipe : elle ne dépend jamais de l’ordre des membres.",
    ].join("\n")
  );
}

export type TeamLookup =
  | { kind: "FOUND"; team: CommunityTeamView }
  | { kind: "AMBIGUOUS"; teams: CommunityTeamView[] }
  | { kind: "MISSING" };

/**
 * Résolution par identifiant, puis par nom exact, puis par nom partiel unique.
 * Aucune ambiguïté n'est tranchée à la place de l'utilisateur — et surtout
 * aucune position dans la liste n'est utilisée.
 */
export function findTeam(teams: CommunityTeamView[], query: string): TeamLookup {
  const raw = query.trim();
  if (!raw) return { kind: "MISSING" };
  const needle = raw.toLowerCase();
  const byId = teams.find((team) => team.id === raw);
  if (byId) return { kind: "FOUND", team: byId };
  const exact = teams.filter((team) => team.name.toLowerCase() === needle);
  if (exact.length === 1) return { kind: "FOUND", team: exact[0] };
  if (exact.length > 1) return { kind: "AMBIGUOUS", teams: exact };
  const partial = teams.filter((team) => team.name.toLowerCase().includes(needle));
  if (partial.length === 1) return { kind: "FOUND", team: partial[0] };
  if (partial.length > 1) return { kind: "AMBIGUOUS", teams: partial };
  return { kind: "MISSING" };
}

/** Contenu de `/equipe voir` — pur. */
export function renderTeamDetail(teams: CommunityTeamView[], query: string): string | null {
  const lookup = findTeam(teams, query);
  if (lookup.kind === "AMBIGUOUS") {
    return short(
      [
        "Plusieurs équipes correspondent à ce nom :",
        ...lookup.teams.slice(0, MAX_LISTED_TEAMS).map(teamLine),
        "Précise le nom exact.",
      ].join("\n")
    );
  }
  if (lookup.kind === "MISSING") return "Aucune équipe ne porte ce nom sur cette communauté.";
  const found = lookup.team;
  const members = found.memberNames.slice(0, MAX_LISTED_MEMBERS);
  return short(
    [
      `🛡️ **${found.name}**`,
      `${found.game} · ${found.platform} · ${found.membersCount}/${found.maxMembers}${found.isRecruiting ? " · recrute" : " · complète"}`,
      found.description.trim() ? found.description.trim().slice(0, 400) : "_Pas de description._",
      found.captainId
        ? `Capitaine : ${found.captainName}`
        : `${CAPTAIN_UNSET_LABEL} — aucun responsable désigné : GameNight ne choisit jamais un membre à sa place.`,
      members.length > 0 ? `Membres : ${members.join(", ")}${found.memberNames.length > members.length ? "…" : ""}` : "Aucun membre actif.",
      "Aucune donnée privée, aucun identifiant Discord.",
    ].join("\n")
  );
}

const TEAM_QUERY_HINT = "Indique le nom de l’équipe : `/equipe voir equipe:<nom>`.";

/** Exclusivement appelé après la vérification Ed25519 du corps brut. */
export function handleSignedTeamInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  if (!teamsCommandEnabled()) {
    return quiet("La commande /equipe n’est pas encore ouverte sur ce serveur.");
  }

  const sub = interaction.data.options?.[0];
  const subName = sub?.name ?? "liste";
  const subOptions = sub?.options ?? [];
  const textOption = (optionName: string): string => {
    const value = subOptions.find((option) => option.name === optionName)?.value;
    return typeof value === "string" ? value.trim() : "";
  };
  const query = textOption("equipe");

  if (
    (WRITE_SUBCOMMANDS.has(subName) ||
      (subName === "espace" &&
        subOptions.some(
          (option) => (option.name === "creer" || option.name === "reactiver") && option.value === true
        ))) &&
    !teamsWriteEnabled()
  ) {
    return quiet(
      "Rejoindre ou quitter une équipe depuis Discord n’est pas encore ouvert. Tu peux le faire depuis le site ; la lecture reste disponible avec `/equipe liste`."
    );
  }

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };
  const guildId = interaction.guild_id;

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runTeams: async () => {
      let content: string;
      try {
        const result = await loadCommunityTeams({ guildId, discordId });
        if (result.status === "TEAMS") {
          const lookup = findTeam(result.teams, query);
          content =
            subName === "liste"
              ? renderTeamList(result.teams, result.communityName)
              : subName === "moi"
                ? renderMyTeams(result.teams, result.userId)
                : subName === "voir"
                  ? renderTeamDetail(result.teams, query) ?? TEAM_QUERY_HINT
                  : subName === "creer"
                    ? await createTeamFromDiscord({
                        userId: result.userId,
                        communityId: result.communityId,
                        gameQuery: textOption("jeu"),
                        name: textOption("nom"),
                        description: textOption("objectif"),
                        platform: textOption("plateforme"),
                        places: (() => {
                          const raw = subOptions.find((option) => option.name === "places")?.value;
                          return typeof raw === "number" ? Math.trunc(raw) : 6;
                        })(),
                      })
                    : subName === "recrutement"
                      ? await changeRecruitment({
                          lookup,
                          ouvert: subOptions.find((option) => option.name === "ouvert")?.value,
                          userId: result.userId,
                          communityId: result.communityId,
                        })
                  : subName === "capitaine"
                    ? withTeam(lookup, renderCaptain)
                    : subName === "membres"
                      ? withTeam(lookup, renderMembers)
                      : subName === "invitations"
                        ? withTeam(lookup, renderInvitations)
                        : subName === "transferer"
                          ? await transferCaptainAction({
                              lookup,
                              query: textOption("membre"),
                              actorId: result.userId,
                              communityId: result.communityId,
                            })
                          : subName === "exclure"
                            ? await excludeMemberAction({
                                lookup,
                                query: textOption("membre"),
                                actorId: result.userId,
                                communityId: result.communityId,
                              })
                            : subName === "espace"
                              ? await spaceAction({
                                  lookup,
                                  actorId: result.userId,
                                  communityId: result.communityId,
                                  create: subOptions.find((option) => option.name === "creer")?.value === true,
                                  reactivate: subOptions.find((option) => option.name === "reactiver")?.value === true,
                                })
                              : await applyMembershipChange({
                                  subName,
                                  lookup,
                                  query,
                                  userId: result.userId,
                                  communityId: result.communityId,
                                  discordId,
                                });
        } else if (result.status === "TEAMS_DISABLED") {
          content = "Les équipes ne sont pas activées sur cette communauté.";
        } else if (result.status === "NOT_MEMBER") {
          content =
            "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une première fois sur le site, puis réessaie.";
        } else {
          content = "Cette demande est invalide. Réessaie depuis le serveur de la communauté.";
        }
      } catch (error) {
        logger.warn("discord-team", "Échec du chargement des équipes.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de lire les équipes pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-team", "Réponse privée /equipe non livrée.", { kind: sent.kind });
    },
  };
}

/** `rejoindre` / `quitter` : délègue au service métier, traduit son code. */
async function applyMembershipChange(input: {
  subName: string;
  lookup: TeamLookup;
  query: string;
  userId: string;
  communityId: string;
  discordId: string;
}): Promise<string> {
  if (input.lookup.kind === "AMBIGUOUS") {
    return short(
      [
        "Plusieurs équipes correspondent à ce nom :",
        ...input.lookup.teams.slice(0, MAX_LISTED_TEAMS).map(teamLine),
        "Précise le nom exact.",
      ].join("\n")
    );
  }
  if (input.lookup.kind === "MISSING") {
    return `Aucune équipe ne porte ce nom. Utilise \`/equipe liste\` pour voir les équipes disponibles.`;
  }
  const team = input.lookup.team;

  if (input.subName === "rejoindre") {
    const outcome = await joinCommunityTeam(input.userId, input.communityId, team.id);
    switch (outcome) {
      case "joined": {
        const space = await syncSpaceMember({
          teamId: team.id,
          communityId: input.communityId,
          discordId: input.discordId,
          action: "join",
        });
        return `✅ Tu as rejoint **${team.name}** (${team.game})${team.captainName ? ` — capitaine : ${team.captainName}` : ""}.${space}`;
      }
      case "already":
        return `Tu fais déjà partie de **${team.name}**.`;
      case "closed":
        return `**${team.name}** ne recrute pas en ce moment.`;
      case "full":
        return `**${team.name}** est complète (${team.membersCount}/${team.maxMembers}).`;
      case "missing":
        return "Cette équipe n’existe plus.";
      default:
        return "Les équipes ne sont pas disponibles pour ton compte sur cette communauté.";
    }
  }

  const outcome = await leaveCommunityTeam(input.userId, input.communityId, team.id);
  switch (outcome) {
    case "left": {
      const space = await syncSpaceMember({
        teamId: team.id,
        communityId: input.communityId,
        discordId: input.discordId,
        action: "leave",
      });
      return `Tu as quitté **${team.name}**.${space}`;
    }
    case "leader":
      return `Tu es capitaine de **${team.name}** : la capitainerie ne se transmet pas depuis Discord (passation en préparation). Ton équipe reste intacte.`;
    case "missing":
      return `Tu ne fais pas partie de **${team.name}**.`;
    default:
      return "Les équipes ne sont pas disponibles pour ton compte sur cette communauté.";
  }
}

/** Bornes identiques au formulaire `/equipes` — validation d'affichage, pas une règle métier. */
export function validateTeamCreationInput(input: {
  name: string;
  description: string;
  platform: string;
  places: number;
}): string | null {
  if (input.name.length < 3 || input.name.length > 80) return "Le nom doit faire entre 3 et 80 caractères.";
  if (input.description.length < 10 || input.description.length > 1_000) {
    return "L’objectif doit faire entre 10 et 1 000 caractères.";
  }
  if (input.platform.length < 1 || input.platform.length > 40) return "La plateforme doit faire entre 1 et 40 caractères.";
  if (!Number.isInteger(input.places) || input.places < 2 || input.places > 20) {
    return "Le nombre de places doit être un entier entre 2 et 20.";
  }
  return null;
}

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

/**
 * Création déléguée à `createCommunityTeam` : quotas, validation du jeu et
 * capitainerie (`createdById`) restent dans le service métier.
 */
async function createTeamFromDiscord(input: {
  userId: string;
  communityId: string;
  gameQuery: string;
  name: string;
  description: string;
  platform: string;
  places: number;
}): Promise<string> {
  const invalid = validateTeamCreationInput(input);
  if (invalid) return invalid;
  const game = await resolveGameId(input.gameQuery);
  if (game.kind === "NONE") {
    return "Jeu introuvable : précise le nom exact du jeu (par exemple `jeu:Valheim`).";
  }
  if (game.kind === "AMBIGUOUS") {
    return `Plusieurs jeux correspondent : ${game.names.join(", ")}. Précise le nom exact.`;
  }
  const outcome = await createCommunityTeamWithId({
    userId: input.userId,
    communityId: input.communityId,
    gameId: game.id,
    name: input.name,
    description: input.description,
    platform: input.platform,
    maxMembers: input.places,
  });
  switch (outcome.status) {
    case "created": {
      const space = outcome.teamId ? await provisionSpace(outcome.teamId, input.communityId) : "";
      return `✅ Équipe **${input.name}** créée sur **${game.name}** (${input.places} places). Tu en es le capitaine : la capitainerie vient du créateur, jamais de l’ordre des membres.${space}`;
    }
    case "limit":
      return "Limite atteinte : trois équipes créées par période de 24 heures.";
    case "invalid_game":
      return "Ce jeu n’est plus disponible. Choisis-en un autre.";
    default:
      return "Les équipes ne sont pas disponibles pour ton compte sur cette communauté.";
  }
}

/**
 * Ouverture/fermeture du recrutement. Le droit de gestion est décidé par la
 * règle partagée (capitaine actif), jamais par la position d'un membre.
 */
async function changeRecruitment(input: {
  lookup: TeamLookup;
  ouvert: string | number | boolean | undefined;
  userId: string;
  communityId: string;
}): Promise<string> {
  if (typeof input.ouvert !== "boolean") {
    return "Précise `ouvert:true` ou `ouvert:false`.";
  }
  if (input.lookup.kind === "AMBIGUOUS") {
    return short(
      [
        "Plusieurs équipes correspondent à ce nom :",
        ...input.lookup.teams.slice(0, MAX_LISTED_TEAMS).map(teamLine),
        "Précise le nom exact.",
      ].join("\n")
    );
  }
  if (input.lookup.kind === "MISSING") {
    return "Aucune équipe ne porte ce nom. Utilise `/equipe liste`.";
  }
  const team = input.lookup.team;
  if (team.captainId !== input.userId) {
    return `Seul le capitaine de **${team.name}** peut changer le recrutement${team.captainName ? ` (actuellement ${team.captainName})` : " — aucun capitaine n’est désigné"}.`;
  }
  const outcome = await setCommunityTeamRecruitment(input.userId, input.communityId, team.id, input.ouvert);
  switch (outcome) {
    case "saved":
      return input.ouvert
        ? `Recrutement ouvert sur **${team.name}**.`
        : `Recrutement fermé sur **${team.name}**.`;
    case "full":
      return `**${team.name}** est complète (${team.membersCount}/${team.maxMembers}) : impossible d’ouvrir le recrutement.`;
    case "missing":
      return "Cette équipe est introuvable ou tu n’en es plus le capitaine.";
    default:
      return "Les équipes ne sont pas disponibles pour ton compte sur cette communauté.";
  }
}

/** Résolution d'un membre cité dans l'équipe (nom Discord exact ou identifiant). */
export async function resolveTeamMember(
  team: CommunityTeamView,
  query: string
): Promise<{ kind: "FOUND"; userId: string; name: string } | { kind: "NONE" } | { kind: "AMBIGUOUS"; names: string[] }> {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "NONE" };
  if (/^\d{16,20}$/.test(trimmed)) {
    const user = await prisma.user.findUnique({ where: { discordId: trimmed }, select: { id: true } });
    const member = user ? team.members.find((candidate) => candidate.userId === user.id) : undefined;
    return member ? { kind: "FOUND", userId: member.userId, name: member.name } : { kind: "NONE" };
  }
  const key = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = team.members.filter(
    (member) => member.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === key
  );
  if (matches.length === 1) return { kind: "FOUND", userId: matches[0].userId, name: matches[0].name };
  if (matches.length > 1) return { kind: "AMBIGUOUS", names: matches.map((member) => member.name) };
  return { kind: "NONE" };
}

function withTeam<T>(lookup: TeamLookup, render: (team: CommunityTeamView) => T): T | string {
  const team = requireTeam(lookup);
  return typeof team === "string" ? team : render(team);
}

function requireTeam(lookup: TeamLookup): CommunityTeamView | string {
  if (lookup.kind === "AMBIGUOUS") {
    return short([
      "Plusieurs équipes correspondent à ce nom :",
      ...lookup.teams.slice(0, MAX_LISTED_TEAMS).map(teamLine),
      "Précise le nom exact.",
    ].join("\n"));
  }
  if (lookup.kind === "MISSING") return "Aucune équipe ne porte ce nom. Utilise `/equipe liste`.";
  return lookup.team;
}

export function renderCaptain(team: CommunityTeamView): string {
  if (!team.captainId) {
    return `**${team.name}** n’a pas de capitaine établi : le créateur n’est plus membre actif. Aucun autre membre n’est promu automatiquement ; une passation doit être décidée explicitement.`;
  }
  return `👑 Capitaine de **${team.name}** : **${team.captainName ?? team.captainId}**. Seul le capitaine peut transférer la capitainerie, exclure un membre ou modifier le recrutement.`;
}

export function renderMembers(team: CommunityTeamView): string {
  const lines = team.members
    .slice(0, MAX_LISTED_MEMBERS)
    .map((member) => `• ${member.name}${member.userId === team.captainId ? " 👑" : ""}`);
  const more = team.members.length > MAX_LISTED_MEMBERS ? `\n… et ${team.members.length - MAX_LISTED_MEMBERS} autre(s).` : "";
  return short(
    [`Membres de **${team.name}** — ${team.membersCount}/${team.maxMembers}`, ...lines].join("\n") + more
  );
}

async function transferCaptainAction(input: {
  lookup: TeamLookup;
  query: string;
  actorId: string;
  communityId: string;
}): Promise<string> {
  const team = requireTeam(input.lookup);
  if (typeof team === "string") return team;
  const target = await resolveTeamMember(team, input.query);
  if (target.kind === "AMBIGUOUS") return `Plusieurs membres correspondent : ${target.names.join(", ")}. Précise lequel.`;
  if (target.kind === "NONE") return "Ce membre ne fait pas partie de l’équipe. Une capitainerie ne se transfère qu’à un membre actif.";
  const result = await transferTeamCaptain({
    teamId: team.id,
    communityId: input.communityId,
    actorId: input.actorId,
    newCaptainUserId: target.userId,
  });
  return describeCaptainTransfer(result);
}

async function excludeMemberAction(input: {
  lookup: TeamLookup;
  query: string;
  actorId: string;
  communityId: string;
}): Promise<string> {
  const team = requireTeam(input.lookup);
  if (typeof team === "string") return team;
  const target = await resolveTeamMember(team, input.query);
  if (target.kind === "AMBIGUOUS") return `Plusieurs membres correspondent : ${target.names.join(", ")}. Précise lequel.`;
  if (target.kind === "NONE") return "Ce joueur ne fait pas partie de l’équipe.";
  const result = await excludeCommunityTeamMember({
    actorId: input.actorId,
    communityId: input.communityId,
    teamId: team.id,
    targetUserId: target.userId,
  });
  if (result.status === "not_captain") return `Seul le capitaine de **${team.name}** peut exclure un membre.`;
  if (result.status === "captain") return "Le capitaine ne peut pas s’exclure : transfère d’abord la capitainerie.";
  if (result.status === "not_member") return "Ce joueur n’est plus membre de l’équipe.";
  if (result.status === "missing") return "Cette équipe n’existe plus.";
  if (result.status === "unavailable") return "Les équipes ne sont pas disponibles pour ton compte sur cette communauté.";
  const space = result.discordId
    ? await syncSpaceMember({
        teamId: team.id,
        communityId: input.communityId,
        discordId: result.discordId,
        action: "leave",
      })
    : "";
  return `✅ **${target.name}** a été exclu de **${team.name}**. Son XP, ses étages et son historique personnel sont conservés.${space}`;
}

function renderInvitations(team: CommunityTeamView): string {
  const status = team.isRecruiting ? "ouvert" : "fermé";
  return short(
    [
      `**${team.name}** — recrutement ${status}.`,
      team.isRecruiting
        ? "Les joueurs peuvent rejoindre avec `/equipe rejoindre`. Aucune invitation directe n’existe encore : elle exige un modèle dédié non migré (voir la note Obsidian)."
        : "Le recrutement est fermé : personne ne peut rejoindre sans que le capitaine l’ouvre avec `/equipe recrutement`.",
      team.captainId ? "Seul le capitaine peut ouvrir le recrutement." : "Aucun capitaine établi : le recrutement ne peut pas être modifié.",
    ].join("\n")
  );
}

async function spaceAction(input: {
  lookup: TeamLookup;
  actorId: string;
  communityId: string;
  create: boolean;
  reactivate: boolean;
}): Promise<string> {
  const team = requireTeam(input.lookup);
  if (typeof team === "string") return team;
  const state = await readTeamSpaceLink({ teamId: team.id });
  if (state.status === "migration_required") {
    return "L’association persistante des espaces n’est pas encore migrée : aucun salon n’est géré pour cette équipe.";
  }
  if (state.status === "unlinked") {
    if (!input.create) return `**${team.name}** n’a pas d’espace Discord géré. Seul le capitaine peut en créer un avec \`/equipe espace creer:true\`.`;
    if (team.captainId !== input.actorId) return `Seul le capitaine de **${team.name}** peut créer son espace Discord.`;
    const outcome = await provisionSpace(team.id, input.communityId);
    return `**${team.name}** —${outcome || " Espace Discord non modifié : fonctionnalité fermée sur ce serveur."}`;
  }
  if (state.archived && input.reactivate) {
    if (team.captainId !== input.actorId) return `Seul le capitaine de **${team.name}** peut réactiver son espace Discord.`;
    const result = await reactivateTeamSpace({ teamId: team.id, communityId: input.communityId, api: createDiscordTeamSpaceApi() });
    const suffix = result.status === "reused" ? " Espace réactivé : le salon associé a retrouvé son nom." : describeSpaceOutcome(result.status);
    return `**${team.name}** —${suffix || " Espace non modifié."}`;
  }
  const archived = state.archived ? "archivé" : "actif";
  return `**${team.name}** — espace ${archived} (salon et rôle privés associés). Aucun identifiant technique n’est nécessaire pour le gérer.`;
}
