# P1-03 — Navigation GameNight (16/11/2026)

Branche locale `agent/preflight-20261116`, issue de `origin/main` à `df2f3ed`
(#441). Aucun push, aucune PR, aucune migration. Lot P1-03 de [[ROADMAP]] :
seule la partie **GameNight** est traitée ici, la partie Discord (salons et
liens) reste à faire.

## Constats mesurés avant changement

Mesures faites dans un Chrome local, vrai `globals.css` + Tailwind, vrai
composant :

- à 360 px, le libellé « Bibliothèque » (63,6 px) ne tenait pas dans sa case
  de 60 px : texte hors de la cible ;
- la barre basse mobile n'avait aucune entrée « Accueil » ; le seul retour
  était le logo du header, masqué par `.gn-topbar-with-picker` quand le
  sélecteur de serveur est actif ;
- l'état actif de la barre basse reposait sur la couleur seule (WCAG 1.4.1) ;
- dans le tiroir, Accueil et Roulette partageaient le dé, Soirées et
  Calendrier le calendrier : deux destinations voisines, même icône.

## Changements

- `nav-links.tsx` devient la source unique (libellé, libellé court, icône) :
  Accueil en tête, `shortLabel` « Jeux » pour la barre basse seulement.
- `Classement` sort de la barre basse (six cibles de 56 px tiennent à 320 px,
  sept non) ; il reste dans le tiroir, sur l'accueil et dans `/profil`.
- `BottomNav` : repère d'accent en haut + graisse + `aria-current` (l'état
  actif ne dépend plus de la couleur seule) ; le nom accessible annonce
  « Jeux, Bibliothèque » sans remplacer le texte visible (WCAG 2.5.3).
- `icons.tsx` : `HomeIcon` et `MoonIcon` ; `Sidebar` s'en sert pour Accueil et
  Soirées, donc plus d'icône partagée entre deux destinations du groupe
  « Jouer ensemble ».

## Emplacement de Classement — validé (16/11/2026)

Le propriétaire valide la barre basse à six entrées, « Classement » conservé
dans le tiroir. Trois chemins existent et pointent vers la vraie page
`src/app/classement/page.tsx` :

1. **tiroir** — bouton menu, puis « Classement » (un tap) ;
2. **accueil** — carte « Classement rapide », lien « Voir tout » ;
3. **profil** — lien « Rang global #n sur N » dans l'en-tête.

Garde ajoutée : `nav-links.test.ts` vérifie que **chaque** destination de la
barre basse et du tiroir a un `page.tsx` ; aucune entrée ne peut plus mener à
une page inexistante. `Sidebar.test.tsx` vérifie « Classement » à un tap dans
le menu mobile.

## Vérifications

- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` sur les 7 fichiers touchés : 0 erreur.
- `npx vitest run BottomNav.test.tsx nav-links.test.ts
  BottomNav.browser.test.tsx Sidebar.test.tsx Header.test.tsx
  Header.touch.browser.test.tsx` : 6 fichiers, **22/22** (deux gardes
  ajoutées après validation : pages existantes, Classement dans le menu).
- Recette navigateur réelle : 320 / 360 / 390 / 414 px — aucun dépassement
  horizontal, aucun chevauchement de libellés, cibles ≥ 44 × 56 px atteintes
  au centre, barre masquée à 1280 px.
- Captures : `docs/captures-p1-03/apres-{mobile,desktop}.png`.

## Limites

- Navigation rendue hors session : aucune connexion Discord réelle n'est
  possible localement (pas de base ni de secret). Les pages authentifiées ne
  sont donc pas recettées ici.
- Aucun test PostgreSQL, aucune action Discord, aucun déploiement Vercel.
- La barre basse reste à six entrées (validé) : `Roulette`, `Tournois` et
  `Classement` passent par le tiroir, ce dernier restant aussi accessible
  depuis l'accueil et le profil.
