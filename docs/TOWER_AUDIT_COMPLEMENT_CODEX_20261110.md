# Complément d'audit exécuté — GameNight × The Tower 2.0

Date : 10 novembre 2026. Ce document complète les cinq rapports existants sans les remplacer. **L'audit fonctionnel global reste incomplet ; aucune autorisation de lancement n'est donnée.**

## Périmètre et méthode

- Code audité : `main`, SHA `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7` ; checkout détaché isolé, aucun changement applicatif.
- Branche documentaire : `docs/audit-cdc-tower-20261110`, base `4f4ff892c0f4b96abdf5decdfeb31aba67d51daf`. Publication limitée au présent rapport ; les cinq rapports antérieurs restent intacts.
- Environnement réel : Codex Cloud Linux, **pas le poste Windows**. Node **22.23.4**, npm **10.9.9**, Prisma Client **6.19.3**. Les valeurs de connexion héritées sont retirées des commandes de test et de build. Aucun secret reproduit ici.
- Suite complète sur PostgreSQL **16.15**, puis retests ciblés sur **18.6** : deux conteneurs exclusivement locaux, utilisés successivement sur `127.0.0.1:55439`, données synthétiques. Identité contrôlée avant écriture : base `gamenight_test`, rôle local `postgres`, aucune identité Neon. Durabilité désactivée uniquement sur ces conteneurs jetables pour accélérer les TRUNCATE ; aucune conclusion de performance ou de robustesse Production. Les deux conteneurs de cet audit sont arrêtés après usage, sans suppression ni intervention sur ceux des autres sessions.
- Lecture de `AGENTS.md`, du cahier canonique et des cinq rapports demandés ; consultation de #400 et #432. Les branches #325, #419 et la pile Tower n'ont pas été modifiées. Deux sous-agents ont effectué les seules revues indépendantes dépendances et sources PostgreSQL.

Les statuts **VALIDÉ / ÉCHEC / NON TESTÉ / BLOQUÉ / NON APPLICABLE** portent sur la preuve indiquée, jamais sur le projet entier. Une fonctionnalité présente dans une PR Draft n'est pas une fonctionnalité livrée sur main.

## Exécutions nouvelles sur main

La passe complète PostgreSQL 16 est terminée : **407 fichiers / 3 705 tests réussis, zéro échec, zéro ignoré**, en 558,99 secondes (exit 0). Le build Node 22 est également terminé, exit 0.

| Vérification | Statut | Preuve et limite |
| --- | --- | --- |
| Installation `npm ci` | VALIDÉ | Installation complète de 605 paquets, scripts actifs, génération Prisma effective ; aucun contournement TLS ni `--ignore-scripts`. |
| Prisma Client | VALIDÉ | Postinstall : génération 6.19.3 réussie. |
| `next typegen`, `tsc --noEmit` | VALIDÉ | Deux commandes exit 0 sur le checkout exact. |
| `npm run lint` | VALIDÉ | Exit 0, zéro erreur, **11 avertissements** préexistants ; pas de correction cosmétique dans ce lot documentaire. |
| Historique local des migrations | VALIDÉ | `prisma migrate deploy` terminé avec succès ; **118 terminées, zéro inachevée** contrôlé dans `_prisma_migrations` ; uniquement main, aucune migration Neon. |
| `npm run test:postgres`, Node 22 / PostgreSQL 16 | VALIDÉ | **407 fichiers / 3 705 tests réussis**, zéro échec, zéro ignoré ; exécution sérialisée du runner existant. Les trois échecs historiques ne se reproduisent pas dans cette passe. |
| `npm run build` | VALIDÉ | Prisma generate puis build Next.js **16.4.5**, exit 0 ; URL synthétique locale vers un port fermé, aucune connexion Neon. |
| Inventaire Discord réel | BLOQUÉ | Le secret demandé n'est pas encore lié dans l'environnement actif au dernier contrôle. |

