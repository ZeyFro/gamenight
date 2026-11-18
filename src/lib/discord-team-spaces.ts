/**
 * Espaces Discord des équipes — planificateur centralisé, **sans création réelle**.
 *
 * Décision du 18/11/2026 (option A) : chaque équipe admissible obtient **deux
 * salons privés permanents** — un salon textuel et un salon vocal — et un rôle
 * d'accès sans permission. Les deux salons vivent aussi longtemps que l'équipe :
 * jamais de vocal éphémère, jamais de recréation à la demande.
 *
 * Règle d'or de l'archivage : on ne cible **jamais** un identifiant d'équipe.
 * Une action sur un salon n'est planifiée que si son identifiant Discord a été
 * vérifié — via le lien persisté (`managedSpaces`) ou via le nom exact dérivé
 * de l'identifiant d'équipe. Sinon le plan est refusé (`unmanaged`) : aucune
 * ressource n'est touchée au hasard, et un salon historique n'est jamais modifié.
 *
 * Les ressources d'une autre équipe ne peuvent pas être ciblées : le lien est
 * indexé par `teamId`, et les noms dérivés contiennent l'identifiant de l'équipe.
 */
export const SPACE_KEY_PREFIX = "gn-team-";
export const DEFAULT_MAX_SPACES_PER_COMMUNITY = 5;
/** Plafond dur de sécurité du quota produit (jamais la limite Discord elle-même). */
export const MAX_SPACES_PER_COMMUNITY_LIMIT = 200;
export const MAX_MEMBERS_PER_SPACE = 50;
export const VIEW_CHANNEL = "1024";
export const CHANNEL_TYPE_TEXT = 0;
export const CHANNEL_TYPE_VOICE = 2;
/**
 * Limites Discord officielles par serveur (documentation Discord) : 500 salons
 * toutes catégories confondues (erreur 30013) et 250 rôles (erreur 30005),
 * 50 salons par catégorie. Ce ne sont pas des réglages produit : la limite du
 * planificateur `DEFAULT_MAX_SPACES_PER_COMMUNITY` reste bien plus basse.
 */
export const GUILD_CHANNEL_LIMIT = 500;
export const GUILD_ROLE_LIMIT = 250;
/** Seuil d'alerte : au-delà de 80 % des limites du serveur, le plan est signalé. */
export const CAPACITY_WARNING_RATIO = 0.8;
const MAX_CHANNEL_NAME = 100;
const MAX_ROLE_NAME = 100;
const snowflake = /^[0-9]{16,20}$/;

export type SpaceIneligibleReason =
  | "invalid_name"
  | "invalid_members"
  | "invalid_captain"
  | "quota"
  | "capacity"
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

/** Lien persisté équipe → ressources Discord (une ligne `DiscordTeamSpace`). */
export interface ManagedSpaceLink {
  teamId: string;
  /** Salon textuel privé permanent. */
  channelId: string;
  /** Salon vocal privé permanent (absent pour un lien créé avant l'option A). */
  voiceChannelId?: string | null;
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
  /** L'équipe était archivée : la réactivation renomme les salons vérifiés. */
  previousArchived?: boolean;
  /** Membres connus avant ce plan : sert à calculer les départs. */
  previousMemberDiscordIds?: string[];
  limits?: {
    maxSpacesPerCommunity?: number;
    guildChannelLimit?: number;
    guildRoleLimit?: number;
    capacityWarningRatio?: number;
  };
}

export interface OverwritePlan {
  target: "everyone" | "team-role";
  allow?: string;
  deny?: string;
}

type ChannelType = typeof CHANNEL_TYPE_TEXT | typeof CHANNEL_TYPE_VOICE;

export type TeamSpaceStep =
  | { kind: "role"; action: "create" | "reuse"; key: string; name: string; targetId?: string }
  | {
      kind: "channel";
      action: "create" | "reuse" | "archive" | "restore";
      /** 0 = salon textuel, 2 = salon vocal : les deux sont permanents. */
      channelType: ChannelType;
      key: string;
      name: string;
      targetId?: string;
    }
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
      voiceChannelName: string;
      rolePermissions: "0";
      overwrites: OverwritePlan[];
      steps: TeamSpaceStep[];
      archived: boolean;
      /** Capacité du serveur proche d'une limite Discord : à signaler au staff. */
      capacityWarning: boolean;
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
 * Base de nom **spécifique à l'équipe** : deux équipes homonymes n'obtiennent
 * jamais le même nom, et une correspondance exacte de nom ne peut pas viser une
 * autre équipe. C'est ce qui autorise la vérification par nom sans approximation.
 */
function teamSlug(team: { id: string; name: string }): string {
  const slug = sanitizeChannelName(team.name) || "espace";
  const safeId = team.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toLowerCase();
  // 90 caractères : le préfixe « vocal- » tient dans la limite Discord de 100.
  return `${slug}-${safeId}`.slice(0, 90).replace(/-+$/g, "");
}

export function spaceChannelName(team: { id: string; name: string }): string {
  return teamSlug(team).slice(0, MAX_CHANNEL_NAME);
}

