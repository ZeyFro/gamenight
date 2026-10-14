"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

function PendingFields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <>
    <fieldset disabled={pending} className="contents" aria-busy={pending}>{children}</fieldset>
    {pending && <p role="status" className="text-sm text-muted">Création en cours…</p>}
  </>;
}

/** La clé reste identique lors d'une réponse perdue ou d'une nouvelle tentative
 * sur ce formulaire. Un nouveau formulaire représente un nouveau geste. */
export function CreationForm({ action, children, className }: {
  action: (data: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(data: FormData) {
    if (busy.current) return;
    busy.current = true;
    key.current ??= crypto.randomUUID();
    data.set("creationKey", key.current);
    setError(null);
    try {
      await action(data);
    } catch (cause) {
      // Next traite cette exception pour naviguer, elle doit être propagée.
      if (cause && typeof cause === "object" && "digest" in cause &&
          String(cause.digest).startsWith("NEXT_REDIRECT")) throw cause;
      setError("La confirmation n’a pas été reçue. Réessaie ici : la même tentative sera reprise sans doublon.");
    } finally {
      busy.current = false;
    }
  }
  return <form action={submit} className={className}>
    <PendingFields>{children}</PendingFields>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
