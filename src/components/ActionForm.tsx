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
 *
 * `onSuccess` (bug remonté — reconnexion forcée globale) : callback
 * optionnel appelé après un résultat de succès, en plus du toast — utile
 * pour une navigation client (`router.push`) garantie après confirmation
 * que l'action a bien abouti, sans dépendre de `redirect()` côté serveur
 * (volontairement incompatible avec ce composant, voir plus haut).
 *
 * Try/catch (bug remonté — "rien ne semble se passer" au clic) : sans ce
 * filet, une exception non gérée par l'action elle-même deviendrait un
 * rejet de promesse silencieux dans la transition React (aucun toast,
 * interface identique) — filet générique pour toutes les actions passées
 * à ce composant, en plus de tout try/catch propre à chaque action.
 */
export function ActionForm({
  action,
  successMessage,
  errorMessages,
  onSuccess,
  className = "",
  children,
}: {
  action: (formData: FormData) => Promise<ActionFormResult>;
  successMessage?: string;
  errorMessages?: Record<string, string>;
  onSuccess?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      let result: ActionFormResult;
      try {
        result = await action(formData);
      } catch {
        toast.error("Une erreur est survenue.");
        return;
      }
      if (result && result.ok === false) {
        toast.error(
          errorMessages?.[result.error ?? ""] ?? "Une erreur est survenue."
        );
        return;
      }
      if (successMessage) toast.success(successMessage);
      onSuccess?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {children}
    </form>
  );
}
