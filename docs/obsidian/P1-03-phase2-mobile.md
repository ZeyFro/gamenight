# P1-03 phase 2 — mobile /sessions, /tournois, /bibliotheque

Branche `agent/preflight-20261116`. Mesures Chrome réelles à 320 / 360 / 390 / 414 px.

## Défauts reproduits (avant)

- **Onglets partagés** (`SegmentedControl`, pages tournois et soirées) : 36 px de haut, sous la cible tactile de 44 px ; à 320 et 360 px les libellés passaient sur deux lignes.
- **Carte de soirée** (`/sessions`) : la date était tronquée — `+74 px` à 320, `+34 px` à 360, `+4 px` à 390 ; l'heure de la soirée disparaissait.
- **Bibliothèque** : action « Marquer comme coop » en 11 px souligné (cible réelle étendue à 44 px, mais libellé illisible et peu identifiable) ; barre de vues sans nom accessible, coupée brutalement à 320 px.
- **Tournois** : titre de tournoi coupé à une ligne à 320 px (« Coupe d'automne des jeux … »).

Aucun débordement horizontal de page n'a été trouvé : le défaut était local (troncature, hauteur de cible, libellés repliés).

## Correctifs

- `src/components/ui/SegmentedControl.tsx` : `min-h-11` (44 px), libellés `whitespace-nowrap`, défilement horizontal localisé quand les options ne tiennent pas, `flex-1` seulement à partir de `sm`.
- `src/components/sessions/SessionRow.tsx` (nouveau) : carte de soirée extraite de `src/app/sessions/page.tsx` (déplacement pur) ; la date n'est plus tronquée, elle passe à la ligne et garde l'heure. Capitalisation française corrigée (`first-letter:uppercase` au lieu de `capitalize`, qui donnait « Samedi 21 Novembre À 20:00 »).
- `src/components/LibraryTabs.tsx` : `<nav aria-label="Vues de la bibliothèque">`, espacement resserré, défilement par onglet, barre de défilement native masquée.
- `src/components/BibliothequeGrid.tsx` : action coop en pastille bordée de 32 px (texte 12 px), cible tactile de 44 px conservée.
- `src/app/tournois/page.tsx` : titre sur deux lignes maximum (`line-clamp-2`) au lieu d'une troncature.
- `src/app/refonte.css` : utilitaire `.gn-scroll-x` (défilement sans barre native).

## Captures

`docs/captures-p1-03/{avant,apres}-{segmented-tournois,segmented-sessions,bibliotheque,tournois-card,session-row}-{320,390}.png`

## Tests exécutés

- `src/components/mobile-phase2.browser.test.tsx` (12 tests, Chrome réel, 320/360/390/414) : aucun débordement, cibles ≥ 44 px, libellés sur une ligne, dernier onglet atteignable après défilement, date de soirée non tronquée, pastilles coop ≥ 32 px en 12 px.
- `src/components/touch-targets.test.ts` mis à jour (garde sur la nouvelle pastille).
- `npx tsc --noEmit` : 0 erreur. ESLint sur les fichiers modifiés : 0 erreur, 0 avertissement.
- `npx vitest run` ciblé : 65 tests sur 5 fichiers, tous verts.

## Limite explicite

`/sessions`, `/tournois` et `/bibliotheque` exigent une session Discord et il n'existe ni base ni secret Discord dans cet environnement : **ces pages n'ont pas pu être affichées avec un compte de test**. La recette porte sur les composants réels qu'elles rendent (données factices), pas sur le parcours complet. Les écrans d'administration, formulaires de création et modales n'ont pas été revus.
