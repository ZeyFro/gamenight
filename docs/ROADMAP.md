# GameNight : suivi de la feuille de route

Lu et mis à jour par `/next-item` (`.claude/commands/next-item.md`), lancé par `scripts/work-roadmap.ps1`.
Règles de travail des sessions manuelles : `docs/ROADMAP-claude-code.md` (non copiées ici).

## Fonctionnement de la boucle

- **Objectif** : finir toute la feuille de route, sans limite de durée. La boucle ne s’arrête que s’il n’y a plus d’élément `À faire` de nature `code`, ou après 2 échecs consécutifs (remis à zéro dès qu’un élément réussit).
- **Statuts** : `À faire` · `PR ouverte` · `Fait` · `ÉCHEC — raison` · `À TOI — raison` (blocage humain : secret, service externe, décision produit, validation).
- **Choix** : premier élément `À faire` de Nature `code`, lots 1 → 7, dans l’ordre des tableaux. Le statut du fichier fait foi.
- **Pile de PR** : chaque élément part de la branche du dernier élément réussi (build, lint et tests verts) et sa PR Draft a cette branche pour base ; le premier part de `origin/main`. `/next-item` lit ce fichier **sur la pointe de la pile**, où les statuts s’accumulent. Un élément en échec n’est jamais une base : son statut `ÉCHEC` est écrit sur une branche de statut seul, partie de la pointe.
- **Pas de plafond de PR** : il remplace l’arrêt par lot du brief `ROADMAP-claude-code.md` (qui reste valable pour les sessions manuelles et n’est pas modifié). La numérotation de ce fichier (lots 1→7) n’est pas celle du brief : ici ce fichier fait foi.
- **Lancement** : `pwsh scripts/work-roadmap.ps1` (`-MaxItems 0` = illimité).

## Lot actuel — #227 (ignoré par la boucle)

PR #227 **mergée** : veto du vote de jeu, filtre roulette par nombre de joueurs, relance instantanée sans doublon, veto roulette asynchrone, correctifs de fiabilité. Reste à valider en réel après déploiement (flags `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`).

## Lot 1 — Fiabilité

