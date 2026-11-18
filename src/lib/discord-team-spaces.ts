/**
 * Espaces Discord des équipes — planificateur centralisé, **sans création réelle**.
 *
 * Règle d'or de l'archivage : on ne cible **jamais** un identifiant d'équipe.
 * Une action sur un salon n'est planifiée que si son identifiant Discord a été
 * vérifié — via le lien persisté (`managedSpaces`) ou via le nom exact dérivé
 * de l'identifiant d'équipe. Sinon le plan est refusé (`unmanaged`) : aucune
 * ressource n'est touchée au hasard, et un salon historique n'est jamais modifié.
 *
 * Les ressources d'une autre équipe ne peuvent pas être ciblées : le lien est
 * indexé par `teamId`, et le nom dérivé contient l'identifiant de l'équipe.
 */
export const SPACE_KEY_PREFIX = "gn-team-";
export const DEFAULT_MAX_SPACES_PER_COMMUNITY = 5;
export const MAX_MEMBERS_PER_SPACE = 50;
export const VIEW_CHANNEL = "1024";
const MAX_CHANNEL_NAME = 100;
const MAX_ROLE_NAME = 100;
const snowflake = /^[0-9]{16,20}$/;

export type SpaceIneligibleReason =
  | "invalid_name"
  | "invalid_members"
  | "invalid_captain"
  | "quota"
  | "team_disabled"
  | "unmanaged";

export interface GuildChannelSummary {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
}

export interface GuildRoleSummaryLite {
  id: string;
  name: string;
  permissions?: string;
  managed?: boolean;
}

/** Lien persisté équipe → ressources Discord (à terme : colonnes Prisma). */
export interface ManagedSpaceLink {
  teamId: string;
  channelId: string;
  roleId?: string;
  archived?: boolean;
}

export interface TeamSpaceMember {
  userId: string;
  discordId: string;
}

export interface TeamSpaceInput {
  team: {
    id: string;
    name: string;
    communityId: string;
    active?: boolean;
    createdById: string;
    /** Capitaine configuré (#370) ; `null` = pas de passation, le créateur reste capitaine. */
    captainId?: string | null;
    /** Membres ACTIFS, du plus ancien au plus récent (`joinedAt`, `userId`). */
    members: TeamSpaceMember[];
  };
  existing: { channels: GuildChannelSummary[]; roles: GuildRoleSummaryLite[] };
  managedSpaces?: ManagedSpaceLink[];
  /** L'équipe était archivée : la réactivation renomme le salon vérifié. */
  previousArchived?: boolean;
  /** Membres connus avant ce plan : sert à calculer les départs. */
  previousMemberDiscordIds?: string[];
  limits?: { maxSpacesPerCommunity?: number };
}

export interface OverwritePlan {
  target: "everyone" | "team-role";
  allow?: string;
  deny?: string;
}

export type TeamSpaceStep =
  | { kind: "role"; action: "create" | "reuse"; key: string; name: string; targetId?: string }
  | { kind: "channel"; action: "create" | "reuse" | "archive" | "restore"; key: string; name: string; targetId?: string }
  | {
      kind: "members";
      action: "sync";
      members: string[];
      captainDiscordId: string | null;
      /** Membres ayant quitté : leurs permissions doivent être retirées côté salon. */
      departed: string[];
    };

export type TeamSpacePlan =
  | { status: "ineligible"; reason: SpaceIneligibleReason }
  | {
      status: "planned";
      spaceKey: string;
      roleName: string;
      channelName: string;
      rolePermissions: "0";
      overwrites: OverwritePlan[];
      steps: TeamSpaceStep[];
      archived: boolean;
      captainDiscordId: string | null;
    };

export function sanitizeChannelName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHANNEL_NAME);
}

export function sanitizeRoleName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_NAME);
}

