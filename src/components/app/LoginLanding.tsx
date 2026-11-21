import type { ReactNode } from "react";
import Link from "next/link";
import { LEGAL_LINKS, isLegalPagesEnabled } from "@/lib/legal-pages";
import { discordInviteUrl } from "@/lib/auth-error-messages";
import { LOGIN_MEMBERS_ONLY_NOTICE, isLaunchTextsEnabled } from "@/lib/launch-texts";
import { AuroraText } from "@/components/magicui/aurora-text";
import { ShineBorder } from "@/components/magicui/shine-border";

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
      <ul className="gn-login-benefits"><li>Des soirées et roulettes à organiser ensemble</li><li>Une bibliothèque commune et vos tierlists</li><li>Une progression propre à chaque serveur</li></ul>
    </section>
  </div>;
}
