# Sujet du salon #tournois : marqueur GameNight

**VÉRIFIÉ dans le code** : `src/lib/community-setup.ts:111-119` construit le sujet exact `GameNight:<guildId>:TOURNAMENT` et recherche les salons dont `topic === ce marqueur` pour retrouver un salon lors du provisionnement. S'il n'existe plus, le setup peut rechercher ou créer un autre salon ; la présence d'une référence par ID en base ne prouve pas que le mécanisme de redécouverte reste inoffensif.

**Verdict : ne pas retirer le marqueur aujourd'hui.** Un changement de sujet seul ne cassera pas nécessairement les annonces déjà configurées, mais peut casser l'idempotence d'un futur setup ou favoriser un doublon.

## Avant modification
1. Inventorier `CommunityChannelConfig` de catégorie `TOURNAMENT`, sans afficher le jeton Discord.
2. Vérifier le vrai sujet du salon, ses permissions, son type, les bots abonnés et les intégrations.
3. Faire évoluer le setup pour découvrir d'abord par ID existant (et vérifier son appartenance à la bonne guild) ; prévoir une autre identification durable.
4. Tester deux exécutions successives en sandbox : aucun nouveau salon, aucun déplacement, aucune perte de permissions.
5. Modifier le sujet en production **seulement après accord explicite**.

Le marqueur ne doit pas être effacé pendant la présente PR.