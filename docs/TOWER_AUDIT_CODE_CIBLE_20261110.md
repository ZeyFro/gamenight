# Audit technique et fonctionnel — GameNight × The Tower 2.0

**Relevé du 10 novembre 2026.** Périmètre exact : arbre Git complet de `main` à `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7` (API GitHub `git/trees/main?recursive=1`, `truncated=false`), lecture de fichiers métier sélectionnés, README/ROADMAP/ETAT, cahier canonique, décisions, PR ouvertes et commentaires de coordination #400. **Audit statique approfondi et inventaire exhaustif des chemins**, mais **pas lecture intégrale de chaque ligne des 1 317 fichiers**, ni exécution locale npm, ni preuve d'activation Production ou Discord. L'environnement de cette session ne peut pas cloner GitHub en direct. Ne pas confondre présence de source avec fonction opérationnelle.

## 1. Mesures d'inventaire à SHA fixe

| Mesure | Résultat observé |
| --- | ---: |
| Fichiers versionnés, hors dossiers | **1 317** |
| Dossiers dans l'arbre | 283 |
| Fichiers `src/` | **997** |
| Fichiers `src/lib/` | 526 |
| Fichiers `src/app/` | 271 |
| Fichiers `src/components/` | 193 |
| Fichiers `docs/` | 116 |
| Fichiers `scripts/` | 45 |
| Fichiers de tests `*.test.*` / `*.spec.*` | **407** |
| Dont tests `*.integration.test.*` | **94** |
| Dossiers avec `migration.sql` | **118** |
| Routes `src/app/api/**/route.ts` | **32** |
| Routes cron `src/app/api/cron/**/route.ts` | **11** |
| Workflows GitHub Actions | **4** |
| Fichiers dont le chemin contient `tower`, `discord`, `team`, `match`, `classified`, `voice`, `vocal`, `onboard` | **223** |

Les 4 workflows : `.github/workflows/ci.yml`, `migrations-immutable.yml`, `neon-test-migrations.yml`, `tower-challenges.yml`. Le CI de PR utilise PostgreSQL 16 jetable et lance tests PostgreSQL, Vitest, typegen, TypeScript, ESLint et build ; le build de l'application (`scripts/build.mjs`) n'effectue **aucune migration**.

## 2. État de main, PR et dépendances

Les **10 PR suivantes étaient toutes ouvertes et Draft** au relevé API GitHub. Les états de fusion et les têtes doivent être relus lors de chaque reprise, car ils peuvent évoluer :

