# Point de reprise — GameNight, PC fixe, 19 octobre 2026

Ce fichier est publié après chaque lot. Échéance utilisateur : 20 octobre 2026 à 00 h Europe/Paris. Aucun périmètre Mangas Origines. Quota restant non observable : aucun pourcentage annoncé.

## Mise à jour finale — 20 octobre, après minuit

- Branche de recoupement `docs/scope-reconciliation-20261019`, SHA `721963f1ccc382d2cff082c267c073170db5002b`, publiée sur GitHub; PR brouillon pas encore créée afin de ne pas lancer un deuxième test PostgreSQL pendant le job DB sériel #291. Vérification locale de cette doc : `git diff --check` vert. Prochaine action exacte : attendre la fin de l'étape `npm run test:postgres` de CI #291 `39334266539`, créer la PR de cette branche en brouillon avec les liens vers `docs/MISSION-20261019.md` et ce point de reprise, puis suivre ses checks au SHA courant. Ne pas fusionner #291 ni déclencher de migration Production.
- #291 : branche `fix/xp-balance-20261019` publiée sur `70ed5fc`, PR toujours BROUILLON; contrôles verts connus au commit antérieur `92a5a91` seulement, les nouveaux commits attendent des checks frais. Migration `20261019190000_separate_xp_balance` jamais appliquée en Production. Revue migration/données/grades et plan de sauvegarde-restauration : `docs/XP-ROLLOUT-DECISION-20261019.md` dans la branche de PR. La répétition PostgreSQL locale complète a restauré le dump en nouvelle base, comparé progression/rangs/cosmétiques, vérifié un rôle lecture seule et l'échec sur XP historique négatif. SHA-256 dump : `a541f30b05e72a22852d6a492cff07cebb8de3ff3822924164ee69569c169ab0`.
- Opération nécessitant décision explicite : maintenance et arrêt vérifié de tous les écrivains; sauvegarde Production restaurée dans une cible isolée; application séparée de la migration XP avec rôle migration; déploiement du code avec `npx prisma generate && npx next build` et runtime en lecture seule; contrôles SQL/inventaire, puis réouverture séparée des écritures. Préconditions concrètes : identifier les vrais rôles et toutes les voies d'écriture, prouver la barrière sur les anciennes/nouvelles instances, et obtenir un point de restauration Production restaurable. Ne pas migrer ni fusionner #291 avant cette autorisation et les préconditions.
- #293 : déploiement Production confirmé dans GitHub, Deployment `7181323490`, SHA exact `e04d76fe15b3966568e99478e72676c159edf20f`, statut success à `2026-10-19T18:14:23Z`. Pas besoin d'accès Vercel direct pour cette preuve.
- Recoupement initial : tous les dix groupes sont détaillés dans `docs/MISSION-20261019.md`. Manques de code confirmés : publication Discord automatique des offres gratuites (flux GamerPower in-app livré), équipes persistantes/bracket par équipe aux tournois, présence Discord/vocale mesurée. Les promotions payantes Epic sont séparées. Les pénalités existantes restent inchangées et inactives sans décision de montants.
- Veto local : script expérimental `scripts/recette-veto.mjs` présent non validé. Tentative locale a échoué avant fixture car l'identifiant local fourni n'était pas accepté par PostgreSQL; aucun secret ou `.env` lu, aucune fixture créée par cette tentative. Reprendre avec une méthode autorisée d'accès au serveur dédié, puis recette browser locale sérialisée.
- Incertitude Production à conserver : un onglet neuf a chargé `/jeux-gratuits`; l'accès de page appelle une lecture de compte qui peut toucher streak, badges ou notifications. Aucun formulaire n'a été soumis et aucune écriture n'a été confirmée; onglet fermé. L'absence d'effet de ce GET n'est pas démontrable rétrospectivement. Pas de navigation Production supplémentaire.
- Les processus Node repérés lors de la recette inachevée sont les serveurs MCP Playwright/Context7, pas des serveurs Next temporaires; ils ont été préservés. Ancien checkout et worktrees conservés.
- Revue indépendante XP (`/root/xp_scope`) terminée sans finding supplémentaire P0–P2; recommandation de garder #291 en brouillon jusqu'aux prérequis et décision. Agent galerie (`/root/gallery_290`) a atteint sa limite de quota avant d'achever le script veto; son historique ne contient pas de résultat de recette veto.

