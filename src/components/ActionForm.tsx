"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

/**
 * Wrapper autour d'une server action qui ne redirige pas : intercepte le
 * submit pour l'appeler directement (au lieu de passer par `action=`),
 * ce qui permet un toast de confirmation. Ne pas utiliser pour une action
 * qui appelle `redirect()` (ex. addManualGame, createSession) — la
 * redirection est déjà un feedback fort, un toast juste avant de quitter
 * la page n'aurait pas le temps de s'afficher correctement.
 */
export function ActionForm({
  action,
  successMessage,
  className = "",
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  successMessage?: string;
  className?: string;
  children: ReactNode;
}) {
  const [, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await action(formData);
      if (successMessage) toast.success(successMessage);
    });
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {children}
    </form>
  );
}
