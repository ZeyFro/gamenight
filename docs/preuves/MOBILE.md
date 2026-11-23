# Audit téléphone et liens (mission 2 et 3, 23/11/2026)

**Méthode.** Serveur local (main `c40d4f82`, mode développement, base jetable peuplée, tous les `*_ENABLED` à `true`), sessions de test (jeton Auth.js signé avec un secret éphémère), sortie réseau bloquée hors `127.0.0.1`, **aucune écriture sur Vercel, Neon ni Discord**. Émulation **iPhone 13** (390 px) et **Pixel 7** (412 px). 96 pages × 2 appareils = **191 mesures** (membre pour les pages publiques et connectées, administrateur pour `/admin/*`). Par page : capture, débordement horizontal, texte coupé, cibles tactiles trop petites, éléments recouverts, temps de chargement (2ᵉ passage, « à chaud »). Outils : [`outils-mobile/audit-mobile.mjs`](outils-mobile/audit-mobile.mjs) et [`crawl-liens.mjs`](outils-mobile/crawl-liens.mjs). Résultats bruts : [`mobile/resultats.json`](mobile/resultats.json), [`liens/liens.json`](liens/liens.json). Captures : [`mobile/iphone13/`](mobile/iphone13) et [`mobile/pixel7/`](mobile/pixel7) (390 px de large, compressées).

**Limite.** Mode développement et base locale : les temps de chargement sont indicatifs (la production sur Vercel/Neon se mesure autrement) ; la production connectée n'a pas été auditée (pas de compte). Les pages publiques de la production sans compte ont été contrôlées à part ([LOT_A1.md](LOT_A1.md)).

## Résultat

| Contrôle | Résultat |
| --- | --- |
| **Débordement horizontal** | **0 page sur 191** |
| Erreur JavaScript de page | **0** |
| **Chargement > 3 s** | **1 / 191** (iPhone 13, `/sessions/[id]` : 3,7 s au 2ᵉ passage, serveur de développement) ; **médiane 628 ms** à chaud (1ᵉʳ passage 1 013 ms, compilation comprise) |
| Texte coupé | **0 réel** : les 191 « coupés » sont le lien d'évitement « Aller au contenu » et des libellés `sr-only` (invisibles voulus) |
| Cibles tactiles < 32 px | voir ci-dessous : **corrigé** pour le pied de page |
| Éléments recouverts | **corrigé** (pied de page) ; reste le bouton flottant (ci-dessous) |
| Menu utilisable | OK : la barre du bas (6 onglets) et le tiroir « The Tower » répondent ; aucun menu hors écran |
| Pages 404 dans la base de test | `/recap/2026/11` (aucun récap), `/sessions/[id]/invites` (membre non créateur), `/tournois/equipes/[id]` (tournoi non « par équipes »), 5 pages admin Tower (réglages de communauté absents) : **dépend des données et réglages, pas d'un défaut d'affichage** |

## Corrigé (PR fusionnée)

**#550** : les liens légaux du pied de page (Mentions légales, Confidentialité, Conditions) faisaient ~20 px de haut (**168 occurrences < 32 px**) et étaient **recouverts** par la barre de navigation du bas (7 cas) ou par le bouton flottant « Compléter mon profil » (74 cas) sur les pages courtes. Désormais 44 px de haut et un espace du bas qui dépasse la barre et le bouton. « Voir tout » et « ← Potes » reçoivent une zone tactile de 44 px. Avant/après sur `/classement` et `/guide` : cibles < 32 px **3 → 0**.

## Restant (non corrigé, à décider)

| # | Constat | Pages | Pourquoi pas corrigé |
| --- | --- | --- | --- |
| 1 | **Bouton flottant « Compléter mon profil »** : il recouvre le contenu en bas à gauche de chaque page tant que le profil est incomplet (ex. « Révoquer le lien » sur `/calendrier`) | toutes (membre au profil incomplet) | Choix de design (à replier ou à intégrer au bandeau) plutôt qu'un réglage CSS ; le pied de page est protégé |
| 2 | **Barres d'onglets qui défilent sans indice** : « Lore du groupe », « Ascension », « The Tower » hors écran à droite (18 pages) | `/profil/*`, `/potes/[id]/*` | L'onglet actif est maintenant centré (#536, #548) ; un dégradé ou une flèche de défilement serait un petit ajout de design |
| 3 | Petites cibles restantes (< 44 px) : cases à cocher 20×20 (le libellé les rend cliquables), « + Dispo en soirée (20h–00h) en un clic » (12 pages), liens admin « → » | `/ce-soir`, `/admin` | Mineur ; libellés cliquables ; admin seulement |
| 4 | Un chargement à 3,7 s (dev) | `/sessions/[id]` | À remesurer sur la production |

## Liens (mission 3)

**155 pages visitées** (visiteur 4, membre 76, administrateur 75), en suivant les liens des menus, du pied de page, du profil, des pages légales et du guide : **0 lien cassé** (aucun 404, aucune erreur, aucune redirection inattendue).

Mais **20 pages statiques n'étaient atteintes par aucun lien**. Trois étaient des fonctionnalités livrées **sans aucun accès** : `/projets`, `/soutiens`, `/bibliotheque/plateformes` (+ `/admin/sante`, `/admin/tower-irregular`). **PR #551** : liens ajoutés (chacun derrière l'interrupteur de sa page) et **garde** `page-links-coverage.test.ts` qui échoue si une page est livrée sans lien. Les autres sont voulues sans lien : `/accueil-v2` (comparaison), `/admin/discord-commands` (console temporaire), `/admin/tower-layout` (outil du propriétaire, écriture suspendue), deux anciennes adresses d'admin qui redirigent, et les onglets de `/admin` (atteints par `?tab=`).
