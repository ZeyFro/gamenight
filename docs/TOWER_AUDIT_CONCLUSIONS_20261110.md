# Audit final de vérification disponible — GameNight × The Tower 2.0

> **Établi le 10 novembre 2026 en lecture seule, base `main` SHA `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7`.**
> **Verdict : NON PRÊT pour certification de lancement.** Ce document clôt les vérifications réalisables par les connecteurs GitHub / Vercel / Neon de cette intervention ; **un audit intégral ligne par ligne de tous les fichiers, une exécution locale indépendante et la recette sur le vrai Discord restent NON RÉALISÉS**. Ne pas transformer l'absence de preuve en échec affirmé ou en succès.
> **Document de proposition, sur branche non fusionnée.** Le cahier canonique et les décisions #400/04-11 restent prioritaires.

## 1. Résultats mesurés

| Objet | Mesure / preuve | Statut |
| --- | --- | --- |
| Inventaire Git GitHub | 1 317 fichiers, arbre récursif non tronqué au SHA de référence | **FAIT** |
| Code source | 997 fichiers sous `src/`, dont 526 `src/lib`, 271 `src/app`, 193 `src/components` | **INVENTORIÉ**, pas tous relus |
| Tests versionnés | 407 fichiers `*.test.*` / `*.spec.*` sur main | **INVENTORIÉ** |
| Migrations | 118 `migration.sql` sur main | **INVENTORIÉ**, pas appliqué |
| API/cron | 32 routes API et 11 routes cron | **INVENTORIÉ** |
| CI GitHub #419 | Run [42803989254](https://github.com/ZeyFro/gamenight/actions/runs/42803989254), tête `6887ef7` : **415 fichiers, 3 771/3 771 tests PostgreSQL réussis**, typegen, tsc, lint, build réussis | **RÉELLEMENT EXÉCUTÉ PAR GITHUB**, pas sur ce poste |
| Contrôle npm test indépendant | Même run : 2 553 réussis, 1 215 ignorés (intégration sans variable Postgres) | **RÉELLEMENT EXÉCUTÉ PAR GITHUB** |
| Immutabilité des migrations #419 | Run [42803989024](https://github.com/ZeyFro/gamenight/actions/runs/42803989024) | **SUCCESS** |
| Autres PR | 10 PR ouvertes, toutes Draft ; CI associées aux têtes relues et indiquées successful ; #325 mergeable=false | **VÉRIFIÉ À LA DATE**, pas une autorisation de fusion |
| Vercel | Preview #419 `READY`; `main` statut Vercel success au SHA cité | **BUILD/DEPLOY**, pas recette utilisateur |
| Vercel configuration | Liste 43 entrées (sans décryptage). Quatre noms absents : `TOWER_CHALLENGES_ENABLED`, `TOWER_ONBOARDING_PANEL_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `TOWER_TEAM_DAILY_ENABLED` | **ABSENCE DU LISTING**, pas preuve d'autres flags base |
| Neon | Branches `production`, `tower-migration-test-20261105`, `backup-tower-migration-test-20261106`, `tower-restore-rehearsal-20261107` observées | **PRÉSENTES**, pas preuve de restauration validée |
| Discord réel | Aucun accès admin/bot direct pour inventorier rôles, commandes, messages et permissions courantes en lecture seule | **NON VÉRIFIÉ** |
| Tests locaux autonomes | `git ls-remote` échoue : `Could not resolve host: github.com` dans l'environnement local | **BLOQUÉ** |

**Important :** la CI #419 contrôle le SHA exact de sa branche. Elle ne valide automatiquement ni `main`, ni les PR empilées, ni les permissions Discord.

## 2. Audits de sécurité ciblés (sources effectivement lues)

| Surface | Preuve | Évaluation |
| --- | --- | --- |
| Signature Discord | `src/lib/discord-signature.ts` : signature Ed25519 sur horodatage + corps brut, vérification échoue fermée | **Bonne base démontrée** |
| Point d'entrée des interactions | `src/lib/discord-interactions.ts` : clé absente ⇒ 503 ; signature invalide ⇒ 401 ; permissions `MANAGE_GUILD` / `ADMINISTRATOR` revérifiées pour setup ; horodatage des commandes/RSVP limité | **Contrôles présents**, tests contre replays et chaînes complètes à maintenir |
| Isolation Preview | `src/lib/preview-safety.ts` : garde explicite `VERCEL_ENV === preview` ; CI et documentation décrivent blocage des sorties Discord | **Protection partielle démontrée**, appels de sortie à auditer exhaustivement |
| Isolation multi-communautés | `src/lib/community-isolation.ts`, `src/lib/community-scoped-client.ts` : périmètres, membership ACTIVE et scopes | **Protection architecturale présente**, couverture de toutes les routes non certifiée |
| Vote de défi | `src/lib/tower-challenge-voting.ts` : 24h, 3 votants distincts min., pas d'auteur, majorité | **Logique contrôlée présente**, contestations et conflits de membres d'équipe en PR |
| Cooldowns et récompenses | `src/lib/tower-challenge-rules.ts` : 12h, 48h, max deux réussites/jour Paris | **Règles codées**, persistance concurrente à contrôler dans chaque transaction |
| Notifications Discord | `src/lib/notification-executor.ts`, `src/lib/discord-rest.ts` et tests | **Infrastructure présente**, ne vaut pas activation ni livraisons réelles |
| Salons temporaires | `discord-thread-cleanup.ts` ne nettoie que des fils de soirée/tournoi ; pas de preuve de gestionnaire de vocaux privés éphémères | **Nouveau besoin non livré démontré** |
| Données et secrets | Aucune valeur Vercel déchiffrée, aucun token publié par l'audit | **Précaution respectée**, audit secret-scanning exhaustif non exécuté |

Ces observations **ne constituent pas une certification de cybersécurité ou une preuve d'absence de vulnérabilité**. Les scénarios d'injection, IDOR, escalade de privilège, exfiltration, quotas et rétention restent à couvrir dans la vraie recette et les tests adversariaux.

## 3. Écarts fonctionnels prioritaires, état exact

| Priorité | Écart | Suivi / condition |
| --- | --- | --- |
| P0 | The Tower non validé sur un vrai compte membre (YAGPDB, forums, progression, preuves/votes, permissions) | `docs/TOWER_PHASE1_RECETTE_PUBLIQUE.md` ; tests Discord réels autorisés |
| P0 | Ancienne attribution d'étages Atlas possiblement en concurrence | Audit rôles et attributions, bascule validée, pas de suppression avant preuves |
| P0 | Flags essentiels Tower absents de la liste Vercel | Relecture valeurs/config effective, autorisation activation par porte du plan T18 |
| P0 | Migrations #370/#406/#325 et dépendances sous contrôle | Respect ordre #419 → #370 → #406 ; #325 propriété Claude, pas de merge/apply implicite |
| P1 | Limite sur main : 2–20 joueurs alors que décision approuvée 2–8 | #370 Draft, ne pas dupliquer |
| P1 | Matchmaking détaillé et commande équipe non intégrés | #408/#416 Draft et dépendances |
| P1 | Contrepartie staff/arbitre contestations non active | #407 Draft, migration distincte |
| P1 | Cron de défi équipe 09h sous PR | #396 Draft + test du scheduler |
| P1 | Nouvel arrivant noyé dans les salons | Amélioration guidée en conservant YAGPDB + panneau existant, sans activer l'onboarding natif |
| P1 | Pas de salon vocal privé temporaire générique démontré | Concevoir bot REST/Gateway adapté, quotas/permissions/recovery, réutiliser équipe GameNight |
| P1 | Recherche Minecraft / Hypixel / Vanilla par trois forums | Réutiliser forums et ID de jeu GameNight ; pas de rôle/tag pour chaque jeu |
| P2 | Vue modération scalable | Audit AutoMod, signalements, limites, dashboards, rétention et accès minimaux |
| P2 | Capacité 500 / 2 000 / 10 000 membres | Tester utilisateurs concurrents, API, DB, quotas salons et saturation, sans flood de la guilde |

## 4. Réutilisation de fonctions natives et sources officielles

- **Permissions de salon Discord** : utiliser des overwrites membres autorisés et refuser `View Channel` aux autres, plutôt que créer des rôles d'équipe à l'infini. Source : [Discord, permissions de salon, juillet 2026](https://support.discord.com/hc/fr/articles/10543994968087-Guide-d-initiation-aux-param%C3%A8tres-des-permissions-du-salon).
- **Onboarding / guide intégré** : mécanismes d'orientation mobile et sélection de salons existent, mais **le propriétaire a retenu YAGPDB + panneau à 3 boutons** ; conserver ce choix sans arbitrage contraire. Sources : [FAQ Onboarding](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ), [Server Guide](https://support.discord.com/hc/en-us/articles/13497665141655-Server-Guide-FAQ).
- **Modération native** : utiliser AutoMod, prévention des raids, niveaux de vérification et outils communautaires avant d'inventer un bot de modération concurrent. Source : [Guide serveur Discord, octobre 2026](https://support.discord.com/hc/fr/articles/33023827550359-Guide-de-configuration-d-un-serveur-sur-Discord).
- **Limites structurelles** : 500 salons, 250 rôles, 50 catégories selon la documentation officielle. Inventaire historique The Tower : 197 rôles en octobre, marge alors 53 ; renouveler l'inventaire avant arbitrage.
- **Forums** : 20 tags disponibles par forum, 5 par publication selon API Discord ; filtrer les jeux par ID GameNight, quelques tags d'intention (coop/compétitif/projet) seulement.

## 5. Décision d'architecture proposée

**The Tower = un seul serveur public ; GameNight = source durable ; salons Discord = ressources temporaires à quotas.**

1. Conserver **3 forums existants** (recherche de joueurs, recrutement, projets/aventures) et indexer par jeu dans GameNight, sans multiplier les catégories.
2. Équipes persistantes en DB, avec règles 2–8 membres/équipe et une équipe active par joueur selon décision antérieure ; possibilité de jouer en groupe informel sans équipe.
3. Vocaux privés temporaires créés seulement à la demande, liés à un groupe/équipe, contrôlés par permission individuelle, supprimés à délai d'inactivité défini, réconciliés après panne. Quotas globaux et par utilisateur, journalisation minimale.
4. Texte privé : **décision fonctionnelle non tranchée** entre fil privé Discord, salon texte temporaire ou messagerie privée GameNight ; évaluer sécurité, accessibilité, historique et coût avant développement.
5. Les modérateurs voient rapports/quota/erreurs et ont un parcours de signalement ; ne pas leur promettre accès automatique ou non-accès absolu sans auditer les permissions `ADMINISTRATOR`.
6. Essais de charge avec 500/2 000/10 000 membres **simulés et simultanéité mesurée**, jamais des créations non autorisées sur le serveur réel.

## 6. Conditions restantes pour clôture « 100 % audit/recette »

Ce sont des **blocages extérieurs à la lecture de code**, pas des choses à déclarer réussies :

1. **Exécution indépendante** sur clone du dépôt au SHA épinglé, lint/types/Prisma/Vitest, audit dépendances et analyse statique globale. L'exécution GitHub Actions prouve la CI #419, pas un clone local indépendant.
2. **Audit Discord direct et récent en lecture seule** : rôles, overwrites, catégories, canaux, scripts et bots ; on ne peut inférer ces états d'une archive du 26/10.
3. **Recette avec comptes joueurs et modérateur** : invitation neuve, lecture/écriture selon rôles, commandes, défis, équipes, votes, annonces et parcours smartphone.
4. **Arbitrage des nouvelles fonctions** (texte privé et quotas vocaux), puis développement, tests, revue et approbation sans collision avec les PR réservées.
5. **Autorisation spécifique** avant fusion des PR, migration Neon, flag Production, publication de message, permissions ou suppressions Discord.

## 7. Avis de livraison et mode de notification

**Audit statique / CI externe / Vercel / Neon / recherche : documentation réalisée et publiée pour revue. Audit opérationnel et certification de lancement : NON FINIS**. Le responsable du projet doit recevoir ce bilan dans la conversation courante et les agents doivent le consulter via [#400](https://github.com/ZeyFro/gamenight/issues/400) et [#432](https://github.com/ZeyFro/gamenight/issues/432).

Aucun dispositif n'exécute automatiquement des étapes supplémentaires après la fin de cette conversation. Ne pas promettre de notification future tant qu'une automatisation dédiée n'a pas été créée et configurée.
