"use client";

import { useState } from "react";

/**
 * Affiche la description FR (DeepL) par défaut, avec un toggle discret
 * "Voir la VO" si une traduction existe et diffère de l'original. Sans
 * traduction (DEEPL_API_KEY absente, ou échec), affiche directement la
 * VO sans toggle.
 */
export function GameDescription({
  fr,
  original,
}: {
  fr: string | null;
  original: string;
}) {
  const hasTranslation = Boolean(fr) && fr !== original;
  const [showOriginal, setShowOriginal] = useState(!hasTranslation);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm whitespace-pre-line text-muted">
        {showOriginal || !fr ? original : fr}
      </p>
      {hasTranslation && (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className="self-start text-xs text-muted underline underline-offset-2 hover:text-foreground"
        >
          {showOriginal ? "Voir la traduction" : "Voir la VO"}
        </button>
      )}
    </div>
  );
}
