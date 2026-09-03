"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { placeBetAction } from "@/app/sessions/actions";
import { XP_BET_MIN, XP_BET_STEP, maxBetAmount } from "@/lib/xp-bets";

export interface XpBetTarget {
  id: string;
  discordName: string;
}

/**
 * Sprint 4 (FEATURE 5, Paris d'XP) — "🎲 Paris" sur une soirée `SCHEDULED`.
 * `<select>` natif pour la cible (fiable au tactile, même choix que
 * `RELEASE_YEARS` dans `GameFilterDrawer`) + un seul `<input
 * type="range">` (contrairement au double-slider corrigé là-bas, un seul
 * curseur ne pose pas ce problème) pour la mise, avec la valeur affichée
 * en direct. `maxBetAmount(xpTotal)` peut être 0 (moins de 10 XP en
 * poche) — le formulaire se désactive alors plutôt que d'afficher un
 * slider inutilisable.
 */
export function XpBetForm({
  sessionId,
  voterId,
  xpTotal,
  targets,
}: {
  sessionId: string;
  voterId: string;
  xpTotal: number;
  targets: XpBetTarget[];
}) {
  const candidates = targets.filter((t) => t.id !== voterId);
  const max = maxBetAmount(xpTotal);
  const [targetUserId, setTargetUserId] = useState(candidates[0]?.id ?? "");
  const [amount, setAmount] = useState(Math.min(XP_BET_MIN, max));

  if (max < XP_BET_MIN || candidates.length === 0) {
    return (
      <p className="text-sm text-muted">
        Pas assez d&apos;XP pour parier (minimum {XP_BET_MIN}).
      </p>
    );
  }

  return (
    <form action={placeBetAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="amount" value={amount} />

      <select
        name="targetUserId"
        value={targetUserId}
        onChange={(e) => setTargetUserId(e.target.value)}
        className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.discordName}
          </option>
        ))}
      </select>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Mise</span>
          <span className="font-semibold text-foreground">{amount} XP</span>
        </div>
        <input
          type="range"
          min={XP_BET_MIN}
          max={max}
          step={XP_BET_STEP}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <p className="text-xs text-muted">
          {XP_BET_MIN}–{max} XP (max 50% de ton solde : {xpTotal} XP)
        </p>
      </div>

      <Button type="submit" variant="primary" size="sm" fullWidthOnMobile>
        Parier {amount} XP sur {candidates.find((t) => t.id === targetUserId)?.discordName}
      </Button>
    </form>
  );
}
