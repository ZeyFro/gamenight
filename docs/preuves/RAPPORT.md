# Rapport : preuves et audit du parcours du nouveau joueur

Local uniquement (PostgreSQL jetable 127.0.0.1, aucun appel Discord, Vercel ni Neon, aucune correction de code). Chiffres calculés par `outils/tracabilite.mjs`.

## 1. Totaux

| | Total | FONCTIONNE | PARTIEL | NE FONCTIONNE PAS | NON TESTABLE EN LOCAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Lignes du cahier** | 127 | 57 | 8 | 5 | 57 |
| **Décisions du 18/11** | 20 | 11 | 1 | 2 | 6 |

Les 57 lignes « non testables » : 24 sans livrable code (principes, actions humaines), 9 reportées par décision, 24 dont l'effet se produit dans Discord (tests à clients simulés réussis, mais l'effet réel n'est pas observable sans appel Discord). **Les décisions comptent 20 lignes : le dépôt ne les numérote pas, j'ai découpé `docs/DECISIONS_TOWER.md` (décisions du 18/11) et le §27 du cahier en 20 décisions atomiques** (liste dans [TRACABILITE.md](TRACABILITE.md)).

**Exécution des tests cités : 57 fichiers, 980/981 tests réussis.** Tests ignorés (« skipped »), à signaler : src/lib/migrations-immutable.test.ts (1). Un premier essai a échoué sur `src/app/tower/forums/page.test.tsx` (« Invalid hook call ») à cause de ma copie locale de `node_modules` en liens physiques ; réexécuté avec le `node_modules` normal : 2/2 réussis. Ce n'est pas un défaut du code.

## 2. NE FONCTIONNE PAS

| Id | § | Exigence | Correction proposée | Effort (estimation de développement, non mesurée) |
| --- | --- | --- | --- | --- |
| C023 | 9.1 | Les défis qui autorisent des preuves anciennes doivent l'indiquer explicitement | Ajouter un champ « preuve ancienne autorisée » à la définition d'un défi et le lire dans les règles de preuve | 0,5–1 j |
| C032 | 11.2 | Identité visuelle d'une équipe | Migration additive (logo, bannière, couleur) sur `CommunityTeam` + interface capitaine | 1–2 j |
| C038 | 12.3 | Proposition de partenaires compatibles | Suggestion de partenaires compatibles (niveau, jeux, créneaux) ; pour la ligne « visibilité » : appliquer `canViewPote` aux classements et soirées | 3–5 j ; 2–3 j |
| C048 | 14.3 | Classement d'équipes | Classement d'équipes Tower (agrégat des étages des membres) et page | 2–3 j |
| C075 | 22.2 | Test : bascule depuis les anciens étages | Sans objet depuis la décision §7.2 (compteur à zéro) : retirer la ligne du cahier | 0 j |

Décisions du 18/11 :

| Id | Décision | Correction proposée | Effort |
| --- | --- | --- | --- |
| D08 | Notifications : MP uniquement pour ce qui vise personnellement le joueur | Appeler `isDirectMessageAllowed` à l'enqueue ; supprimer ou justifier les MP hors liste (« Bienvenue », rappels) ; décider avec le propriétaire du double ping #116 ; décocher « Prévenir qui » par défaut | 1–2 j |
| D10 | Notifications : annonces publiques seulement pour les moments marquants | Filtrer `announceLevelUp` et `announceBadgeUnlocked` (nouveau Ranker/High Ranker, victoire de tournoi, record) et retirer la mention `<@id>` | 1 j |

## 3. PARTIEL

