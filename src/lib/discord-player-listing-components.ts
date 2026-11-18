import type { DiscordActionRow } from "@/lib/discord-rest";
import { gameNightUrl } from "@/lib/discord-links";

/**
 * Composants d'une annonce de joueur (`PlayerClassified`).
 *
 * - « Je suis intéressé » (`gn:listing:interest:<id>`) : signale l'intérêt.
 * - « Contacter l'auteur » (`gn:listing:contact:<id>`) : renvoie la mention
 *   Discord de l'auteur, résolue côté serveur.
 * - Bouton lien vers GameNight **seulement** si l'origine est résolvable.
 *
 * Aucun modèle de candidature n'existe : l'intérêt n'est donc **pas** persisté.
 * Le handler le dit explicitement au joueur au lieu de simuler un enregistrement.
 */
const LISTING_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export type PlayerListingComponent =
  | { kind: "interest"; listingId: string }
  | { kind: "contact"; listingId: string };

export function parsePlayerListingComponent(customId: string): PlayerListingComponent | null {
  const match = /^gn:listing:(interest|contact):([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  if (!match) return null;
  return { kind: match[1] as "interest" | "contact", listingId: match[2] };
}

export function playerListingComponents(
  input: { listingId: string; expired?: boolean },
  env: NodeJS.ProcessEnv = process.env
): DiscordActionRow[] {
  if (!LISTING_ID.test(input.listingId)) return [];
  const rows: DiscordActionRow[] = [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Je suis intéressé", custom_id: `gn:listing:interest:${input.listingId}` },
        { type: 2, style: 2, label: "Contacter l’auteur", custom_id: `gn:listing:contact:${input.listingId}` },
      ],
    },
  ];
  const url = input.expired ? null : gameNightUrl("/joueurs", env);
  if (url) {
    // Bouton lien (style 5) : Discord n’envoie aucune interaction pour lui, il
    // ouvre directement GameNight. Le type partagé `DiscordActionRow` ne décrit
    // que les boutons à `custom_id`, on l’étend donc localement plutôt que de
    // durcir un type partagé avec les autres PR.
    const linkButton = { type: 2, style: 5, label: "Ouvrir GameNight", url } as unknown as DiscordActionRow["components"][number];
    rows[0].components.push(linkButton);
  }
  return rows;
}
