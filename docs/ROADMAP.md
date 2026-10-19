# GameNight : suivi de la feuille de route

Lu et mis à jour par `/next-item` (`.claude/commands/next-item.md`), lancé par `scripts/work-roadmap.ps1`.
Règles de travail des sessions manuelles : `docs/ROADMAP-claude-code.md` (non copiées ici).

## Fonctionnement de la boucle

- **Objectif** : finir toute la feuille de route, sans limite de durée. La boucle ne s’arrête que s’il n’y a plus d’élément `À faire` de nature `code`, ou après 2 échecs consécutifs (remis à zéro dès qu’un élément réussit).
- Livraison (colonne dédiée) : Livré et testé = code présent et couvert par les validations automatisées documentées ; Livré mais désactivé = activation ou configuration manquante ; Partiellement livré = périmètre incomplet ; Non implémenté = aucun parcours fonctionnel pour le périmètre restant.
- Statut reste le suivi de la boucle et des PR : Fait signifie que le lot/PR décrit est fusionné, pas que toute la fonctionnalité est activée ou validée en production. La disponibilité réelle dépend des flags, des secrets et des essais authentifiés.
- **Choix** : premier élément `À faire` de Nature `code`, lots 1 → 7, dans l’ordre des tableaux. Le statut du fichier fait foi.
- **Pile de PR** : chaque élément part de la branche du dernier élément réussi (build, lint et tests verts) et sa PR Draft a cette branche pour base ; le premier part de `origin/main`. `/next-item` lit ce fichier **sur la pointe de la pile**, où les statuts s’accumulent. Un élément en échec n’est jamais une base : son statut `ÉCHEC` est écrit sur une branche de statut seul, partie de la pointe.
- **Pas de plafond de PR** : il remplace l’arrêt par lot du brief `ROADMAP-claude-code.md` (qui reste valable pour les sessions manuelles et n’est pas modifié). La numérotation de ce fichier (lots 1→7) n’est pas celle du brief : ici ce fichier fait foi.
- **Lancement** : `pwsh scripts/work-roadmap.ps1` (`-MaxItems 0` = illimité).

## Lot actuel — #227 (ignoré par la boucle)

PR #227 **mergée** : veto du vote de jeu, filtre roulette par nombre de joueurs, relance instantanée sans doublon, veto roulette asynchrone, correctifs de fiabilité. Reste à valider en réel après déploiement (flags `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`).

## Lot 1 — Fiabilité

