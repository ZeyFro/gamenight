# Point de reprise unique — GameNight — 22 octobre 2026

Cette note décrit l’état du portable 1, vérifié contre `origin/main` (`244eee33509355b258b72ecb3d3e1d3e6730ac26`). Les reprises datées et les bilans des autres machines sont historiques. Le checkout racine est ancien et contient des modifications locales préexistantes : continuer dans un worktree dédié.

## Production

- Le deployment GitHub `7232777326` de `244eee3` est en échec (`Production`, créé par `vercel[bot]`). Son statut `20198731385` demande `npx vercel inspect dpl_Cc5GLnEYNHoWhzCnhB3nEsdSrCL9 --logs`, sans donner la cause. Ce n’est pas un run GitHub Actions; l’API Actions ne fournit pas de jobs pour cet ID.
- Le dernier deployment marqué réussi par GitHub est `7227987255`, SHA `4a7151673da437a2e0f4616ac7b36c7d301229d3`, à 13:57 UTC le 21 octobre. L’alias public `https://gamenight.vercel.app/` répond HTTP 200 avec des marqueurs Next.js. Cela confirme que le domaine est joignable, pas quel SHA l’alias sert.
- Les URLs des deux deployments redirigent vers le SSO Vercel et l’API Vercel répond 403. Le SHA actuellement servi et les journaux détaillés restent invérifiables. Aucun redeploy, rollback, changement de configuration ou accès à la base n’a été effectué.

## PR ouvertes

| PR | SHA actuel | Contrôles | État / condition restante |
|---|---|---|---|
| [#291 XP](https://github.com/ZeyFro/gamenight/pull/291) | `529aa26e2ca4fe5e2f73397bb86613f261035b3a` | CI `verify` et Preview verts sur ce SHA | Draft. Le merge-base avec `main` est `4a715167`; la branche est 18 commits devant et 1 derrière `main` actuel (`244eee3`). GitHub indique aucun conflit, mais il faut synchroniser puis revalider les contrôles sur le nouveau SHA. Le runtime lit `xpBalance`; sa migration n’est pas appliquée ni autorisée en Production. Voir les prérequis ci-dessous. |
| [#303 Vocal](https://github.com/ZeyFro/gamenight/pull/303) | `24548393c0f83e908cb8df2045e7574f852f004f` | [CI `verify` verte](https://github.com/ZeyFro/gamenight/actions/runs/39743648553) et Preview verte sur ce SHA | Draft. Le correctif Gateway publié exclut les événements rejoués et le trou de reconnexion; il n’ajoute pas de coordination durable. La PR inclut une migration vocale et attend les décisions de consentement/rétention. |
| [#316 Recette](https://github.com/ZeyFro/gamenight/pull/316) | `1dce0774c12486c2a8330bea1d2670e0cae6c6ec` | CI `verify` et Vercel verts sur ce SHA | Draft. La revue ne trouve pas de défaut du script. Une recette locale sur `e27741a` a passé six étapes puis Playwright a fermé la page à l’étape 7; 21 échecs en cascade. Aucune trace Edge/Playwright n’a été conservée, donc cause et recette complète restent inconnues. Si #291 passe avant #316, mettre `xpBalance` dans le fixture boutique. |

Les merge-bases de #303 et #316 sont le `main` actuel `244eee3`; ces branches ne sont pas en retard et GitHub ne signale pas de conflit. Sur l’ancien commit vocal `722b053`, avant publication du SHA #303 actuel, les tests locaux ciblés (3 fichiers, 28 tests), ESLint et TypeScript passaient. La preuve actuelle exacte est le CI `39743648553`, terminé avec succès à 08:06 UTC : migrations de base de service, tests PostgreSQL et unitaires, typegen, TypeScript, lint et build.

Les revues indépendantes sont enregistrées sur les SHA actuels de #303 et #316. #291 n’a pas reçu de changement pendant cette reprise. Aucun lot n’a été fusionné ici.

## Éléments locaux et limites de récupération

- La coordination Vercel↔worker avec checkpoints annoncée comme locale hier est absente de #303, de la branche publiée `codex/fixe2-voice-20261020` et des worktrees vocaux accessibles sur le portable. Ne pas la décrire comme récupérée du PC éteint.
- Le dump de répétition XP `gamenight_xp_rehearsal_1792441725052.dump` et son JSON sont absents du portable et de GitHub. Leur hash ne les remplace pas; ils ne sont pas une sauvegarde Production.
- Les preuves de compatibilité XP restent celles déjà acquises : déterminer la destination et les rôles réels, inventorier et drainer tous les writers, restaurer une sauvegarde Production fraîche sur une cible isolée, vérifier le checksum et l’unique migration `20261019190000_separate_xp_balance`, puis disposer d’un plan de repli. Rien de cela n’autorise une bascule dans cette reprise.

## Proposition technique vocale à arbitrer

Le stopper actuel est en mémoire de processus. Proposition pour une coordination future, sans changement d’endpoint : registre durable par session (`desired_state`, revision, `stop_at`, raison, lease, propriétaire et epoch de fencing), contrôle du lease avant toute écriture, curseur Gateway et état des présences commis atomiquement, et clés d’idempotence pour transitions et finalisation.

`markSessionDone` et `cancelSession` inscriraient une commande `STOP` avec cutoff dans leur transaction. Le worker cesserait reconnexions et collecte, finaliserait uniquement les intervalles déjà observés jusqu’à ce cutoff, puis acquitterait la revision. Après crash, un worker reprenant le lease traiterait d’abord le `STOP`; l’ancien worker ne pourrait plus écrire grâce à l’epoch. `RESUMED` reconstruirait l’état sans durée dans le trou. Le stockage des checkpoints personnels et la migration correspondante attendent les choix de consentement, visibilité et rétention. Aucun endpoint, host, flag, cron, migration Production ou collecte réelle n’a été modifié/activé.

## Reprise

1. Pour #316, ne relancer le navigateur que si une trace ou un diagnostic d’environnement permet un scénario isolé précis; le run incomplet n’est pas un succès.
2. Pour identifier le SHA servi en Production et le motif détaillé de l’échec, il faut des métadonnées/logs Vercel accessibles en lecture seule. Ne pas répéter l’appel Vercel refusé; aucune action de déploiement ou de base n’est autorisée.
3. Avant une mise en service vocale, faire approuver séparément le consentement individuel, le périmètre, la visibilité, la rétention, le retrait/suppression, l’hôte du worker et le comportement si celui-ci est indisponible.

## Restrictions actives

Aucune migration Production, interruption de writers, restauration Neon, modification d’endpoint, installation Raspberry, activation de flag/cron, collecte vocale réelle ou notification Discord réelle.