## État et contraintes persistantes

- Checkout racine C:/Users/Mousiouf/gamenight préservé sur feat/prix-telechargement-jeux, SHA73f2e1f; HANDOFF.md non suivi conservé. Trois anciens worktrees 23f2, 978b et a33e conservés et propres au relevé initial.
- Worktree de reprise : C:/Users/Mousiouf/.codex/worktrees/mission-fixe-20261019/gamenight, branche work/mission-fixe-20261019. Il poursuit sans réécriture la branche publiée work/mission-complete-20261019 de PR #290, base origin/main babf958 (#289).
- #290 était brouillon au SHA329fc2d, CI verify et Vercel/Preview Comments SUCCESS. Métadonnées Vercel READY confirmées pour ce SHA. Les nouveaux commits doivent obtenir leurs propres contrôles avant fusion.
- L'utilisateur autorise explicitement fusion après tests adaptés, revue et contrôles requis verts au dernier SHA, puis vérification du déploiement. Pas de force-push, contournement ou migration Production.
- Toute écriture de recette reste sur PostgreSQL local; jamais de message Discord réel, activation de flag Production, désactivation protection Vercel ou nettoyage distant. Ne récupérer aucune ancienne Preview et ne supprimer aucune branche Neon.
- Les recettes authentifiées #289 sont acquises et ne sont pas rejouées.

## Lot #290 — permissions et classements

- Galerie et chronique : créateur ou ADMIN/OWNER communautaire déjà autorisé à accéder à la soirée privée. Un admin sans invitation reste refusé; le seul rôle admin global ne donne aucun droit de gestion.
- Lore communautaire Fame/Shame : ADMIN/OWNER. Il n'existe aucun lien soirée dans ce modèle, donc être créateur d'une autre soirée n'accorde aucun droit global.
- Musée : formulaires réservés aux personnes réellement autorisées côté serveur. Classements : temps déclaré, nombre de soirées rejouées et régularité, isolés par communauté.
- Tests PostgreSQL PC fixe : chroniques + highlights 16/16 en série après vérification du conteneur/binding/base. Tests unitaires supplémentaires et contrôles finaux consignés dans la PR et le tableau.
- Nouvelle recette scripts/recette-contenus.mjs passée sur Next local3102 + cinq comptes : gestion créateur/admin invité, lecture membre et admin global, admin tiers 404, modification chronique et publication musée persistées, révocation immédiate, musée mobile390x844 sans débordement et zéro NotificationDelivery pour la soirée.
- La recette n'envoie aucun Blob. Le stockage réel et les clips réels restent une validation externe manquante. AUTH_SECRET éphémère en mémoire, cookie local synthétique; ceci ne valide pas OAuth Discord réel.
- Dépendances existantes réutilisées par junction; aucun npm ci. Next dev utilise --webpack car Turbopack refuse les junctions hors de sa racine. Le script arrête seulement son propre serveur et navigateur; fixtures locales conservées.

## Suite indépendante

- Grades/boutique : défaut confirmé, l'achat décrémente actuellement xpTotal utilisé par les rangs. Choix utilisateur explicite : conserver la progression lors d'un achat. Correctif séparé fix/xp-balance-20261019, worktree C:/Users/Mousiouf/.codex/worktrees/xp-balance-20261019/gamenight; solde distinct, initialisé au total actuel, sans restitution historique inventée.
- Cette séparation ajoute une migration. scripts/build.mjs exécute migrate deploy hors Preview : PR BROUILLON uniquement, aucune fusion tant que migration Production interdite. Les autres paramètres économiques existants sont conservés, sans nouvelle pénalité arbitraire.
- Offres gratuites automatiques : flux GamerPower in-app livré par #292, fusionné dans `80c2b63`; curation manuelle prioritaire conservée. OFF sauf `FREE_GAME_FEED_ENABLED=true` et `freeGamesEnabled` communautaire. Filtres d'éligibilité, redirection bornée vers Steam/Epic officiels, attribution et déduplication présents; aucune expiration ou disponibilité régionale garantie. GET source observé depuis le PC fixe et CI/Preview vertes; intégration live dans l'application non validée. Les promotions payantes Epic ne bloquent pas ce flux gratuit.
- Pas de quiz de connaissances distinct à ajouter : le quiz carnet Tryharder/Ambianceur/Stratège/Chaos est livré; rester dans la demande initiale.
- Tableau exhaustif : docs/MISSION-20261019.md (exigence → code → tests → recette → activation → preuve/blocage). Les anciennes preuves du portable y sont conservées. Présent dans le code ne signifie pas activé ou validé réellement.

