import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { InteractionOutput } from "@/lib/discord-interactions";
import {
  addGuildMemberRole,
  createGuildRole,
  editSetupResponse,
  getGuildMemberRoles,
  getSetupBot,
  listGuildRoles,
  removeGuildMemberRole,
  type DiscordRestFailure,
} from "@/lib/discord-rest";
import {
  botCanManageRoles,
  DEFAULT_MAX_GUILD_ROLES,
  MAX_ROLE_QUERY_LENGTH,
  canonicalRoleName,
  exactRoleMatches,
  isSensitiveRole,
  planRoleGrant,
  queryKey,
  suggestRoleMatches,
  topRolePosition,
  type GuildRoleSummary,
  type RoleRefusalReason,
} from "@/lib/discord-guild-roles";
import { syncGameRoleToProfile, unsyncGameRoleFromProfile, type RoleProfileSync } from "@/lib/discord-role-sync";
import { withRoleCreationLock } from "@/lib/discord-role-lock";

/**
 * Commande `/role` — attribution libre-service des rôles de JEU Discord et
 * synchronisation du profil GameNight.
 *
 * Périmètre v1 (aucune migration) :
 * - `chercher` : trouve les rôles existants, sans jamais proposer un rôle
 *   technique ;
 * - `attribuer` : attribue un rôle de jeu existant (PUT idempotent) ; le crée
 *   seulement s'il n'existe pas ET que la création est permise ;
 * - `creer` : crée le rôle de jeu (mêmes garde-fous) puis l'attribue ;
 * - `retirer` : retire au joueur un rôle de jeu qu'il porte.
 *
 * Garde-fous tenus à chaque exécution :
 * - rôle sensible (nom réservé, permissions élevées, rôle géré par une
 *   intégration, `@everyone`) jamais attribué ni retiré ;
 * - rôle au-dessus du rôle le plus haut du bot jamais attribué ;
 * - nom normalisé unique : rejouer l'interaction ne duplique jamais un rôle ;
 * - rôle créé sans aucune permission Discord, non mentionnable, non affiché
 *   à part ;
 * - erreurs Discord traduites (permission du bot, limite de débit, réseau
 *   incertain) sans jamais prétendre que l'action a réussi.
 *
 * Ce module n'appelle Discord QUE si `DISCORD_ROLE_COMMAND_ENABLED=true` et
 * que le corps a déjà été vérifié par la signature Ed25519 dans
 * `discord-interactions.ts`.
 */

const EPHEMERAL = 64;
const ADMINISTRATOR = BigInt(1) << BigInt(3);
const MANAGE_ROLES = BigInt(1) << BigInt(28);
const REQUEST_BUDGET_MS = 8_000;
const REPLY_BUDGET_MS = 10_000;

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake,
  member: z.object({
    permissions: z.string().regex(/^\d+$/).optional(),
    user: z.object({
      id: snowflake,
      username: z.string().min(1).max(100),
      bot: z.literal(false).optional(),
    }),
  }),
  data: z.object({
    name: z.literal("role"),
    options: z
      .array(
        z.object({
          // 1 = sous-commande ; 3 = option texte (`/role jeu:Valorant`).
          type: z.number().optional(),
          name: z.string().min(1).max(32),
          options: z
            .array(z.object({ name: z.string().min(1).max(32), type: z.number().optional(), value: z.string().max(400).optional() }))
            .max(5)
            .optional(),
          value: z.string().max(400).optional(),
        })
      )
      .min(1)
      .max(1),
  }),
});

export type RoleCommandSub = "chercher" | "attribuer" | "creer" | "retirer";

export interface RoleCommandInput {
  sub: RoleCommandSub;
  query: string;
  guildId: string;
  invokerId: string;
  invokerPermissions: string;
}

const quiet = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

function deadline() {
  return new Date(Date.now() + REQUEST_BUDGET_MS);
}

/** Trois créations de rôle par heure et par joueur (quota horaire glissant). */
const ROLE_CREATION_QUOTA = { limit: 3, windowMs: 60 * 60 * 1000 };

function maxGuildRoles(): number {
  const configured = Number(process.env.DISCORD_ROLE_MAX_GUILD_ROLES);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_GUILD_ROLES;
}

