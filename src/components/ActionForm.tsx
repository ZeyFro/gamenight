"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

/** Forme de retour optionnelle qu'une action peut renvoyer pour signaler un échec sans lever d'exception (même convention que `UpdateGameResult` dans `src/app/actions.ts`). `void` reste accepté pour toutes les actions existantes qui ne renvoient rien. */
export type ActionFormResult = void | { ok: boolean; error?: string };

/**
 * Wrapper autour d'une server action qui ne redirige pas : intercepte le
 * submit pour l'appeler directement (au lieu de passer par `action=`),
 * ce qui permet un toast de confirmation. Ne pas utiliser pour une action
 * qui appelle `redirect()` (ex. addManualGame, createSession) — la
 * redirection est déjà un feedback fort, un toast juste avant de quitter
 * la page n'aurait pas le temps de s'afficher correctement.
 *
 * `errorMessages` (Sprint 1, fiabilisation — rate limiting) : si l'action
 * renvoie `{ ok: false, error }`, affiche un toast d'erreur au lieu du
 * toast de succès — utilisé notamment pour le message "Doucement !" du
 * rate limiting (`RATE_LIMIT_ERROR_KEY`), sans changer le contrat des
 * actions qui continuent de renvoyer `void`.
 */
export function ActionForm({
  action,
  successMessage,
  errorMessages,
  className = "",
  children,
}: {
  action: (formData: FormData) => Promise<ActionFormResult>;
  successMessage?: string;
  errorMessages?: Record<string, string>;
  className?: string;
  children: ReactNode;
}) {
  const [, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await action(formData);
      if (result && result.ok === false) {
        toast.error(
          errorMessages?.[result.error ?? ""] ?? "Une erreur est survenue."
        );
        return;
      }
      if (successMessage) toast.success(successMessage);
    });
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {children}
    </form>
  );
}