/** Salon vocal privé permanent, nommé d'après la même identité que le textuel. */
export function spaceVoiceChannelName(team: { id: string; name: string }): string {
  return `vocal-${teamSlug(team)}`.slice(0, MAX_CHANNEL_NAME).replace(/-+$/g, "");
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
 * Identifiant de salon textuel vérifié : uniquement le lien persisté de CETTE
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

/** Identifiant de salon vocal vérifié, avec la même règle stricte que le textuel. */
export function resolveSpaceVoiceChannelId(input: TeamSpaceInput): string | null {
  const link = verifiedLink(input);
  if (link?.voiceChannelId) {
    const channel = input.existing.channels.find((candidate) => candidate.id === link.voiceChannelId);
    return channel ? channel.id : null;
  }
  if (link) return null;
  const expected = spaceVoiceChannelName(input.team);
  const exact = input.existing.channels.filter(
    (candidate) => candidate.name === expected && candidate.type === CHANNEL_TYPE_VOICE
  );
  return exact.length === 1 ? exact[0].id : null;
}

/** Quota produit par communauté (`DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY`, défaut 5). */
export function teamSpaceLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_SPACES_PER_COMMUNITY;
  return Math.min(parsed, MAX_SPACES_PER_COMMUNITY_LIMIT);
}

function capacityUsage(used: number, limit: number): number {
  return limit <= 0 ? 1 : used / limit;
}

export function planTeamSpace(input: TeamSpaceInput): TeamSpacePlan {
  const { team } = input;
  if (team.active === false) return { status: "ineligible", reason: "team_disabled" };

  const roleName = sanitizeRoleName(`GN · ${team.name}`);
  const channelName = spaceChannelName(team);
  const voiceChannelName = spaceVoiceChannelName(team);
  if (roleName.length < 3 || channelName.length < 4 || voiceChannelName.length < 4) {
    return { status: "ineligible", reason: "invalid_name" };
  }

  const members = [...new Set(team.members.map((member) => member.discordId))];
  if (members.some((id) => !snowflake.test(id)) || members.length > MAX_MEMBERS_PER_SPACE) {
    return { status: "ineligible", reason: "invalid_members" };
  }
  const captain = spaceCaptain(team);
  if (captain && !snowflake.test(captain.discordId)) return { status: "ineligible", reason: "invalid_captain" };

  const link = verifiedLink(input);
  const channelId = resolveSpaceChannelId(input);
  const voiceChannelId = resolveSpaceVoiceChannelId(input);
  const roleId = link?.roleId && input.existing.roles.some((role) => role.id === link.roleId) ? link.roleId : null;
  const maxSpaces = input.limits?.maxSpacesPerCommunity ?? teamSpaceLimit();
  if (!link && !channelId && (input.managedSpaces?.length ?? 0) >= maxSpaces) {
    return { status: "ineligible", reason: "quota" };
  }

  const archived = members.length === 0;
  // Archivage impossible sans identifiant vérifié : on refuse au lieu de deviner.
  if (archived && !channelId) return { status: "ineligible", reason: "unmanaged" };

  // Capacité Discord : deux salons par équipe (texte + vocal), un rôle partagé.
  // Un archivage ne crée rien (renommage seul) : aucune capacité consommée.
  const channelsToCreate = archived ? 0 : (channelId ? 0 : 1) + (voiceChannelId ? 0 : 1);
  const rolesToCreate = archived || roleId ? 0 : 1;
  const channelLimit = input.limits?.guildChannelLimit ?? GUILD_CHANNEL_LIMIT;
  const roleLimit = input.limits?.guildRoleLimit ?? GUILD_ROLE_LIMIT;
  if (input.existing.channels.length + channelsToCreate > channelLimit) {
    return { status: "ineligible", reason: "capacity" };
  }
  if (input.existing.roles.length + rolesToCreate > roleLimit) {
    return { status: "ineligible", reason: "capacity" };
  }
  const warningRatio = input.limits?.capacityWarningRatio ?? CAPACITY_WARNING_RATIO;
  const capacityWarning =
    capacityUsage(input.existing.channels.length + channelsToCreate, channelLimit) >= warningRatio ||
    capacityUsage(input.existing.roles.length + rolesToCreate, roleLimit) >= warningRatio;

  const channelAction = (verifiedId: string | null): "create" | "reuse" | "restore" =>
    verifiedId ? (input.previousArchived ? "restore" : "reuse") : "create";

  const textStep: TeamSpaceStep = archived
    ? { kind: "channel", action: "archive", channelType: CHANNEL_TYPE_TEXT, key: spaceKey(team.id), name: channelName, targetId: channelId! }
    : channelId
      ? {
          kind: "channel",
          action: channelAction(channelId),
          channelType: CHANNEL_TYPE_TEXT,
          key: spaceKey(team.id),
          name: channelName,
          targetId: channelId,
        }
      : { kind: "channel", action: "create", channelType: CHANNEL_TYPE_TEXT, key: spaceKey(team.id), name: channelName };

  // Vocal : archive/restaure seulement s'il est vérifié — un vocal supprimé à la
  // main n'est jamais recréé ici (la réconciliation le signale).
  const voiceStep: TeamSpaceStep | null = archived
    ? voiceChannelId
      ? {
          kind: "channel",
          action: "archive",
          channelType: CHANNEL_TYPE_VOICE,
          key: `${spaceKey(team.id)}-voice`,
          name: voiceChannelName,
          targetId: voiceChannelId,
        }
      : null
    : voiceChannelId
      ? {
          kind: "channel",
          action: channelAction(voiceChannelId),
          channelType: CHANNEL_TYPE_VOICE,
          key: `${spaceKey(team.id)}-voice`,
          name: voiceChannelName,
          targetId: voiceChannelId,
        }
      : {
          kind: "channel",
          action: "create",
          channelType: CHANNEL_TYPE_VOICE,
          key: `${spaceKey(team.id)}-voice`,
          name: voiceChannelName,
        };

  const steps: TeamSpaceStep[] = [
    roleId
      ? { kind: "role", action: "reuse", key: spaceKey(team.id), name: roleName, targetId: roleId }
      : { kind: "role", action: "create", key: spaceKey(team.id), name: roleName },
    textStep,
    ...(voiceStep ? [voiceStep] : []),
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
    voiceChannelName,
    rolePermissions: "0",
    // Les deux salons sont privés : @everyone n'y voit rien, le rôle d'équipe voit.
    overwrites: [
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ],
    steps,
    archived,
    capacityWarning,
    captainDiscordId: captain?.discordId ?? null,
  };
}

