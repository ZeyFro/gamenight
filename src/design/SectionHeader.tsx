/**
 * En-tête de section : titre, sous-titre facultatif et une action à droite
 * (« Tout voir »…). L'action n'existe que si `actionLabel` ET `onAction` sont
 * fournis. Le niveau de titre (`h2` par défaut) suit l'arborescence de la page.
 */

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  as?: "h2" | "h3";
}

export function SectionHeader({ title, subtitle, actionLabel, onAction, as: Heading = "h2" }: SectionHeaderProps) {
  return (
    <div className="gn-section-header">
      <div className="gn-section-header-text">
        <Heading className="gn-section-title">{title}</Heading>
        {subtitle ? <p className="gn-section-subtitle">{subtitle}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="gn-section-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
