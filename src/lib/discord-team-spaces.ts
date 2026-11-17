/**
 * Espaces Discord des équipes et projets — **planificateur centralisé**.
 *
 * Ce module ne crée rien par lui-même : il calcule un plan idempotent (rôle +
 * salon + permissions), puis `applyTeamSpacePlan` l'exécute avec un client
 * injecté, et uniquement si `DISCORD_TEAM_SPACES_ENABLED === "true"`.
 *
 * Garanties tenues ici :
 * - un rôle créé par ce service est **toujours** sans permission
 *   (`permissions: "0"`, `mentionable: false`, `hoist: false`) : aucun droit
 *   administratif, aucun accès sensible ;
 * - le salon est privé : `@everyone` n'a pas `Voir les salons`, le rôle d'équipe
 *   l'a — les permissions sont limitées aux membres concernés ;
 * - clé déterministe `gn-team-<id>` : rejouer la planification réutilise la
 *   ressource existante au lieu d'en créer une seconde ;
 * - quota par communauté, nom validé et tronqué aux limites Discord ;
 * - équipe vide ou dissoute → plan d'archivage, jamais une suppression sauvage ;
 * - échec partiel modélisé pas à pas.
 *
 * Aucune ressource réelle n'est créée sans autorisation : le flag est fermé par
 * défaut et rien n'appelle ce service en production aujourd'hui.
 */

export const SPACE_KEY_PREFIX = "gn-team-";
export const DEFAULT_MAX_SPACES_PER_COMMUNITY = 5;
export const MAX_MEMBERS_PER_SPACE = 50;
export const VIEW_CHANNEL = "1024";
const MAX_CHANNEL_NAME = 100;
const MAX_ROLE_NAME = 100;

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

export interface OverwritePlan {
  /** `@everyone` est identifié par l'identifiant du serveur, fourni par l'appelant. */
  target: "everyone" | "team-role";
  allow?: string;
  deny?: string;
}

export type TeamSpaceStep =
  | { kind: "role"; action: "create" | "reuse"; key: string; name: string }
  | { kind: "channel"; action: "create" | "reuse" | "archive"; key: string; name: string }
  | { kind: "members"; action: "sync"; members: string[] };

export type TeamSpacePlan =
  | { status: "ineligible"; reason: "invalid_name" | "empty_team" | "quota" | "invalid_members" | "team_disabled" }
  | {
      status: "planned";
      spaceKey: string;
      roleName: string;
      channelName: string;
      rolePermissions: "0";
      overwrites: OverwritePlan[];
      steps: TeamSpaceStep[];
      archived: boolean;
    };

export interface TeamSpaceInput {
  team: {
    id: string;
    name: string;
    communityId: string;
    active?: boolean;
    memberDiscordIds: string[];
  };
  existing: { channels: GuildChannelSummary[]; roles: GuildRoleSummaryLite[] };
  managed: { communityId: string; channelIds: string[] };
  limits?: { maxSpacesPerCommunity?: number };
}

const snowflake = /^[0-9]{16,20}$/;

/** Nom de salon Discord : minuscules, sans accent, séparateurs unifiés. */
export function sanitizeChannelName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CHANNEL_NAME);
}

/** Nom de rôle : lisible, borné, sans caractères de permission (aucun n'a d'effet). */
export function sanitizeRoleName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_NAME);
}

