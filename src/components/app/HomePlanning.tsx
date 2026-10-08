import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";

/** Des points d’entrée vers les fonctions existantes, sans requête supplémentaire. */
export function EmptySessionHero() {
  return (
    <section className="gn-home-empty" aria-labelledby="next-session-empty">
      <div className="gn-home-empty-art" aria-hidden="true">
        <span className="gn-home-orbit" />
        <svg viewBox="0 0 120 100" fill="none">
          <path d="M35 29h50c10 0 16 7 18 17l7 28c3 13-11 19-19 10L78 69H42L29 84c-8 9-22 3-19-10l7-28c2-10 8-17 18-17Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="3" />
          <path d="M36 43v20M26 53h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle cx="82" cy="47" r="4" fill="currentColor" /><circle cx="92" cy="58" r="4" fill="currentColor" />
        </svg>
        <span className="gn-home-art-spark">✦</span>
      </div>
      <div className="gn-home-empty-content">
        <p className="gn-eyebrow">À vous de jouer</p>
        <h2 id="next-session-empty">La prochaine soirée<br />commence ici.</h2>
        <p>Aucun rendez-vous prévu. Choisis un jeu, invite les potes et lance la suite.</p>
        <ButtonLink href="/sessions" variant="primary">+ Proposer une soirée</ButtonLink>
      </div>
    </section>
  );
}

export function HomePlanningLinks() {
  return (
    <nav className="gn-home-planning" aria-label="Préparer la prochaine soirée">
      <Link href="/calendrier" prefetch={false}><span aria-hidden="true">▦</span><b>Trouver une date</b><small>Calendrier & dispos</small><i aria-hidden="true">↗</i></Link>
      <Link href="/bibliotheque/groupe" prefetch={false}><span aria-hidden="true">🎮</span><b>Les jeux du groupe</b><small>Votre bibliothèque</small><i aria-hidden="true">↗</i></Link>
      <Link href="/tierlist" prefetch={false}><span aria-hidden="true">✦</span><b>Classer mes jeux</b><small>Ma tierlist</small><i aria-hidden="true">↗</i></Link>
    </nav>
  );
}

export function HomeInstantLink() {
  return (
    <Link href="/jouer-maintenant" prefetch={false} className="gn-home-instant">
      <span className="gn-home-instant-icon" aria-hidden="true">▷</span>
      <div><b>Pas besoin d’attendre ce soir.</b><p>Lance une partie et invite les potes maintenant.</p></div>
      <span className="gn-home-instant-cta">Jouer maintenant <span aria-hidden="true">→</span></span>
    </Link>
  );
}
