# Organisation : reprise et validation

Branche `feat/organisation-quick-wins`, reprise du travail de Claude le 14 octobre 2026.
Base de comparaison récupérée : `origin/main` à `491d43e` ; reprise à `601b555` (12 commits).

## Périmètre livré

- Veto du vote de jeu : un veto par personne et soirée, remplaçable et retirable pendant le vote ; refus si aucun candidat jouable ne resterait. Comptage anonyme, exclusion à la clôture et au tirage manuel.
- Roulette instantanée et asynchrone : filtre du nombre de joueurs avec repli si aucun candidat ne convient. Relance instantanée sans reprendre un jeu déjà tiré ; redémarrage après épuisement.
- Roulette asynchrone : un veto par participant sur le résultat d'une soirée encore planifiée et future ; relance sans les jeux rejetés, mise à jour atomique de la roulette, de la soirée, des propositions/votes et des intentions d'édition Discord. Refus lorsque l'annonce n'est pas éditable via le bot.
- `remindersSent` : fusion par comparaison conditionnelle, trois tentatives et avertissement si la sauvegarde échoue ; un échec ne saute pas les soirées suivantes.

Corrections de reprise : verrou partagé entre les mutations de veto et la décision de clôture/tirage, relecture du statut sous verrou, verrou de la soirée issue de roulette, bouton synchronisé avec la valeur serveur et nouvelle animation après changement de gagnant. Le retrait d'un bouton obsolète ne supprime pas le veto d'une autre proposition.

Sondage de disponibilités et rappels après changement de date hors périmètre. Aucun merge, changement de production, accès à un `.env` réel, test Neon ou notification Discord réelle.

## Migrations et flags

Appliquer les migrations du dépôt dans leur ordre habituel, puis ces deux migrations additives, déjà écrites par Claude et conservées sans modification :

1. `20261014120000_add_session_veto/migration.sql` : table `SessionVeto`, unicité soirée/utilisateur, index proposition et communauté, clés étrangères avec suppression en cascade.
2. `20261014130000_add_roulette_veto/migration.sql` : table `RouletteVeto`, unicité roulette/utilisateur, index communauté, clés étrangères avec suppression en cascade.

Aucune migration existante modifiée. Application locale vérifiée sur une base neuve `gamenight_organisation_test` à `127.0.0.1:55439`. Les previews ne déploient pas les migrations : préparer leur schéma avant d'activer les flags.

- `VOTE_VETO_ENABLED=true` : veto de soirée et de roulette asynchrone ; nécessite les deux migrations.
- `ROULETTE_PLAYER_FILTER_ENABLED=true` : filtre joueurs, relance sans doublon et redémarrage instantané ; sans migration.
- Les deux flags sont OFF par défaut et exigent la valeur exacte `true`.
- Le veto asynchrone nécessite une soirée `announceViaBot=true` et le chemin d'annonces bot/executor déjà configuré. Cette reprise n'active aucun flag d'infrastructure ni d'isolation en production.

## Validation

Les tests ajoutés reproduisent avant correction quatre courses sur Postgres et le bouton veto obsolète. Après correction : 22 tests veto de soirée, 19 tests roulette et 3 tests DOM ciblés réussis. La relecture finale fonctionnelle et sécurité n'a relevé aucun blocage.

Suite unitaire complète : 164 fichiers et 1 534 tests réussis avec deux workers ; 56 fichiers et 900 tests Postgres ignorés dans ce passage sans URL. TypeScript, ESLint et build Next direct réussis. Premier passage unitaire : timeout de 5 secondes dans le test OAuth préexistant, suivi d'un passage isolé puis complet réussis. Premier build : téléchargement des polices Google bloqué par le réseau du bac à sable, puis build complet réussi avec accès réseau autorisé.

