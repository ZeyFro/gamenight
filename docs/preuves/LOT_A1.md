# Contrôles du lot A1 (23/11/2026, après l'allumage)

Lot A1 : `LAUNCH_TEXTS_ENABLED`, `NAV_TOWER_ENABLED`, `PAGE_TITLES_ENABLED`, `PAGE_TITLES_DYNAMIC_ENABLED`, `GUIDE_V2_ENABLED`, `MEDIA_PRIVACY_ENABLED`, `ADMIN_DASHBOARD_V2_ENABLED` (contrôles de [`ALLUMAGES.md`](../ALLUMAGES.md)).

**Limite honnête.** Je n'ai pas de compte ni de secret de session pour la production : en production, seules les pages **sans compte** sont contrôlables (lecture seule, GET, aucun formulaire). Tout ce qui exige une connexion est contrôlé **en local** sur le même code (`main` f1cd73fd) avec les 7 variables du lot et des sessions de test (jeton Auth.js signé avec un secret éphémère, base jetable). Ces contrôles locaux prouvent le code et les variables, **pas l'état de la production** : la dernière colonne dit ce qu'il reste à confirmer avec un vrai compte.

## Résultat : 0 KO

| # | Contrôle | Production (sans compte) | Local (code + 7 variables) | Reste à confirmer en production |
| --- | --- | --- | --- | --- |
| 1 | Phrase « L'accès est réservé aux membres du serveur Discord The Tower » + lien « Rejoindre le serveur » (`LAUNCH_TEXTS`) | **OK** (bureau et mobile) : [bureau](lot-a1/bureau-accueil.png) · [mobile](lot-a1/mobile-accueil.png) | test `LoginLanding.launch.test.tsx` | — |
| 2 | Titres d'onglet « page · GameNight » (`PAGE_TITLES`) | **OK** sur les pages publiques : « Mentions légales · GameNight » ([capture](lot-a1/bureau-mentions.png)) ; la page de connexion garde « GameNight » (attendu) | **OK** accueil « GameNight » ; `/sessions` = « **Soirées · GameNight** » ; `/tower` = « The Tower · GameNight » ; `/ascension` = « Ascension · GameNight » ; `/guide` = « Guide · GameNight » | titres de `/sessions`, `/tower`, `/guide` (exigent un compte) |
| 3 | Titre dynamique d'une fiche jeu (`PAGE_TITLES_DYNAMIC`) | non vérifiable (fiche jeu derrière la connexion : redirection vers l'accueil, titre « GameNight », jamais de nom de jeu, **comme prévu**) | **OK** « Among Us · GameNight » : [capture](lot-a1/local/bureau-fiche-jeu.png) | titre d'une vraie fiche |
| 4 | `/guide` : sections « Jouer maintenant » et « Tournois » (`GUIDE_V2`) | non vérifiable (connexion) | **OK** les deux : [capture](lot-a1/local/bureau-guide.png) · [mobile](lot-a1/local/mobile-guide.png) | `/guide` connecté |
| 5 | Bande-annonce chargée seulement après le clic (`MEDIA_PRIVACY`) | **OK** pour ce qui est visible : **0 requête vers YouTube ou ytimg** sur les 12 pages publiques ouvertes | **OK** test `GameTrailer.test.tsx` 4/4 (rendu initial sans iframe ni URL YouTube ; iframe `youtube-nocookie.com` seulement après le clic). Pas de bande-annonce en local (IGDB, réseau coupé) : contrôle par composant | une fiche **avec** bande-annonce, à la main |
| 6 | Lien « The Tower » dans le menu ordinateur et mobile (`NAV_TOWER`) | non vérifiable (menu réservé aux connectés) | **OK** ordinateur : « The Tower » dans la barre latérale ; mobile : dans le **tiroir** (pas dans la barre basse : voulu, 6 onglets à 320 px) : [menu mobile](lot-a1/local/mobile-menu.png) | menus d'un compte réel |
| 7 | `/tower` et `/ascension` s'affichent, avec la phrase sur les étages (`LAUNCH_TEXTS`) | non vérifiable (connexion) | **OK** HTTP 200, phrase « …tes étages Tower repartent de zéro » sur les deux : [/tower](lot-a1/local/bureau-tower.png) · [/ascension](lot-a1/local/bureau-ascension.png) · [mobile](lot-a1/local/mobile-tower.png) | idem avec un compte réel |
| 8 | `/admin/tableau-de-bord` (`ADMIN_DASHBOARD_V2`) | non vérifiable (admin) | **OK** admin : HTTP 200, « Tableau de bord · Admin · GameNight » ([capture](lot-a1/local/bureau-tableau-de-bord.png)) ; membre non admin : renvoyé à l'accueil | avec le compte administrateur |

## Autres constats en production, sans compte (lecture seule)

- Toutes les pages de l'application ouvertes sans compte (`/sessions`, `/tower`, `/ascension`, `/guide`, `/classement`, `/jeux/…`) renvoient à la page de connexion (HTTP 200, titre « GameNight ») : accès fermé, normal.
- `/connexion` n'existe pas (404 « Cette page a rage quit ») : la connexion est sur `/`.
- Temps de chargement des pages publiques : 1,9 à 3,0 s (réseau complet, `networkidle`).
- Aucune requête vers YouTube sur aucune page publique.

Outils : [`outils-mobile/controle-lot-a1.mjs`](outils-mobile/controle-lot-a1.mjs) (production, GET seulement) et [`controle-lot-a1-local.mjs`](outils-mobile/controle-lot-a1-local.mjs) (local). Résultats bruts : [`lot-a1/resultats.json`](lot-a1/resultats.json), [`lot-a1/local/resultats.json`](lot-a1/local/resultats.json).
