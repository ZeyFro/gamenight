# GameNight : suivi de la feuille de route

Lu et mis à jour par `/next-item` (`.claude/commands/next-item.md`), lancé par `scripts/work-roadmap.ps1`.
Règles de travail des sessions manuelles : brief `ROADMAP-claude-code.md`, hors dépôt (absent de `docs/`). État courant : `docs/REPRISE_AUTONOME.md`.

## Fonctionnement de la boucle

- **Objectif** : finir toute la feuille de route, sans limite de durée. La boucle ne s’arrête que s’il n’y a plus d’élément `À faire` de nature `code`, ou après 2 échecs consécutifs (remis à zéro dès qu’un élément réussit).
- Livraison (colonne dédiée) : Livré et testé = code présent et couvert par les validations automatisées documentées ; Livré mais désactivé = activation ou configuration manquante ; Partiellement livré = périmètre incomplet ; Non implémenté = aucun parcours fonctionnel pour le périmètre restant.
- Statut reste le suivi de la boucle et des PR : Fait signifie que le lot/PR décrit est fusionné, pas que toute la fonctionnalité est activée ou validée en production. La disponibilité réelle dépend des flags, des secrets et des essais authentifiés.
- **Choix** : premier élément `À faire` de Nature `code`, lots 1 → 7, dans l’ordre des tableaux. Le statut du fichier fait foi.
- **Pile de PR** : chaque élément part de la branche du dernier élément réussi (build, lint et tests verts) et sa PR Draft a cette branche pour base ; le premier part de `origin/main`. `/next-item` lit ce fichier **sur la pointe de la pile**, où les statuts s’accumulent. Un élément en échec n’est jamais une base : son statut `ÉCHEC` est écrit sur une branche de statut seul, partie de la pointe.
- **Pas de plafond de PR** : il remplace l’arrêt par lot du brief `ROADMAP-claude-code.md` (qui reste valable pour les sessions manuelles et n’est pas modifié). La numérotation de ce fichier (lots 1→7) n’est pas celle du brief : ici ce fichier fait foi.
- **Lancement** : `pwsh scripts/work-roadmap.ps1` (`-MaxItems 0` = illimité).

## Lot #227 (historique, ignoré par la boucle)