Les journaux bruts de cette exécution restent locaux dans les worktrees isolés (`.audit-artifacts/`), non committés. Les preuves synthétiques publiées ci-dessous évitent les identifiants sensibles et données personnelles.

Le journal Vitest contient le message jsdom préexistant « Not implemented: navigation to another Document », sans échec de test. Les onze warnings ESLint et les alertes npm restent ouverts : un exit 0 des tests/build ne les corrige pas.

### Résultats antérieurs réutilisés, sans les présenter comme de nouveaux tests

Le rapport [d'exécution réelle](TOWER_AUDIT_EXECUTION_REELLE_20261110.md), base documentaire `4f4ff89`, concerne le même SHA main mais un Sandbox Node 24/PostgreSQL 18.6 : build réussi ; 2 488 tests sans DB réussis et 1 214 ignorés ; suite PostgreSQL **3 702 réussis / 3 échecs** sur 3 705. La CI historique de #419 à **3 771/3 771** concerne un autre SHA et ne remplace pas la vérification de main.

La recette anonyme Playwright déjà exécutée sur cinq routes à 360 et 1366 px est réutilisée : accueil sans débordement ni erreur de page ; les quatre routes protégées finissent par rediriger vers l'accueil. Le bouton Discord atteint l'écran OAuth, sans connexion ni callback. Les réponses HTTP initiales 200 ne prouvent pas un accès connecté. Les refus anonymes IGDB/health 401 et Tower admin 403 sont positifs, mais ne prouvent pas les permissions d'un membre connecté.

## PostgreSQL : diagnostic des trois échecs historiques

### Restriction Game / CommunityTeam

Le modèle et la migration existants imposent volontairement `onDelete: Restrict`. Le test `src/lib/community-teams.integration.test.ts` exige précisément le code Prisma `P2003`. Le précédent audit PostgreSQL 18 rapporte `SQLSTATE 23001` sous `PrismaClientUnknownRequestError` : le rejet peut protéger les données tout en échouant à cette assertion. Ne pas retirer la contrainte métier pour faire passer le test.

**Reproduction nouvelle contrôlée** : après arrêt du seul conteneur PostgreSQL 16 de cet audit, un second conteneur jetable PostgreSQL **18.6** est démarré sur le même port local. Même Node 22, même verrou, même Prisma ; identité locale vérifiée et **118 migrations terminées, zéro inachevée**. Les deux fichiers concernés, exécutés ensemble avec un worker, donnent **6 réussis / 1 échec** sur 7 : le seul échec est bien `PrismaClientUnknownRequestError` / SQLSTATE `23001`, contre l'attente `P2003` ; les deux tests de tournoi passent. La suite entière PostgreSQL 18 n'a pas été répétée inutilement.

Une exécution supplémentaire du seul scénario RESTRICT (un échec attendu, quatre tests non sélectionnés) permet de vérifier ensuite l'intégrité de sa fixture : **une équipe conservée et son jeu référencé toujours présent**. La restriction fonctionne dans cette expérience. L'écart observé concerne le contrat d'erreur de cette pile Prisma/PostgreSQL ; cela ne prouve pas un support complet de PostgreSQL 18.

Recommandation conditionnelle si PostgreSQL 18 devient une cible supportée : reconnaître uniquement les représentations documentées de cette violation de contrainte et vérifier après le rejet la conservation du jeu et de l'équipe. Une assertion générique « toute erreur convient » masquerait une panne réseau ou une erreur de requête.

### Tournoi par équipes

Revue des sources : la fixture de `tournament-team-bracket.integration.test.ts` tronque User/Game/Tournament mais conserve `Community`. `getDefaultCommunityId()` réutilise la communauté existante sans réactiver son statut. `declareWinner` exige une appartenance active **et une communauté ACTIVE**. Une communauté `default` suspendue constitue donc une piste falsifiable ; le mélange aléatoire des participants ne suffit pas à expliquer les assertions, qui utilisent les IDs réellement créés.

Aucun fichier prédécesseur laissant cet état à la fin de l'exécution historique n'est prouvé. Le passage isolé antérieur ne démontre ni correction, ni cause de l'intermittence. Aucun contournement de l'autorisation métier n'est proposé.

**Expérience contrôlée réellement exécutée**, après la fin de la suite complète, même PostgreSQL 16 et mêmes sources :

1. La communauté `default` synthétique est mise à `SUSPENDED` dans la base locale seulement. Exécution isolée du fichier avec `--maxWorkers=1` : **deux échecs**, exit 1 ; refus `declareWinner` à la ligne 56 et finale incomplète à la ligne 93.
2. La même communauté est remise à `ACTIVE`. Exactement la même commande : **deux tests réussis**, exit 0.

Cette expérience **valide la sensibilité de la fixture à un état conservé**, pas l'origine historique de cet état ni un défaut de l'autorisation métier. Correctif candidat : fixture explicitant sa communauté ACTIVE et le chemin legacy/null qu'elle souhaite tester, avec contrôle de ses préconditions. Aucun test ni code modifié ici ; aucune correction revendiquée.

## Dépendances de production

**ÉCHEC : `npm audit --omit=dev --json`, exit 1.** Cinq entrées de packages classées high, zéro critical ; **six chemins physiques affectés**, car Zod apparaît deux fois. Six GHSA distincts : quatre high et deux moderate. Les packages Vercel portent des propagations ; ce ne sont pas cinq CVE distinctes.

| Dépendance verrouillée | Constat | Candidat et limite |
| --- | --- | --- |
| Zod direct 4.5.4 | Vulnérable | 4.6.7 corrige l'avis et respecte `^4.5.4`. |
| Zod transitif 4.1.11 | Pin exact de cli-config | Actualisation ordinaire insuffisante. |
| Undici 6.29.0 | Cinq avis, dont trois high | 6.29.1 respecte la plage de Blob et corrige ces avis. |
| `@vercel/cli-config` 0.2.4 | Importe Zod 4.1.11 exact | 0.3.8 utilise Zod corrigé, mais n'est pas dans la résolution actuelle d'OIDC. |
| `@vercel/oidc` 3.8.5 | Propagation Zod | Le dernier 3.x interrogé, 3.8.10, importe encore cli-config 0.3.1 avec Zod 4.1.11. OIDC 4.0.8 sort de la plage du parent. |
| `@vercel/blob` 2.8.0 | Propagations Zod/Undici | Blob 2.9.0 conserve OIDC `^3.6.1` ; ne suffit pas à tout corriger. |

Avis examinés dans les sources officielles GitHub :

- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) : Zod, high, corrigé dès 4.6.6 ; accumulation d'erreurs sur collections énormes. Des tableaux sans borne explicite existent dans les validations d'actions et d'interactions. Surface pertinente, **aucun exploit ni épuisement mémoire exécuté** ; les limites HTTP et l'authentification doivent être prises en compte.
- [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) : Undici, high. Respectivement réponses distantes malveillantes, renégociation TLS et callback TLS personnalisé. Un attaquant contrôlant le pair ou une configuration particulière est nécessaire selon l'avis ; pas de preuve qu'un visiteur GameNight dispose de cette capacité.
- [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) et [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) : Undici, moderate, EventSource et WebSocket ; usages applicatifs de ces API via cet exemplaire non établis.

