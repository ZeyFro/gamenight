# État de reprise — 5 novembre 2026

## Branche et PR en cours
- Branche courante : `feat/tower-community-entry-points-20261105`.
- PR brouillon #410 vers la branche documentaire #409 : https://github.com/ZeyFro/gamenight/pull/410
- Tête de #410 avant ce point de reprise : `053ed897f8aa8fc1a04f3a4350140fdc1e407d9e`. Le commit d'état ci-dessous sera la nouvelle tête.
- #409 reste brouillon vers `main`, tête `638bf02748c166317dbe245235add7c4c03d2a65`. Aucune PR n'est fusionnée.

## Fait
- #396 : idempotence vérifiée (jour Europe/Paris, clé unique et upsert); échec partiel d'attribution renvoyé en HTTP 503. CI et Preview avaient été rapportés verts au SHA `1f1136dc0a37fef6949052034e89214f8bafce9d`.
- #410 / P1-03 : liens vers Équipes, Soirées et The Tower ajoutés aux deux pages d'accueil; test ciblé ajouté. SHA de code `053ed897f8aa8fc1a04f3a4350140fdc1e407d9e`. Aucun test local exécuté dans cette session; le statut Vercel visible à l'ouverture était en attente.
- P3-04 : les règles de cooldown solo de 12 h, expiration/dépôt de preuve sous 48 h, quota de deux succès par jour en heure de Paris et le barème des étages existent déjà sur `main`, avec tests unitaires. Aucun doublon de PR créé.
- Aucune migration, opération Neon/Production, modification de configuration ou action Discord effectuée.

## Reste et blocages
- P1-01 et P1-02, ainsi que le volet Discord de P1-03, exigent un accès ou des actions Discord : en attente d'autorisation.
- P2-01 dépend de #370; P2-02 de #406; P2-03 de #370 et #406; P2-04 dépend de #370 et #408.
- #370 et #406 contiennent chacune une migration : aucune opération ni fusion avant accord spécifique distinct pour la migration concernée.
- P3-03 / #407 dépend de #406 et de la compatibilité avec #396; le délai de contestation de 7 jours doit être confirmé avant son implémentation.
- #395 ne devient opérationnelle qu'après configuration de l'ID en Production; ne pas modifier cette configuration.
- #408 reste dépendante de #370 et #406. #325 reste gelée avec six migrations et ses préconditions documentées.
- Le test ciblé de #410 n'a pas été exécuté localement dans cet environnement; attendre ses checks CI. Aucun essai réel Discord.

## Garde-fous permanents
- Aucune migration ni opération Neon/Production sans accord explicite distinct pour chaque migration.
- Aucune modification de configuration Production ou de variables d'environnement.
- Aucune modification de permissions, rôles ou salons Discord; aucun essai réel Discord sans accord explicite.
- Aucune fusion : toutes les PR restent en brouillon.
- Ne jamais demander ni publier de secret dans le chat.

## Prochaine action exacte
Vérifier les checks CI de #410 sur sa tête publiée. Si les checks passent, reprendre le premier lot restant qui ne dépend ni d'une migration non autorisée, ni d'une décision produit en attente, ni d'une action Discord; s'il n'existe pas de lot code distinct de ceux déjà livrés, consigner le blocage dans ce fichier sans créer de PR doublon.
