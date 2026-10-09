"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { completeOnboardingAction, skipSteamOnboardingAction } from "@/app/onboarding-actions";
import type { OnboardingProgress } from "@/lib/onboarding";

const TOUR = [
  { title: "Ton planning", icon: "📅", text: "Indique tes créneaux habituels et tes exceptions. Le calendrier du groupe aide ensuite à choisir une date commune.", href: "/disponibilites", label: "Renseigner mon planning" },
  { title: "Tes jeux et ceux du groupe", icon: "🎮", text: "Steam importe les jeux accessibles de ta bibliothèque. Tu peux aussi ajouter des jeux à la main, consulter la bibliothèque du groupe et organiser ta tierlist.", href: "/bibliotheque/groupe", label: "Voir les jeux du groupe", secondHref: "/profil/tierlist", secondLabel: "Ma tierlist" },
  { title: "Soirées et calendrier", icon: "🌙", text: "Crée une soirée pour plus tard, invite tes potes et vote pour le jeu. Avec des places activées, les inscriptions supplémentaires passent en liste d’attente.", href: "/sessions", label: "Voir les soirées", secondHref: "/calendrier", secondLabel: "Le calendrier" },
  { title: "Roulette ou partie immédiate", icon: "🎲", text: "La roulette choisit un jeu : maintenant pour partir directement, ou plus tard pour organiser une soirée. Jouer maintenant ouvre une partie que les membres de ton serveur peuvent rejoindre.", href: "/roulette?mode=instant", label: "Roulette maintenant", secondHref: "/jouer-maintenant", secondLabel: "Jouer maintenant" },
  { title: "Tournois et progression", icon: "🏆", text: "Inscris-toi aux tournois et suis les matchs. XP, badges et classement sont propres au serveur choisi : tu peux changer de communauté dans la navigation.", href: "/tournois", label: "Voir les tournois", secondHref: "/classement", secondLabel: "Le classement" },
] as const;

export function OnboardingFlow({ progress, initialStep }: { progress: OnboardingProgress; initialStep?: string }) {
  const router = useRouter();
  const needsSteam = !progress.steamLinked && !progress.steamSkipped;
  const [screen, setScreen] = useState(initialStep === "planning" ? 1 : initialStep === "steam" || needsSteam ? 0 : !progress.planningReady ? 1 : 2);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const completed = Number(!needsSteam) + Number(progress.planningReady);
  const current = screen > 0 ? TOUR[screen - 1] : null;
  function skipSteam() {
    setError("");
    startTransition(async () => {
      if (await skipSteamOnboardingAction()) { setScreen(1); router.refresh(); }
      else setError("Ton choix n’a pas été enregistré. Réessaie dans un instant.");
    });
  }
  function finish() {
    setError("");
    startTransition(async () => {
      if (await completeOnboardingAction()) router.push("/");
      else { setError("Il reste un réglage à terminer. Ton avancée est conservée."); router.refresh(); }
    });
  }
  return <section className="flex flex-col gap-6" aria-label="Guide de démarrage">
    <div><p className="gn-eyebrow">Ton aventure commence ici</p><h1 className="mt-2 text-2xl font-bold">Bienvenue sur GameNight</h1><p className="mt-3 text-muted">Deux réglages pour jouer ensemble, puis une visite guidée. Ils restent valables quand tu changes de serveur.</p></div>
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="text-sm font-semibold">Profil prêt : {completed}/2</p>
      <div role="progressbar" aria-label="Réglages du profil" aria-valuemin={0} aria-valuemax={2} aria-valuenow={completed} className="mt-3 h-2 overflow-hidden rounded-full bg-surface-hover"><div className="h-full bg-accent transition-all" style={{ width: `${completed * 50}%` }} /></div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm"><li>{needsSteam ? "○" : "✓"} Steam {progress.steamSkipped && !progress.steamLinked ? "(non utilisé)" : progress.steamLinked ? "lié" : "à lier"}</li><li>{progress.planningReady ? "✓ Planning renseigné" : "○ Planning à renseigner"}</li></ul>
    </div>
    <nav className="flex flex-wrap gap-2" aria-label="Étapes du guide">
      {["Steam", ...TOUR.map(step => step.title)].map((label, i) => <button key={label} type="button" onClick={() => setScreen(i)} aria-current={screen === i ? "step" : undefined} className={`rounded-lg border px-3 py-2 text-xs ${screen === i ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted"}`}>{i + 1}. {label}</button>)}
    </nav>
    <div className="rounded-2xl border-2 border-border bg-surface p-5 sm:p-7" aria-live="polite">
      <span className="text-4xl" aria-hidden>{current?.icon ?? "🎮"}</span>
      <h2 className="mt-4 text-xl font-bold">{current?.title ?? "Lie ton compte Steam"}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">{current?.text ?? "Retrouve tes jeux sans les saisir un par un. Connecte-toi sur Steam pour autoriser la liaison ; GameNight ne demande jamais ton mot de passe. Une bibliothèque privée peut demander un réglage de visibilité ou un ajout manuel."}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {screen === 0 ? <><a className="gn-button gn-button-primary rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground" href="/api/steam/link">{progress.steamLinked ? "Changer mon compte Steam" : "Lier mon compte Steam"}</a>{needsSteam && <Button variant="secondary" disabled={pending} onClick={skipSteam}>Je n’utilise pas Steam</Button>}</> : current && <><ButtonLink href={current.href}>{current.label}</ButtonLink>{"secondHref" in current && <ButtonLink variant="ghost" href={current.secondHref}>{current.secondLabel}</ButtonLink>}</>}
      </div>
      {screen <= 1 && <p className="mt-4 text-xs text-muted">Cette étape se valide quand le réglage est enregistré. <button type="button" onClick={() => router.refresh()} className="underline">Vérifier mon avancée</button></p>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-between gap-3">
      <Button variant="ghost" disabled={screen === 0 || pending} onClick={() => setScreen(screen - 1)}>Précédent</Button>
      {screen < TOUR.length ? <Button variant="primary" onClick={() => setScreen(screen + 1)}>Suivant</Button> : <Button variant="primary" disabled={pending || completed !== 2} onClick={finish}>Terminer le guide</Button>}
    </div>
    {completed !== 2 && <p className="text-sm text-muted">À terminer : {needsSteam && <Link className="underline" href="/bienvenue?step=steam">Steam</Link>}{needsSteam && !progress.planningReady && " et "}{!progress.planningReady && <Link className="underline" href="/disponibilites">tes disponibilités</Link>}.</p>}
    <Link className="text-center text-sm text-muted underline" href="/">Revenir à l’application — mes étapes restent à terminer</Link>
  </section>;
}
