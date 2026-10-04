import { SKIP_LINK_TARGET_ID } from "@/lib/skip-link";

/**
 * Premier élément focalisable de la page : invisible tant qu'il n'a pas le
 * focus clavier (Tab), puis affiché en haut à gauche. Permet de passer
 * l'en-tête et la navigation pour atteindre directement le contenu.
 */
export function SkipLink() {
  return (
    <a
      href={`#${SKIP_LINK_TARGET_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus:ring-2 focus:ring-white"
    >
      Aller au contenu
    </a>
  );
}
