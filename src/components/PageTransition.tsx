"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Fix bug remonté (page /profil restant blanche en navigation client,
 * jamais au F5, aucune erreur console — le contenu est dans le DOM mais
 * invisible, et réapparaît sur resize) — root cause enfin identifiée : ce
 * n'est PAS `FadeInView`/`ParallaxHeader` (déjà corrigés dans 3 PR
 * précédentes, sans effet sur ce bug précis). `/profil` est la SEULE
 * route de l'app avec sa propre mise en page imbriquée
 * (`profil/layout.tsx` + `profil/page.tsx`, tous deux `async` et
 * chacun avec ses propres requêtes) — aucune autre route n'a ce
 * découpage layout+page imbriqué à deux niveaux. Next.js diffuse donc
 * `/profil` en plusieurs temps (layout puis page), alors que ce wrapper
 * ne voit qu'UNE seule clé (`pathname`) : le fondu `initial`/`animate`
 * se termine dès le premier flux, et le contenu qui arrive ensuite (le
 * vrai contenu de la page) atterrit dans le calque déjà "figé" par le
 * compositeur du navigateur au lieu d'être repeint — invisible jusqu'à
 * un reflow forcé (resize/F5), sans jamais lever d'erreur JS. `mode="wait"`
 * aggrave l'effet en séquençant sortie/entrée sur une frontière déjà
 * fragile. Fix : `/profil` (et ses sous-routes) sort du fondu de
 * transition et s'affiche directement, sans `motion.div` ni
 * `AnimatePresence` — un rendu 100% statique sur cette route précise,
 * le reste de l'app (aucune autre route n'a de layout imbriqué) garde
 * le fondu normalement.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/profil")) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="flex flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