function describeFailure(failure: DiscordRestFailure): string {
  switch (failure.kind) {
    case "auth_or_permission":
      return "Le bot n’a pas la permission « Gérer les rôles » sur ce serveur, ou ce rôle est au-dessus du sien : demande à un administrateur de corriger la hiérarchie.";
    case "rate_limited":
      return "Discord limite les demandes de rôle pendant quelques secondes. Réessaie dans un instant.";
    case "not_configured":
      return "La commande /role n’est pas configurée sur ce serveur.";
    case "not_found":
      return "Ce serveur, ce membre ou ce rôle est introuvable sur Discord.";
    case "network_uncertain":
      return "Discord n’a pas confirmé cette action. Vérifie tes rôles avant de réessayer.";
    case "insufficient_lease":
      return "L’action a pris trop de temps. Réessaie dans un instant.";
    default:
      return "Discord a refusé cette action de rôle. Vérifie la hiérarchie des rôles du bot avant de réessayer.";
  }
}

function listNames(roles: GuildRoleSummary[]): string {
  return roles.map((role) => `**${role.name}**`).join(", ");
}

function describeRefusal(reason: RoleRefusalReason, candidates: GuildRoleSummary[]): string {
  switch (reason) {
    case "invalid_name":
      return `Indique un nom de jeu de 1 à ${MAX_ROLE_QUERY_LENGTH} caractères, par exemple \`/role attribuer jeu:Deep Rock Galactic\`.`;
    case "sensitive":
      return "Ce rôle est technique ou administratif : /role ne l’attribue jamais et ne le retire jamais.";
    case "ambiguous":
      return candidates.length > 0
        ? `Plusieurs rôles correspondent : ${listNames(candidates)}. Reprends la commande avec le nom exact.`
        : "Ce nom correspond à plusieurs rôles. Reprends la commande avec le nom exact.";
    case "not_assignable":
      return "Ce rôle est au-dessus du rôle le plus haut du bot : un administrateur doit descendre le rôle GameNight dans la hiérarchie.";
    case "creation_forbidden":
      return "Ce rôle n’existe pas encore et le bot ne peut pas le créer : il lui manque la permission « Gérer les rôles », ou la création est désactivée sur ce serveur. Un administrateur doit corriger la permission du bot.";
    case "guild_full":
      return "Ce serveur a atteint le nombre de rôles autorisé par GameNight. Un administrateur peut relever la limite ou créer le rôle manuellement.";
    default:
      return "Cette action n’est pas possible pour le moment.";
  }
}

function syncNote(sync: RoleProfileSync): string {
  if (sync.status === "synced") return ` 📚 Ton profil GameNight suit maintenant « ${sync.tagName} ».`;
  if (sync.status === "not_linked") {
    return " Connecte ton compte Discord à GameNight pour que ce jeu apparaisse aussi sur ton profil.";
  }
  return "";
}

async function describeSearch(roles: GuildRoleSummary[], query: string): Promise<string> {
  const exact = exactRoleMatches(roles, query);
  if (exact.length === 1) {
    const role = exact[0];
    if (isSensitiveRole(role)) return `**${role.name}** est un rôle technique ou géré par une intégration : /role ne l’attribue jamais.`;
    return `**${role.name}** existe déjà. Utilise \`/role attribuer jeu:${role.name}\`.`;
  }
  if (exact.length > 1) return `Plusieurs rôles portent ce nom : ${listNames(exact.slice(0, 5))}. Précise lequel tu veux.`;
  const suggestions = suggestRoleMatches(roles, query, 8);
  if (suggestions.length === 0) {
    return `Aucun rôle de jeu ne correspond à « ${canonicalRoleName(query)} ». \`/role attribuer jeu:${canonicalRoleName(query)}\` le créera si ta communauté l’autorise.`;
  }
  return `Rôles trouvés : ${listNames(suggestions)}. Utilise \`/role attribuer jeu:<nom exact>\`.`;
}

