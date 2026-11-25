import type { ReactNode } from "react";
import { AuroraText } from "@/components/magicui/aurora-text";

/**
 * En-tête commun aux onglets principaux : même hiérarchie (surtitre, titre,
 * description, actions) et même rythme sur desktop comme sur mobile. Les
 * pages avec un héros dédié (Accueil, Profil) gardent leur composition.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  aurora = false,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  aurora?: boolean;
}) {
  return (
    <header className="gn-page-header">
      <div className="gn-page-heading">
        {eyebrow && <p className="gn-eyebrow">{eyebrow}</p>}
        <h1 className="gn-page-title">
          {aurora ? (
            <AuroraText colors={["#b99aff", "#e3cffc", "#d4ef80"]}>{title}</AuroraText>
          ) : (
            title
          )}
        </h1>
        {description && <p className="gn-page-subtitle">{description}</p>}
      </div>
      {actions && <div className="gn-page-actions">{actions}</div>}
    </header>
  );
}
