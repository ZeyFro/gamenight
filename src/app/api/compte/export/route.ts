import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAccountDeletionEnabled } from "@/lib/account-deletion-flag";
import { buildAccountExport, serializeAccountExport } from "@/lib/account-export";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Export des données personnelles (ACCOUNT_DELETION_ENABLED, docs/SUPPRESSION_COMPTE.md) : un fichier JSON lisible,
 * uniquement les données de la personne connectée (jamais un identifiant fourni par la requête), sans jetons ni
 * donnée d'autrui. Flag éteint : 404 côté serveur.
 */
export async function GET() {
  if (!isAccountDeletionEnabled()) return new Response(null, { status: 404, headers: NO_STORE });
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return new Response(null, { status: 401, headers: NO_STORE });
  if (!checkRateLimit(user.id, "exportAccountData", { limit: 3, windowMs: 60_000 })) return new Response(null, { status: 429, headers: NO_STORE });

  const data = await buildAccountExport(user.id);
  if (!data) return new Response(null, { status: 404, headers: NO_STORE });
  const day = data.generatedAt.slice(0, 10);
  return new Response(serializeAccountExport(data), {
    headers: {
      ...NO_STORE,
      "Content-Disposition": `attachment; filename="gamenight-mes-donnees-${day}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