### Correctif proposé, NON TESTÉ et non installé

1. Zod direct 4.6.7 et Undici 6.29.1 dans une future branche dédiée testée.
2. Pour Zod transitif, attendre une chaîne OIDC 3 corrigée ou évaluer un override **ciblé** `{"overrides":{"@vercel/cli-config":{"zod":"4.6.7"}}}`. Celui-ci remplace volontairement le pin du parent : compatibilité à démontrer, pas une correction déjà validée.
3. Ne pas appliquer automatiquement le downgrade Blob 2.4.0 suggéré par npm, ni imposer OIDC 4 comme une mise à jour compatible. Aucun `npm audit fix`, changement de package/lock ou installation de ces candidats dans cette mission.

Non-régression requise : inspection du verrou et des six chemins `npm ls`, nouvel audit, validations Zod et tableaux bornés, interactions Discord simulées, préférences de profil ; tests galerie/média/banner Blob. Ajouter un transport local contrôlé pour put/get/head/del et erreurs réseau sans écriture Blob Production ; tester cli-config avec HOME temporaire et transport OIDC simulé, sans login réel. Puis TypeScript, ESLint, build et intégrations locales adaptées. Les mocks actuels ne prouvent pas la compatibilité réelle du SDK. Le fetch embarqué dans Node est distinct de l'Undici npm.