async function assignRole(input: {
  guildId: string;
  invokerId: string;
  role: GuildRoleSummary;
  alreadyPresent: boolean;
}): Promise<string> {
  const added = await addGuildMemberRole({
    guildId: input.guildId,
    userId: input.invokerId,
    roleId: input.role.id,
    deadline: deadline(),
  });
  if (!added.ok) return describeFailure(added);
  const sync = await syncGameRoleToProfile({ discordId: input.invokerId, gameName: input.role.name });
  const prefix = input.alreadyPresent
    ? `✅ Le rôle **${input.role.name}** existait déjà, il t’a été attribué.`
    : `✅ Rôle **${input.role.name}** ajouté.`;
  return prefix + syncNote(sync);
}

async function createThenAssign(input: {
  guildId: string;
  invokerId: string;
  name: string;
  botTopPosition: number;
}): Promise<string> {
  // Deuxième lecture juste avant la création : une interaction rejouée (ou une
  // seconde instance) retrouve le rôle créé entre-temps au lieu d'en créer un
  // doublon. La fenêtre résiduelle est celle d'un appel réseau, pas d'une
  // session — la garantie forte (quota persistant) demande une table dédiée.
  const fresh = await listGuildRoles({ guildId: input.guildId, deadline: deadline() });
  if (!fresh.ok) return describeFailure(fresh);
  const concurrent = exactRoleMatches(fresh.data.roles, input.name);
  if (concurrent.length > 0) {
    const role = concurrent[0];
    if (isSensitiveRole(role)) return describeRefusal("sensitive", []);
    const assignable = role.position > 0 && role.position < input.botTopPosition;
    if (!assignable) return describeRefusal("not_assignable", []);
    return assignRole({ guildId: input.guildId, invokerId: input.invokerId, role, alreadyPresent: true });
  }
  const created = await createGuildRole({ guildId: input.guildId, name: input.name, deadline: deadline() });
  if (!created.ok) return describeFailure(created);
  return assignRole({
    guildId: input.guildId,
    invokerId: input.invokerId,
    role: { id: created.data.id, name: created.data.name, position: 1, permissions: "0", managed: false },
    alreadyPresent: false,
  });
}

/**
 * Le joueur doit appartenir à la communauté GameNight de ce serveur. Aucun rôle
 * n'est attribué ni créé pour un compte Discord extérieur.
 */
async function isActiveCommunityMember(guildId: string, discordId: string): Promise<boolean> {
  const community = await prisma.community.findFirst({
    where: { discordGuildId: guildId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!community) return false;
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true, memberships: { where: { communityId: community.id, status: "ACTIVE" }, select: { id: true } } },
  });
  return Boolean(user?.memberships.length);
}

