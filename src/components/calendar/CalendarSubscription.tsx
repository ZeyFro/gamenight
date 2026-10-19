"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { manageCalendarFeedAction, type CalendarFeedState } from "@/app/calendrier/feed-actions";
import { Button } from "@/components/ui/Button";

const initialState: CalendarFeedState = {};

export function CalendarSubscription() {
  const [state, action, pending] = useActionState(manageCalendarFeedAction, initialState);
  const url = state.path && typeof window !== "undefined" ? new URL(state.path, window.location.origin).href : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien privé copié");
    } catch {
      toast.error("Copie impossible : sélectionne le lien ci-dessous.");
    }
  }

  return (
    <section aria-labelledby="calendar-subscription-title" className="rounded-xl border border-border bg-surface p-4">
      <h2 id="calendar-subscription-title" className="font-semibold">S’abonner aux soirées</h2>
      <p className="mt-1 text-sm text-muted">Crée un lien privé pour ajouter les soirées à venir de ce serveur à Google Calendar, Apple Calendar ou une autre application. Le lien reste lié à ce serveur.</p>
      <p className="mt-2 text-sm text-muted">Toute personne possédant ce lien peut lire tes soirées accessibles. Garde-le privé. Créer un nouveau lien remplace l’ancien; révoquer le lien arrête les prochaines lectures.</p>
      <form action={action} className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" name="mode" value="create" size="sm" disabled={pending}>Créer / renouveler le lien</Button>
        <Button type="submit" name="mode" value="revoke" variant="destructive" size="sm" disabled={pending}>Révoquer le lien de ce serveur</Button>
      </form>
      <p role="status" className="mt-2 text-sm">{state.message}</p>
      {state.error && <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
      {url && <div className="mt-3 space-y-2">
        <label htmlFor="calendar-subscription-url" className="block text-sm">Lien privé — {state.communityName}</label>
        <input id="calendar-subscription-url" value={url} readOnly onFocus={(event) => event.currentTarget.select()} className="w-full min-w-0 rounded-lg border border-border bg-background p-2 text-sm" />
        <Button type="button" size="sm" onClick={copyLink}>Copier le lien privé</Button>
        <p className="text-sm text-muted">Dans ton application calendrier, choisis « Ajouter par URL » ou « Nouvel abonnement », puis colle ce lien. Copie-le maintenant : il ne sera plus affiché après avoir quitté la page. La fréquence d’actualisation dépend de ton application.</p>
      </div>}
    </section>
  );
}