Validation Postgres complète et checks distants : résultats finaux consignés dans la [PR Draft #227](https://github.com/ZeyFro/gamenight/pull/227). Les journaux locaux sont conservés sous `%TEMP%/gamenight-organisation-*`. Le premier passage Postgres a signalé sept échecs roulette : diagnostic ouvert jusqu'à lecture du rapport complet. La CI distante exécute les mêmes tests sur son service Postgres. Le premier check Vercel indique « Deployment was blocked » ; inspection détaillée refusée par le plugin (403 sur l'équipe), aucune CLI Vercel installée.

Commandes utilisées :

```text
TEST_DATABASE_URL=<Postgres local dédié> npm run test:postgres
npm test
node node_modules/typescript/bin/tsc --noEmit
npm run lint -- --ignore-pattern .claude/** --ignore-pattern .codex-worktrees/** --ignore-pattern graphify-out/**
DATABASE_URL=<Postgres local dédié> node node_modules/next/dist/bin/next build
```

ESLint exclut uniquement les copies locales imbriquées et les artefacts Graphify. La CI et les dépendances restent inchangées. Le build direct évite le script qui déploie les migrations. La suite Postgres héritée a été inspectée puis arrêtée avant tout nouveau lancement ; une seule suite Postgres à la fois.

## Tests utilisateur après déploiement autorisé

1. Flags OFF : aucun veto ni nouvelle relance/redémarrage visible ; parcours historiques fonctionnels.
2. Vote avec au moins trois jeux jouables : poser un veto sur A, le remplacer par B, vérifier que seul B affiche « Retirer mon veto », puis le retirer. Les compteurs ne dévoilent aucun nom. Le dernier candidat ne peut pas être vetoé.
3. Clôture et tirage manuel : aucun jeu vetoé retenu ; essayer deux onglets et deux utilisateurs simultanément.
4. Roulette instantanée : choisir un nombre de participants, vérifier les bornes min/max et le repli explicatif. Relancer jusqu'à épuisement sans reprendre un même jeu, puis recommencer.
5. Roulette asynchrone avec annonce bot : veto d'un participant, roue et résultat cohérents, même soirée mise à jour, annonce/MP édités sans nouveau ping ; second veto du même participant refusé. Vérifier épuisement, fin/annulation et membre d'une autre communauté.
6. Sur mobile et au clavier : boutons accessibles, focus visible, désactivation pendant requête, messages de refus lisibles.

Ces parcours réels restent à vérifier : aucun navigateur Playwright ni compte de test authentifié n'est disponible dans la session. Les tests DOM utilisent jsdom, Testing Library et des actions simulées ; les tests d'intégration utilisent un vrai Postgres local et des transports Discord simulés.

## Outils et délégation

| Étape | Sous-agent | Modèle demandé/utilisé |
|---|---|---|
| État, commits et validations existantes | `explorateur` | `gpt-6-luna`, réflexion moyenne, lancement accepté |
| Règles, flags, textes/accessibilité, relecture UI | `regles_flags` | modèle hérité, identifiant non vérifié |
| Première relecture concurrence/isolation/migrations | `concurrence_isolation` | modèle hérité, identifiant non vérifié |
| Relecture sécurité des corrections finales | `securite_finale` | `gpt-6-astra`, réflexion élevée, lancement accepté |

Tous les sous-agents sont restés en lecture seule. L'agent principal réalise les corrections et les validations. Les rôles de `.claude/agents/` ont été lus ; leur modèle Claude `sonnet` n'est pas supposé disponible dans Codex.

Capacités utilisées : shell/Git/GitHub CLI, Docker local, Vitest/Postgres local, TypeScript, ESLint, Next, Context7 (documentation Prisma), skill Plugin Management (inventaire), skills Vercel React et Deployments/CI-CD (relecture et inspection des checks), plugin Vercel (tentative d'inspection refusée). GitHub, Context7, Vercel, Neon, Sites et Work Pets figurent dans les outils exposés ; les capacités Neon n'ont pas été utilisées. Aucun nouveau plugin ni dépendance installé.

Limites : Superpowers proposé mais non installé ; Graphify, Ponytail, frontend-design/design-skills et outil navigateur Playwright non exposés. Cartographie Graphify non nécessaire à cette correction ciblée. TDD et vérification avant conclusion effectués avec l'outillage du dépôt ; synthèse concise rédigée directement. Context7 retourne aussi des API Prisma récentes : seules les signatures compatibles avec Prisma 6 et le client local sont retenues.
