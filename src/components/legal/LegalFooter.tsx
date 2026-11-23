import Link from "next/link";
import { LEGAL_LINKS, isLegalPagesEnabled } from "@/lib/legal-pages";

/**
 * Pied de page légal de chaque page ; rien tant que `LEGAL_PAGES_ENABLED` n'est pas `true`. Connecté (`raised`), sur téléphone,
 * l'espace du bas dépasse la barre de navigation fixe (56 px + zone de sécurité) ET le bouton flottant « Compléter mon profil »
 * (au-dessus d'elle) : sans lui, les liens légaux restaient recouverts sur une page courte (audit téléphone du 23/11/2026).
 * Chaque lien fait au moins 44 px de haut (cible tactile).
 */
export function LegalFooter({ raised = false }: { raised?: boolean }) {
  if (!isLegalPagesEnabled()) return null;
  return (
    <footer className={`border-t border-border px-4 py-4 text-xs text-muted ${raised ? "pb-[calc(9rem+env(safe-area-inset-bottom))] lg:pb-4" : ""}`}>
      <nav aria-label="Informations légales" className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-4">
        {LEGAL_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-foreground">{link.label}</Link>
        ))}
      </nav>
    </footer>
  );
}