/** Cœur testable de la commande : renvoie le message privé à afficher au joueur. */
export async function runRoleCommand(
  input: RoleCommandInput & { membershipCheck?: (guildId: string, discordId: string) => Promise<boolean> }
): Promise<string> {
  if (!queryKey(input.query)) return describeRefusal("invalid_name", []);

  const isMember = await (input.membershipCheck ?? isActiveCommunityMember)(input.guildId, input.invokerId);
  if (!isMember) {
    return "Ton compte Discord n’est pas encore membre actif de cette communauté GameNight : connecte-toi une fois sur le site, puis réessaie.";
  }

  const listed = await listGuildRoles({ guildId: input.guildId, deadline: deadline() });
  if (!listed.ok) return describeFailure(listed);
  const roles = listed.data.roles;

  if (input.sub === "chercher") return describeSearch(roles, input.query);

  const member = await getGuildMemberRoles({ guildId: input.guildId, userId: input.invokerId, deadline: deadline() });
  if (!member.ok) return describeFailure(member);
  const memberRoleIds = member.data.roles;

  if (input.sub === "retirer") {
    const exact = exactRoleMatches(roles, input.query);
    if (exact.length !== 1) {
      return exact.length > 1
        ? `Plusieurs rôles portent ce nom : ${listNames(exact.slice(0, 5))}. Précise lequel retirer.`
        : "Aucun rôle de jeu ne porte ce nom. Utilise `/role chercher` pour retrouver le nom exact.";
    }
    const role = exact[0];
    if (isSensitiveRole(role)) return describeRefusal("sensitive", []);
    if (!memberRoleIds.includes(role.id)) return `Tu n’as pas le rôle **${role.name}**.`;
    const removed = await removeGuildMemberRole({
      guildId: input.guildId,
      userId: input.invokerId,
      roleId: role.id,
      deadline: deadline(),
    });
    if (!removed.ok) return describeFailure(removed);
    // Suivre un jeu = rôle Discord + centre d'intérêt : le retrait est cohérent
    // dans les deux sens. Le `Tag` partagé n'est jamais supprimé.
    const sync = await unsyncGameRoleFromProfile({ discordId: input.invokerId, gameName: role.name });
    return sync.status === "synced"
      ? `✅ Rôle **${role.name}** retiré et ton profil GameNight ne suit plus ce jeu.`
      : `✅ Rôle **${role.name}** retiré.`;
  }

  const bot = await getSetupBot({ guildId: input.guildId, deadline: deadline() });
  if (!bot.ok) return describeFailure(bot);
  const botTopPosition = topRolePosition(roles, bot.data.roles);
  // La permission « Gérer les rôles » est celle du BOT (et sa position dans la
  // hiérarchie), jamais celle du joueur : un membre ordinaire peut utiliser une
  // création autorisée. Le flag ne sert qu'à fermer la création d'un serveur.
  const canCreate =
    botCanManageRoles(roles, bot.data.roles) && process.env.DISCORD_ROLE_SELF_CREATION_ENABLED !== "false";
  const plan = planRoleGrant({
    roles,
    query: input.query,
    botTopPosition,
    canCreate,
    memberRoleIds,
    maxGuildRoles: maxGuildRoles(),
  });

  switch (plan.action) {
    case "refuse":
      return describeRefusal(plan.reason, plan.candidates);
    case "already":
      return `Tu as déjà le rôle **${plan.role.name}**.`;
    case "create": {
      // Création bornée : permission du bot, quota horaire par joueur, plafond de
      // rôles de la guilde (vérifié dans planRoleGrant), et verrou partagé.
      if (!checkRateLimit(input.invokerId, "discord-role-create", ROLE_CREATION_QUOTA)) {
        return `${RATE_LIMIT_MESSAGE} Trois créations de rôle par heure maximum.`;
      }
      const locked = await withRoleCreationLock({
        guildId: input.guildId,
        key: queryKey(plan.name) || plan.name.toLowerCase(),
        run: () =>
          createThenAssign({ guildId: input.guildId, invokerId: input.invokerId, name: plan.name, botTopPosition }),
      });
      if (locked.status === "busy") {
        return "Une autre création de rôle est déjà en cours pour ce jeu. Réessaie dans quelques secondes : le rôle existant sera réutilisé, jamais dupliqué.";
      }
      return locked.value;
    }
    case "assign":
      return assignRole({ guildId: input.guildId, invokerId: input.invokerId, role: plan.role, alreadyPresent: false });
  }
}

/** Exclusivement appelé après la vérification Ed25519 du corps brut dans discord-interactions. */
export function handleSignedRoleInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  if (process.env.DISCORD_ROLE_COMMAND_ENABLED !== "true") {
    return quiet("La commande /role n’est pas encore ouverte sur ce serveur.");
  }
  const first = interaction.data.options[0];
  const SUBS = new Set(["chercher", "attribuer", "creer", "retirer"]);
  // `/role jeu:Valorant` (option directe, type 3) vaut `/role attribuer jeu:Valorant`.
  const direct = first.type !== 1 && first.name === "jeu";
  if (!direct && !SUBS.has(first.name)) return { status: 400 };
  const sub = direct ? null : { name: first.name, options: first.options };
  if (direct && !first.value?.trim()) return { status: 400 };
  const query = direct ? (first.value ?? "").trim() : (sub?.options?.find((option) => option.name === "jeu")?.value ?? "").trim();
  // ACK immédiat (< 3 s) : aucune requête Discord ni SQL avant la réponse.
  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runRole: async () => {
      let content: string;
      try {
        content = await runRoleCommand({
          sub: (direct ? "attribuer" : sub!.name) as RoleCommandSub,
          query,
          guildId: interaction.guild_id,
          invokerId: interaction.member.user.id,
          invokerPermissions: interaction.member.permissions ?? "0",
        });
      } catch (error) {
        logger.warn("discord-role", "Échec du traitement /role.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de confirmer cette action pour le moment. Vérifie tes rôles dans Discord avant de réessayer.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, 1900),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-role", "Réponse privée de /role non livrée.", { kind: sent.kind });
    },
  };
}