| ID | Livraison | Élément | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|
| L1-01 | Livré et testé | Rappels réarmés après changement de date; préréglage 1 h inclus | Recette réelle des rappels non exécutée ici; aucun envoi Discord autorisé | code | Fait (#229) |
| L1-02 | Livré et testé | Bibliothèque collective, possesseurs et compteurs filtrés par communauté active | Code conditionné par l’isolation; garder celle-ci désactivée, recette multi-compte non vérifiée | code | Fait (#228) |

## Lot 2 — Organisation

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L2-01 | Livré et testé | Sondage de disponibilités type When2meet | ✅ Créneaux, réponses individuelles, grille et conversion en soirée | Migration et parcours authentifié à vérifier sur Preview; pas de flag dédié | code | Fait (#232) |
| L2-02 | Livré et testé | Jeux possédés par tous les participants choisis | ✅ Intersection exacte des possessions des joueurs sélectionnés | Recette authentifiée non vérifiée; périmètre global historique si isolation OFF | code | Fait (#234) |

## Lot 3 — Carnet et préparation

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L3-01 | Livré et testé | Identifiants Steam, PSN, Xbox, Switch, Epic, Battle.net | ✅ Identifiants déclaratifs hors Steam, édition profil et affichage aux potes | Migration et parcours authentifié à vérifier; pas de vérification de propriété hors Steam | code | Fait (#235) |
| L3-02 | Livré et testé | Manette/clavier, micro, plateformes disponibles | ✅ Carnet matériel, plateformes et micro sur le profil | Aucune | code | Fait (#236) |
| L3-03 | Livré et testé | Préférences et jeux refusés | ✅ Refus de catégories/jeux et classement des suggestions des participants choisis | Migration et recette authentifiée à vérifier; ne modifie pas les votes ni les roulettes | code | Fait (#237) |
| L3-04 | Livré et testé | Avertissements : jumpscares, mal des transports, langue | ✅ Avertissements visibles avant participation | Aucune | code | Fait (#239 ; PR #238 fusionnée) |
| L3-05 | Livré et testé | Gratuit/payant et taille du téléchargement | ✅ Coût, prix, volume, plateforme et source déclarés sur la fiche jeu | Saisie communautaire; pas de catalogue automatique ni de garantie de fraîcheur | code | Fait (#239) |
| L3-06 | Livré mais désactivé | Checklist installé / mis à jour / micro / lobby | ✅ Checklist individuelle sur les soirées prévues | Aucune | code | Fait (#240) |
| L3-07 | Livré mais désactivé | Temps de préparation | ✅ Durée estimée sur les fiches jeu | Aucune | code | Fait (#241) |

## Lot 4 — Calendrier pratique

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L4-01 | Livré mais désactivé | Export Google/Apple Calendar (iCal) | ✅ Téléchargement ponctuel; abonnement privé révocable par serveur | Export disponible; abonnement exige `CALENDAR_SUBSCRIPTIONS_ENABLED` et migration `calendar_feed_tokens`; essai calendrier tiers non vérifié | code | Export Fait (#242); abonnement ajouté par le lot `calendar-subscriptions` |
| L4-02 | Partiellement livré | Rituels récurrents | ✅ Séries hebdomadaires/mensuelles; annulation groupée des occurrences futures des nouvelles séries | Annulation exige `SESSION_SERIES_CANCEL_ENABLED` et migration; édition groupée des dates/cadences et traitement des exceptions à cadrer | code | Création Fait (#243); annulation ajoutée par le lot `cancel-recurring-sessions` |
| L4-03 | Livré et testé | Anniversaires et dates importantes du serveur | ✅ Dates serveur et anniversaires opt-in dans le calendrier | Aucune | code | Fait (#245, fusionnée) |
| L4-04 | Livré mais désactivé | Bouton « Rejoindre le vocal » | ✅ Salon vocal vérifié et lien depuis la soirée | Validation Discord réelle par un administrateur | code | Fait (#246, fusionnée) |

## Lot 5 — Engagement

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L5-01 | Livré et testé | Note de la soirée | ✅ Notes individuelles (1–5) après une soirée terminée, moyenne visible aux invités | Aucune | code | Fait (#247, fusionnée) |
| L5-02 | Partiellement livré | Galerie de screenshots et clips | 🟡 Galerie photo privée | Images JPEG/PNG/GIF/WebP, 4 Mo, 8 par soirée, consentement, participants actifs; toggle admin OFF; clips et purge séparée différés | code | Fait (#276, fusionnée); upload fermé sans `SESSION_MEDIA_BLOB_TOKEN` |
| L5-03 | Livré et testé | Quêtes hebdomadaires automatiques | ✅ Deux jeux différents ou arrivée d'un nouveau membre, suivi à la clôture | Aucune | code | Fait (#248, fusionnée) |
| L5-04 | Livré mais désactivé | Taux de présence | 🟡 Présence/résultats et gages | Pourcentage mesuré à partir des saisies de présence, bonus +2 XP / absence −1 XP réglables par communauté; désactivés par défaut, absence débitée uniquement après saisie explicite par le créateur | code | Fait (#276, fusionnée) |
| L5-05 | Livré et testé | Boutique XP : titres, cadres, couleurs | ✅ Livré | Aucune | code | Fait (#249, fusionnée) |

## Lot 6 — Compléments communautaires

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L6-01 | Livré et testé | Tirage au sort des équipes | ✅ Livré | Aucune | code | Fait (#250, fusionnée) |
| L6-02 | Livré mais désactivé | Annonces Discord de chaque match de tournoi | ✅ Livré | Aucune | code | Fait (#268, fusionnée) |
| L6-03 | Livré mais désactivé | Pronostics sur le gagnant d'un tournoi | ✅ Pronostics champion et match | Aucune | code | Fait (#269, fusionnée) |
| L6-04 | Livré mais désactivé | Hall of Fame / Hall of Shame | ✅ Musée exploits/fails, descriptions et liens médias | Aucune | code | Fait (#270, fusionnée) |
| L6-05 | Livré mais désactivé | Running gags et expressions du serveur | ✅ Collection éditable par serveur | Aucune | code | Fait (#271, fusionnée) |
| L6-06 | Livré mais désactivé | Chronique de soirée | ✅ Archives éditoriales par soirée | Aucune | code | Fait (#273, fusionnée dans `fd95637`; CI verte sur `fbaa830`) |
| L6-07 | Livré mais désactivé | Cimetière des jeux avec épitaphe | ✅ Épitaphes de jeux par serveur | Aucune | code | Fait (#272, fusionnée) |
| L6-08 | Livré et testé | Quiz et « devine le jeu en trois indices » | ✅ Livré | Aucune | code | Fait (#252, fusionnée) |
| L6-09 | Livré mais désactivé | Sondages éclair | ✅ Sondages communautaires à échéance | Aucune | code | Fait (#274, fusionnée) |
| L6-10 | Livré mais désactivé | Alertes de promotion | 🟡 Prix Steam consultables | Seuil configurable (20 % par défaut), Steam France, notification in-app, délai de 7 jours; option désactivée par défaut | code | Fait (#276, fusionnée) |
| L6-11 | Partiellement livré | « On l'achète à plusieurs » | 🟡 Votes d'intérêt collectif | Plan indicatif par date et note, administrable par communauté; aucun engagement financier ni achat automatique | code | Fait (#276, fusionnée) |
| L6-12 | Partiellement livré | Jeux gratuits Epic/Steam postés automatiquement | 🟡 Curation en app | Offres Steam/Epic en français, dates de validité, publication in-app par admin et toggle désactivé par défaut | code | Fait (#276, fusionnée) pour la curation manuelle; automatisation différée faute de flux public officiel stable |
| L6-13 | Livré mais désactivé | Notifications push mobile | 🟡 Implémentation Web Push locale; worker partagé avec PWA | Configurer une paire VAPID persistante et activer par environnement; aucun secret trouvé dans les sources accessibles | produit | Fait (#276, fusionnée); activation non vérifiée (403), paire VAPID non vérifiée |

## Lot 7 — Compléments (après le lot 6)

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L7-01 | Livré et testé | Roulette favorisant la tierlist | ✅ Livré | Aucune | code | Fait (#254, fusionnée) |
| L7-02 | Livré et testé | Roulette évitant les jeux récents | ✅ Livré | Aucune | code | Fait (#254, fusionnée) |
| L7-03 | Livré et testé | Heures par jeu et heures cumulées | ✅ Livré | Aucune | code | Fait (#255, fusionnée) |
| L7-04 | Livré et testé | Classements fun (heures, régularité) | ✅ Livré | Aucune | code | Fait (#256, fusionnée) |
| L7-05 | Livré et testé | Quiz Tryharder/Ambianceur/Stratège/Chaos | ✅ Quiz court à quatre questions, profil dominant/mixte réutilisé par la roulette; édition manuelle conservée | Aucune | code | Fait (#276, fusionnée) |
| L7-06 | Livré et testé | Import Steam groupé | ✅ Livré | Aucune | code | Fait (#258, fusionnée) |
| L7-07 | Livré et testé | Sorties de jeux attendus | ✅ Livré | Aucune | code | Fait (#259, fusionnée) |
| L7-08 | Livré et testé | Soldes Steam, Game Awards, gratuits de la semaine | ✅ Livré | Aucune | code | Fait (#260, fusionnée) |
| L7-09 | Livré et testé | Halloween, Noël, marathon d'été | ✅ Livré | Aucune | code | Fait (#261, fusionnée) |
| L7-10 | Livré et testé | Charte de fair-play | ✅ Livré | Aucune | code | Fait (#262, fusionnée) |
| L7-11 | Partiellement livré | Recherche de joueurs (« il manque un quatrième ») | 🟡 MVP petites annonces | Jeu + message court, membres actifs uniquement, 24 h, suppression auteur/admin ; activation par communauté | code | Fait (#276, fusionnée) |
| L7-12 | Livré et testé | Glossaire débutants | ✅ Livré | Aucune | code | Fait (#263, fusionnée) |
| L7-13 | Partiellement livré | PWA hors ligne | 🟡 Fallback hors ligne | L'application et ses données ne sont pas disponibles sans réseau; ne pas mettre en cache de réponses privées sans décision de sécurité | code | Fallback `/offline.html` livré (#265); expérience réellement utilisable hors ligne non livrée |
| L7-14 | Livré et testé | Boutons Discord « Je viens » (tournois, parties immédiates, soirées sans capacité) | ✅ Livré | Aucune | code | Fait (#264, fusionnée) |
| L7-15 | Livré et testé | Promotion de liste d'attente | ✅ Livré | Aucune | code | Fait (#266, fusionnée) |
| L7-16 | Livré et testé | Guide du nouveau : règles et contacts par serveur | ✅ Règles et contacts administrables, affichés dans le guide du serveur | Migration, contenu admin et parcours authentifié à vérifier; ne pas activer l’isolation pour cette reprise | code | Fait (#267, fusionnée) |
| L7-17 | Partiellement livré | Messages personnalisés et pings du bot | 🟡 Modèles fil/MP | Valider les messages réels et les règles ; modèles partagés entre serveurs | validation | À TOI — validation humaine des messages réels |

## Parcours livrés à valider en réel (ignorés par la boucle)

Créneaux habituels · Vote de jeu (+ veto #227) · Veto roulette asynchrone, filtre joueurs, relance sans doublon (#227) · Historique des soirées · Jeux les plus joués et stats du groupe (compléter les indicateurs : validation) · Wrapped mensuel (le Wrapped annuel serait un ajout distinct) · Vote MVP · Saisons et reset (vérifier en réel) · Bracket visuel · Saisie des scores (`TOURNAMENT_SCORES_ENABLED`, vérifier l'activation) · Annonces de tournoi · Popup/MP Steam et planning · Rappels (voir L1-01).

## Bilan (rempli par la boucle, un élément à la fois)

**Ordre de merge** : de haut en bas dans chaque lot, lots 1 → 7. Chaque PR a pour base la précédente : merge la première (base `main`), puis la suivante (GitHub la rebase sur `main` quand la branche de base est supprimée au merge ; à vérifier au premier merge). Les PR « statut seul » (ÉCHEC / À TOI) se mergent aussi, dans l’ordre : elles portent les statuts.

| Lot | Ordre | ID | Branche | PR | Résultat |
|---|---|---|---|---|---|
| 5/6/7 | 1 | L5-02, L5-04, L6-10 à L6-12, L7-05, L7-11 | `feat/roadmap-product-basics` | #276 | Fusionnée dans `8c1525f`; CI et validation décrites dans la PR |
| 6 | 2 | L6-06 | `feat/session-chronicles-next` | #273 | Fusionnée dans `fd95637`; CI verte au head `fbaa830`, Vercel Preview Ready, Postgres local 2 972/2 972 |