## Discord : preuves disponibles et accès manquant

Le propriétaire a choisi la liaison de `DISCORD_BOT_TOKEN` via les paramètres sécurisés Cloud. **Ce choix n'est pas une preuve que le secret est disponible.** Au contrôle effectué, la présence du jeton est fausse et la configuration active n'annonce pas cette liaison. Aucun secret n'a été recherché dans des cookies, déchiffré depuis Vercel ni demandé dans le chat.

Le script `scripts/audit-discord-readonly.mjs` a été relu : trois GET vers Discord uniquement (guilde, rôles, salons), retries bornés. La cible devra être fixée explicitement à **The Tower `553922938101825536`** ; le script accepte sinon un ID fourni par l'environnement, ce qui n'identifie pas automatiquement le bon serveur.

**VALIDÉ localement** : syntaxe `node --check`, refus exit 2 sans identifiants avant tout réseau, puis contrat hors ligne avec fetch simulé : exactement trois GET attendus, agrégats corrects, pas de jeton ni de noms dans stdout. **Aucun appel Discord réel n'a été exécuté.**

Limites du script à ne pas masquer :

- Le compteur de membres demandé est approximatif ; ce n'est pas un décompte exact de membres.
- Les overwrites ne suffisent pas à calculer les permissions effectives : il faut les rôles du membre, les permissions de guilde, les héritages et les exceptions administrateur/propriétaire.
- Les GET téléchargent en mémoire les noms de rôles et salons, même si le script ne les imprime pas. Sa phrase finale « no role/channel names downloaded » est donc imprécise ; ne pas la reprendre comme garantie.
- Ces trois GET ne prouvent ni les commandes disponibles, ni la présence/fonctionnalité de YAGPDB, Atlas ou des bots historiques, ni l'accès d'un joueur/modérateur aux trois forums. Aucun endpoint membres/commandes n'est interrogé.
- Comptages actuels rôles/salons/catégories/vocaux, marges sous 250 rôles/500 salons et visibilité effective : **BLOQUÉ**, valeurs inconnues. Les 197 rôles historiques d'octobre ne sont pas un relevé actuel.

Action d'accès indispensable : lier le jeton existant dans les paramètres sécurisés de l'environnement actif, sans valeur dans GitHub ou le chat. L'accès du bot ne remplace pas des comptes de recette autorisés ; aucune utilisation d'un compte réel à son insu.

## Parcours réels et scénarios préparés

| Parcours | Preuve acquise | Étape restant à exécuter |
| --- | --- | --- |
| Arrivée / OAuth Discord | Navigation anonyme antérieure jusqu'à l'autorisation OAuth | BLOQUÉ : compte nouveau joueur autorisé, callback et rôles initiaux ; pas de connexion réelle effectuée. |
| Jeux / recherche de joueurs | Sources/tests existants, pages protégées refusées à l'anonyme | BLOQUÉ : session de recette ; contrôler filtres, résultats et accès en lecture sans créer d'annonce. |
| Recrutement / équipe | Tests synthétiques et code de la pile Draft | BLOQUÉ : intégration non livrée et compte de recette ; création/adhésion sur vraie guilde non autorisée dans cet audit. |
| Défis solo/collectifs | Couverture locale, compléments en PR Draft | NON TESTÉ en réel : sélectionner un défi existant en lecture ; soumission/attribution sur vrai serveur interdites. |
| Preuves / votes / contestations / récompenses | Tests locaux uniquement | BLOQUÉ : comptes distincts et recette isolée ; aucune preuve, vote, décision ni récompense réels créés. |
| Joueur / modérateur / groupes privés | Revue des gardes, pas de permissions effectives Discord | BLOQUÉ : comptes consentants aux rôles connus ; comparer visibilité et refus croisés sans publier leur identité. |
| Mobile / ordinateur | Recette anonyme existante 360/1366 px ; correctif tactile #430 testé mais Draft | NON TESTÉ connecté sur main ; ne pas assimiler #430 à une correction déjà fusionnée. |

