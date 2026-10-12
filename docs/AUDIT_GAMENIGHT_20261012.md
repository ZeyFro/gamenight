# Diagnostic GameNight — 12 octobre 2026

Base analysée : `main`, commit `49f2ea41d8ef94cfa208bd3c958552ace18d50a7` (merge #216).
Ce rapport distingue le code présent, les preuves automatiques et les contrôles réels encore nécessaires.

## Résultat

- Neon est **déjà sur Free (`free_v3`)**, avec le compute de production réglé de **0,25 à 0,5 CU**. Les anciennes indications « Launch / 4 CU » ne décrivent plus l'état constaté.
- La base est petite. Les appels répétés et les tâches qui la maintiennent éveillée sont une priorité plus pertinente qu'une augmentation du compute.
- Le passage en `fra1`, l'allègement des lectures du streak (#213) et la parallélisation de l'accueil (#214) sont déjà intégrés. Il ne faut pas les refaire.
- Les appels périodiques à l'executor, même sans livraison à traiter, peuvent empêcher la suspension. Réduire seulement le nombre de requêtes d'un import Steam ne garantit donc pas une baisse des CU-heures.
- L'accès Vercel renvoie **403 pour l'équipe attendue**. Les durées réelles, variables, destinations des previews et paramètres de runtime ne sont pas vérifiés.
- L'environnement local s'est déconnecté avant la publication des modifications de code. **Cette PR contient uniquement le diagnostic et le relevé anonymisé. Aucune optimisation de code n'est livrée par cette PR.**

Aucun changement de compute, de flag, de cadence, de dépendance ou de migration en production.
Aucune notification Discord réelle, aucun merge, aucun reset de statistiques.

## Sources et portée

Lectures des instructions `CLAUDE.md`, du schéma, des parcours concernés, des scripts, des documents V2 et des workflows.
Aucun `AGENTS.md` trouvé dans l'arbre du dépôt analysé.
Inspection GitHub, API Neon et requêtes SQL en lecture seule.
Les relevés sont datés : le trafic ultérieur peut modifier les compteurs.

Le relevé machine est dans [NEON_RELEVE_20261012.json](NEON_RELEVE_20261012.json).
Il ne contient ni chaîne de connexion, ni token, ni identité individuelle de joueur.

Cette analyse n'est ni un test navigateur de tous les parcours, ni une certification de sécurité exhaustive.
Un build vert ne prouve pas la latence perçue sur téléphone, la bonne livraison d'un MP ou l'état des flags en production.

## État Git et validations existantes

Au début de l'audit : aucune PR ouverte.
#212, #213, #214, #215, #216 et #217 sont fusionnées ; #211 est fermée sans fusion.
Le `main` a été revérifié avant la publication du rapport.

La CI de la base analysée est verte :
[run 37996744595, job verify](https://github.com/ZeyFro/gamenight/actions/runs/37996744595/job/114044655120).

- Passage Postgres : **203 fichiers, 2 261 tests réussis, aucun ignoré**.
- Passage sans URL de test : **1 440 réussis, 818 ignorés**. Les ignorés ne constituent pas une seconde preuve d'intégration.
- TypeScript, ESLint et compilation Next réussis.
- Statut Vercel du commit analysé vert ; cela ne donne pas accès aux métriques runtime.

La CI utilise Postgres **16**, tandis que Neon production annonce Postgres **18**.
Les tests Postgres doivent rester en série sur leur base isolée : ils utilisent des TRUNCATE.
Ne pas exécuter les tests sur Neon production.

## Fonctionnalités V2

« Présent » signifie trouvé dans le code, pas validé réellement sur Discord pendant cet audit.

| Domaine | État constaté | Contrôle / travail restant |
| --- | --- | --- |
| Isolation multi-communautés | Modèles, client scopé, OAuth guilds, sélecteur, XP/badges et clés collectives présents (#196–201) | Parcours A/B, retrait et suspension à revalider sur un environnement autorisé |
| Connexion Discord | Issuer explicite et callback simulé corrigés (#198) | Aucun nouveau login réel effectué ici |
| Setup Discord | Création de salons, permissions et reprise présents (#201) | Reprise après échec Discord et permissions réelles à surveiller |
| Interface et navigation | Refonte, fond animé, calendrier et navigation présents (#203–206) | Fluidité et accessibilité sur téléphone non mesurées ici |
| Calendrier | Création et améliorations mobiles présentes ; documentation de performance | Mesurer affichage, clic et confirmation sur mobile |
| Soirées planifiées | Création, invitations, propositions, votes et résultats présents | Revalider création, modification et suppression sans doublon |
| Création idempotente | Protections à inspecter dans chaque parcours | Ne pas déduire une garantie globale « zéro doublon » des seuls tests existants |
| Disponibilités | Planning habituel et propositions de créneaux (#207) | Le sondage de dates propres à une soirée reste distinct |
| Places et liste d'attente | Capacité, attente et promotion présents (#208) | Vérifier désistement/promotion en concurrence |
| Réponses Discord | Boutons des soirées planifiées avec capacité présents (#209) | Tournois et parties instantanées restent à compléter |
| Jouer maintenant | Session immédiate et annonce publique dans le serveur d'origine présents | **11 invitations MP ont échoué pour configuration manquante** ; diagnostic opérationnel à poursuivre |
| Roulette | Instantanée, planifiée et liée à une session présentes | Pondération par historique/tierlist et veto individuel à compléter |
| Onboarding | Accueil Steam/planning, guide reprenable et MP ciblé présents | Tester avec un nouveau compte, Steam refusé et MP fermés |
| Bibliothèques / Steam | Import, bibliothèque personnelle/de groupe et synchronisations présentes | Import réécrit inutilement de nombreux jeux inchangés |
| Tierlist / wishlist | Parcours présents | Intersection ciblée de possessions, promos et achat collectif à compléter |
| XP / badges / streaks | Progression par communauté, limite CREATE_SESSION et admin XP présents (#197, #215, #216) | Revalider la lecture rapide quand l'isolation est OFF et default SUSPENDED |
| Saisons / pronostics / paris / défis | Domaines présents et isolés | Contenu et règles souhaités à valider, boutique XP encore à faire |
| Tournois | Création, bracket et scores présents | Revalider annonces, équipes, fils et suppression |
| Notifications / rappels | File persistante, executor, reprises et modèles présents | Vérifier configuration live, pings, personnalisation et boutons réels |
| Rétention / nettoyage | Crons et règles de conservation présents | Vérifier configuration réelle et dry-run avant toute exécution destructive |
| Historique / récap / guide | Parcours présents | Notes, galerie, clips, LFG et autres extensions restent distincts |

Le reste des demandes produit est suivi dans [V2_EVOLUTIONS.md](V2_EVOLUTIONS.md).
Ce document contient encore des formulations « ce lot » anciennes : les comprendre à partir de l'historique des PR, sans déclarer toute la liste terminée.

Extensions encore à faire ou à compléter : sondage de dates, veto, pondération roulette, intersection ciblée des jeux,
notes/galerie de fin de soirée, boutique XP, alertes de promos, identifiants multiplateformes, préférences,
checklist, lore, événements récurrents au calendrier, mini-jeux et LFG.
Ce sont des évolutions produit ; elles ne justifient pas de retarder les corrections de fiabilité/performance.

## Neon — état réel

Relevé du projet : **2026-10-12 06:42:16 UTC**.

| Élément | Valeur constatée | Conséquence |
| --- | --- | --- |
| Projet | `misty-tooth-45335023` | Projet GameNight existant conservé |
| Forfait | `free_v3` | Le retour au gratuit a déjà eu lieu |
| Région | `aws-eu-central-1` | Francfort |
| Postgres | 18 | Différence à garder visible avec les tests CI en 16 |
| Production | `br-super-cell-b1ukvk08` | Aucun test ni migration lancé ici |
| Compute production | min 0,25 / max 0,5 CU | Ne pas ramener arbitrairement le plafond à 0,25 sans mesure de charge |
| Stockage synthétique du projet | 38 764 544 octets | Petit volume ; ce relevé n'est pas toute la facturation de stockage |
| Taille SQL de neondb | 15 712 256 octets | Ne justifie pas une purge pour gagner de la vitesse |
| Historique de restauration | 21 600 s (6 h) | Ne pas réduire sans besoin ni supprimer la sauvegarde |
| Preview | `preview-gamenight` archivée, endpoint idle | Zéro consommation dans la période relevée |
| Backup | `backup-avant-multiserveur`, endpoint idle | Zéro consommation dans la période relevée ; conserver la sauvegarde |
| Comptes / Steam | 7 comptes, 5 liés à Steam | Petit groupe |
| Communautés / membres | 2 ACTIVE, 10 memberships ACTIVE | Le volume ne suffit pas à expliquer une lenteur importante |
| Migrations | Aucune migration échouée non annulée ; dernière terminée le 09/10 à 22:11 UTC | Pas de nouvelle migration à demander pour ce diagnostic |

Le champ API `suspend_timeout_seconds: 0` **ne prouve pas** que la suspension est désactivée :
la documentation Free indique une suspension après 5 minutes d'inactivité, et les endpoints nonprod sont effectivement idle avec le même champ.
Ne pas modifier ce réglage sur cette seule valeur.

Le champ `pooler_enabled: false` ne suffit pas à établir quelle URL Prisma utilise réellement.
Aucune URL secrète n'a été lue et aucun réglage de connexion n'a été modifié.

### Consommation et limite de l'interprétation

Période API : du **09/10/2026 21:19:49 UTC au 01/11/2026 00:00 UTC**.
Relevé : `active_time_seconds = 200716`, `compute_time_seconds = 52607`, transfert `85045475` octets.

La production représente la totalité du compute relevé ; preview et backup sont à zéro.
Au moment du relevé, le temps actif correspond à environ **97 %** du temps écoulé depuis le début de cette période.
Ce constat est compatible avec une base constamment réveillée.

Le champ historique `compute_time_seconds` n'est pas la métrique détaillée `compute_unit_seconds` décrite par la documentation de facturation.
Sa division par 3 600 donne 14,61, mais **ce chiffre n'est pas présenté comme une consommation CU-h formellement vérifiée**.
Il faut rapprocher les métriques officielles du tableau de consommation.

Exemple théorique : un compute de 0,25 CU actif 24 h/24 pendant 31 jours consomme **186 CU-h**.
Une baisse du coût nécessite donc aussi des périodes réellement suspendues ; moins de SQL sur un compute toujours éveillé ne suffit pas.
Le volume d'usage réel, le quota applicable et la période courante doivent être vérifiés dans Neon avant toute conclusion sur le reste du mois.

## Requêtes et synchronisations

Statistiques depuis le redémarrage/reset observé **11/10/2026 19:58 UTC**.
Aucun reset de `pg_stat_statements` effectué pendant l'audit.
Ces compteurs ne sont pas des taux permanents ni des benchmarks utilisateur.

| Requête / tâche | Appels relevés | Analyse |
| --- | ---: | --- |
| Upsert Game | 1 077 | Réécrit métadonnées à chaque synchronisation, même inchangées |
| Upsert UserGame | 1 077 | Une écriture par possession, même déjà connue |
| Test de file executor vide | 649 | Correspond à un réveil proche de chaque minute dans la fenêtre observée |
| Écritures Steam activité User | 220 | Retours de lignes User complets inutiles à examiner |
| Écritures Steam now-playing User | 220 | Un utilisateur déjà inactif est réécrit à chaque tick |
| Verrou CommunityMemberStats | 4 | L'ancien verrou à chaque page ne se reproduit pas dans ce relevé ; #213 est déjà intégré |

Les 1 077 upserts UserGame totalisent environ **228 ms d'exécution SQL** ; les upserts Game environ **93 ms**.
Une lecture UserGame isolée atteint environ **97 ms**.
Le temps SQL d'exécution seul ne mesure ni les allers-retours réseau, ni la connexion, ni l'API Steam/Discord, ni le rendu navigateur.
Il ne permet pas de garantir « instantané » ni d'exclure tout pic de latence.

### Optimisations préparées localement — non publiées

1. Import Steam par lots de 50, créations groupées, mises à jour uniquement pour les métadonnées ou possessions qui changent.
2. Sélections étroites sur les écritures User ; conservation des attributs manuels/coop et des possessions des autres utilisateurs.
3. Now-playing : aucune écriture pour un joueur déjà idle, renouvellement conservé pour un joueur actif afin de préserver la fraîcheur de 10 minutes.
4. Écriture conditionnée au même SteamID afin d'éviter d'écraser un compte détaché/relié pendant la requête.
5. Contrôle ACTIVE de default sur le chemin de lecture rapide des statistiques lorsque les flags sont OFF.
6. Tests Postgres prévus : import concurrent, reprise partielle, métadonnées manuelles, snapshot Steam, suspension default et mesure SQL avant/après depuis le vrai code de base.

Avant la déconnexion de l'environnement : **100 tests ciblés**, TypeScript, ESLint et build direct Next avaient réussi.
La suite locale complète finale et les nouveaux scénarios Postgres **n'ont pas de résultat vérifiable**.
Il n'y avait pas de Postgres local disponible pour les nouveaux tests d'intégration.
**Ces contrôles ne valident pas la PR documentaire, ne prouvent pas que le code est poussé et ne remplacent pas sa future CI.**

Les modifications de code étaient non committées quand l'environnement local est devenu offline.
Leur disponibilité à la reprise est incertaine ; il faut vérifier le disque avant de reprendre ou reconstruire.
Ne pas déclarer de gain SQL mesuré pour cette implémentation : son benchmark Postgres n'a pas été exécuté.

## Discord : incidents à traiter

| Statut de livraison | Nombre |
| --- | ---: |
| SENT | 392 |
| FAILED | 134 |
| SKIPPED | 43 |
| PENDING / RESERVED | 0 / 0 |

Les 134 FAILED se répartissent en :
87 expirées, 17 auth/permission, 11 non configurées, 9 MP indisponibles, 9 ressources introuvables et 1 dépendance non prête.
Ce sont des compteurs historiques. Les expirations ne prouvent pas une panne actuelle et zéro en attente ne prouve pas que tous les MP réussissent.

Les **11 `resolver:not_configured`** sont des MP `INSTANT_SESSION_INVITE` :
9 dans la seconde communauté, 2 dans default.
Une configuration/flag/credential live manque ou ne satisfait pas le resolver ; la cause précise n'est pas confirmée sans accès Vercel.
Ne pas activer un flag au hasard et ne pas rejouer toutes les notifications historiques.

Une seule configuration DB SESSION et une seule TOURNAMENT sont activées.
Default peut utiliser ses anciennes destinations ENV : ce comptage ne prouve pas qu'un serveur est mal configuré.

À contrôler réellement, avec des destinataires de test consentants :
annonce personnalisée, MP, mention dans le fil, créateur non repingé dans le fil, refus des MP,
soirée classique/roulette/instantanée/tournoi, liens, suppression et absence de fuite entre serveurs.

## Réduction des CU-heures : suite recommandée

1. **Conserver les réglages Neon actuels** tant que la charge ne montre pas un besoin contraire.
   Aucun intérêt démontré à augmenter le compute ; aucune preuve suffisante pour abaisser son plafond.
2. **Récupérer l'inventaire des crons externes** : URL, fréquence, éventuels doublons et dernière exécution.
   Ne pas transmettre leurs tokens, Authorization ou URL contenant des secrets.
3. **Corréler les réveils** Neon aux appels Vercel/cron. Le test de file vide toutes les minutes est la priorité constatée.
4. Préparer une livraison déclenchée **après commit**, avec intention durable, relance et filet de sécurité.
   La file persistante et les protections de concurrence doivent rester la source de vérité.
   Un cache mémoire « file vide » sans invalidation durable risquerait de retarder un rappel ou un MP.
5. Traiter séparément la présence Steam et les imports complets : conserver la fraîcheur promise et le rattrapage avant de modifier leurs cadences.
6. Mesurer sur **24–48 h comparables**, avant/après : CU-h officiels, temps actif, réveils, SQL, durée des pages et retard des livraisons.
   Une amélioration du nombre de SQL seule n'est pas un résultat de facturation.

La documentation prévoit notamment executor chaque minute, rappels toutes les 5 min, Steam léger toutes les 5 min et import complet toutes les 2 h.
Ces cadences n'ont pas été changées.
L'executor ne doit pas être simplement désactivé pour laisser dormir la base.

## Blocages et reprise précise

- **Vercel** : l'appel de lecture du projet `gamenight` dans `mpmaximeparisot-6230s-projects` renvoie 403.
  Accès attendu : `team_gho4DTcbV8MSZicSAIroYF9c`.
  Ne pas retenter une requête inchangée ni utiliser une autre équipe pour contourner ce refus.
- **Crons externes** : aucun accès à leur inventaire réel.
- **Local** : le serveur d'exécution répond `409 environment_offline: Environment is not connected`.
  La relecture finale, la récupération des fichiers de code et leur publication n'étaient plus possibles.

À la reprise : vérifier d'abord les fichiers locaux et l'état de main, récupérer le diff préparé si disponible,
finir les tests Postgres en série et la mesure avant/après, puis ajouter le code dans une seule PR Draft.
Ne pas prétendre repartir de zéro avant d'avoir vérifié le travail encore présent.
La PR de diagnostic conserve les constats et peut être complétée par cette implémentation après validation.

Pour le volet infrastructure, fournir l'accès autorisé à l'équipe Vercel attendue et l'inventaire des tâches externes.
Aucune nouvelle requête SQL de migration n'est nécessaire pour appliquer ce rapport.

## Références officielles

- [Neon — Computes](https://neon.com/docs/manage/computes)
- [Neon — Scale to zero](https://neon.com/docs/introduction/scale-to-zero)
- [Neon — Billing](https://neon.com/docs/introduction/about-billing)
- [Neon — Usage calculations](https://neon.com/docs/introduction/usage-calculations)
