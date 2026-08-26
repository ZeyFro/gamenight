import type { ReactNode } from "react";
import type { BadgeCategory, BadgeRarity } from "@prisma/client";
import { CATEGORY_LABELS, CRITERIA_TYPE_LABELS, RARITY_LABELS } from "@/lib/badge-rarity";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as BadgeCategory[];
const RARITIES = Object.keys(RARITY_LABELS) as BadgeRarity[];
const CRITERIA_TYPES = Object.keys(CRITERIA_TYPE_LABELS);

/**
 * Formulaire d'ajout/édition d'un `Badge` (`/admin/badges`, PR 8/9) —
 * critère saisi de façon structurée (select type + nombre) plutôt qu'un
 * textarea JSON libre : `criteria` est toujours `{ type, count }`, un
 * champ JSON brut serait une source d'erreur de saisie sans bénéfice
 * (voir `BadgeCriteria` dans src/lib/badges.ts).
 */
export function BadgeForm({
  action,
  idValue,
  initialName = "",
  initialIcon = "",
  initialDescription = "",
  initialCategory = "PARTICIPATION",
  initialRarity = "COMMON",
  initialCriteriaType = "SESSIONS_CREATED",
  initialCriteriaCount = 1,
  initialXpReward,
  idPrefix,
  footer,
}: {
  action: (formData: FormData) => Promise<void>;
  idValue?: string;
  initialName?: string;
  initialIcon?: string;
  initialDescription?: string;
  initialCategory?: BadgeCategory;
  initialRarity?: BadgeRarity;
  initialCriteriaType?: string;
  initialCriteriaCount?: number;
  initialXpReward?: number | null;
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
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-center text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
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
            placeholder="GOAT"
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted" htmlFor={`${idPrefix}-description`}>
          Description
        </label>
        <input
          id={`${idPrefix}-description`}
          type="text"
          name="description"
          defaultValue={initialDescription}
          required
          placeholder="Participer à 50 soirées."
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-category`}>
            Catégorie
          </label>
          <select
            id={`${idPrefix}-category`}
            name="category"
            defaultValue={initialCategory}
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-rarity`}>
            Rareté
          </label>
          <select
            id={`${idPrefix}-rarity`}
            name="rarity"
            defaultValue={initialRarity}
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
          >
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {RARITY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-criteriaType`}>
            Critère
          </label>
          <select
            id={`${idPrefix}-criteriaType`}
            name="criteriaType"
            defaultValue={initialCriteriaType}
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
          >
            {CRITERIA_TYPES.map((t) => (
              <option key={t} value={t}>
                {CRITERIA_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor={`${idPrefix}-criteriaCount`}>
            Seuil
          </label>
          <input
            id={`${idPrefix}-criteriaCount`}
            type="number"
            name="criteriaCount"
            defaultValue={initialCriteriaCount}
            required
            min={1}
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted" htmlFor={`${idPrefix}-xpReward`}>
          XP bonus au déblocage (optionnel)
        </label>
        <input
          id={`${idPrefix}-xpReward`}
          type="number"
          name="xpReward"
          defaultValue={initialXpReward ?? ""}
          min={0}
          placeholder="Aucun"
          className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      {footer}
    </form>
  );
}
