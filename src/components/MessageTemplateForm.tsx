"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ALL_MESSAGE_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_VARIABLES,
  variablesForCategories,
} from "@/lib/message-templates";
import type { MessageCategory } from "@prisma/client";

function extractUsedVariables(text: string): string[] {
  const matches = text.match(/\{([a-zA-Z0-9_]+)\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}

/**
 * Formulaire d'ajout/édition d'un `MessageTemplate` — extrait en composant
 * client (le `page.tsx` d'origine était un Server Component avec de
 * simples `<form action=...>`) pour porter deux choses (FIX 2, bug
 * remonté : un message avec une variable hors catégorie, ex. `{jeu}` dans
 * un `SESSION_MODIFIED`, était envoyé tel quel dans Discord) :
 * - un bandeau d'avertissement live si le texte utilise une variable que
 *   les catégories cochées ne fournissent pas — sauvegarde autorisée quand
 *   même (l'utilisateur peut vouloir ignorer, cf. demande), le vrai filet
 *   de sécurité est le remplacement silencieux par du vide au runtime
 *   (`substituteVariables`) ;
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

  const allowedVars = useMemo(() => variablesForCategories(categories), [categories]);
  const usedVars = useMemo(() => extractUsedVariables(text), [text]);
  const unknownVars = useMemo(
    () => usedVars.filter((v) => !allowedVars.includes(v)),
    [usedVars, allowedVars]
  );

  const suggestions = useMemo(() => {
    if (!suggestion) return [];
    const q = suggestion.query.toLowerCase();
    return allowedVars.filter((v) => v.toLowerCase().startsWith(q));
  }, [suggestion, allowedVars]);

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
    <form action={action} className="flex flex-col gap-3">
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
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
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

      {unknownVars.length > 0 && (
        <p className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          Variable{unknownVars.length > 1 ? "s" : ""} inconnue
          {unknownVars.length > 1 ? "s" : ""} pour les catégories cochées :{" "}
          {unknownVars.map((v) => `{${v}}`).join(", ")}. Remplacée
          {unknownVars.length > 1 ? "s" : ""} par du vide à l&apos;envoi —
          tu peux quand même enregistrer.
        </p>
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

      {footer}
    </form>
  );
}
