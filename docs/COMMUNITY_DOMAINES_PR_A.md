# Isolation des domaines — PR A

État actuel : PR #196 et PR B #197 mergées. Le bilan ci-dessous est historique.
La préparation OAuth, les preuves locales complémentaires et les contrôles
réels avant The Tower sont détaillés dans [COMMUNITY_ROLLOUT.md](COMMUNITY_ROLLOUT.md).
Les flags de production restent OFF ; aucune ouverture n'est déclarée.

Base : `main`, commit `8e430cc` (PR #195). Cette PR regroupe les anciens lots
PR10 et PR11. Tous les flags `COMMUNITY_*` restent éteints en production.
Elle ne suffit pas à autoriser l'ajout d'un second serveur réel.

| Domaine | Comportement sous isolation |
| --- | --- |
| Roulette | Liste sur le serveur actif ; accès par ID réservé aux membres invités/créateur ; refus avant tirage paresseux. Le tirage exclut les membres retirés et conserve le serveur de la roulette, même après changement de sélection du créateur. |
| Jouer maintenant | Création et invités dans la communauté active ; contrôles avant expiration/récompenses ; liste limitée au serveur actif ; créateur retiré refusé. |
| MP roulette et sessions instantanées | Appartenance et statut du serveur relus avant SEND et EDIT. Aucun appel Discord après retrait/suspension. |
| Superlatifs, pronostics et paris | Contrôle du parent et provenance `communityId` persistante, même après purge de la soirée. Lectures du profil et des vitrines limitées au serveur actif. |
| Défis | Une ligne par `(communityId, weekStart)` ; une soirée complète uniquement le défi de son propre serveur. |
| Récaps | Un snapshot par `(communityId, year, month)` ; génération pour les communautés actives et lecture sur le serveur sélectionné. |
| Saisons | Numérotation par `(communityId, number)` ; bootstrap par communauté. Clôture et reset suspendus sous isolation jusqu'à PR B. |
| Tournois | Carte d'accueil sur le serveur actif ; contrôles d'appartenance avant gestion, désinscription et déclaration du vainqueur. |

## Migration

Migration unique : `20261005160000_community_domain_keys`.

- Préserve les lignes historiques et crée `default` si elle manque.
- Rattache les défis, récaps et saisons historiques à `default`, rend leurs
  communautés obligatoires et remplace les clés uniques globales par des clés
  composites.
- Ajoute une provenance nullable aux récompenses, pronostics et paris. Elle est
  backfillée depuis les soirées encore présentes. Une soirée déjà purgée ne
  permet pas de reconstruire son serveur : ces résumés historiques restent
  `NULL`, donc visibles uniquement dans `default` sous isolation.
- Pas de FK de communauté sur ces trois résumés durables : une purge de la
  communauté ne réattribue pas leurs récompenses à `default`.

La migration change les clés Prisma utilisées par l'ancien code : backup Neon
avant le merge, déploiement hors des heures de jeu, base de PR `main` à vérifier.
Le rollback du seul code ancien n'est pas compatible avec ces nouvelles clés.
Ne pas modifier une migration déjà appliquée.

Après un merge autorisé, vérifier `_prisma_migrations`, l'accueil, les vitrines,
les défis et les logs `Unique constraint`/`communityId`. Une couleur verte dans
Vercel ne suffit pas à prouver l'application de la migration.

## Validation locale

Aucun test sur Neon ni appel Discord réel.

- Migration appliquée sur Postgres 16 local ; répétition depuis les migrations
  de `main` avec lignes historiques, `default` absente, résumés déjà purgés et
  données d'un autre serveur. Conservation vérifiée, mêmes clés dans deux
  serveurs autorisées, provenance conservée après suppression du parent.
  `prisma migrate diff` : aucun écart.
- `community-domains.integration.test.ts` : 21 scénarios sur deux serveurs,
  membre commun, absence d'appartenance, retrait, suspension et flags OFF.
  Toute tentative réseau est interdite par le test.
- Avec `community-scoped-client.integration.test.ts` : 30 tests passent.
- Mutation temporaire retirant le filtre Prisma : 8 scénarios échouent ; source
  restaurée avec vérification d'empreinte. Le filtre est donc réellement exercé.
- Typage, ESLint et `npx next build` passent. Ne pas utiliser `npm run build`
  contre une base distante : ce script lance aussi les migrations.

Commande de suite complète :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npm run test:postgres
```

Trois échecs sont reproduits aussi sur le checkout intact de `main` :

| Test | Échec observé |
| --- | --- |
| `discord-thread-cleanup.integration.test.ts` — retry 429 | Une livraison est sélectionnée à +5 s alors que le scénario attend aucune livraison. |
| `notification-executor.integration.test.ts` — budget batch | Le batch traite 8 tentatives au lieu d'une. |
| `session-announce.integration.test.ts` — nettoyage pendant retry du SEND | Le scénario obtient `resolver:expired` au lieu de `resolver:dependency_not_ready`. |

Ces résultats ne valident pas la suite complète. Garder la PR en Draft jusqu'à
résolution des échecs et validation des checks distants. Aucun test supprimé ni
assertion affaiblie pour masquer ces échecs.

## Reste avant activation

PR B doit isoler les soldes XP, événements XP, badges/streaks, classements,
admin, rétention et les chemins globaux restants. En particulier :

- Les mises et récompenses utilisent encore le solde global. Cette PR isole les
  lignes métier, pas l'économie XP.
- Le recap ne publie pas de streak global sous isolation. Son total XP est
  provisoirement limité aux sources soirées/sessions instantanées du serveur ;
  il n'est pas exhaustif tant que les événements XP ne sont pas communautaires.
- Aucun webhook global de récompense/recap n'est envoyé pour un serveur non
  `default`. Le routage complet reste à finir.
- La présence instantanée simultanée reste unique par utilisateur, tous serveurs
  confondus ; les catalogues de jeux et de catégories restent globaux.

Ensuite seulement : tests de charge, login Discord `guilds`, réconciliation,
validation sur deux serveurs et bascule des flags dans une étape distincte.
Ne pas lancer `register-discord-commands.mjs --execute` dans cette PR.
