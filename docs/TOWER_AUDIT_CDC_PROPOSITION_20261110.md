# GameNight × The Tower 2.0 — audit de cadrage et cahier consolidé

> **Proposition documentaire du 10 novembre 2026 — NON fusionnée, NON activée.** Ce document est une analyse de l'état du dépôt et une proposition d'évolution fonctionnelle. Il ne remplace ni le cahier canonique `docs/CAHIER_DES_CHARGES.md` ni les décisions propriétaires consignées dans `docs/TOWER_DECISIONS_26_20261104.md`. Les nouveaux arbitrages ci-dessous sont **à valider** avant développement/activation.
>
> **Périmètre de vérification** : lecture de `README.md`, `AGENTS.md`, `docs/INDEX.md`, `docs/ROADMAP.md`, `docs/ETAT.md`, `docs/REPRISE_AUTONOME.md`, `docs/TOWER_COMMUNITY_GAPS.md`, `docs/TOWER_MATCHMAKING_GAPS.md`, `docs/TOWER_PROGRESSION_GAPS.md`, `docs/TOWER_DECISIONS_26_20261104.md`, extraits de documentation Tower, résultats de recherche de fichiers GitHub et de l'issue #400, PR ouvertes. **Pas de clone complet, pas de tests exécutés et pas de recette Discord/Production pendant cet audit.** Ne pas appeler ceci un audit exhaustif ligne par ligne.

## 1. Sources de vérité et coordination