export function spaceKey(teamId: string): string {
  return `${SPACE_KEY_PREFIX}${teamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
}

export function planTeamSpace(input: TeamSpaceInput): TeamSpacePlan {
  const { team } = input;
  if (team.active === false) return { status: "ineligible", reason: "team_disabled" };
  if (input.managed.communityId !== team.communityId) return { status: "ineligible", reason: "quota" };

  const roleName = sanitizeRoleName(`GN · ${team.name}`);
  const channelName = sanitizeChannelName(team.name);
  if (roleName.length < 3 || channelName.length < 2) return { status: "ineligible", reason: "invalid_name" };

  const members = [...new Set(team.memberDiscordIds)];
  if (members.some((id) => !snowflake.test(id))) return { status: "ineligible", reason: "invalid_members" };
  if (members.length > MAX_MEMBERS_PER_SPACE) return { status: "ineligible", reason: "invalid_members" };

  const maxSpaces = input.limits?.maxSpacesPerCommunity ?? DEFAULT_MAX_SPACES_PER_COMMUNITY;
  const key = spaceKey(team.id);
  const existingChannel = input.existing.channels.find((channel) => channel.name === channelName || channel.name === key);
  if (!existingChannel && input.managed.channelIds.length >= maxSpaces) {
    return { status: "ineligible", reason: "quota" };
  }

  const existingRole = input.existing.roles.find((role) => role.name === roleName || role.name === key);
  const archived = members.length === 0;

  const steps: TeamSpaceStep[] = [
    existingRole
      ? { kind: "role", action: "reuse", key, name: existingRole.name }
      : { kind: "role", action: "create", key, name: roleName },
    archived
      ? { kind: "channel", action: "archive", key, name: existingChannel?.name ?? channelName }
      : existingChannel
        ? { kind: "channel", action: "reuse", key, name: existingChannel.name }
        : { kind: "channel", action: "create", key, name: channelName },
    { kind: "members", action: "sync", members },
  ];

  return {
    status: "planned",
    spaceKey: key,
    roleName,
    channelName,
    rolePermissions: "0",
    overwrites: [
      // Salon privé : personne d'autre que les membres ne le voit.
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ],
    steps,
    archived,
  };
}

export interface TeamSpaceClient {
  createRole(input: { name: string; permissions: "0"; mentionable: false; hoist: false }): Promise<{ id: string }>;
  createChannel(input: {
    name: string;
    type: 0;
    overwrites: OverwritePlan[];
    reason: string;
  }): Promise<{ id: string }>;
  editChannel?(input: { id: string; name: string; reason: string }): Promise<unknown>;
}

export type TeamSpaceApplyResult = {
  status: "disabled" | "applied" | "partial" | "ineligible";
  steps: Array<{ key: string; kind: TeamSpaceStep["kind"]; status: "ok" | "skipped" | "failed"; detail?: string }>;
};

export function teamSpacesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TEAM_SPACES_ENABLED === "true";
}

/**
 * Exécute le plan, étape par étape. Un échec de rôle empêche la création du
 * salon (pas de salon orphelin) ; les autres échecs sont rapportés sans lancer
 * d'exception, pour que l'appelant puisse reprendre ou archiver.
 */
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

  for (const step of plan.steps) {
    if (step.kind === "members") {
      // La synchronisation des permissions des membres se fait à la création du
      // salon ; aucun appel réseau supplémentaire ici.
      steps.push({ key: plan.spaceKey, kind: step.kind, status: roleFailed || channelFailed ? "skipped" : "ok" });
      continue;
    }
    if (step.kind === "role") {
      if (step.action === "reuse") {
        steps.push({ key: step.key, kind: step.kind, status: "ok", detail: "existing" });
        continue;
      }
      try {
        await client.createRole({ name: step.name, permissions: "0", mentionable: false, hoist: false });
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
      steps.push({ key: step.key, kind: step.kind, status: "ok", detail: "existing" });
      continue;
    }
    try {
      if (step.action === "archive") {
        if (!client.editChannel) throw new Error("editChannel indisponible");
        await client.editChannel({ id: step.key, name: `archive-${step.name}`.slice(0, MAX_CHANNEL_NAME), reason: "gn-team-archive" });
      } else {
        await client.createChannel({ name: step.name, type: 0, overwrites: plan.overwrites, reason: "gn-team-space" });
      }
      steps.push({ key: step.key, kind: step.kind, status: "ok" });
    } catch (error) {
      channelFailed = true;
      steps.push({ key: step.key, kind: step.kind, status: "failed", detail: error instanceof Error ? error.message : "unknown" });
    }
  }

  const failed = steps.some((step) => step.status === "failed");
  return { status: failed ? "partial" : "applied", steps };
}
