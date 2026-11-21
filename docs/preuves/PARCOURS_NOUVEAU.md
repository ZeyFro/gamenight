# Parcours du nouveau joueur : de la connexion à la première action utile

Mesuré en local le 21/11/2026 sur la base jetable (31 membres actifs, 3 équipes, 5 soirées, 2 tournois, 5 défis, 1 booster), tous les `*_ENABLED` à `true`, avec un joueur **sans aucune donnée** (« Nouveau Joueur », niveau 1, 0 XP, onboarding non terminé). Chaque clic ci-dessous est un vrai clic Playwright (`docs/preuves/outils/parcours.mjs`) ; les nombres de clics des pages viennent d'un parcours en largeur des liens réels (`outils/graphe-clics.mjs`, `graphe-clics.json`).

**Limites assumées.** La connexion Discord (OAuth) n'est pas testable en local : la session est un jeton Auth.js signé avec un secret éphémère. Le serveur local est en mode développement (pastille « N » et « Compiling » visibles sur certaines captures). Les parcours mobiles ont été refaits seulement jusqu'à la 3ᵉ étape : les étapes suivantes échouent parce que le profil de test avait déjà été modifié par les parcours bureau (état déjà fait, pas un défaut de l'application).

## 1. Clics et écrans jusqu'à la première action utile

« Clic » compte aussi la fermeture de l'invite d'accueil (1 clic obligatoire pour accéder à l'application).

| Première action utile | Clics | Écrans | Où ça bloque ou surprend | Preuve |
| --- | ---: | ---: | --- | --- |
| **Lancer une partie immédiate** (« Jouer maintenant ») | 4 : Plus tard → Jouer maintenant → choisir le jeu → Démarrer | 2 (accueil, `/jouer-maintenant`) | Le bouton **Démarrer est grisé sans aucune explication** tant qu'aucun jeu n'est choisi. Surtout : **les 31 membres sont cochés par défaut** (« Prévenir qui ? 31/31 »). Mesuré en base après un seul clic : **31 livraisons de MP + 1 annonce de salon mises en file**. | [parcours D, étape 3](parcours/D-bureau-03.png) · [étape 5](parcours/D-bureau-05.png) |
| **Rejoindre une soirée** | 3 jusqu'à la fiche (+ 1 « Je participe » non exécuté) : Plus tard → Rejoindre une soirée → Rejoindre | 3 (accueil, `/sessions`, fiche de la soirée) | « Rejoindre une soirée » ouvre la page **Soirées**, dont le haut est le formulaire de **création** (« Créer la soirée ») ; le bouton « Rejoindre » est plus bas dans la liste. Rejoindre ne participe pas encore : il faut un 4ᵉ clic. | [A2-3](parcours/A2-bureau-03.png) · [A2-4](parcours/A2-bureau-04.png) |
| **Se déclarer dispo ce soir** (« Qui joue ce soir ? ») | 6 : Plus tard → Trouver des joueurs → Voir les annonces → Qui joue ce soir ? → choisir un jeu → Je suis dispo | 5 | La page n'est **pas dans le menu**. « Trouver des joueurs » mène aux **Forums The Tower**, pas à la recherche de joueurs. Le lien vers « Qui joue ce soir ? » est enfoui au 3ᵉ clic, dans `/joueurs`. | [B-3](parcours/B-bureau-03.png) · [B-5](parcours/B-bureau-05.png) · [B-7](parcours/B-bureau-07.png) |
| **Obtenir son premier défi Tower** | impossible dans l'application | 2 (accueil, `/tower`) | `/tower` affiche : « **Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord.** » Aucun bouton web. Cul-de-sac si Discord n'est pas ouvert. | [C-3](parcours/C-bureau-03.png) |
| **Régler son profil** (Steam, planning) | 1 pour entrer dans l'assistant ; 1 de plus par étape | 1 (`/bienvenue`, 6 étapes) | « Lier mon compte Steam » part vers Steam (externe, non testable ici). « Je n'utilise pas Steam » fait avancer la jauge « Profil prêt 1/2 ». | [E-2](parcours/E-bureau-02.png) · [E-3](parcours/E-bureau-03.png) |

## 2. Pages auxquelles le nouveau joueur n'arrive pas (liens réels, profondeur 4)

| Page | Clics depuis l'accueil | Constat |
| --- | ---: | --- |
| `/sessions`, `/roulette`, `/tournois`, `/calendrier`, `/tower`, `/classement`, `/profil`, `/guide`, `/potes`, `/jouer-maintenant` | 1 | Dans le menu ou sur l'accueil. |
| `/notifications` | 2 (cloche, puis « Voir tout ») | Pas un lien du menu : seulement la cloche, vérifié par un clic (`outils/cloche.mjs`). |
| `/ce-soir` | 3 | Seul lien entrant : `src/app/joueurs/page.tsx`. |
| `/equipes/candidatures`, `/profil/compte`, `/profil/lore/sondages` | 3 | Profonds. |
| **`/projets`**, **`/soutiens`**, **`/bibliotheque/plateformes`** | **aucun lien entrant** | Trois fonctionnalités livrées sans lien depuis aucune page : `/soutiens` et `/bibliotheque/plateformes` n'ont aucun lien dans `src/` ; `/projets` n'est lié que depuis sa propre fiche détail. |
| `/equipes/gestion` | non trouvée | Lien seulement dans `/equipes`, pour les capitaines. |
| `/admin`, `/serveurs` | redirection | Un non-admin qui ouvre `/admin` revient **silencieusement à l'accueil**, sans message (capture « erreur » : [nouveau-bureau-admin](captures/nouveau-bureau-admin.png)). Le lien « Gérer les messages de rappel → » de `/profil/parametres` mène à `/admin`. |

## 3. Les six mots : ce que comprend un débutant

Occurrences mesurées sur les 51 pages vues par le nouveau joueur (texte réellement affiché, `captures/manifeste.json`).

| Mot | Où | Ce qu'il comprend vraiment | Verdict |
| --- | --- | --- | --- |
| **GameNight** | menu, titre, accueil, pied de page | Le nom du site. L'écran de connexion dit que l'accès est « réservé aux membres du serveur Discord **The Tower** » : rien ne relie les deux noms. `/tower` affiche même « GAMENIGHT · GAMENIGHT » en en-tête. | Flou |
| **Tower / The Tower** | menu (« The Tower »), 51 pages | Soit le serveur Discord, soit la section défis du menu. `/tower` explique « défis solo et d'équipe, étages personnels, saisons et classement » : il comprend « un jeu de défis avec un classement », mais pas que c'est le même nom que la communauté. | Partiel |
| **étage** | 11 pages | Trois sens mélangés : étage d'« Ascension » (XP), « étages remportés par les défis », « prochain étage ». Un joueur à 0 XP voit **« Étage 1 » deux fois** sur `/tower` ([capture](parcours/C-bureau-03.png)) et croit en avoir déjà gagné. | Perdu |
| **étage XP** | 2 pages (`/tower`, `/ascension`) | Jamais défini. Il n'existe que dans une phrase en petits caractères : « Ton niveau, ton étage XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro… » | Perdu |
| **grade** | 5 pages | `/tower` cite « ton grade Tower (Régulars, Irregular, Ranker, High Ranker) » sans définir les quatre noms. La définition (Ranker dès 30 étages, High Ranker dès 100 étages + 5 défis) n'est que sur `/tower/palmares`, un clic de plus. | Partiel après un clic |
| **rang** | 13 pages | Trois sens : « rang XP » (le « Victime · Bronze » de l'accueil, sur 13 pages), rang Tower (« Prochain rang, Ranker : encore 30 étage(s) »), et « rang de jour » dans les soirées récurrentes. « Grade » et « rang » sont employés l'un pour l'autre. | Perdu |

Mots supplémentaires jamais expliqués : **« Victime »** (affiché « Niveau 1 · Victime · Bronze » sur l'accueil et 12 autres pages), **Régulars / Irregular**, **Lore**, **tierlist**, **Ascension**, **Palmarès**, **streak**.

## 4. Le débutant est-il perdu ? étape par étape

| # | Étape | Perdu ? | Pourquoi | Capture |
| ---: | --- | --- | --- | --- |
| 0 | Arrivée sur le site, déconnecté | **Non** | Un titre, une promesse, un seul bouton « Se connecter avec Discord ». Réserve : on ne sait pas que GameNight et The Tower sont la même communauté. | [bureau](captures/visiteur-bureau-accueil.png) · [mobile](captures/visiteur-mobile-accueil.png) |
| 1 | Connexion Discord | **Non testable en local** | OAuth Discord réel impossible ; session simulée. | — |
| 2 | Première page : invite « Bienvenue dans la partie ! » | **Un peu** | Quatre boutons pour un seul écran (Configurer / Lier Steam / Mes disponibilités / Plus tard). « Plus tard — garder mes étapes à terminer » est clair, mais le fond reste sombre et l'invite bloque la page tant qu'on ne choisit pas. | [mobile](captures/nouveau-mobile-accueil.png) · [bureau](captures/nouveau-bureau-accueil.png) |
| 3 | Accueil après « Plus tard » | **Oui, en partie** | Trois boutons de tête (Créer une soirée / Trouver des joueurs / Rejoindre une soirée) plus « Commencer l'Ascension », un « Niveau 1 · Victime · Bronze » sans explication, une grille de « Trophées du groupe » tous grisés sans indication pour les débloquer. « Trouver des joueurs » ne fait pas ce qu'il dit. | [bureau](captures/nouveau-bureau-accueil.png) |
| 4 | « Rejoindre une soirée » | **Oui** | On arrive sur un formulaire de création de soirée. | [A2-3](parcours/A2-bureau-03.png) |
| 5 | « Jouer maintenant » | **Oui, et c'est risqué** | Démarrer grisé sans raison affichée ; 31 personnes cochées par défaut ; le texte explicatif (« Les potes cochés reçoivent un MP Discord… ») est tout en bas, sous 31 lignes. | [D-3](parcours/D-bureau-03.png) · [D-5](parcours/D-bureau-05.png) |
| 6 | Tower : premier défi | **Oui, bloqué** | Deux « Étage 1 », une phrase de jargon, et pour agir : « avec /tower defi sur Discord ». | [C-3](parcours/C-bureau-03.png) |
| 7 | Réglage du profil (Steam, planning) | **Non** | Assistant en 6 étapes, jauge « Profil prêt », choix « Je n'utilise pas Steam » : le plus clair du parcours. | [E-2](parcours/E-bureau-02.png) |
| 8 | Pages vides | **Non, sauf deux** | Presque toutes proposent une action (« Pas encore de soirée — crée la première »). Sans consigne : `/tower/palmares` (« Aucune récompense créditée… »), `/serveurs` (renvoie à l'accueil). | [palmarès](captures/nouveau-bureau-tower_palmares.png) |

## 5. Page d'erreur et messages

La page 404 dit « **404 — Cette page a rage quit 🎮 · Introuvable — elle a probablement déco sans prévenir** » : drôle, mais ne dit pas quoi faire ailleurs que « Retour à l'accueil » ([capture](captures/actif-bureau-page-qui-n-existe-pas.png)). Deux pages écrivent des avertissements d'hydratation dans la console du navigateur (`/calendrier`, `/tierlist`) : [manifeste](captures/manifeste.json).