L’état courant du projet est dans `docs/REPRISE_AUTONOME.md`. PR #227 **mergée** : veto du vote de jeu, filtre roulette par nombre de joueurs, relance instantanée sans doublon, veto roulette asynchrone, correctifs de fiabilité. Reste à valider en réel après déploiement (flags `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`).

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
| L4-01 | Livré mais désactivé | Export Google/Apple Calendar (iCal) | ✅ Téléchargement ponctuel; abonnement privé révocable par serveur | Export disponible; abonnement exige `CALENDAR_SUBSCRIPTIONS_ENABLED` et migration `calendar_feed_tokens`; essai calendrier tiers non vérifié | code | Export Fait (#242); abonnement Fait (#286, fusionnée) |
| L4-02 | Partiellement livré | Rituels récurrents | ✅ Séries hebdomadaires/mensuelles; annulation groupée des occurrences futures des nouvelles séries | Annulation exige `SESSION_SERIES_CANCEL_ENABLED` et migration; proposition à valider : éditer les occurrences futures seulement, sans modifier le passé ni les exceptions individuelles | code | Création Fait (#243); annulation Fait (#287, fusionnée) |
| L4-03 | Livré et testé | Anniversaires et dates importantes du serveur | ✅ Dates serveur et anniversaires opt-in dans le calendrier | Aucune | code | Fait (#245, fusionnée) |
| L4-04 | Livré mais désactivé | Bouton « Rejoindre le vocal » | ✅ Salon vocal vérifié et lien depuis la soirée | Validation Discord réelle par un administrateur | code | Fait (#246, fusionnée) |

## Lot 5 — Engagement

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L5-01 | Livré et testé | Note de la soirée | ✅ Notes individuelles (1–5) après une soirée terminée, moyenne visible aux invités | Aucune | code | Fait (#247, fusionnée) |
| L5-02 | Livré mais désactivé | Galerie de screenshots et clips | Galerie privée photo et MP4 : 4 Mo par média, 8 médias par soirée, consentement; gestion créateur ou ADMIN/OWNER déjà autorisé à voir la soirée | `SESSION_MEDIA_BLOB_TOKEN`, galerie communautaire activée et `SESSION_VIDEO_ENABLED=true` pour les clips; upload/lecture Blob et codecs réels non validés. Nettoyage lié à la suppression de soirée présent, sans purge autonome | code | Galerie #276, clips #288 et permissions #290 fusionnés; tests locaux et recette multi-compte acquis, aucun upload Blob réel |
| L5-03 | Livré et testé | Quêtes hebdomadaires automatiques | ✅ Deux jeux différents ou arrivée d'un nouveau membre, suivi à la clôture | Aucune | code | Fait (#248, fusionnée) |
| L5-04 | Partiellement livré | Taux de présence | Présence déclarée par le créateur, pourcentage calculé depuis ces saisies, bonus et pénalités configurables | Présence Discord ou vocale réellement mesurée non implémentée; ce manque exige un collecteur, pas seulement un flag. Bonus +2 XP / absence −1 XP existants, désactivés par défaut; conserver les paramètres sans activation arbitraire | code | Déclaratif #276 fusionné; collecte Discord absente, parcours et activation non validés |
| L5-05 | Livré avec réserve | Boutique XP : titres, cadres, couleurs | Boutique `/profil/boutique` livrée (#249, fusionnée). Sur `main`, l'achat décrémente `xpTotal` (`src/lib/xp-shop.ts`) : le solde dépensé est le même que celui du niveau | Séparation XP boutique / XP de niveau portée par #325 (Draft, non fusionnée) ; non en production tant que #325 n'est pas intégrée | code | Livré (#249) ; réserve ci-dessus |

## Lot 6 — Compléments communautaires

| ID | Livraison | Élément | État actuel | Ce qui reste | Nature | Statut |
|---|---|---|---|---|---|---|
| L6-01 | Livré et testé | Tirage au sort des équipes | ✅ Livré | Aucune | code | Fait (#250, fusionnée) |
| L6-02 | Livré mais désactivé | Annonces Discord de chaque match de tournoi | ✅ Livré | Aucune | code | Fait (#268, fusionnée) |
| L6-03 | Livré mais désactivé | Pronostics sur le gagnant d'un tournoi | Pronostics champion/match et score personnel fictif : 1 point par cible correcte résolue, sans mise ni XP | `TOURNAMENT_PREDICTIONS_ENABLED`; parcours authentifié à valider | code | Pronostics #269 et points #295 fusionnés; tests ciblés 11/11 et CI verte |
| L6-04 | Livré mais désactivé | Hall of Fame / Hall of Shame | ✅ Musée exploits/fails, descriptions et liens médias | Aucune | code | Fait (#270, fusionnée) |
| L6-05 | Livré mais désactivé | Running gags et expressions du serveur | ✅ Collection éditable par serveur | Aucune | code | Fait (#271, fusionnée) |
| L6-06 | Livré mais désactivé | Chronique de soirée | ✅ Archives éditoriales par soirée | Aucune | code | Fait (#273, fusionnée dans `fd95637`; CI verte sur `fbaa830`) |
| L6-07 | Livré mais désactivé | Cimetière des jeux avec épitaphe | ✅ Épitaphes de jeux par serveur | Aucune | code | Fait (#272, fusionnée) |
| L6-08 | Livré et testé | Quiz et « devine le jeu en trois indices » | ✅ Livré | Aucune | code | Fait (#252, fusionnée) |
| L6-09 | Livré mais désactivé | Sondages éclair | ✅ Sondages communautaires à échéance | Aucune | code | Fait (#274, fusionnée) |
| L6-10 | Livré mais désactivé | Alertes de promotion | 🟡 Prix Steam consultables | Seuil configurable (20 % par défaut), Steam France, notification in-app, délai de 7 jours; option désactivée par défaut | code | Fait (#276, fusionnée) |
| L6-11 | Partiellement livré | « On l'achète à plusieurs » | 🟡 Votes d'intérêt collectif | Plan indicatif par date et note, administrable par communauté; proposition à valider : coordination sans paiement intégré, engagement financier ni achat automatique | code | Fait (#276, fusionnée) |
| L6-12 | Livré mais désactivé | Jeux gratuits Epic/Steam : agrégation in-app automatique et publication | Catalogue in-app GamerPower filtré, liens boutiques officiels; curation manuelle prioritaire et doublons retirés. Publication Discord par communauté présente (#299, revalidation avant envoi #301, recette Postgres #320) via `src/lib/free-game-discord.ts` et le cron `free-game-discord` | `FREE_GAME_FEED_ENABLED=true` et `freeGamesEnabled` communautaire, OFF par défaut; publication Discord : `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` en plus de `COMMUNITY_CHANNELS_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED` et d'un salon communautaire dédié, OFF par défaut; cache 15 min, relevés de plus de 30 min ignorés. Disponibilité, prix et expiration non garantis; intégration live non validée | code | Curation #276, flux in-app #292 et publication Discord #299/#301 fusionnés; CI/Preview vertes. Les promotions payantes Epic sont un sujet distinct |
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
| L7-13 | Partiellement livré | PWA hors ligne | 🟡 Fallback hors ligne | Proposition à valider : shell public uniquement; aucune donnée privée ni réponse authentifiée en cache | code | Fallback `/offline.html` livré (#265); expérience réellement utilisable hors ligne non livrée |
| L7-14 | Livré et testé | Boutons Discord « Je viens » (tournois, parties immédiates, soirées sans capacité) | ✅ Livré | Aucune | code | Fait (#264, fusionnée) |
| L7-15 | Livré et testé | Promotion de liste d'attente | ✅ Livré | Aucune | code | Fait (#266, fusionnée) |
| L7-16 | Livré et testé | Guide du nouveau : règles et contacts par serveur | ✅ Règles et contacts administrables, affichés dans le guide du serveur | Migration, contenu admin et parcours authentifié à vérifier; ne pas activer l’isolation pour cette reprise | code | Fait (#267, fusionnée) |
| L7-17 | Partiellement livré | Messages personnalisés et pings du bot | 🟡 Modèles fil/MP | Proposition à valider : modèles par communauté et mentions contrôlées par ses administrateurs; valider les messages réels et les règles | validation | À TOI — validation humaine des messages réels |

## Propositions de cadrage produit — validation du propriétaire requise

Ces orientations restent des propositions; elles ne sont ni arbitrées par le propriétaire ni mises en œuvre. Les fonctions existantes et les validations manquantes gardent leur statut séparé.

- Séries : éditer les occurrences futures seulement; préserver le passé et les exceptions individuelles.
- Hors ligne : shell public uniquement; aucune donnée privée mise en cache.
- Galerie : conserver les médias avec la soirée et les supprimer avec elle; pas de purge autonome.
- Achats collectifs : coordination sans paiement intégré.
- Jeux gratuits : curation manuelle conservée et flux GamerPower in-app livré (#292), deux réglages OFF par défaut; gratuité, conditions et région restent à vérifier sur la boutique. La publication Discord par communauté existe (#299), derrière ses propres drapeaux OFF par défaut.
- Discord : modèles par communauté; contrôle des mentions par ses administrateurs.

## Parcours livrés à valider en réel (ignorés par la boucle)

Créneaux habituels · Vote de jeu (+ veto #227) · Veto roulette asynchrone, filtre joueurs, relance sans doublon (#227) · Historique des soirées · Jeux les plus joués et stats du groupe (compléter les indicateurs : validation) · Wrapped mensuel (le Wrapped annuel serait un ajout distinct) · Vote MVP · Saisons et reset (vérifier en réel) · Bracket visuel · Saisie des scores (`TOURNAMENT_SCORES_ENABLED`, vérifier l'activation) · Annonces de tournoi · Popup/MP Steam et planning · Rappels (voir L1-01) · The Tower (défis par étage, équipes, vote de saison ; migrations Tower marquées appliquées, commandes `/tower` et `/tower-admin` pas encore enregistrées sur le serveur (tentative en échec 403, voir `REPRISE_AUTONOME.md`) ; **Livré mais désactivé** tant que `TOWER_CHALLENGES_ENABLED` et `towerChallengesEnabled` sont éteints).

## Bilan (rempli par la boucle, un élément à la fois)

**Ordre de merge** : de haut en bas dans chaque lot, lots 1 → 7. Chaque PR a pour base la précédente : merge la première (base `main`), puis la suivante (GitHub la rebase sur `main` quand la branche de base est supprimée au merge ; à vérifier au premier merge). Les PR « statut seul » (ÉCHEC / À TOI) se mergent aussi, dans l’ordre : elles portent les statuts.

| Lot | Ordre | ID | Branche | PR | Résultat |
|---|---|---|---|---|---|
| 5/6/7 | 1 | L5-02, L5-04, L6-10 à L6-12, L7-05, L7-11 | `feat/roadmap-product-basics` | #276 | Fusionnée dans `8c1525f`; CI et validation décrites dans la PR |
| 6 | 2 | L6-06 | `feat/session-chronicles-next` | #273 | Fusionnée dans `fd95637`; CI verte au head `fbaa830`, Vercel Preview Ready, Postgres local 2 972/2 972 |



---

## The Tower 2.0 × GameNight — roadmap globale par PR

Cette section complète la feuille de route GameNight ci-dessus. Le cahier produit de référence est [docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md). La version enrichie [docs/TOWER_CAHIER_DES_CHARGES_GLOBAL.md](TOWER_CAHIER_DES_CHARGES_GLOBAL.md) apporte une navigation et des consignes opérationnelles ; elle ne remplace pas le texte canonique. Le plan d'exécution transversal reste l'issue [#400](https://github.com/ZeyFro/gamenight/issues/400).

Les lots #406, #407 et #408 existent déjà : ils sont reliés ci-dessous et ne doivent pas être recréés. #370 et #396 sont des PR de suivi existantes. La PR #395 a été abandonnée et clôturée sans fusion le 5 novembre 2026 : aucune dépendance fonctionnelle de #370/#396, seul chevauchement documentaire dans `.env.example`. Les étapes terminées dans le dépôt ne sont pas requalifiées comme essais réels Discord ou Production.

### Phase 1 — Fondation communautaire

### P1-01 — Accueil et orientation du nouveau membre

- **Objectif :** Rendre le parcours d'arrivée compréhensible en réutilisant YAGPDB et le panneau à trois actions retenu.
- **Critères d'acceptation :** Un nouveau membre comprend le règlement, choisit ses intérêts et atteint une première action sans inscription GameNight imposée; le parcours existe sur ordinateur et mobile.
- **Tests attendus :** Matrice de parcours en compte neuf, contrôle mobile, vérification des droits sans modifier les permissions.
- **Dépendances / suivi :** Décision d'accueil consignée dans docs/TOWER_DECISIONS_26_20261104.md; suivi global #400.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P1-02 — Audit et remise en cohérence des bots, tickets et rôles historiques

- **Objectif :** Cartographier l'usage réel des bots historiques et les dépendances des rôles avant toute évolution.
- **Critères d'acceptation :** Inventaire sourcé des rôles et fonctions conservés, remplacés ou candidats au retrait; aucun élément n'est retiré sans validation de ses dépendances.
- **Tests attendus :** Audit lecture seule du serveur et tests des parcours applicatifs déjà présents.
- **Dépendances / suivi :** Audits/documentation déjà suivis via #384 et #404; plan parent #400. Vérifier leur état avant d'ouvrir un nouveau lot.
- **Décision §26 :** l'ancien système d'étages doit être remplacé; aucune suppression de rôle ne fait partie de cette PR. Les changements Discord sont exécutés séparément après vérification des dépendances.

### P1-03 — Navigation et présentation cohérentes sur Discord et GameNight

- **Objectif :** Harmoniser les entrées vers équipes, soirées et Ascension en réutilisant les composants et salons existants.
- **Critères d'acceptation :** Les parcours principaux sont accessibles depuis les espaces prévus, sans doublons de salon ou de bot; textes et liens sont à jour.
- **Tests attendus :** Vérification des liens, navigation mobile et revue des libellés.
- **Dépendances / suivi :** #400; tâches d'audit P1-02.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### Phase 2 — Fonctionnalités sociales

### P2-01 — Règles d'équipe et passation du capitaine

- **Objectif :** Appliquer les règles de composition, d'exclusivité, de délai et de passation.
- **Critères d'acceptation :** 2–8 membres, une équipe active par joueur, délai de 7 jours après départ et transfert selon l'activité de 30 jours; historique fondateur conservé.
- **Tests attendus :** Tests ciblés et PostgreSQL sur contraintes, concurrence, départ, dissolution et passation.
- **Dépendances / suivi :** PR existante #370; sa migration reste un prérequis de livraison/production.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P2-02 — Préférences de notifications

- **Objectif :** Permettre les préférences par catégorie et canal, sans couper les annonces communautaires générales.
- **Critères d'acceptation :** Chaque parcours respecte le choix du joueur et isole les communautés; valeur par défaut et kit bêta sont documentés.
- **Tests attendus :** Tests unitaires et PostgreSQL d'isolation et d'opt-out.
- **Dépendances / suivi :** PR existante #406, incluant la migration partagée; ne pas la recréer.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P2-03 — Recherche d'équipe et commande serveur /equipe

- **Objectif :** Filtrer le recrutement et exposer liste, profil d'équipe et demande d'adhésion via la commande de serveur.
- **Critères d'acceptation :** Filtres par jeux, plateforme, horaires, micro et type; réponses privées; validation côté serveur des règles d'équipe.
- **Tests attendus :** Tests des filtres, permissions Discord simulées, idempotence et tests PostgreSQL des règles.
- **Dépendances / suivi :** PR existante #408; dépend de #370 et du schéma de #406.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P2-04 — Connexion des équipes aux soirées et aux forums

- **Objectif :** Faire circuler les joueurs entre équipes persistantes, recrutement et soirées GameNight.
- **Critères d'acceptation :** Un capitaine peut associer une soirée et des critères de recrutement sans dupliquer les membres ni les notifications.
- **Tests attendus :** Tests de liaison/déliaison, autorisations et absence de doublon.
- **Dépendances / suivi :** Fondation équipes déjà livrée via #329; règles #370 puis #408.
- **Décision §26 :** règles d'équipe déjà tranchées dans la décision approuvée du 04/11/2026; les critères ci-dessus les appliquent.

### Phase 3 — Nouvelle Ascension

### P3-01 — Exclusion des comptes de test des votes de Production (abandonnée)

- **Décision :** Maxime continue de tester avec son propre compte Discord; aucune exclusion des comptes de test n'est souhaitée.
- **Livraison :** PR #395 clôturée sans fusion le 5 novembre 2026. Aucun contrôle Production ni identifiant de test ne doit être configuré.
- **Dépendances :** audit de #370 et #396 : aucune dépendance fonctionnelle à #395; seul `.env.example` se chevauchait.
- **Suivi :** décision consignée dans l'issue #400 et le document de décisions; le cahier canonique n'est pas modifié.

### P3-02 — Attribution quotidienne du défi d'équipe

- **Objectif :** Garantir l'attribution idempotente du défi d'équipe à 09:00 Europe/Paris.
- **Critères d'acceptation :** Route protégée, flag OFF par défaut, attribution unique, reprise après échec et aucune exécution Preview.
- **Tests attendus :** Tests de cadence, idempotence, mauvais serveur, échéance et Preview; vérifier séparément le scheduler externe.
- **Dépendances / suivi :** PR existante #396 et règles d'équipe #370; aucun cron externe à créer sans accord opérationnel.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P3-03 — Preuves, votes, quorum et contestations

- **Objectif :** Terminer le cycle de preuve avec auditabilité et protections anti-abus.
- **Critères d'acceptation :** Preuve liée à l'attribution, vote 24 h, quorum de 3, majorité stricte, absence d'auto-vote, contestation motivée dans les 24 heures suivant l'annonce du résultat et aucune double récompense.
- **Tests attendus :** Tests de concurrence et PostgreSQL sur quorum, égalité, rejouabilité, contestation et attribution unique.
- **Dépendances / suivi :** PR existante #407, schéma #406, compatibilité avec #396.
- **Décision prise :** le délai de contestation est de 24 heures après l'annonce du résultat du vote (issue #400). Le délai historique de 7 jours est remplacé; le cahier canonique reste intact.**

### P3-04 — Quotas et progression d'Ascension

- **Objectif :** Garantir les limites d'attribution et de réussite, et l'absence de double progression.
- **Critères d'acceptation :** Attribution solo espacée de 12 h, expiration 48 h, plafond de deux succès par jour partagé solo/équipe; récompense +1/+2/+3.
- **Tests attendus :** Tests ciblés avec événements concurrents, fuseaux, expiration et reprise.
- **Dépendances / suivi :** Décision de barème confirmée dans docs/TOWER_DECISIONS_26_20261104.md; plan #400.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### Phase 4 — Saisons et fidélisation

### P4-01 — Saisons et classements selon les règles validées

- **Objectif :** Aligner les périodes, classements et départages avec les décisions du propriétaire.
- **Critères d'acceptation :** Calendrier 2027 exact; intersaisons explicitement sans score; classement par étages, défis difficiles puis heure d'arrivée.
- **Tests attendus :** Tests de bornes calendaires, fuseau Europe/Paris, départage et transition entre saisons.
- **Dépendances / suivi :** Lots déjà fusionnés #372, #373 et #374; vérifier les écarts recensés dans docs/TOWER_DECISIONS_26_20261104.md.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P4-02 — Récompenses saisonnières et Hall of Fame

- **Objectif :** Publier les distinctions prévues à partir des résultats réels, sans accorder de pouvoirs techniques.
- **Critères d'acceptation :** Top 3 reçoit les éléments cosmétiques convenus; top 1 peut proposer un défi suivant le processus établi; résultat idempotent.
- **Tests attendus :** Tests d'unicité, réexécution du traitement et autorisations.
- **Dépendances / suivi :** P4-01 et #400.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P4-03 — Animation et récapitulatifs communautaires

- **Objectif :** Mettre en avant les réussites sans spam ni activité artificielle.
- **Critères d'acceptation :** Annonces fondées sur des résultats réels, fréquence bornée et préférences prises en compte.
- **Tests attendus :** Tests de déduplication, limites d'envoi, opt-out et textes sans données privées.
- **Dépendances / suivi :** P3-01 à P3-03 et préférences #406.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### Phase 5 — Lancement public

### P5-01 — Kit bêta et scénarios de réception

- **Objectif :** Préparer les testeurs et consigner les anomalies avant ouverture.
- **Critères d'acceptation :** Scénarios couvrant compte neuf, équipe, défi, preuve, vote, contestation, mobile et récupération; registre d'anomalies exploitable.
- **Tests attendus :** Revue de cohérence du kit puis exécution réelle datée par des testeurs.
- **Dépendances / suivi :** Kit de suivi #402 et PR #406; ne pas confondre scénario écrit et parcours réellement testé.
- **Décision §26 :** aucune décision ouverte identifiée pour ce lot; les décisions déjà validées sont citées dans les dépendances.

### P5-02 — Préparation technique de lancement

- **Objectif :** Consolider déploiement, migrations, variables et commandes dans une procédure répétable.
- **Critères d'acceptation :** Chaque migration a un plan contrôlé et retour arrière; variables présentes par nom; commandes documentées; flags par défaut éteints.
- **Tests attendus :** Dry-run en environnement isolé, CI exacte et contrôle de déploiement sans activation.
- **Dépendances / suivi :** Réutiliser #325 et #329; aucun merge ou action Production par cette feuille de route.
- **Autorisation opérationnelle :** toute migration ou action sur la base Production reste un point d'arrêt distinct, conformément à AGENTS.md.

### P5-03 — Go/no-go et ouverture publique

- **Objectif :** Décider si tous les critères §25 sont réellement démontrés et ouvrir uniquement une expérience cohérente.
- **Critères d'acceptation :** Chaque critère §25 a une preuve code, configuration et essai réel; limites facultatives publiées; go/no-go consigné.
- **Tests attendus :** Recette complète par un nouveau membre, tests de restauration et revue indépendante des incidents.
- **Dépendances / suivi :** P1 à P5; plan parent #400; kit #402.
- **Décision §26 :** ouverture publique prévue le 4 janvier 2027, uniquement si les critères sont démontrés; tout changement de configuration reste soumis à l'autorisation correspondante.

### Ordre de reprise

Les PR existantes #406–#408 restent brouillon et gardent leurs dépendances documentées. La PR #395 est abandonnée et clôturée sans fusion; ne pas la reprendre. Parmi les tâches de code ouvertes,  les tâches qui requièrent #370/#406 ou une écriture Production restent en attente de ces dépendances. Après chaque PR ouverte, reprendre la première tâche de code non bloquée et empiler sa branche sur la précédente si elle n'est pas fusionnée.
