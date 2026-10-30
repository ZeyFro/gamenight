import { z } from "zod";
import type { InteractionOutput } from "@/lib/discord-interactions";
import { editSetupResponse } from "@/lib/discord-rest";
import { logger } from "@/lib/logger";
import { addSoloTowerChallengeDefinition, deactivateSoloTowerChallengeDefinition, importSoloTowerChallengeStarterPack, importTeamTowerChallengeStarterPack, listSoloTowerChallengeDefinitions } from "@/lib/tower-challenges";

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const values = z.array(z.object({
  type: z.number().int(),
  name: z.string().min(1).max(32),
  value: z.union([z.string().max(1500), z.number().int()]),
})).max(3);
const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake,
  channel_id: snowflake,
  member: z.object({
    permissions: z.string().regex(/^\d+$/),
    user: z.object({ id: snowflake }),
  }),
  data: z.object({
    name: z.literal("tower-admin"),
    options: z.array(z.object({
      type: z.literal(1),
      name: z.enum(["ajouter", "defis", "desactiver", "importer", "importer-equipe"]),
      options: values.optional(),
    })).length(1),
  }),
});
const addSchema = z.object({
  titre: z.string().trim().min(1).max(120),
  consigne: z.string().trim().min(1).max(1500),
  etages: z.number().int().min(1).max(20),
});
const deactivateSchema = z.object({ id: z.string().min(1).max(64) });
const MANAGE_GUILD = BigInt(0x20);
const ADMINISTRATOR = BigInt(0x8);
const EPHEMERAL = 64;
const quiet = (content: string): InteractionOutput => ({
  status: 200, body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});
const ack: InteractionOutput = { status: 200, body: { type: 5, data: { flags: EPHEMERAL } } };

function canManageGuild(permissions: string): boolean {
  return (BigInt(permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== BigInt(0);
}
function parseOptions(options: z.infer<typeof values>) {
  if (new Set(options.map(option => option.name)).size !== options.length) return null;
  return Object.fromEntries(options.map(option => [option.name, option.value]));
}
function messageFor(status: string): string {
  switch (status) {
    case "CREATED": return "✅ Défi solo ajouté au catalogue. Il ne sera proposé que lorsque les défis seront activés.";
    case "DUPLICATE": return "Un défi solo actif porte déjà ce titre.";
    case "DEACTIVATED": return "Défi désactivé pour les prochaines attributions. Les tentatives en cours restent intactes.";
    case "ALREADY_INACTIVE": return "Ce défi est déjà désactivé.";
    case "NOT_FOUND": return "Aucun défi solo correspondant à cet ID dans ce serveur.";
    case "UNAVAILABLE": return "Aucune communauté GameNight active n’est configurée pour ce serveur.";
    default: return "La demande est invalide ou n’a pas pu être traitée.";
  }
}

/** Appelé par la route seulement après validation de la signature Ed25519 du corps brut. */
export function handleSignedTowerAdminInteraction(body: unknown, timestamp: string | null): InteractionOutput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300
    || interaction.application_id !== process.env.DISCORD_CLIENT_ID
    || interaction.guild_id !== process.env.TOWER_DISCORD_GUILD_ID) return { status: 400 };
  if (!canManageGuild(interaction.member.permissions)) return quiet("Il faut la permission « Gérer le serveur » pour gérer le catalogue The Tower.");

  const command = interaction.data.options[0];
  const args = command.options ?? [];
  const parsedArgs = parseOptions(args);
  if (!parsedArgs) return { status: 400 };
  if (command.name === "ajouter") {
    const input = addSchema.safeParse(parsedArgs);
    if (!input.success || args.length !== 3 || args.some(option => option.type !== 3 && option.type !== 4)) return { status: 400 };
  } else if (command.name === "desactiver") {
    const input = deactivateSchema.safeParse(parsedArgs);
    if (!input.success || args.length !== 1 || args[0].type !== 3) return { status: 400 };
  } else if (command.name === "defis") {
    const input = z.object({ page: z.number().int().min(1).max(10000).optional() }).safeParse(parsedArgs);
    if (!input.success || args.length > 1 || args.some(option => option.name !== "page" || option.type !== 4)) return { status: 400 };
  } else if (args.length !== 0) {
    return { status: 400 };
  }
  return { ...ack, runTower: async () => {
    let content = "Impossible de traiter le catalogue maintenant.";
    try {
      if (command.name === "ajouter") {
        const input = addSchema.parse(parsedArgs);
        const result = await addSoloTowerChallengeDefinition({
          guildId: interaction.guild_id, title: input.titre, instructions: input.consigne, rewardFloors: input.etages,
        });
        content = messageFor(result.status);
      } else if (command.name === "desactiver") {
        const input = deactivateSchema.parse(parsedArgs);
        const result = await deactivateSoloTowerChallengeDefinition({ guildId: interaction.guild_id, definitionId: input.id });
        content = messageFor(result.status);
      } else if (command.name === "importer") {
        const result = await importSoloTowerChallengeStarterPack({ guildId: interaction.guild_id });
        content = result.status === "IMPORTED"
          ? "✅ Catalogue prêt : " + result.added + " défis ajoutés, " + result.alreadyPresent + " déjà présents. Une nouvelle importation ne réactive pas les défis désactivés."
          : messageFor(result.status);
      } else if (command.name === "importer-equipe") {
        const result = await importTeamTowerChallengeStarterPack({ guildId: interaction.guild_id });
        content = result.status === "IMPORTED"
          ? "✅ Catalogue d'équipe prêt : " + result.added + " défis ajoutés, " + result.alreadyPresent + " déjà présents. Aucune annonce n'a été envoyée."
          : messageFor(result.status);
      } else {
        const pageInput = z.object({ page: z.number().int().min(1).max(10000).optional() }).parse(parsedArgs);
        const result = await listSoloTowerChallengeDefinitions({ guildId: interaction.guild_id, page: pageInput.page });
        if (result.status !== "LISTED") content = messageFor(result.status);
        else if (result.total === 0) content = "Le catalogue solo est vide. Ajoute un défi avec /tower-admin ajouter.";
        else if (!result.definitions.length) content = "Aucune entrée sur cette page. Page " + result.page + "/" + Math.ceil(result.total / 12) + ".";
        else content = "🏰 **Catalogue solo — page " + result.page + "/" + Math.ceil(result.total / 12) + " (" + result.total + ")**\n" + result.definitions
          .map(definition => `${definition.id} — ${definition.active ? "actif" : "désactivé"} — +${definition.rewardFloors} étage(s) — ${definition.title.slice(0, 52)}`)
          .join("\n");
      }
    } catch {
      logger.error("discord-tower-admin", "L’administration du catalogue a échoué.");
    }
    const sent = await editSetupResponse({ applicationId: interaction.application_id, token: interaction.token,
      content: content.slice(0, 1900), deadline: new Date(Date.now() + 10000) });
    if (!sent.ok) logger.error("discord-tower-admin", "Réponse privée non livrée.", { kind: sent.kind });
  } };
}