| Id | § | Exigence | Correction proposée | Effort (estimation) |
| --- | --- | --- | --- | --- |
| C019 | 8.5 | Variété des défis (gaming, créatifs, absurdes, coopération, hors jeu…) | Relecture humaine de la variété du catalogue de 116 défis | 0,5 j |
| C029 | 10.3 | Animation : réussites marquantes, exploits insolites, distinctions humoristiques, résultats de compétitions, récapitulatifs hebdomadaires, mise en avant des joueurs actifs | Récapitulatif hebdomadaire Tower et mise en avant des joueurs actifs | 2–3 j |
| C036 | 12.2 | Critères de recherche : langue, préférences communautaires, habitudes de jeu, centres d'intérêt | Champs langue et habitudes de jeu sur le profil et dans les filtres | 1–2 j |
| C039 | 12.3 | Découverte des joueurs respectant leur choix de visibilité | Suggestion de partenaires compatibles (niveau, jeux, créneaux) ; pour la ligne « visibilité » : appliquer `canViewPote` aux classements et soirées | 3–5 j ; 2–3 j |
| C044 | 13.4 | Interfaces : « Ce soir », fiches de soirée, recherche de partie, roulette, calendrier, notifications personnalisées | Brancher `notifyGamePingOptIns` dans les flux (voir D09) | 1–2 j |
| C055 | 19.1 | Journalisation des opérations sensibles | Journal général des opérations sensibles | 2–3 j |
| C061 | 21.4 | Migrations : structure vérifiée, sauvegarde, tests, retour arrière, validation de la bascule | Preuve de restauration (action propriétaire sur Neon) | 0,5–1 j |
| C085 | 27 I | Notifications : MP ciblés, pings de rôle opt-in, centre in-app, jamais @everyone [#474] | Brancher les pings de rôle opt-in et la politique de MP (voir D08 à D10) | 2–4 j |

Décisions du 18/11 :

| Id | Décision | Correction proposée | Effort |
| --- | --- | --- | --- |
| D09 | Notifications : pings de rôle de jeu en opt-in + centre de notifications dans l'app, jamais @everyone | Appeler `notifyGamePingOptIns` / `buildGameRolePing` depuis les annonces de tournoi public et de jeux gratuits ; écran d'opt-in par jeu | 1–2 j |

## 4. Les 10 premières frictions d'un débutant (classées)

| # | Friction | Preuve mesurée | Capture | Correction | Effort |
| ---: | --- | --- | --- | --- | --- |
| 1 | **« Jouer maintenant » prévient les 31 membres par défaut** | Les 31 cases « Prévenir qui ? » sont cochées ; un seul « Démarrer » met en file 31 MP + 1 annonce (mesuré en base). Le texte d'avertissement est sous 31 lignes. | [D-3](parcours/D-bureau-03.png) · [D-5](parcours/D-bureau-05.png) | Décocher par défaut, plafonner, afficher l'avertissement au-dessus de la liste | 0,5 j |
| 2 | **Premier défi Tower impossible dans l'application** | « Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord. » Aucun bouton. | [C-3](parcours/C-bureau-03.png) | Bouton « Obtenir mon défi » qui appelle la même action | 1–2 j |
| 3 | **Deux « Étage 1 » pour un joueur à 0 XP** | Étage d'Ascension (XP) et étages remportés par les défis s'affichent côte à côte, tous deux « Étage 1 ». | [C-3](parcours/C-bureau-03.png) | Renommer (« Niveau XP » / « Étages Tower »), afficher 0 pour un compteur vide | 0,5–1 j |
| 4 | **Vocabulaire jamais défini** | « Victime · Bronze » (13 pages), Régulars/Irregular, étage XP, rang, Lore, tierlist, Ascension : aucune définition dans le parcours. | [PARCOURS_NOUVEAU §3](PARCOURS_NOUVEAU.md) | Glossaire dans `/guide` + infobulles | 1 j |
| 5 | **Pages sans lien ou enfouies** | `/projets`, `/soutiens`, `/bibliotheque/plateformes` : aucun lien entrant ; `/ce-soir` à 3 clics ; `/notifications` seulement par la cloche. | [graphe-clics.json](graphe-clics.json) | Ajouter au menu ou à l'accueil | 0,5 j |
| 6 | **Libellés qui ne font pas ce qu'ils disent** | « Trouver des joueurs » ouvre les Forums Tower ; « Rejoindre une soirée » ouvre le formulaire de création. | [B-3](parcours/B-bureau-03.png) · [A2-3](parcours/A2-bureau-03.png) | Corriger les cibles et les libellés | 0,5 j |
| 7 | **Bouton Démarrer grisé sans raison affichée** | Aucun message tant qu'aucun jeu n'est choisi. | [D-3](parcours/D-bureau-03.png) | Texte d'aide « Choisis un jeu » | 0,25 j |
| 8 | **Redirections silencieuses** | `/admin` et `/serveurs` renvoient à l'accueil sans un mot pour un non-admin. | [nouveau /admin](captures/nouveau-bureau-admin.png) | Message « Réservé aux administrateurs » | 0,5 j |
| 9 | **Invite d'accueil et bouton flottant qui masquent le contenu** | Quatre boutons sur la première invite ; « Compléter mon profil » recouvre le bas de page sur plusieurs captures. | [accueil](captures/nouveau-bureau-accueil.png) · [D-5](parcours/D-bureau-05.png) | Un seul bouton principal ; décaler le bouton flottant | 0,5 j |
| 10 | **Annonces et MP au-delà de la décision du 18/11** | Chaque niveau et chaque badge annoncés avec mention ; MP « Bienvenue » au premier rendu (code lu, non exécuté faute de jeton). | [NOTIFICATIONS.md](NOTIFICATIONS.md) | Voir D08 et D10 | 1–2 j |

Détail des clics, des culs-de-sac et du jargon : [PARCOURS_NOUVEAU.md](PARCOURS_NOUVEAU.md).

## 5. Pings et notifications (résumé ; détail dans [NOTIFICATIONS.md](NOTIFICATIONS.md))

Vérifié par moi : aucun `@everyone` ni `@here` n'est émis (suppression de `parse=everyone` dans `src/lib/discord-rest.ts`) ; **`buildGameRolePing`, `notifyGamePingOptIns`, `isDirectMessageAllowed`, `isPublicAnnouncementAllowed` ont zéro appelant hors tests** (grep exécuté) : l'opt-in des pings de rôle est du code mort et la politique « MP seulement ciblés » n'est pas appliquée ; chaque niveau et badge sont annoncés avec `<@id>` (`discord-level-up.ts:33`, `discord-badge-unlocked.ts:26`). Lu dans le code par l'audit (non exécuté) : 25 livraisons par passage de l'executor, aucun plafond sur la liste des invités notifiés, un 429 consomme une tentative sur 8 ; à 100 invités une annonce de soirée dépasse probablement la limite de 2 000 caractères de Discord (chiffre non vérifiable en local).

## 6. Ce qui n'a pas pu être fait

- Connexion Discord réelle (OAuth), toute action dans Discord, Steam, IGDB, crons externes : non testables en local.
- Mobile : captures de toutes les pages ; parcours interactifs mobiles seulement jusqu'à la 3ᵉ étape (profil de test déjà modifié par les parcours bureau).
- Serveur en mode développement : pastille « N » visible sur certaines captures ; les performances mesurées ne sont pas celles de la production.

## 7. Reproduire

```bash
npm ci   # ou lien vers un node_modules existant
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves node docs/preuves/outils/seed.mjs
docs/preuves/outils/lancer-serveur.sh &
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves node docs/preuves/outils/capture.mjs
node docs/preuves/outils/tests.mjs && node docs/preuves/outils/scenarios.mjs && node docs/preuves/outils/tracabilite.mjs
```
