import { permanentRedirect } from "next/navigation";

/**
 * Absorbé dans le hub /admin (PR 8/9) — redirige pour ne pas casser les
 * liens existants. Seule cette page d'index est absorbée :
 * `/admin/jeux-stats/[gameId]` (CRUD détaillé par jeu) reste une route
 * indépendante, référencée depuis l'onglet Jeux-stats du hub.
 */
export default function JeuxStatsAdminRedirect() {
  permanentRedirect("/admin?tab=jeux-stats");
}
