# /equipe — recette Discord simulée (T13 / #416)

Cette recette vérifie le manifeste et les interactions avec des données fictives,
sans identifiant Discord réel, sans base et sans appel réseau Discord. Elle ne
valide ni l'installation du bot, ni la visibilité de la commande sur un serveur,
ni les autorisations réelles de Discord. T13 reste à valider réellement après
accord distinct pour l'enregistrement.

## Exécution locale

Depuis la racine du dépôt, avec les dépendances existantes et Node 22 :

```sh
env -u MIGRATION_DATABASE_URL npx vitest run src/lib/discord-team-command-manifest.test.ts src/lib/discord-team-command.test.ts src/lib/discord-interactions.test.ts
```

Ces tests utilisent des doubles pour les utilisateurs, communautés, équipes et
réponses HTTP. Aucun PostgreSQL ni migration n'est nécessaire. Le test du script
de simulation supprime les identifiants et remplace `fetch` par un refus explicite.
Il compare le JSON affiché au manifeste complet.

## Résultats attendus et portée

| Scénario fictif | Résultat attendu |
| --- | --- |
| Manifeste `/equipe` | Installation serveur (`integration_types: [0]`), contexte serveur (`contexts: [0]`), aucune restriction administrateur (`default_member_permissions: null`) |
| Contrat des options | `liste`, `moi`, `rejoindre equipe_id`; identifiant texte obligatoire, longueur 1–191 |
| Liste avec équipe ouverte, pleine et fermée | Seule l'équipe ouverte avec une place apparaît, avec son identifiant |
| `moi` avec deux équipes fictives | Seule l'équipe du membre apparaît |
| `rejoindre` avec un identifiant valide | Transmission au service métier avec utilisateur et communauté attendus |
| Message privé, option forgée ou identifiant absent | Réponse privée de refus avant accès aux données |
| Communauté d'un autre serveur | Refus, sans liste ni adhésion |
| Interaction routée | Signature et anti-rejeu contrôlés avant routage; ACK privé (`flags: 64`) avant travail différé |

L'absence de restriction administrateur dans le manifeste ne remplace pas les
contrôles métier : compte GameNight associé, accès communautaire, communauté
active, serveur sélectionné et équipes activées restent requis. Le test du
handler simule le service d'adhésion : il ne démontre pas ses contraintes SQL,
la concurrence ou le traitement réel d'une réponse HTTP par Discord.

## Avant une future recette réelle autorisée

Consigner séparément l'application, le serveur de recette, le SHA déployé, les
comptes autorisés et les résultats observés. Vérifier avec un membre ordinaire
la réponse éphémère des trois sous-commandes, le refus en message privé et le
refus d'accès à une autre communauté. Toute donnée créée doit rester fictive
et sur l'environnement de recette autorisé.

Le script historique `register-discord-commands.mjs --execute` écrit des commandes
**globales** : son utilisation n'est pas autorisée par cette recette. Le script
Tower limité au serveur ne gère que `tower` et `tower-admin`, pas `equipe`.
Le mode d'enregistrement de `/equipe` doit donc être choisi et approuvé avant
toute écriture. Ne changer aucun rôle, droit, drapeau ou configuration pour
exécuter cette simulation. Aucun enregistrement réel n'est réalisé ici.

## Préparation hors ligne d'un enregistrement limité au serveur

`scripts/plan-team-guild-commands.mjs` prépare un JSON lisible sans requête réseau,
sans variable d'environnement et sans mode d'exécution. Il exige trois options,
sans répétition : `--application-id`, `--guild-id`, `--snapshot`. Le snapshot JSON
local doit contenir uniquement `application_id`, `guild_id` et `commands` (tableau
des commandes du serveur, avec leurs identités Discord). Les identifiants de
l'enveloppe et de chaque commande doivent correspondre aux options. Une commande
globale, une autre application, un autre serveur, un doublon ou un champ inconnu
fait refuser le plan. Ne fournir aucun token ou secret dans ce fichier.

Le résultat distingue le `payload` proposé pour un **POST** de création/mise à
jour de la seule commande `/equipe`, et `plannedCommands`, vue de comparaison qui
préserve les autres commandes. Cette vue n'est pas un corps de PUT : aucun
remplacement global des commandes n'est préparé. La route inclut explicitement
le serveur, sans possibilité de sélectionner une route globale. Les champs
`contexts` et `integration_types`, réservés aux commandes globales dans cette
API, ne sont pas transmis au payload de serveur ; les identifiants en lecture
seule ne le sont pas non plus.

Si `/equipe` existe déjà, le plan conserve `default_member_permissions` ainsi
que `default_permission` et `nsfw` lorsqu'ils sont présents ; une permission
par défaut absente ou de type inconnu entraîne un refus. Le snapshot ne couvre
pas les permissions spécifiques par utilisateur, rôle ou salon : leur contrôle
réel reste à faire séparément après autorisation. Le plan ne prouve ni la
fraîcheur du snapshot, ni l'installation effective de l'application.

Référence officielle vérifiée : [Create Guild Application Command](https://docs.discord.com/developers/interactions/application-commands#create-guild-application-command).
Les tests remplacent `fetch` par une erreur et limitent l'environnement du
sous-processus à `NODE_ENV=test`. Les options `--execute`, `--check` et `--token` sont refusées.
L'enregistrement réel demeure une opération distincte exigeant un accord.

## Revalidation de la pile — 12 novembre 2026

La branche reprend #408 `533e185`, dont #407 `059419f`, #406 `e1a890e`
et main `50e8246`, sans changer les SQL publiés. Le filtre `paths` du workflow
dédié inclut désormais `scripts/plan-team-guild-commands.mjs` : une modification
isolée de ce script déclenchera aussi les tests qui l'exercent.

Sur Node 22.23.4, `npm ci` complet et génération Prisma 6.19.3 réussis.
La commande exacte du workflow, complétée par la recette
`src/testsrecette/discord-team.e2e.integration.test.ts`, passe : **10 fichiers,
106 tests réussis, zéro ignoré**, PostgreSQL 16 jetable et Discord simulé.
Next typegen, TypeScript et ESLint complet passent (zéro erreur, 12 warnings).
Le contrôle local Prisma relève **121 migrations terminées, zéro inachevée,
zéro écart de checksum** avec les fichiers SQL du candidat. Ce contrôle ne
concerne aucune base Neon et ne prouve aucune migration distante.

Le build Next.js complet réussit également. Le contrôle supplémentaire
`prisma migrate diff` entre la base locale et le schéma n'est toutefois pas
vide : il propose le retrait de l'index
`CommunityGameEpitaph_communityId_createdAt_idx` et le renommage de l'index
tronqué de `TowerChallengeAttemptParticipant` sur communauté/utilisateur/date
de récompense. Les modèles concernés et leurs SQL sont hérités de main,
antérieurs aux trois migrations de la pile ; ce ne sont pas les deux écarts
R1/R2 corrigés dans #406. **Aucun SQL proposé par diff n'a été exécuté** et
aucune correction de ces modèles partagés n'est incluse dans #416. Un contrôle
de checksum réussi ne doit pas être présenté comme une absence de dérive.

L'intégration reste dépendante de #408 ; pas de commande Discord enregistrée,
pas d'activation, de Ready ou de fusion. Les résultats CI du commit publié et
le build sont consignés dans la PR et #400, sans les présumer ici.
