import type { ReactNode } from "react";

/**
 * Formulaire d'ajout/édition d'un `SuperlativeCategory` — pas de state
 * client nécessaire (contrairement à `MessageTemplateForm`), champs
 * simples soumis tels quels. `idPrefix` évite les collisions d'`id`
 * HTML entre le formulaire d'ajout et les N formulaires d'édition sur la
 * même page.
 */
export function SuperlativeCategoryForm({
  action,
  idValue,
  initialIcon = "",
  initialName = "",
  initialDescription = "",
  initialXpReward = 20,
  idPrefix,
  footer,
}: {
  action: (formData: FormData) => Promise<void>;
  idValue?: string;
  initialIcon?: string;
  initialName?: string;
  initialDescription?: string;
  initialXpReward?: number;
  idPrefix: string;
  footer: ReactNode;
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      {idValue && <input type="hidden" name="id" value={idValue} />}

      <div className="flex gap-3">
        <div className="flex w-20 flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-icon`}>
            Icône
          </label>
          <input
            id={`${idPrefix}-icon`}
            type="text"
            name="icon"
            defaultValue={initialIcon}
            required
            maxLength={4}
            placeholder="🏆"
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-center text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-name`}>
            Nom
          </label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            name="name"
            defaultValue={initialName}
            required
            placeholder="MVP de la soirée"
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted" htmlFor={`${idPrefix}-description`}>
          Description (optionnelle)
        </label>
        <input
          id={`${idPrefix}-description`}
          type="text"
          name="description"
          defaultValue={initialDescription}
          placeholder="Le meilleur de la soirée, toutes catégories confondues"
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted" htmlFor={`${idPrefix}-xpReward`}>
          XP bonus pour le gagnant
        </label>
        <input
          id={`${idPrefix}-xpReward`}
          type="number"
          name="xpReward"
          defaultValue={initialXpReward}
          required
          min={1}
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      {footer}
    </form>
  );
}
