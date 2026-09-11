"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ALL_MESSAGE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_VARIABLES,
  findInvalidCategoryVariables,
  variablesForCategories,
} from "@/lib/message-templates";
import type { MessageCategory } from "@prisma/client";

/**
 * Formulaire d'ajout/édition d'un `MessageTemplate` — extrait en composant
 * client (le `page.tsx` d'origine était un Server Component avec de
 * simples `<form action=...>`) pour porter deux choses :
 * - un blocage strict à la sauvegarde (Fix 4C, PR 30) si le texte utilise
 *   une variable que l'une des catégories cochées ne fournit pas —
 *   `findInvalidCategoryVariables` vérifie catégorie par catégorie, pas à
 *   l'union comme avant (bug corrigé : un message texte à trous en prod,
 *   `{jeu}` dans un message aussi coché `SESSION_CREATED`, passait
 *   l'ancienne validation "union"). Le `<fieldset disabled>` autour du
 *   footer désactive réellement le bouton d'enregistrement — pas qu'un
 *   avertissement ignorable ;
 * - une autocomplétion : taper `{` propose les variables disponibles pour
 *   les catégories actuellement cochées.
 */
export function MessageTemplateForm({
  action,
  idValue,
  initialText = "",
  initialCategories = [],
  idPrefix,
  footer,
}: {
  action: (formData: FormData) => Promise<void>;
  idValue?: string;
  initialText?: string;
  initialCategories?: MessageCategory[];
  idPrefix: string;
  footer: ReactNode;
}) {
  const [text, setText] = useState(initialText);
  const [categories, setCategories] = useState<MessageCategory[]>(initialCategories);
  const [suggestion, setSuggestion] = useState<{ query: string; caret: number } | null>(
    null
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autocomplétion : intersection des variables des catégories cochées
  // (pas l'union) — ne proposer que ce qui marche pour TOUTES les
  // catégories cochées à la fois évite de suggérer soi-même une variable
  // qui déclencherait `invalidPairs` juste en dessous. Sans catégorie
  // cochée, on propose tout (rien à restreindre encore).
  const suggestableVars = useMemo(() => {
    if (categories.length === 0) return variablesForCategories(ALL_MESSAGE_CATEGORIES);
    return categories.reduce<string[]>(
      (acc, c) => acc.filter((v) => CATEGORY_VARIABLES[c].includes(v)),
      CATEGORY_VARIABLES[categories[0]]
    );
  }, [categories]);

  const invalidPairs = useMemo(
    () => findInvalidCategoryVariables(text, categories),
    [text, categories]
  );

  const suggestions = useMemo(() => {
    if (!suggestion) return [];
    const q = suggestion.query.toLowerCase();
    return suggestableVars.filter((v) => v.toLowerCase().startsWith(q));
  }, [suggestion, suggestableVars]);

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);

    const caret = e.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/\{([a-zA-Z0-9_]*)$/);
    setSuggestion(match ? { query: match[1], caret } : null);
  }

  function insertSuggestion(varName: string) {
    if (!suggestion) return;
    const before = text.slice(0, suggestion.caret - suggestion.query.length - 1);
    const after = text.slice(suggestion.caret);
    const next = `${before}{${varName}}${after}`;
    setText(next);
    setSuggestion(null);
    requestAnimationFrame(() => {
      const pos = before.length + varName.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function toggleCategory(category: MessageCategory) {
    setCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Filet de sécurité en plus du `<fieldset disabled>` sur le footer
        // (qui désactive déjà visuellement le bouton) : si jamais le
        // bouton était quand même cliqué (ex. `invalidPairs` vient de
        // repasser à 0 entre deux rendus), on bloque explicitement l'envoi
        // de l'action serveur plutôt que de compter uniquement sur le CSS.
        if (invalidPairs.length > 0) e.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      {idValue && <input type="hidden" name="id" value={idValue} />}

      <div className="relative flex flex-col gap-1">
        <textarea
          ref={textareaRef}
          name="text"
          value={text}
          onChange={handleTextChange}
          onBlur={() => setTimeout(() => setSuggestion(null), 150)}
          rows={2}
          required
          placeholder="Ex. : Yo {pote}, dans 30 min c'est {jeu}."
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {suggestion && suggestions.length > 0 && (
          <ul className="absolute top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            {suggestions.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSuggestion(v);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent/10"
                >
                  {`{${v}}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {invalidPairs.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          {invalidPairs.map(({ category, variable }) => (
            <p key={`${category}-${variable}`}>
              Ce message ne peut pas être coché{" "}
              <strong>{CATEGORY_LABELS[category]}</strong> car il contient{" "}
              {`{${variable}}`} qui n&apos;existe pas pour cette catégorie.
            </p>
          ))}
          <p>
            Décoche la catégorie concernée, ou retire la variable, pour
            pouvoir enregistrer.
          </p>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-muted">
          Catégories (tirage aléatoire pour l&apos;envoi correspondant)
        </legend>
        {ALL_MESSAGE_CATEGORIES.map((category) => {
          const id = `${idPrefix}-${category}`;
          return (
            <label
              key={category}
              htmlFor={id}
              className="flex items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"
            >
              <input
                id={id}
                type="checkbox"
                name={`category-${category}`}
                checked={categories.includes(category)}
                onChange={() => toggleCategory(category)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-border accent-accent"
              />
              <span>
                {CATEGORY_LABELS[category]}
                <span className="mt-0.5 block text-xs text-faint">
                  Variables :{" "}
                  {CATEGORY_VARIABLES[category].map((v) => `{${v}}`).join(", ")}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset disabled={invalidPairs.length > 0} className="contents">
        {footer}
      </fieldset>
    </form>
  );
}
