import { z } from "zod";
import { listGuildRoles } from "@/lib/discord-rest";
import {
  MAX_ROLE_QUERY_LENGTH,
  canonicalRoleName,
  isSensitiveRole,
  isSensitiveRoleName,
  normalizeRoleKey,
  queryKey,
  type GuildRoleSummary,
} from "@/lib/discord-guild-roles";

/**
 * Autocomplétion de `/role` : le joueur cherche son jeu, sans recopier un nom
 * exact ni un identifiant Discord.
 *
 * Lecture seule : on ne crée, n'attribue ni ne retire **aucun** rôle ici.
 * Les rôles sensibles (administration, intégrations, @everyone, permissions
 * élevées) sont exclus des suggestions, comme dans `/role chercher`.
 *
 * Le sous-commande `creer` propose en plus le nom canonique de la saisie :
 * l'attribution ou la création restent décidées par `runRoleCommand`, qui porte
 * les règles (permissions, limites, création autorisée).
 */
const MAX_CHOICES = 25;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const SUBS = ["chercher", "attribuer", "creer", "retirer"] as const;

const schema = z.object({
  type: z.literal(4),
  application_id: snowflake,
  guild_id: snowflake.optional(),
  data: z.object({
    name: z.literal("role"),
    options: z
      .array(
        z.object({
          name: z.enum(SUBS),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                value: z.union([z.string(), z.number()]).optional(),
                focused: z.boolean().optional(),
              })
            )
            .max(3)
            .optional(),
        })
      )
      .max(1)
      .optional(),
  }),
});

export interface RoleChoice {
  name: string;
  value: string;
}

/** Suggestions dédupliquées, sans accent, rôles sensibles exclus. */
export function filterRoleChoices(roles: GuildRoleSummary[], query: string): RoleChoice[] {
  const needle = normalizeRoleKey(query);
  const seen = new Set<string>();
  const choices: RoleChoice[] = [];
  for (const role of roles) {
    if (isSensitiveRole(role)) continue;
    const key = normalizeRoleKey(role.name);
    if (!key || seen.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seen.add(key);
    choices.push({ name: role.name.slice(0, 100), value: role.name.slice(0, 100) });
  }
  const startsWith = (choice: RoleChoice) => normalizeRoleKey(choice.name).startsWith(needle);
  return choices.sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)) || a.name.localeCompare(b.name, "fr")).slice(0, MAX_CHOICES);
}

/** Pour `creer` : propose le nom normalisé de la saisie, s'il est acceptable. */
export function creationChoice(query: string): RoleChoice | null {
  const name = canonicalRoleName(query);
  if (!name || !queryKey(name) || isSensitiveRoleName(name)) return null;
  return { name, value: name.slice(0, MAX_ROLE_QUERY_LENGTH) };
}

export async function buildRoleAutocompleteResponse(body: unknown, timestamp: string | null) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { status: 400 as const };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID ||
    !interaction.guild_id ||
    process.env.DISCORD_ROLE_COMMAND_ENABLED !== "true"
  ) {
    return { status: 400 as const };
  }
  const sub = interaction.data.options?.[0];
  if (!sub) return { status: 400 as const };
  const focused = sub.options?.find((option) => option.focused)?.value;
  const query = typeof focused === "string" ? focused : "";

  const listed = await listGuildRoles({ guildId: interaction.guild_id, deadline: new Date(Date.now() + 2_000) });
  if (!listed.ok) return { status: 200 as const, body: { type: 8, data: { choices: [] } } };

  const choices = filterRoleChoices(listed.data.roles, query);
  if (sub.name === "creer") {
    const proposed = creationChoice(query);
    if (proposed && !choices.some((choice) => normalizeRoleKey(choice.name) === normalizeRoleKey(proposed.name))) {
      choices.unshift(proposed);
    }
  }
  return { status: 200 as const, body: { type: 8, data: { choices: choices.slice(0, MAX_CHOICES) } } };
}
