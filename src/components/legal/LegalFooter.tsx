import Link from "next/link";
import { LEGAL_LINKS, isLegalPagesEnabled } from "@/lib/legal-pages";

/** Pied de page légal de chaque page ; rien tant que `LEGAL_PAGES_ENABLED` n'est pas `true`. */
export function LegalFooter({ raised = false }: { raised?: boolean }) {
  if (!isLegalPagesEnabled()) return null;
  return (
    <footer className={`border-t border-border px-4 py-4 text-xs text-muted ${raised ? "pb-20 lg:pb-4" : ""}`}>
      <nav aria-label="Informations légales" className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-4 gap-y-1">
        {LEGAL_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="underline underline-offset-2 hover:text-foreground">{link.label}</Link>
        ))}
      </nav>
    </footer>
  );
}