| ID | Élément | Ce qui reste | Nature | Statut |
|---|---|---|---|---|
| L1-01 | Rappels après changement de date (✅ rappels 24 h / 2 h configurables) | Corriger les rappels après changement de date ; option 1 h | code | Fait (#229) |
| L1-02 | Périmètre communautaire de la bibliothèque | Isoler jeux, possesseurs et compteurs par serveur | code | Fait (#228) |

## Lot 2 — Organisation

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L2-01 | Sondage de disponibilités type When2meet | 🟡 Suggestions de trois créneaux à partir des plannings | Vrai sondage par soirée, grille de réponses, choix collectif | code | Fait (#232) |
| L2-02 | Jeux possédés par tous les participants choisis | 🟡 Bibliothèque de groupe, possesseurs et filtres | Intersection exacte des joueurs sélectionnés, limitée à leur communauté | code | Fait (#234) |

## Lot 3 — Carnet et préparation

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L3-01 | Identifiants Steam, PSN, Xbox, Switch, Epic, Battle.net | 🟡 Liaison et identifiant Steam | Ajouter les autres identifiants au profil | code | Fait (#235) |
| L3-02 | Manette/clavier, micro, plateformes disponibles | ❌ Aucun carnet structuré | Formulaire et affichage aux autres membres | code | Fait (#236) |
| L3-03 | Préférences et jeux refusés | 🟡 Tags configurables (Coop, FPS, Chill, Horreur…) | Refus explicites (« pas d'horreur ») et usage dans les suggestions | code | Fait (#237) |
| L3-04 | Avertissements : jumpscares, mal des transports, langue | ❌ Pas d'avertissements structurés | Infos sur les fiches et avant inscription | code | PR ouverte #238 (CI et Vercel verts au SHA 019d9e4) |
| L3-05 | Gratuit/payant et taille du téléchargement | 🟡 Prix Steam dans la wishlist | Infos de préparation fiables sur les fiches ; taille absente | code | PR ouverte #239 (HEAD intégré, contrôles à vérifier) |
| L3-06 | Checklist installé / mis à jour / micro / lobby | ❌ Pas de checklist par participant | Cases enregistrées et état de préparation collectif | code | PR ouverte #240 (CI bloquée avant checkout : quota ECR) |
| L3-07 | Temps de préparation | ❌ Pas de durée dédiée | Durée estimée affichée avant la soirée | code | En cours |

## Lot 4 — Calendrier pratique

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L4-01 | Export Google/Apple Calendar (iCal) | ❌ Aucun export | Export ou abonnement respectant la confidentialité | code | À faire |
| L4-02 | Rituels récurrents | ❌ Pas de séries de soirées | « Tous les vendredis », « premier samedi du mois »… | code | À faire |
| L4-03 | Anniversaires et dates importantes du serveur | ❌ Pas d'événements calendrier dédiés | Saisie et affichage | code | À faire |
| L4-04 | Bouton « Rejoindre le vocal » | ❌ Aucun parcours/configuration vocale | Salon vocal par communauté, lien depuis la soirée | code | À faire |

## Lot 5 — Engagement

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L5-01 | Note de la soirée | ❌ Absente | Vote de satisfaction et moyenne | code | À faire |
| L5-02 | Galerie de screenshots et clips | ❌ Pas de souvenirs par soirée | Upload, affichage, permissions, rétention (limites de taille/type à valider) | produit | À TOI — limites de taille et de type d’upload à décider |
| L5-03 | Quêtes hebdomadaires automatiques | 🟡 Défis hebdo manuels, 100 XP | Objectifs suivis automatiquement (deux jeux différents, invitation d'un nouveau…) | code | À faire |
| L5-04 | Taux de présence | 🟡 Présence/résultats et gages | Pourcentage de fiabilité et bonus/malus XP (montants à proposer avant) | produit | À TOI — montants d’XP à décider (bonus/malus) |
| L5-05 | Boutique XP : titres, cadres, couleurs | ❌ Pas de boutique | Catalogue, achat, équipement (dépense XP atomique) | code | À faire |

## Lot 6 — Compléments communautaires

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L6-01 | Tirage au sort des équipes | 🟡 Tirage des joueurs individuels | Équipes/duos | code | À faire |
| L6-02 | Annonces Discord de chaque match de tournoi | ✅ Création, lancement, fin, annulation | Annonces par match | code | À faire |
| L6-03 | Pronostics sur le gagnant d'un tournoi | 🟡 Pronostics/paris pour les soirées | Les relier aux tournois et matchs | code | À faire |
| L6-04 | Hall of Fame / Hall of Shame | 🟡 Badges, superlatifs, gages | Musée des exploits et fails, descriptions et médias | code | À faire |
| L6-05 | Running gags et expressions du serveur | ❌ Pas de glossaire communautaire | Collection éditable par serveur | code | À faire |
| L6-06 | Chronique de soirée | ❌ Absente | Texte par soirée, archive durable | code | À faire |
| L6-07 | Cimetière des jeux avec épitaphe | ❌ Absent | Jeux abandonnés, épitaphes par serveur | code | À faire |
| L6-08 | Quiz et « devine le jeu en trois indices » | ❌ Pas de mini-jeux | Développement du système | code | À faire |
| L6-09 | Sondages éclair | ❌ Votes de soirée/wishlist seulement | Questions, réponses, durée, résultats | code | À faire |
| L6-10 | Alertes de promotion | 🟡 Prix Steam consultables | Détection des baisses et notification | code | À faire |
| L6-11 | « On l'achète à plusieurs » | 🟡 Votes d'intérêt collectif | Engagement et organisation de l'achat groupé | produit | À TOI — règles de l’achat groupé à décider |
| L6-12 | Jeux gratuits Epic/Steam postés automatiquement | ❌ Pas de système | Sources, sélection, publication | code | À faire |
| L6-13 | Notifications push mobile | ❌ Aucun Web Push | Abonnements et livraison (clés VAPID : secret à créer par toi) | produit | À TOI — clés VAPID à créer par toi |

## Lot 7 — Compléments (après le lot 6)

| ID | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L7-01 | Roulette favorisant la tierlist | ❌ Tirage uniforme | Pondération selon les préférences | code | À faire |
| L7-02 | Roulette évitant les jeux récents | ❌ | Utiliser l'historique de la semaine précédente | code | À faire |
| L7-03 | Heures par jeu et heures cumulées | ❌ Pas de suivi de durée | Collecte et calcul | code | À faire |
| L7-04 | Classements fun (heures, régularité) | 🟡 XP, streaks, superlatifs… | Classements par heures et régularité | code | À faire |
| L7-05 | Quiz Tryharder/Ambianceur/Stratège/Chaos | ❌ | Questionnaire et équilibrage d'équipes | code | À faire |
| L7-06 | Import Steam groupé | ✅ Import et synchro | Optimisation de l'import groupé | code | À faire |
| L7-07 | Sorties de jeux attendus | 🟡 Dates IGDB sur les fiches | Suivi et intégration calendrier | code | À faire |
| L7-08 | Soldes Steam, Game Awards, gratuits de la semaine | ❌ | Sources et événements calendaires | code | À faire |
| L7-09 | Halloween, Noël, marathon d'été | 🟡 Création manuelle possible | Thèmes ou programmation saisonnière | code | À faire |
| L7-10 | Charte de fair-play | ❌ | Charte par communauté | code | À faire |
| L7-11 | Recherche de joueurs (« il manque un quatrième ») | 🟡 « Jouer maintenant » | Petites annonces explicites si ce format est voulu | produit | À TOI — format des petites annonces à confirmer |
| L7-12 | Glossaire débutants | ❌ | Lexique aggro/tank/GG/carry | code | À faire |
| L7-13 | PWA hors ligne | 🟡 Manifest présent | Fonctionnement hors ligne non établi | code | À faire |
| L7-14 | Boutons Discord « Je viens » (tournois, parties immédiates, soirées sans capacité) | ✅ Soirées futures avec capacité | Étendre | code | À faire |
| L7-15 | Promotion de liste d'attente | ✅ Promotion auto | Notification dans l'appli ; pas de MP | code | À faire |
| L7-16 | Guide du nouveau : règles et contacts par serveur | ✅ Guide et assistant | Règles/contacts propres à chaque serveur | code | À faire |
| L7-17 | Messages personnalisés et pings du bot | 🟡 Modèles fil/MP | Valider les messages réels et les règles ; modèles partagés entre serveurs | validation | À TOI — validation humaine des messages réels |

## Fait ou à valider en réel (ignorés par la boucle)

Créneaux habituels · Vote de jeu (+ veto #227) · Veto roulette asynchrone, filtre joueurs, relance sans doublon (#227) · Historique des soirées · Jeux les plus joués et stats du groupe (compléter les indicateurs : validation) · Wrapped mensuel (le Wrapped annuel serait un ajout distinct) · Vote MVP · Saisons et reset (vérifier en réel) · Bracket visuel · Saisie des scores (`TOURNAMENT_SCORES_ENABLED`, vérifier l'activation) · Annonces de tournoi · Popup/MP Steam et planning · Rappels (voir L1-01).

## Bilan (rempli par la boucle, un élément à la fois)

**Ordre de merge** : de haut en bas dans chaque lot, lots 1 → 7. Chaque PR a pour base la précédente : merge la première (base `main`), puis la suivante (GitHub la rebase sur `main` quand la branche de base est supprimée au merge ; à vérifier au premier merge). Les PR « statut seul » (ÉCHEC / À TOI) se mergent aussi, dans l’ordre : elles portent les statuts.

| Lot | Ordre | ID | Branche | PR | Résultat |
|---|---|---|---|---|---|
| — | — | — | (pile vide) | — | — |
