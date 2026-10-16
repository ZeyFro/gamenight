"use client";

import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/Card";
import { isCorrectGameAnswer, type CommunityGameQuizRound } from "@/lib/community-game-quiz";

export function CommunityGameQuiz({ round }: { round: CommunityGameQuizRound }) {
  const [visibleClues, setVisibleClues] = useState(1);
  const [guess, setGuess] = useState("");
  const [result, setResult] = useState<boolean | null>(null);

  function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (result !== null || !guess.trim()) return;
    setResult(isCorrectGameAnswer(guess, round.answer));
  }

  return (
    <Card className="flex flex-col gap-4">
      <p className="text-sm text-muted">Trouve le jeu à partir des indices tirés de la bibliothèque jouée par le groupe.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
        {round.clues.slice(0, visibleClues).map((clue, index) => <li key={index}>{clue}</li>)}
      </ol>
      {visibleClues < round.clues.length && result === null && (
        <button type="button" onClick={() => setVisibleClues((count) => count + 1)} className="min-h-11 self-start rounded-lg border border-border px-4 text-sm text-foreground hover:bg-surface-hover">
          Révéler un autre indice
        </button>
      )}
      <form onSubmit={submitGuess} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="community-game-guess" className="sr-only">Nom du jeu</label>
        <input
          id="community-game-guess"
          value={guess}
          onChange={(event) => setGuess(event.target.value)}
          disabled={result !== null}
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          placeholder="Ta réponse…"
        />
        <button type="submit" disabled={result !== null || !guess.trim()} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50">
          Valider
        </button>
      </form>
      {result !== null && (
        <p role="status" className={`text-sm font-medium ${result ? "text-accent" : "text-muted"}`}>
          {result ? "Bien joué !" : "Pas tout à fait."} La réponse était {round.answer}.
        </p>
      )}
    </Card>
  );
}