Les scénarios qui créent des données ou modifient Discord nécessiteront une recette isolée et une autorisation distincte. Le présent audit prépare leurs préconditions, pas leur exécution réelle.

## Correspondance aux 17 critères canoniques (§25)

Ce tableau ne chiffre pas un pourcentage artificiel d'achèvement. « Partiel » décrit le code ; le statut décrit sa preuve.

| N° | Critère | État et preuve manquante |
| --- | --- | --- |
| 1 | Identité visuelle et navigation du serveur | BLOQUÉ : serveur réel non inventorié ; pages web anonymes seules vérifiées. |
| 2 | Accueil d'un véritable nouveau membre | BLOQUÉ : aucun compte de recette connecté ni arrivée réelle. |
| 3 | Réemploi tickets/rôles/modération historiques | BLOQUÉ : configuration et fonctionnement des bots non observés. |
| 4 | Cohérence grades et permissions | BLOQUÉ : permissions effectives non calculées ni testées par rôle. |
| 5 | Ascension sans double progression | Partiel ; BLOQUÉ pour preuve réelle. Revue antérieure : affichage main encore lié à XP et règles nouvelles en pile ; Atlas non contrôlé. |
| 6 | Retrait contrôlé des anciens rôles Etage | BLOQUÉ : aucune migration Discord autorisée/exécutée ; ne pas supprimer de rôles pour l'audit. |
| 7 | Défis solo et collectifs | Partiel sur main et PR Draft ; NON TESTÉ sur vrai serveur. |
| 8 | Preuves, votes et contestations | Partiel ; #406/#407 non livrées ; NON TESTÉ opérationnellement. Appliquer les décisions ultérieures approuvées, pas l'exigence retirée d'exclusion des comptes de test. |
| 9 | Quotas et anti-abus testés | Tests locaux disponibles ; NON TESTÉ en charge/distribué. Limiteurs Map locaux signalés par l'audit précédent, pas preuve d'un quota global. |
| 10 | Équipes et forums opérationnels | Partiel en #370/#408/#416 ; BLOQUÉ pour forums, permissions et commandes réels. |
| 11 | Soirées et événements GameNight intégrés | Code/tests présents ; NON TESTÉ via Discord réel. |
| 12 | Classements, saisons et récompenses | Partiel ; Hall of Fame absent selon revue antérieure ; recette et remise réelles NON TESTÉES. |
| 13 | Catalogue/calendrier première saison | Partiel ; BLOQUÉ pour validation du contenu/configuration effectivement actifs. |
| 14 | Données et permissions protégées | ÉCHEC de l'audit dépendances ; gardes positifs constatés mais permissions Discord BLOQUÉES. Pas de certification de sécurité globale. |
| 15 | Déploiements vérifiés sur Discord | BLOQUÉ : déploiement READY ou CI verte ne prouve pas l'exécution Discord. |
| 16 | Facultatif non développé identifié | VALIDÉ documentaire pour ce rapport : IA payante désactivée, fonctionnalités futures distinguées du périmètre approuvé. |
| 17 | Aucun faux avancement présenté comme livré | VALIDÉ pour la présentation de ce rapport ; ce n'est pas une validation globale du produit. |