export function spaceKey(teamId: string): string {
  return `${SPACE_KEY_PREFIX}${teamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
}

/**
 * Nom **spécifique à l'équipe** : deux équipes homonymes n'obtiennent jamais le
 * même nom, et une correspondance exacte de nom ne peut pas viser une autre
 * équipe. C'est ce qui autorise la vérification par nom sans approximation.
 */
export function spaceChannelName(team: { id: string; name: string }): string {
  const slug = sanitizeChannelName(team.name) || "espace";
  const safeId = team.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toLowerCase();
  return `${slug}-${safeId}`.slice(0, MAX_CHANNEL_NAME).replace(/-+$/g, "");
}

/**
 * Capitaine = `captainId ?? createdById` s'il est membre actif ; sinon le plus
 * ancien membre actif (`members` est trié par ancienneté) — même règle que
 * `setCommunityTeamRecruitment` (community-teams.ts, #370). `createdById` n'est
 * jamais réécrit.
 */
export function spaceCaptain(team: TeamSpaceInput["team"]): TeamSpaceMember | null {
  const configured = team.captainId ?? team.createdById;
  return team.members.find((member) => member.userId === configured) ?? team.members[0] ?? null;
}

function verifiedLink(input: TeamSpaceInput): ManagedSpaceLink | null {
  return input.managedSpaces?.find((link) => link.teamId === input.team.id) ?? null;
}

/**
 * Identifiant de salon Discord vérifié : uniquement le lien persisté de CETTE
 * équipe, ou un salon dont le nom est le nom exact dérivé de l'équipe.
 * Une ressemblance de nom ne suffit jamais.
 */
export function resolveSpaceChannelId(input: TeamSpaceInput): string | null {
  const link = verifiedLink(input);
  if (link) {
    const channel = input.existing.channels.find((candidate) => candidate.id === link.channelId);
    return channel ? channel.id : null;
  }
  const expected = spaceChannelName(input.team);
  const exact = input.existing.channels.filter((candidate) => candidate.name === expected);
  return exact.length === 1 ? exact[0].id : null;
}

export function planTeamSpace(input: TeamSpaceInput): TeamSpacePlan {
  const { team } = input;
  if (team.active === false) return { status: "ineligible", reason: "team_disabled" };

  const roleName = sanitizeRoleName(`GN · ${team.name}`);
  const channelName = spaceChannelName(team);
  if (roleName.length < 3 || channelName.length < 4) return { status: "ineligible", reason: "invalid_name" };

  const members = [...new Set(team.members.map((member) => member.discordId))];
  if (members.some((id) => !snowflake.test(id)) || members.length > MAX_MEMBERS_PER_SPACE) {
    return { status: "ineligible", reason: "invalid_members" };
  }
  const captain = spaceCaptain(team);
  if (captain && !snowflake.test(captain.discordId)) return { status: "ineligible", reason: "invalid_captain" };

  const link = verifiedLink(input);
  const channelId = resolveSpaceChannelId(input);
  const roleId = link?.roleId && input.existing.roles.some((role) => role.id === link.roleId) ? link.roleId : null;
  const maxSpaces = input.limits?.maxSpacesPerCommunity ?? DEFAULT_MAX_SPACES_PER_COMMUNITY;
  if (!link && !channelId && (input.managedSpaces?.length ?? 0) >= maxSpaces) {
    return { status: "ineligible", reason: "quota" };
  }

  const archived = members.length === 0;
  // Archivage impossible sans identifiant vérifié : on refuse au lieu de deviner.
  if (archived && !channelId) return { status: "ineligible", reason: "unmanaged" };

  const channelStep: TeamSpaceStep = archived
    ? { kind: "channel", action: "archive", key: spaceKey(team.id), name: channelName, targetId: channelId! }
    : channelId
      ? {
          kind: "channel",
          action: input.previousArchived ? "restore" : "reuse",
          key: spaceKey(team.id),
          name: channelName,
          targetId: channelId,
        }
      : { kind: "channel", action: "create", key: spaceKey(team.id), name: channelName };

  const steps: TeamSpaceStep[] = [
    roleId
      ? { kind: "role", action: "reuse", key: spaceKey(team.id), name: roleName, targetId: roleId }
      : { kind: "role", action: "create", key: spaceKey(team.id), name: roleName },
    channelStep,
    {
      kind: "members",
      action: "sync",
      members,
      captainDiscordId: captain?.discordId ?? null,
      // Départs = membres connus avant, absents maintenant : ce sont eux dont les
      // permissions de salon doivent être retirées (aucune autre équipe touchée).
      departed: [...new Set(input.previousMemberDiscordIds ?? [])].filter((id) => !members.includes(id)),
    },
  ];

  return {
    status: "planned",
    spaceKey: spaceKey(team.id),
    roleName,
    channelName,
    rolePermissions: "0",
    overwrites: [
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ],
    steps,
    archived,
    captainDiscordId: captain?.discordId ?? null,
  };
}

export interface TeamSpaceClient {
  createRole(input: { name: string; permissions: "0"; mentionable: false; hoist: false }): Promise<{ id: string }>;
  createChannel(input: { name: string; type: 0; overwrites: OverwritePlan[]; reason: string }): Promise<{ id: string }>;
  editChannel?(input: { id: string; name: string; reason: string }): Promise<unknown>;
  addMemberRole?(input: { userId: string; roleId: string }): Promise<unknown>;
  removeMemberRole?(input: { userId: string; roleId: string }): Promise<unknown>;
}

export type TeamSpaceApplyResult = {
  status: "disabled" | "applied" | "partial" | "ineligible";
  steps: Array<{ key: string; kind: TeamSpaceStep["kind"]; status: "ok" | "skipped" | "failed"; detail?: string }>;
  /** Identifiants réellement obtenus/créés — à persister par l'appelant. */
  roleId?: string;
  channelId?: string;
};

export function teamSpacesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TEAM_SPACES_ENABLED === "true";
}

export async function applyTeamSpacePlan(
  plan: TeamSpacePlan,
  client: TeamSpaceClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<TeamSpaceApplyResult> {
  if (plan.status !== "planned") return { status: "ineligible", steps: [] };
  if (!teamSpacesEnabled(env)) return { status: "disabled", steps: [] };

  const steps: TeamSpaceApplyResult["steps"] = [];
  let roleFailed = false;
  let channelFailed = false;
  let roleId: string | undefined;
  let channelId: string | undefined;

  for (const step of plan.steps) {
    // Les membres sont traités après la boucle (le rôle doit exister).
    if (step.kind === "members") continue;
    if (step.kind === "role") {
      roleId = step.targetId;
      if (step.action === "reuse") {
        steps.push({ key: step.key, kind: step.kind, status: "ok", detail: "existing" });
        continue;
      }
      try {
        const created = await client.createRole({ name: step.name, permissions: "0", mentionable: false, hoist: false });
        roleId = created.id;
        steps.push({ key: step.key, kind: step.kind, status: "ok" });
      } catch (error) {
        roleFailed = true;
        steps.push({ key: step.key, kind: step.kind, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
      }
      continue;
    }
    if (roleFailed) {
      steps.push({ key: step.key, kind: step.kind, status: "skipped", detail: "role_failed" });
      continue;
    }
    if (step.action === "reuse") {
      channelId = step.targetId;
      steps.push({ key: step.key, kind: step.kind, status: "ok", detail: "existing" });
      continue;
    }
    // Toute modification d'un salon existant exige un identifiant vérifié.
    if ((step.action === "archive" || step.action === "restore") && !step.targetId) {
      steps.push({ key: step.key, kind: step.kind, status: "failed", detail: "unverified_target" });
      channelFailed = true;
      continue;
    }
    try {
      if (step.action === "archive") {
        if (!client.editChannel) throw new Error("editChannel indisponible");
        await client.editChannel({ id: step.targetId!, name: `archive-${step.name}`.slice(0, MAX_CHANNEL_NAME), reason: "gn-team-archive" });
      } else if (step.action === "restore") {
        if (!client.editChannel) throw new Error("editChannel indisponible");
        await client.editChannel({ id: step.targetId!, name: step.name, reason: "gn-team-restore" });
      } else {
        const created = await client.createChannel({ name: step.name, type: 0, overwrites: plan.overwrites, reason: "gn-team-space" });
        channelId = created.id;
      }
      steps.push({ key: step.key, kind: step.kind, status: "ok" });
    } catch (error) {
      channelFailed = true;
      steps.push({ key: step.key, kind: step.kind, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
    }
  }

  // Membres : ajout du rôle aux membres actuels, retrait aux départs connus.
  const memberStep = plan.steps.find((step) => step.kind === "members");
  if (memberStep && memberStep.kind === "members") {
    if (roleFailed || channelFailed || !roleId || !client.addMemberRole) {
      steps.push({ key: plan.spaceKey, kind: "members", status: "skipped" });
    } else {
      let memberFailed = false;
      for (const userId of memberStep.members) {
        try {
          await client.addMemberRole({ userId, roleId });
        } catch {
          memberFailed = true;
        }
      }
      for (const userId of memberStep.departed) {
        try {
          await client.removeMemberRole?.({ userId, roleId });
        } catch {
          memberFailed = true;
        }
      }
      steps.push({ key: plan.spaceKey, kind: "members", status: memberFailed ? "failed" : "ok" });
      if (memberFailed) channelFailed = true;
    }
  }

  const failed = steps.some((step) => step.status === "failed");
  return { status: failed ? "partial" : "applied", steps, roleId, channelId };
}
