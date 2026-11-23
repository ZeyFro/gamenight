import { buildAutocompleteResponse } from "@/lib/discord-tournament-autocomplete";
import { buildSessionAutocompleteResponse } from "@/lib/discord-session-autocomplete";
import { buildRoleAutocompleteResponse } from "@/lib/discord-role-autocomplete";
import { logger } from "@/lib/logger";

type AutocompleteResult = { status: 200 | 400; body?: unknown };

/**
 * Budget de réponse (audit du 23/11/2026) : Discord abandonne une autocomplétion après 3 s et elle ne peut PAS être différée (contrairement
 * aux commandes). Avec une base Neon endormie, le démarrage à froid dépasse ce délai : Discord affichait « chargement échoué ». Passé
 * `AUTOCOMPLETE_BUDGET_MS`, on répond une liste vide (le joueur tape ou réessaie) plutôt que de ne rien répondre. Les erreurs
 * ordinaires restent propagées comme avant : seul le dépassement de délai est converti.
 */
export const AUTOCOMPLETE_BUDGET_MS = 2200;
const EMPTY_CHOICES: AutocompleteResult = { status: 200, body: { type: 8, data: { choices: [] } } };

function withinBudget(work: Promise<AutocompleteResult>, command: string): Promise<AutocompleteResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      logger.warn("discord-autocomplete", "Autocomplétion trop lente : liste vide renvoyée avant le délai de 3 s de Discord.", { command, budgetMs: AUTOCOMPLETE_BUDGET_MS });
      resolve(EMPTY_CHOICES);
    }, AUTOCOMPLETE_BUDGET_MS);
    work.then(
      (result) => { if (!settled) { clearTimeout(timer); resolve(result); } },
      (error) => {
        if (!settled) { clearTimeout(timer); reject(error); return; }
        // Réponse déjà partie : l'échec tardif est journalisé, jamais une promesse rejetée sans gestionnaire.
        logger.error("discord-autocomplete", error, { command, late: true });
      },
    );
  });
}

/**
 * Point d'entrée unique des interactions Discord de type 4 (autocomplétion).
 *
 * Le routeur (`src/lib/discord-interactions.ts`) n'a qu'une ligne d'aiguillage vers ce module.
 *
 * Chaque adaptateur valide lui-même application, horodatage, serveur et
 * appartenance. Aucune écriture, aucune création de ressource Discord.
 */
export async function handleSignedAutocomplete(
  body: unknown,
  timestamp: string | null
): Promise<AutocompleteResult> {
  const name = (body as { data?: { name?: unknown } } | null)?.data?.name;
  if (name === "tournoi") return withinBudget(Promise.resolve(buildAutocompleteResponse(body, timestamp)), "tournoi");
  if (name === "soiree") return withinBudget(Promise.resolve(buildSessionAutocompleteResponse(body, timestamp)), "soiree");
  if (name === "role") return withinBudget(Promise.resolve(buildRoleAutocompleteResponse(body, timestamp)), "role");
  return { status: 400 };
}
