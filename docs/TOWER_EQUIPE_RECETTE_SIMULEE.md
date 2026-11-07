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
