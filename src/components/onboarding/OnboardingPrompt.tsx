"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { OnboardingProgress } from "@/lib/onboarding";

export function OnboardingPrompt({ userId, progress }: { userId: string; progress: OnboardingProgress }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const needsSteam = !progress.steamLinked && !progress.steamSkipped;
  const incomplete = needsSteam || !progress.planningReady || !progress.guideCompleted;
  const workingOnSetup = path === "/bienvenue" || path === "/disponibilites" || path === "/serveurs" || path?.startsWith("/profil/parametres");
  const key = `gn:onboarding-prompt:${userId}`;
  useEffect(() => {
    if (!incomplete || workingOnSetup) return;
    // Fermer ne valide jamais le profil. Stockage limité à cet onglet.
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(key) === "later"; } catch { /* stockage privé indisponible : garder le guide accessible */ }
    if (dismissed) return;
    const timer = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(timer);
  }, [key, incomplete, workingOnSetup]);
  function close() {
    try { sessionStorage.setItem(key, "later"); } catch { /* aucun état serveur modifié */ }
    setOpen(false);
  }
  if (!incomplete || workingOnSetup) return null;
  return <>
    <Button size="sm" onClick={() => setOpen(true)} className="fixed bottom-20 left-4 z-40 shadow-lg lg:bottom-5 lg:left-[17rem]">{needsSteam || !progress.planningReady ? "Compléter mon profil" : "Découvrir GameNight"}</Button>
    <Dialog.Root open={open} onOpenChange={value => value ? setOpen(true) : close()}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[111] max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border-2 border-accent/40 bg-surface p-6 shadow-2xl">
          <span className="text-4xl" aria-hidden>🎮</span><Dialog.Title className="mt-4 text-2xl font-bold">Bienvenue dans la partie !</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-muted">Prépare ton profil pour retrouver tes jeux et organiser les bons créneaux avec tes potes.</Dialog.Description>
          <ul className="my-5 space-y-2 text-sm"><li>{needsSteam ? "○ Lie ton compte Steam, ou indique que tu ne l’utilises pas." : "✓ Steam : réglage terminé."}</li><li>{progress.planningReady ? "✓ Tes disponibilités sont renseignées." : "○ Renseigne ton planning pour jouer ensemble."}</li><li>✨ Découvre les onglets avec le guide pas à pas.</li></ul>
          <div className="flex flex-col gap-3"><ButtonLink variant="primary" href="/bienvenue" onClick={close}>Configurer mon profil pas à pas</ButtonLink>{needsSteam && <a onClick={close} href="/api/steam/link" className="rounded-lg border border-border px-4 py-3 text-center text-sm font-semibold">Lier Steam maintenant</a>}{!progress.planningReady && <ButtonLink href="/disponibilites" onClick={close}>Renseigner mes disponibilités</ButtonLink>}<Button variant="ghost" onClick={close}>Plus tard — garder mes étapes à terminer</Button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