1. Cahier initial : [docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md), 26 sections et 17 conditions de livraison.
2. Édition avec navigation : [docs/TOWER_CAHIER_DES_CHARGES_GLOBAL.md](TOWER_CAHIER_DES_CHARGES_GLOBAL.md).
3. Décisions effectivement approuvées : [docs/TOWER_DECISIONS_26_20261104.md](TOWER_DECISIONS_26_20261104.md) et décisions plus récentes consignées dans [#400](https://github.com/ZeyFro/gamenight/issues/400).
4. Travaux et réservations : [#400](https://github.com/ZeyFro/gamenight/issues/400), PR ouvertes et leurs têtes exactes.
5. Guide des agents : [AGENTS.md](../AGENTS.md). Le conserver intégralement et ne pas inventer d'autorisation de fusion, migration, suppression de rôle, déploiement ou publication Discord.
6. Le serveur « The Tower — Recette » distinct a été supprimé ; aucun serveur de test supplémentaire ne doit être créé par cette proposition.

## 2. Vision produit consolidée

The Tower est un **serveur Discord multigaming francophone unique** où des inconnus, groupes d'amis et équipes constituées jouent et se rencontrent. Discord est l'interface communautaire quotidienne ; GameNight est le moteur de profils, jeux, équipes, soirées, historique, progression, récompenses et coordination. **Un nouvel arrivant doit trouver une activité rapidement sans devoir comprendre tous les salons et sans compte GameNight obligatoire pour les usages publics.**

L'Ascension (défis solo/équipe, preuves, votes, étages, saisons et classements) est un parcours **facultatif**, jamais une condition pour discuter ou jouer entre amis. Aucune activité fictive ne doit être générée pour faire paraître le serveur actif. Le budget initial doit rester gratuit ; vérifier quotas et limites avant de promettre l'échelle cible.

## 3. Parcours utilisateur attendus — nouveaux besoins

### P1 — Arrivée sans surcharge
- Présenter un point d'entrée clair avec choix d'objectif : discuter, trouver des joueurs, jouer avec des amis, créer/rejoindre une équipe, découvrir soirées/défis.
- Conserver **YAGPDB et le panneau d'accueil existant à trois boutons** selon la décision propriétaire du 04/11. **Ne pas activer l'onboarding natif Discord** sans nouvelle décision explicite.
- Ne pas créer de catégorie permanente pour chaque jeu. Différencier *salon découvert ou affiché* et *permission réelle d'accès*.
- Définir des scénarios de recette mobile/desktop avec un compte nouvellement arrivé, un membre ordinaire, un capitaine d'équipe et un modérateur ; mesurer le nombre de clics jusqu'à la première action utile.

### P2 — Découverte par jeu
- L'utilisateur choisit Minecraft, Counter-Strike ou un autre jeu ; la recherche lui présente des publications filtrées ou liées : **recherche de joueurs, recrutement d'équipes, projets et aventures**. Ces trois forums Discord sont déjà en place selon le propriétaire : **les auditer et les réutiliser**.
- Exemples : invitation à une partie Minecraft Vanilla, recrutement Hypixel, aventure privée, team Counter-Strike.
- S'appuyer en priorité sur le catalogue GameNight, identifiants de jeux persistants et tags existants ; préserver les autres jeux et leurs variantes sans créer automatiquement un rôle et un salon pour chaque entrée de catalogue.
- La création dynamique de rôle Discord **n'est pas un acquis** ; l'autoriser seulement après définition de seuils, quotas, anti-abus et stratégie d'épuisement des rôles.

### P3 — Groupes d'amis et équipes
- **Équipe persistante** : fiche GameNight, membres, capitaine, jeux, recrutement, événements et historique, indépendamment de l'existence d'un salon Discord.
- **Groupe d'amis occasionnel** : créer un lieu vocal privé à la demande sans imposer l'équipe persistante ni l'Ascension.
- **Vocal temporaire** : l'utilisateur éligible demande ou rejoint un vocal ; le bot crée un salon si quota et permissions le permettent, n'autorise que les participants/invités, supprime après vacance et délai de grâce. Gérer reprise après panne, demandes simultanées, abandon, nettoyage et appels API limités.
- **Texte privé** : ne pas promettre un fil Discord privé comme solution universelle sans valider ses limites, permissions, archivage, récupération et confidentialité. Évaluer fil privé, salon temporaire ou messagerie GameNight ; soumettre le choix au propriétaire.
- **Équipe persistante ≠ salon permanent** : aucun couple salon texte/vocal permanent par équipe par défaut. Définir les éventuelles exceptions sous quotas/approbation.
- Respecter les décisions d'équipes **2 à 8 personnes, une seule équipe active, délai de 7 jours après départ et passation** déjà consignées ; les PR correspondantes ne sont pas automatiquement fusionnées ni actives.
- Les espaces privés sont accessibles aux membres autorisés, avec règles explicites pour staff/bot, journaux et sécurité ; ne jamais promettre un secret absolu vis-à-vis des administrateurs disposant d'un accès supérieur.

### P4 — Expérience modération et exploitation
- Le joueur voit des espaces publics pertinents, ses propres groupes/équipes, ses activités ; les outils de modération sont réservés aux permissions adéquates.
- Le staff dispose d'une vue distincte des abus, signalements, créations temporaires, quotas, échecs du bot, alertes et demandes d'assistance ; pas de lecture systématique des conversations privées.
- Garder la séparation des rôles de prestige et d'administration ; préserver Ticket Tool, YAGPDB, Atlas hors ancienne progression et Appy suivant audit.
- Procédures anti-raid, anti-spam, limites de créations, permissions minimales, audit des suppressions, réconciliation et repli après incident.

### P5 — Capacité et croissance
- **Trois paliers de recette : 500, 2 000 et 10 000 membres inscrits**, avec simulations distinctes de simultanéité (ne pas confondre membres totaux et connectés).
- Tester nombre de salons actifs, rôles, catégorie, activité de messages, interaction vocale, rate limits Discord, charge bot/cron, stockage Neon, latence web et modération.
- Prévoir des budgets de ressources, quotas par compte/équipe, nettoyage sans perte de données permanentes, instrumentation et seuils d'alerte.
- Les contraintes plateforme (par exemple limites des salons/rôles) doivent être confirmées sur la documentation officielle lors de la conception technique ; aucune promesse de capacité n'est validée ici.

## 4. Obligations fonctionnelles historiques conservées

Le nouveau parcours n'annule aucune des exigences initiales :
- profils et préférences, matchmaking, soirées, calendrier, tournois ;
- progression illimitée en étages persistants et indépendants des saisons ;
- défi solo au plus une attribution toutes les 12 h, délai de 48 h ; équipe quotidien à 09 h Europe/Paris selon décision ; deux réussites/jour maximum ;
- preuve, vote 24 h, trois votants distincts minimum, majorité réelle, refus de l'auto-vote et protections des concurrents ; absence de quorum, contestation et arbitre fixe selon décisions récentes ;
- grades Régulars, Irregular, Ranker et High Ranker, récompenses cosmétiques sans privilèges admin ;
- saisons, podium, historique, Hall of Fame, annonces opt-in proportionnées ;
- préservation des rôles historiques `Etage` jusqu'à audit des attributions, remplacement contrôlé et approbation de suppression ;
- conservation des profils et historiques GameNight, isolation multi-communautés et idempotence.

Les seuils, dates, barèmes et arbitrages du 04/11 et décisions ultérieures de #400 **priment** sur les anciennes propositions du §26. Ne pas réouvrir arbitrairement ces décisions.

## 5. Audit documentaire de l'existant au 10/11/2026

**Légende** : « code présent » = dépôt/documentation décrit une implémentation ; « PR Draft » = pas dans main par simple présence de la PR ; « non prouvé » = pas de recette réelle ni constat de configuration dans cette lecture.

| Domaine | Constat étayé | Reste à faire / preuve exigée |
| --- | --- | --- |
| GameNight général | README et ROADMAP : profils, Steam, bibliothèque, soirées, tournois, calendrier, XP, badges, classements, annonces | Recette fonctionnelle authentifiée et intégrations réellement activées |
| Équipes durables | Modèles/parcours documentés, règles 2–8 et adhésion unique en #370 Draft | Revue, migrations ordonnées et tests/recette ; interdiction de dupliquer le travail |
| Matchmaking | Petites annonces 24 h déjà codées sous flag ; filtres étendus en #408 Draft ; /equipe manifeste en #416 Draft | État réel des flags, enregistrement commande, essais utilisateur et navigation par jeu |
| Défis Tower | Composants et catalogues, saisons et règles documentés ; cron équipe #396 Draft | Chaîne de bout en bout : commande, preuve, vote, quota, attribution, notification, vrais membres |
| Contestations | Règles approuvées, arbitre fixe et migration dans #407 Draft | Migration autorisée séparément, tests adversariaux et recette publique |
| Préférences notifications | #406 Draft et flags nécessaires | Sécurité des migrations et activation progressive |
| XP / vocal historiques | #325 Draft, migrations et dépendances importantes | Préconditions de restauration et déploiement, aucun merge sans autorisation |
| Migrateur Neon Test | #419 Draft ; dernier commentaire #400 signale tête `6887ef7`, CI et contrôles réussis | Dry-run récent et attestation de restauration avant toute application réelle |
| Accueil et rôles Discord | YAGPDB, panneau et audit de structure documentés | Tests nouveau membre et permissions effectives ; ne pas remplacer par onboarding natif |
| Espaces privés automatisés | **Nouveau besoin de cadrage**, pas démontré livré | Conception, prototype à quotas, tests d'échelle, sécurité et consentement |
| Déploiement | README : build sans migration implicite | Vérification flag/secret/commandes Discord et état réellement actif distincts des CI |

**Relevé de coordination au moment de la consultation** : 10 PR ouvertes : #325, #370, #396, #406, #407, #408, #416, #419, #430, #431. La tête de `main` mentionnée dans les derniers relevés #400 et index de code était `6d6e30e` ; revalider au moment de tout cherry-pick ou intégration. Le plafond opérationnel de 10 PR ne doit pas être contourné en ouvrant une onzième PR.

## 6. Travaux restants — ordre proposé sous réserves des réservations #400

1. **S0 / préservation** : relecture #400, têtes Git, réservations, conflits et statut des branches ; aucune édition concurrente du travail #325/#419.
2. **S1 / inventaire probant** : matrice « exigence → fichier/PR → test → flag → recette réelle », sur tout le dépôt, y compris tests, schéma, scripts, workflow et sécurité ; distinguer inconnu/partiel/testé/actif.
3. **S2 / intégration Tower** : poursuivre l'ordre déjà acté #419 puis #370 → #406, puis autres PR selon dépendances, contrôles CI, restaurations et consentements. Ne pas modifier la chronologie existante.
4. **S3 / onboarding** : mesurer parcours existant et présenter un parcours simplifié fondé sur YAGPDB/panneau existant ; aucune modification de rôles ou permissions sans accord.
5. **S4 / découverte par jeu** : réutiliser forums et catalogue GameNight, recherche/tag/filtre, limiter nombre de rôles et salons.
6. **S5 / groupes privés** : prototype vocal à la demande, quotas, accès, journal minimal, délai d'inactivité, repli ; décision explicite sur les discussions texte.
7. **S6 / supervision** : vue modération dédiée, signalements, erreurs, interventions et protection des données.
8. **S7 / résilience/charge** : essais sur base jetable et Discord dans les seules limites autorisées, scénarios 500/2 000/10 000 membres simulés, budgets de charge et quotas ; jamais de flood sur serveur réel.
9. **S8 / bêta et lancement** : recette avec vrais nouveaux membres et staff, règles publiques, contrôles des 17 critères, bilan go/no-go ; lancement seulement sur preuves et accord.

## 7. Critères de réception ajoutés au cahier

- Un nouveau joueur trouve son jeu et une annonce pertinente en un parcours court sur mobile et desktop, sans rejoindre GameNight pour lire les forums publics.
- Un joueur Minecraft trouve recherche, recrutement et projets sans catégorie Minecraft permanente imposée.
- Un groupe de quatre amis peut demander un vocal privé ; seules les personnes autorisées peuvent le rejoindre ; après vacance et délai défini, le salon disparaît sans supprimer l'équipe ni son historique GameNight.
- Répéter création/suppression, double clic, redémarrage bot, annulation et changement de capitaine : pas de fuite de salon, permission ou doublon.
- Une équipe existante peut rejoindre les activités publiques et les défis ; participer à l'Ascension reste facultatif.
- Une équipe de modération travaille depuis ses espaces dédiés, sans accès inutile aux données privées ; les actions administratives sensibles sont traçables.
- Les métriques de charge et de saturation sont testées pour chaque palier, et les seuils de repli documentés.
- Toute livraison doit produire séparément **preuves code/tests**, **preuves configuration**, **preuves réelles Discord/Vercel/Neon**.

## 8. Décisions restant à obtenir pour la nouvelle architecture

1. **Discussion privée** : fil privé Discord, salon texte temporaire, messagerie GameNight ou combinaison ; définir durée de conservation, visibilité staff, suppression/export.
2. **Vocal temporaire** : création à la demande vs salon d'entrée « créer mon vocal » ; délai de grâce, nombre maximum simultané, possibilité d'inviter, gestion de propriétaires inactifs.
3. **Groupes occasionnels** : quelle limite de taille, durée et fréquence ? Une équipe durable doit-elle bénéficier d'un quota distinct ?
4. **Rôles par jeu** : conserver la sélection existante et catalogue GameNight comme vérité ; politique de création d'un nouveau rôle éventuel à décider.
5. **Présentation des forums** : filtres/tags Discord, recherche GameNight ou interface hybride, après audit des forums réels.
6. **Confidentialité et modération** : exigences d'accès, signalement et politique de conservation publique.

## 9. Durées et capacité de codage — distinction impérative

- Une session d'assistant n'a **pas de durée de codage continue exacte garantie** : les limites dépendent du mode, des outils, des quotas, de l'environnement et des validations externes. Aucun nombre d'heures « garanties » ne doit être inventé.
- Une tâche programmée ne prouve pas qu'elle possède un clone ni qu'elle exécute du code. Le commentaire #400 du 10/11 signale un contrôle de coordination nocturne sans checkout, test ou push.
- Estimer **par lot après inventaire des fichiers et critères** (complexité, dépendances, tests, migrations, revue, recette) sous forme de fourchettes humaines/agents, jamais de promesse précise de livraison.
- La mesure exacte possible est le **temps réellement observé** sur une exécution instrumentée (début/fin, commandes, CI, minutes agent), pas le temps futur garanti.

## 10. Règle de publication de cette proposition

Ce document est une **proposition de branche documentaire** : ne pas le présenter comme une décision approuvée, une intégration dans `main`, une activation ou une validation finale. Une fois le plafond de PR redescendu et les réservations contrôlées, sa relecture peut faire l'objet d'une PR documentaire dédiée, selon #400. **Aucune autre branche, PR, migration, variable, rôle, commande Discord ou Production n'est touchée.**


## Annexe — choix à l'échelle étayés par l'audit et les sources officielles (10/11/2026)

- Le dernier inventaire Discord documenté du 26/10/2026 comptait **197 rôles**, dont **134 rôles historiques d'étages** selon le cahier. Avec le plafond officiel de **250 rôles**, la marge théorique à cet instant n'était que **53 rôles** : **création automatique d'un rôle par jeu ou équipe interdite par défaut**, même pour 500 membres. L'inventaire est historique et doit être refait avant toute décision.
- Plafond officiel de **500 salons** et **50 catégories** : conserver un budget public/administration incompressible ; les vocaux à la demande doivent être bornés, réconciliés après panne et supprimés sans effacer les équipes persistantes. La capacité exacte en vocaux concurrents reste à déterminer par une analyse de configuration actuelle.
- L'API Discord possède des limites globales et spécifiques par route ; le bot doit exploiter les en-têtes et le délai `retry_after`, sans hypothèse de débit garanti pour les créations de salon.
- **Onboarding natif Discord** et **Server Guide** sont des options réelles documentées, mais **non retenues actuellement** par décision propriétaire. Les soumettre à un choix explicite après comparaison avec YAGPDB + panneau existant ; aucune activation silencieuse.
- AutoMod anti-raid et protections de mentions sont à auditer en priorité, sans développer un second mécanisme lorsqu'une fonction native suffit.
- **Preuve tests** : les journaux du run #419/CI `42803989254` prouvent 3 771 tests sur 3 771 réussis dans `npm run test:postgres` (415 fichiers) sur sa tête `6887ef7`; aucun test n'a été exécuté localement par cet audit, et cela ne valide ni Discord réel ni Production. Voir [journal détaillé](TOWER_PREUVES_CI_RECHERCHE_20261110.md).

Sources Discord : [limites](https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More), [onboarding](https://support.discord.com/hc/fr/articles/11074987197975-FAQ-sur-l-int%C3%A9gration-%C3%A0-la-communaut%C3%A9), [Server Guide](https://support.discord.com/hc/en-us/articles/13497665141655-Server-Guide-FAQ), [rate limits](https://support-dev.discord.com/hc/fr/articles/6223003921559-Mon-bot-est-soumis-%C3%A0-un-nombre-d-actions-limit%C3%A9), [anti-raid](https://support.discord.com/hc/fr/articles/10989121220631-Comment-prot%C3%A9ger-votre-serveur-contre-les-Raids).

**Non-modification des décisions validées :** l'annexe enrichit les options de conception, mais n'autorise aucune migration, aucune modification de permissions/rôles, ni une fusion ou une activation.


## Annexe — limite officielle des tags de forums

L'API Discord limite `available_tags` à **20 tags par forum** et `applied_tags` à **5 tags par publication**. Source première : [Discord API, Channel Resource](https://github.com/discord/discord-api-docs/blob/main/developers/resources/channel.mdx), paramètres des salons Forum/Media et fils.

**Conséquence pour le besoin « Minecraft, Hypixel, CS, tous les jeux » :** ne pas affecter un tag Discord à chaque jeu du catalogue. Conserver les **trois forums** en les utilisant pour les **types de demandes** ; enregistrer un **ID de jeu durable** côté GameNight pour les filtres riches et, éventuellement, utiliser quelques tags Discord réservés à des familles de jeux ou types de partie. Le lien concret et le mode de création/publication bot nécessitent une conception et une validation distinctes (pas de scraping Discord non autorisé).

À valider par le propriétaire après démonstration du parcours d'un joueur ordinaire.