Les propositions nouvelles du document `TOWER_AUDIT_CDC_PROPOSITION_20261110.md` (notamment extensions de groupes privés/vocaux) ne deviennent pas des exigences approuvées par leur simple rédaction. **NON APPLICABLE** comme critère obligatoire nouveau tant qu'elles ne sont pas approuvées. Leurs fonctionnalités absentes ne doivent pas être confondues avec une régression du cahier canonique.

## Priorités et limites de livraison

1. Reproductions PostgreSQL ci-dessus : distinguer erreur de contrat Prisma, fixture sensible et véritable défaut métier avant tout correctif. Ne pas annoncer les trois échecs historiques corrigés.
2. Réduire les alertes Zod/Undici via une modification ciblée testée ; aucune compatibilité de l'override n'est acquise.
3. Débloquer l'inventaire Discord en lecture et les comptes de recette, puis examiner réellement permissions, forums, bots et absence de double progression. Un token seul ne valide pas les parcours humains.
4. Reprendre les risques P1 déjà documentés sans les réauditer artificiellement : limites locales non distribuées, recherche IGDB sans quota/cache de résultats, fraîcheur du webhook APPLICATION_AUTHORIZED à définir en respectant les retries officiels. Ce sont des constats de source, pas des exploits exécutés.
5. Intégrer les PR existantes seulement après décisions autorisées et validations de leurs SHA exacts. Dix PR ouvertes au contrôle : aucune nouvelle PR créée pour ce rapport.

**NON TESTÉ** : charge 500/2 000/10 000 utilisateurs, parcours authentifiés, exploitation des vulnérabilités, restauration et migrations Neon. **NON APPLICABLE / hors autorisation** : API payante, fusion/Ready, modification Production, modification Discord et protections du poste Windows. Aucune de ces opérations n'a été effectuée.

Le seul livrable de cette tâche est documentaire ; aucun code applicatif, dépendance, migration ou configuration distante n'a été changé. Les interventions humaines restantes sont la liaison sécurisée du bot, les accès de recette consentis et les décisions d'intégration/opérations sensibles. **Ne pas fermer #432 ni annoncer un GO à partir de ce rapport.**

## Reproductibilité des preuves nouvelles

Les commandes suivantes ont réellement été exécutées sur le checkout main indiqué, avec Node 22 et les variables distantes retirées du processus. Les URL ne sont volontairement pas reproduites ; chaque test DB recevait exclusivement l'URL synthétique locale préalablement contrôlée.

```text
npm ci                                            exit 0
npx next typegen                                  exit 0
npx tsc --noEmit                                  exit 0
npm run lint                                      exit 0 ; 11 warnings
npx prisma migrate deploy                         exit 0 ; 118/118, PostgreSQL 16
npm run test:postgres                             exit 0 ; 3705/3705, PostgreSQL 16
npx vitest run src/lib/tournament-team-bracket.integration.test.ts --maxWorkers=1
  communauté synthétique SUSPENDED                 exit 1 ; 0 pass / 2 fail
  même communauté ACTIVE                          exit 0 ; 2 pass / 0 fail
npm run build                                     exit 0
npx prisma migrate deploy                         exit 0 ; 118/118, PostgreSQL 18
npx vitest run src/lib/community-teams.integration.test.ts src/lib/tournament-team-bracket.integration.test.ts --maxWorkers=1
                                                   exit 1 ; 6 pass / 1 fail
npx vitest run src/lib/community-teams.integration.test.ts --maxWorkers=1 -t 'prevents deleting a game'
                                                   exit 1 ; 1 fail / 4 non sélectionnés
npm audit --omit=dev --json                        exit 1 ; 5 packages high
node --check scripts/audit-discord-readonly.mjs      exit 0
contrat Discord hors ligne, fetch simulé            exit 0 ; 3 GET attendus
script Discord sans identifiants                    exit 2 ; refus avant réseau
```

Les échecs provoqués dans les expériences locales ne sont pas cachés ni additionnés à la passe complète verte. Aucun correctif applicatif n'a été tenté et aucune CI distante n'a été revendiquée pour ce commit documentaire.