export interface TeamSpaceClient {
  createRole(input: { name: string; permissions: "0"; mentionable: false; hoist: false }): Promise<{ id: string }>;
  createChannel(input: {
    name: string;
    type: ChannelType;
    overwrites: OverwritePlan[];
    reason: string;
  }): Promise<{ id: string }>;
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
  voiceChannelId?: string;
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
  let textFailed = false;
  let voiceFailed = false;
  let roleId: string | undefined;
  let channelId: string | undefined;
  let voiceChannelId: string | undefined;

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
    // Le vocal n'est jamais créé sans son salon textuel : un espace à moitié
    // créé serait plus difficile à reprendre qu'un simple rejeu.
    if (step.channelType === CHANNEL_TYPE_VOICE && textFailed) {
      steps.push({ key: step.key, kind: step.kind, status: "skipped", detail: "text_failed" });
      continue;
    }
    if (step.action === "reuse") {
      if (step.channelType === CHANNEL_TYPE_VOICE) voiceChannelId = step.targetId;
      else channelId = step.targetId;
      steps.push({ key: step.key, kind: step.kind, status: "ok", detail: "existing" });
      continue;
    }
    // Toute modification d'un salon existant exige un identifiant vérifié.
    if ((step.action === "archive" || step.action === "restore") && !step.targetId) {
      steps.push({ key: step.key, kind: step.kind, status: "failed", detail: "unverified_target" });
      if (step.channelType === CHANNEL_TYPE_VOICE) voiceFailed = true;
      else textFailed = true;
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
        const created = await client.createChannel({
          name: step.name,
          type: step.channelType,
          overwrites: plan.overwrites,
          reason: "gn-team-space",
        });
        if (step.channelType === CHANNEL_TYPE_VOICE) voiceChannelId = created.id;
        else channelId = created.id;
      }
      steps.push({ key: step.key, kind: step.kind, status: "ok" });
    } catch (error) {
      if (step.channelType === CHANNEL_TYPE_VOICE) voiceFailed = true;
      else textFailed = true;
      steps.push({ key: step.key, kind: step.kind, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
    }
  }

  // Membres : ajout du rôle aux membres actuels, retrait aux départs connus.
  // Rien n'est appliqué tant que les DEUX salons ne sont pas en place.
  const memberStep = plan.steps.find((step) => step.kind === "members");
  if (memberStep && memberStep.kind === "members") {
    const spaceReady = Boolean(roleId) && Boolean(channelId) && (Boolean(voiceChannelId) || plan.archived);
    if (roleFailed || textFailed || voiceFailed || !spaceReady || !client.addMemberRole) {
      steps.push({ key: plan.spaceKey, kind: "members", status: "skipped" });
    } else {
      let memberFailed = false;
      for (const userId of memberStep.members) {
        try {
          await client.addMemberRole({ userId, roleId: roleId! });
        } catch {
          memberFailed = true;
        }
      }
      for (const userId of memberStep.departed) {
        try {
          await client.removeMemberRole?.({ userId, roleId: roleId! });
        } catch {
          memberFailed = true;
        }
      }
      steps.push({ key: plan.spaceKey, kind: "members", status: memberFailed ? "failed" : "ok" });
      if (memberFailed) voiceFailed = true;
    }
  }

  const failed = steps.some((step) => step.status === "failed");
  return { status: failed ? "partial" : "applied", steps, roleId, channelId, voiceChannelId };
}