| PR | Sujet | Fichiers touchés annoncés | Constat |
| --- | --- | ---: | --- |
| [#325](https://github.com/ZeyFro/gamenight/pull/325) | XP / vocal / migration | 178 | Draft ; `mergeable=false` au relevé ; **réservée à Claude** et migrations sensibles |
| [#370](https://github.com/ZeyFro/gamenight/pull/370) | Équipes 2–8 / unique / 7j / passation | 25 | Draft ; migration requise |
| [#396](https://github.com/ZeyFro/gamenight/pull/396) | Cron défis équipe 09h Paris | 13 | Draft |
| [#406](https://github.com/ZeyFro/gamenight/pull/406) | Notifications et kit bêta | 65 | Draft, dépendances #370 |
| [#407](https://github.com/ZeyFro/gamenight/pull/407) | Preuves et contestations | 95 | Draft ; migration arbitre fixe |
| [#408](https://github.com/ZeyFro/gamenight/pull/408) | Matchmaking et commande équipe | 112 | Draft |
| [#416](https://github.com/ZeyFro/gamenight/pull/416) | Manifeste Discord /equipe | 5 | Draft ; ne signifie pas commande enregistrée |
| [#419](https://github.com/ZeyFro/gamenight/pull/419) | Workflow Neon Test | 25 | Draft ; tête `6887ef7` vérifiée dans #400, CI réussie rapportée |
| [#430](https://github.com/ZeyFro/gamenight/pull/430) | Chevauchement tactile | 3 | Draft |
| [#431](https://github.com/ZeyFro/gamenight/pull/431) | Bornes de filtres vides | 2 | Draft |

**Ordre de coordination :** #419, préparation contrôlée #370 puis #406, respect de la réservation et des jalons #325 ; les autres selon #400. Une CI verte n'autorise ni migration, ni merge, ni activation. Ne pas publier une 11e PR tant que le plafond opérationnel de 10 subsiste.

## 3. Preuves ciblées de code existant

| Fonction | Fichier(s) lu(s) sur main | Constat |
| --- | --- | --- |
| Équipes durables | `src/lib/community-teams.ts` (213 lignes) | Fonctions créer, rejoindre, quitter, recruter et lier aux soirées |
| Règles équipe | `src/lib/community-teams-rules.ts` | **Écart confirmé** : `min(2).max(20)` sur main malgré décision 2–8 ; correction portée par #370 |
| Petites annonces | `src/lib/player-classifieds.ts` | Filtre annonces non expirées, appartenance ACTIVE, flag `playerClassifiedsEnabled` |
| Moteur Tower | `src/lib/tower-challenges.ts` (792 lignes) | Attribution solo, défi équipe, preuve, vote, règlement, classement, import de catalogue |
| Entrée Discord Tower | `src/lib/discord-tower-challenges.ts` (251 lignes) | Gestion d'interactions signées et réponses de défis/preuves/votes |
| Administration Tower | `src/lib/discord-tower-admin.ts` | Ajouter, désactiver et importer des définitions, garde de permission |
| Accueil Tower | `src/lib/tower-onboarding-panel.ts` | Trois boutons : joueurs / soirées / Ascension ; publication volontairement non reliée à une route/cron |
| Configuration Tower | `src/lib/tower-config.ts` | ID guild centralisé, garde propriétaire, fallback historique |
| Nettoyage de fils | `src/lib/discord-thread-cleanup.ts` | Nettoyage **des fils de soirées et tournois**, pas preuve de vocal privé de groupe |
| Build | `scripts/build.mjs` | Prisma generate + Next build, **sans migration** |
| CI | `.github/workflows/ci.yml` | PostgreSQL de service jetable, tests, lint, types et build |

Le dépôt contient une migration `community_voice_channel` ; **cela ne prouve pas** un système de création de vocal privé éphémère. Aucun fichier de chemin explicitement nommé `voice` ou `vocal` ne constitue, sur `main`, la preuve d'un tel gestionnaire. **La PR #325 contient elle-même des changements vocaux non fusionnés**. Il faut donc distinguer fonctionnalités vocales existantes, fonctionnalités Draft et nouveau besoin « vocal privé par groupe ».

## 4. Matrice de conformité — 26 sections du cahier

Légende : **Base** = fonctionnalité ou document déjà présent ; **Partiel** = manque des exigences spécifiques ; **À prouver** = activation/essai réel non certifié ; **Proposé** = nouveau besoin non arbitré.

| § | Domaine | État démontrable | Principal reste à faire |
| --- | --- | --- | --- |
| 1 | Vision / budget gratuit | Base documentaire | Contrôler coûts et limites des services utilisés |
| 2 | Discord ↔ GameNight | Partiel (intégrations et accès présents) | Parcours bidirectionnels réels et isolation |
| 3 | Organisation serveur | Plans et inventaire Discord | Recette mobile, rôles et salons réels |
| 4 | Accueil | Panneau 3 boutons codé | Publier seulement après accord ; tester nouveau membre |
| 5 | Identité visuelle | Documentation / composants existants | Vérifier cohérence réellement affichée |
| 6 | Rôles et grades | Code / plan de migration | Dépendances Atlas et 134 rôles Etage, aucun retrait non autorisé |
| 7 | Ascension | Moteur codé sous conditions | Essai d'étages et attribution sur vrai serveur |
| 8 | Défis | Moteur solo/équipe existant | Cron #396, configuration et preuve réelle |
| 9 | Preuves et votes | Code sur main, #407 Draft | Quorum, contestation, arbitre, tests de concurrence, activation |
| 10 | Annonces | Enqueue / notifications | Destinations, consentement, idempotence réelle |
| 11 | Équipes | CRUD sur main, #370 Draft | 2–8, unicité, passation, migrations et recette |
| 12 | Matchmaking | Petites annonces + #408 Draft | Recherche par jeu, filtres, parcours forums Discord |
| 13 | Soirées / tournois | Base GameNight documentée | Essais authentifiés et Discord réel |
| 14 | Saisons / classement | Moteur et podium présents | Cohérence dates/flags/fin de saison en recette |
| 15 | Récompenses | XP/badges/boutique présents | #325 et attestations de non double attribution |
| 16 | Sommet | Podium et classement documentés | Expérience publique et données réelles |
| 17 | Vocaux | Lien vocal et migration existants, #325 Draft | **Nouveau système de vocal privé temporaire à concevoir** |
| 18 | Bots historiques | Plans YAGPDB/Atlas/Ticket Tool/Appy | Inventaire fonctionnel et permissions effectives |
| 19 | Sécurité | Tests et isolation documentés | Audit des droits réels, rate limits, anti-abus |
| 20 | IA future | Options explicitement hors lancement | Aucune IA de validation de preuve à activer |
| 21 | Architecture | Next/Prisma/Neon/Vercel, workflows | Vérifier configuration des environnements |
| 22 | Tests | 407 fichiers de tests dans l'arbre | Exécution au SHA cible + recette réelles |
| 23 | Phases | Roadmap et #400 | Réconcilier PR empilées et dépendances |
| 24 | Lancement | Plan de croissance et animation | Bêta réelle et engagement utilisateur |
| 25 | Conditions de livraison | 17 critères définis | Matrice code + configuration + essai pour chaque critère |
| 26 | Décisions ouvertes | Décisions du 04/11 et #400 | Ne pas contredire les décisions ultérieures |

**Aucun pourcentage de complétude n'est défendable** sans pondérer ces exigences et les tester réellement. Le nombre de fichiers ou de PR n'est pas un indicateur de fonctionnalité terminée.

## 5. Nouveau périmètre demandé — expérience Discord à l'échelle

Ces besoins sont décrits dans [TOWER_AUDIT_CDC_PROPOSITION_20261110.md](TOWER_AUDIT_CDC_PROPOSITION_20261110.md) ; ils ne sont **pas approuvés pour implémentation**.

1. **Navigation guidée sans surcharge** : conserver YAGPDB et le panneau à 3 boutons selon décision du propriétaire ; un membre voit les activités qui l'intéressent, sans suppression automatique des salons.
2. **Filtrer les forums existants par jeu** : Minecraft Vanilla / Hypixel, Counter-Strike, etc. ; réutiliser recherche, recrutement et projets/aventures, sans 1 rôle ou catégorie par jeu.
3. **Groupe privé** : équipe persistante stockée dans GameNight, **vocal temporaire et contrôlé** dans Discord, nettoyage idempotent et récupération après panne. Décider séparément le support des discussions écrites privées.
4. **Vision modération** : alerte de saturation, salons éphémères actifs, signalements et logs nécessaires, sans surveillance systématique des messages privés.
5. **Scalabilité** : scénarios de 500 / 2 000 / 10 000 inscrits, avec concurrents simultanés chiffrés séparément, mesure API Discord/bot/Neon et budget de salons.

## 6. Bloqueurs concrets (pas de faux « fait »)

| Priorité | Blocage | Action autorisée sans risque Production |
| --- | --- | --- |
| P0 | Pas de recette réelle de nouveau membre, rôle Régulars, panneau et forums | Préparer protocole et captures anonymisées, exécution humaine autorisée |
| P0 | Double source d'étages possible Atlas/GameNight | Audit lecture seule des attributions et plan de bascule |
| P0 | Migrations #370/#406, #325, #407 non traitées dans le parcours d'autorisation | Revue, précontrôles et CI, jamais apply sans accord spécifique |
| P0 | Activation de commandes/flags Tower non prouvée | Lire configuration et tests réels sans modification |
| P1 | Règles 2–8 absentes de main | Intégrer #370 dans l'ordre validé |
| P1 | Commande équipe et matchmaking dans PR Draft | Réutiliser #408/#416 après dépendances |
| P1 | Absence de système de salons vocaux privés temporaires démontré | Design documenté, prototype isolé après arbitrage |
| P1 | Pas de mesure de charge 500/2 000/10 000 sur le parcours nouveau | Plan de charge synthétique sans faire de flood Discord |
| P2 | Documentation de recette historique contradictoire | Harmoniser les documents historiques sans les effacer (certains mentionnent un serveur de recette supprimé et l'exclusion de testeurs retirée) |

## 7. Plan d'exécution mesurable

1. À chaque session : lire `AGENTS.md`, #400 (derniers commentaires), `docs/ETAT.md`, les têtes Git exactes, réservations et CI.
2. Reprendre la pile de migrations selon l'ordre et les autorisations déjà décidés ; **aucun changement de Production automatique**.
3. Construire les preuves pour les 17 critères de livraison, avec statut `code` / `CI` / `configuration` / `Discord réel` / `acquittement propriétaire`.
4. Après arbitrage : lot accueil → navigation par jeu → groupes temporaires vocaux → modération et supervision → charge et tests d'endurance.
5. Ne marquer « terminé » que lorsqu'un parcours utilisateur réel est prouvé ; conserver la date, le SHA, l'environnement et le résultat.

## 8. Temps de codage et capacité réelle

Il n'existe **aucun temps futur exact garanti** pour une session ChatGPT : les limites de conversation, outils, agents, quotas et fenêtres d'autorisation varient. Un cron de coordination peut lire GitHub sans créer de checkout ni écrire du code. La preuve d'activité est le journal : heure de début/fin, SHA, fichiers modifiés, tests, CI et PR.

Chiffrage **indicatif non contractuel** par effort technique (heures-humain équivalentes, non heures d'IA garanties) des **nouveaux** chantiers, à resserrer après design :

| Chantier nouveau | Fourchette initiale |
| --- | ---: |
| Parcours accueil et navigation | 15–40 h |
| Filtrage des 3 forums par jeu | 15–35 h |
| Création/suppression de vocaux temporaires sûrs | 25–60 h |
| Surveillance modération et anti-abus | 20–50 h |
| Résilience, charge et recette 500/2 000/10 000 | 25–60 h |

Les travaux historiques Tower et leurs migrations **ne sont pas inclus** dans ces fourchettes. Estimer chaque PR séparément après revue de son état et du test requis. **Ne jamais convertir ces fourchettes en promesse d'une date de fin.**

## 9. Portée et diffusion

Cette analyse complète l'audit de cadrage et constitue une **documentation sur branche de travail**. Elle ne remplace pas le cahier canonique avant approbation. Aucune fusion, migration, mise à jour Discord, changement de permission, flag, variable Vercel ou Production. Le point de coordination est [#400](https://github.com/ZeyFro/gamenight/issues/400) et la relecture documentaire [#432](https://github.com/ZeyFro/gamenight/issues/432).