## Recoupement du périmètre — base `main` `1c939ac`

- Clips MP4 : code livré (#288), permissions et capacité revérifiées (#290); Blob réel et codecs sur appareil restent à valider. Le message galerie flag OFF indique désormais que les clips sont désactivés, pas absents.
- Veto : vote et roulette asynchrone exigent `VOTE_VETO_ENABLED`. Le filtre par nombre et la relance instantanée utilisent `ROULETTE_PLAYER_FILTER_ENABLED`; activer ce dernier seul n'active pas les vetos. Recette réelle restante, aucune activation Production.
- MVP multicatégorie : formulaire et action traitent toutes les catégories actives. Nouvelle intégration `superlative-voting.integration.test.ts` 3/3 sur PostgreSQL local dédié après vérification de destination et libération du créneau #291 : gagnants distincts/identiques, ex-aequo, ledger par catégorie, montants et replay sans doublon. Récompenses et notifications in-app réelles en base; seul transport Discord simulé. Formulaire navigateur et annonce réelle restent non validés, sans rejouer #289.
- Présence : taux et pénalités reposent sur la saisie du créateur. Aucun collecteur de présence Discord/vocale n'est implémenté; ce reste fonctionnel est distinct du bouton vocal et de l'indicateur Steam « En jeu ».
- Pronostics : points fictifs livrés par #295, fusion `3397b9a`, déploiement Production exact en succès; parcours authentifié et flag non validés. Aucun XP ni point stocké.
- Prochaines tâches indépendantes : recette locale du veto et du vote multicatégorie, puis validations externes Blob/Push/iCal/Discord uniquement dans les limites autorisées. Ne pas relancer la recherche d'anciennes données Preview ni ajouter un quiz de connaissances distinct.
- Lot local `docs/scope-reconciliation-20261019`, worktree dédié de même nom : 4/4 tests galerie verts après échec attendu sur le texte précédent, PostgreSQL MVP 3/3 en créneau exclusif, typegen/TypeScript/ESLint ciblé et diff check réussis. Dépendances identiques réutilisées par junction; aucune réinstallation, migration, activation ou recette externe. Publication confiée au coordinateur après revue.

## PostgreSQL et coordination

- Conteneur conservé gamenight-test-pg, uniquement127.0.0.1:55439, base gamenight_test. Identité vérifiée par current_database() et aucune connexion concurrente avant première écriture. Les deux migrations déjà publiées iCal/annulation ont été appliquées uniquement à cette base locale.
- Toujours un seul processus de tests PostgreSQL; les suites historiques partagent/vident des tables. Chaque agent doit demander le créneau au coordinateur et le libérer explicitement.
- Le worktree XP dispose de son propre client Prisma, isolé des dépendances partagées; hash partagé23f2 inchangé après génération.

## Interventions externes à distinguer

- Blob privé : configuration et vraie lecture/envoi médias non validés; aucun token réel utilisé.
- Discord : vérifier manuellement les vrais messages/rappels/RSVP, canaux et vocal; textes définitifs plus tard. Aucun envoi réel ici.
- Push : VAPID et opt-in navigateur réels à configurer/valider; aucune activation Production.
- iCal : import tiers Google/Apple non effectué; abonnement local/jetons peuvent être testés isolément.
- Vercel : Chrome Production est authentifié pour recette read-only. Le connecteur lit les métadonnées sans team explicite; accès Preview protégé et portée équipe restent une limitation déjà documentée. Ne pas reconnecter ni modifier protection sans nécessité.
