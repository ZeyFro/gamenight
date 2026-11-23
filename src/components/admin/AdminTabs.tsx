import { TabLink } from "@/components/ui/TabLink";

export type AdminTabKey =
  | "messages"
  | "superlatifs"
  | "badges"
  | "joueurs"
  | "jeux-stats"
  | "reglages"
  | "confidentialite"
  | "nettoyage"
  | "communautes";

export const ADMIN_TAB_KEYS: AdminTabKey[] = [
  "messages",
  "superlatifs",
  "badges",
  "joueurs",
  "jeux-stats",
  "reglages",
  "confidentialite",
  "nettoyage",
  "communautes",
];

const TABS: { key: AdminTabKey; label: string }[] = [
  { key: "messages", label: "Messages Discord" },
  { key: "superlatifs", label: "Récompenses" },
  { key: "badges", label: "Badges" },
  { key: "joueurs", label: "Joueurs" },
  { key: "jeux-stats", label: "Jeux-stats" },
  { key: "reglages", label: "Réglages" },
  { key: "confidentialite", label: "Confidentialité" },
  { key: "nettoyage", label: "Nettoyage" },
  { key: "communautes", label: "Communautés" },
];

/**
 * Onglets du hub `/admin` (PR 8/9) — remplace les 4 pages individuelles
 * (`/admin/messages`, `/admin/superlatifs`, `/admin/badges`,
 * `/admin/jeux-stats`) qui devenaient longues à scroller séparément.
 * Piloté par `?tab=` (pas de sous-route réelle comme `LibraryTabs`) :
 * un seul hub, l'onglet actif vient du query param plutôt que du
 * pathname — permet aux anciennes URLs de rediriger proprement vers
 * `/admin?tab=X` sans avoir à recréer une arborescence de routes.
 */
/** `showCommunities` : drapeau COMMUNITY_ADMIN_ENABLED (onglet « Communautés » masqué sinon). */
export function AdminTabs({ active, showCommunities = false }: { active: AdminTabKey; showCommunities?: boolean }) {
  return (
    // Retour à la ligne (jamais de défilement horizontal) : 9 onglets ne tiennent pas sur 320 px, et un onglet caché hors écran
    // passait inaperçu. Chaque lien garde une cible tactile d’au moins 44 px.
    <nav aria-label="Sections de l’administration" className="flex flex-wrap gap-x-1 border-b border-border">
      {TABS.filter((tab) => showCommunities || tab.key !== "communautes").map((tab) => (
        <TabLink
          key={tab.key}
          href={`/admin?tab=${tab.key}`}
          active={active === tab.key}
          layoutId="admin-tabs-underline"
          className="flex min-h-11 items-center"
        >
          {tab.label}
        </TabLink>
      ))}
    </nav>
  );
}
