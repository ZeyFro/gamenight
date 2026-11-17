import { buildAutocompleteResponse } from "@/lib/discord-tournament-autocomplete";
import { buildSessionAutocompleteResponse } from "@/lib/discord-session-autocomplete";
import { buildRoleAutocompleteResponse } from "@/lib/discord-role-autocomplete";

/**
 * Point d'entrée unique des interactions Discord de type 4 (autocomplétion).
 *
 * Le routeur (`src/lib/discord-interactions.ts`) est réservé par #408 : il ne
 * reçoit qu'une seule ligne d'aiguillage vers ce module, identique au patch
 * `docs/patches/20261117-autocomplete-routage.patch`, afin que les deux branches
 * se rejoignent sans conflit.
 *
 * Chaque adaptateur valide lui-même application, horodatage, serveur et
 * appartenance. Aucune écriture, aucune création de ressource Discord.
 */
export async function handleSignedAutocomplete(
  body: unknown,
  timestamp: string | null
): Promise<{ status: 200 | 400; body?: unknown }> {
  const name = (body as { data?: { name?: unknown } } | null)?.data?.name;
  if (name === "tournoi") return buildAutocompleteResponse(body, timestamp);
  if (name === "soiree") return buildSessionAutocompleteResponse(body, timestamp);
  if (name === "role") return buildRoleAutocompleteResponse(body, timestamp);
  return { status: 400 };
}
