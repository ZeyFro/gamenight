import type { ReactNode } from "react";
import Link from "next/link";
import { LEGAL_LINKS, isLegalPagesEnabled } from "@/lib/legal-pages";
import { discordInviteUrl } from "@/lib/auth-error-messages";
import { LOGIN_MEMBERS_ONLY_NOTICE, isLaunchTextsEnabled } from "@/lib/launch-texts";
import { AuroraText } from "@/components/magicui/aurora-text";
import { ShineBorder } from "@/components/magicui/shine-border";

export function DiscordMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419z" /></svg>;
}

export function LoginLanding({ children }: { children: ReactNode }) {
  // V3-02 : connexion fermée (S0), on le dit avant le clic ; le lien vient du même helper que le message de refus.
  const launchTexts = isLaunchTextsEnabled();
  const inviteUrl = launchTexts ? discordInviteUrl() : null;
  return <div className="gn-login-layout">
    <div className="gn-login-story"><span className="gn-eyebrow" style={{ color: "var(--gn-lime)" }}>Moins d’organisation. Plus de parties.</span><h1>Le point de départ<br />de vos <AuroraText colors={["#b99aff", "#e2ccff", "#d4ef80"]}>meilleures soirées.</AuroraText></h1><p>Vos jeux, vos potes, vos rendez-vous. Retrouvez votre serveur Discord et choisissez ensemble à quoi jouer.</p><div className="gn-login-art" aria-hidden="true"><span><b>🎮</b>Les jeux</span><span><b>☾</b>Les soirées</span><span><b>🏆</b>Les souvenirs</span></div></div>
    <section className="gn-login-card" aria-label="Connexion à GameNight">
      <ShineBorder shineColor={["#b99aff", "#d4ef80", "#8d70c1"]} duration={18} aria-hidden="true" />
      <p className="gn-eyebrow text-accent">Bienvenue dans GameNight</p><h2>Ta prochaine partie<br />commence ici.</h2>
      <p className="mb-7 text-sm text-muted">Connecte-toi avec Discord pour retrouver tes communautés.</p>
      {children}
      {launchTexts && <p className="mt-4 text-sm text-muted">{LOGIN_MEMBERS_ONLY_NOTICE}{inviteUrl && <>{" "}<a href={inviteUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2">Rejoindre le serveur</a></>}</p>}
      {isLegalPagesEnabled() && <nav aria-label="Informations légales" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">{LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href} className="underline underline-offset-2 hover:text-foreground">{link.label}</Link>)}</nav>}
      <ul className="gn-login-benefits"><li>Des soirées et roulettes à organiser ensemble</li><li>Une bibliothèque commune et vos classements de jeux</li><li>Une progression propre à chaque serveur</li></ul>
    </section>
  </div>;
}
