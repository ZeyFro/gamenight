import type { ReactNode } from "react";

/**
 * État vide générique (polish visuel) — remplace les `<p className="text-sm
 * text-muted">…</p>` isolés utilisés jusqu'ici pour chaque liste vide de
 * l'app, par un bloc visuel cohérent (icône + message + CTA optionnel).
 */
export function EmptyState({
  icon,
  title,
  action,
  className = "",
}: {
  icon: string;
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-10 text-center ${className}`}
    >
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {action}
    </div>
  );
}
