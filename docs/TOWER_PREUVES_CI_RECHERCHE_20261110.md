# Revue de validation CI et contraintes Discord — 10 novembre 2026

**Statut : audit de preuves distantes, sans action en Production ni exécution de tests locaux.** Complète [l'audit technique](TOWER_AUDIT_CODE_CIBLE_20261110.md) et le [cahier proposé](TOWER_AUDIT_CDC_PROPOSITION_20261110.md).

## 1. Traçabilité des tests réellement exécutés par GitHub Actions

Sur la tête exacte de PR #419 `6887ef7ee564eaa464918448cbe9b8fdb4621b4e` (branche `codex/neon-test-apply-20261106`) :

| Preuve GitHub | Contrôle | Résultat |
|---|---|---|
| [Run 42803989254](https://github.com/ZeyFro/gamenight/actions/runs/42803989254) | `npm ci`, `prisma generate` | SUCCESS |
| Même run, job `verify` | `prisma migrate deploy` **sur PostgreSQL de service jetable** | SUCCESS |
| Même run | `npm run test:postgres` | SUCCESS |
| Même run | `npm test` (Vitest) | SUCCESS |
| Même run | `npx next typegen`, `npx tsc --noEmit` | SUCCESS |
| Même run | `npm run lint` | SUCCESS |
| Même run | `npx next build` | SUCCESS |
| [Run 42803989024](https://github.com/ZeyFro/gamenight/actions/runs/42803989024) | Migrations existantes intactes | SUCCESS |

Ces résultats sont **des tests distants historiques déjà exécutés**, relus le 10/11 par l'API GitHub Jobs. Ils **ne couvrent pas automatiquement l'état courant de `main`**, ne prouvent aucune fonctionnalité Discord réelle et ne remplacent pas une recette. Durée du job CI sur ce run : 11:01:20 → 11:19:23 UTC, soit **18 min 03 s** de temps calendrier de job, pas 18 minutes garanties pour chaque exécution.

Autres CI récentes constatées :
- #430, tête `707f573c2c56e07fb799f0e40cc0b1c85fb7be10`, CI [42795569335](https://github.com/ZeyFro/gamenight/actions/runs/42795569335) : SUCCESS.
- #431, tête `f01804ac6da647cbd94cf5b81768d556ecffbe5d`, CI [42794348562](https://github.com/ZeyFro/gamenight/actions/runs/42794348562) : SUCCESS.
- `main` `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7` : statut GitHub Vercel `success` du 10/11 ; **ne vaut ni CI globale ni recette fonctionnelle**.

### Limitation de cette session

`git ls-remote https://github.com/ZeyFro/gamenight.git HEAD` depuis l'environnement de test local : **`Could not resolve host: github.com`**. Le connecteur GitHub lit les sources et preuves distantes, mais ne fournit pas un dossier de travail exécutable. Aucun `npm ci`, `npm test` ni `npm run test:postgres` n'a été lancé par cette session. Aucun résultat n'est présenté comme « test local réussi ».

## 2. Recherches externes : règles Discord officielles à réutiliser

Sources vérifiées le 10 novembre 2026 :
- [Discord, Account Caps, Server Caps, and More](https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More), publication 02/03/2026 : limites 500 salons (textes/vocaux/catégories), 250 rôles, 50 catégories, 50 salons/catégorie.
- [Discord, FAQ Intégration à la communauté](https://support.discord.com/hc/fr/articles/11074987197975-FAQ-sur-l-int%C3%A9gration-%C3%A0-la-communaut%C3%A9) : questions permettant d'attribuer rôles/salons ; 7 salons par défaut dont 5 avec `@everyone` pouvant voir et écrire, lors de la configuration mentionnée. **La décision produit actuelle maintient YAGPDB + panneau à 3 boutons, sans onboarding natif** ; l'option native est une **alternative à réévaluer explicitement**, pas une autorisation d'activation.
- [Discord, Server Guide FAQ](https://support.discord.com/hc/en-us/articles/13497665141655-Server-Guide-FAQ) : guide intégré à l'onboarding, remplacement du Welcome Screen dans certains cas ; ne pas modifier sans arbitrage.
- [Discord, Threads FAQ](https://support.discord.com/hc/en-us/articles/4403205878423-Threads-FAQ) : permissions distinctes `Create Private Threads`, `Send Messages in Threads`; ne pas inférer qu'un fil privé est complètement invisible aux administrateurs ni accessible sans droits.
- [Discord, limitation des bots](https://support-dev.discord.com/hc/fr/articles/6223003921559-Mon-bot-est-soumis-%C3%A0-un-nombre-d-actions-limit%C3%A9) : majoritairement 50 requêtes/s globales, mais **limites par route** ; respecter `429`, `retry_after`, `X-RateLimit-*`, utiliser une file d'attente et un budget indépendant pour les actions de création/suppression de salons.
- [Discord, prévention des raids](https://support.discord.com/hc/fr/articles/10989121220631-Comment-prot%C3%A9ger-votre-serveur-contre-les-Raids) : AutoMod, restrictions des mentions de masse, signalements et mesures anti-spam.

## 3. Recommandation d'architecture priorisée, **non encore arbitrée**

| Besoin | Réutiliser avant de coder | Nouveau développement prudent |
|---|---|---|
| Accueil | YAGPDB + panneau 3 boutons déjà codé | Tests vrai nouveau membre / mobile ; ne pas créer un parcours parallèle |
| Jeux | Catalogue de jeux GameNight et forums existants | Filtrage par ID de jeu, tags et parcours recherche/recrutement/projet |
| Équipes | `CommunityTeam` et PR #370/#408/#416 | Quotas de vocaux et règles d'invitation, pas de nouveau modèle d'équipe dupliqué |
| Voix | Gestion de destinations vocales existante et PR #325 | Gestionnaire à la demande avec expiration et réconciliation après crash ; **ne pas confondre avec la suppression des fils de soirées** |
| Textes privés | Fils Discord et messagerie GameNight à comparer | Choix de rétention, droits, limites et traçabilité avant création |
| Modération | AutoMod Discord, Ticket Tool, audit read-only | Tableau de bord des erreurs, salles temporaires, quotas et alertes |
| Scale | 500 salons / 250 rôles officiels | Budget de salons disponibles, limites de création simultanée, file API, mesures sur PostgreSQL jetable |

Ne jamais créer **un rôle par jeu ou un couple de salons permanents par équipe**. La taille maximale des communautés doit être testée par charge simultanée, pas déduite du nombre de membres inscrits.

## 4. Prochaines preuves réellement manquantes

1. Exécuter la CI sur le **SHA exact candidat final** et conserver le lien de run, résultats détaillés des tests et couverture pertinente.
2. Tester avec un vrai membre non-admin : arrivée, YAGPDB, trois forums, liens GameNight, accès privés et mobile.
3. Vérifier l'état réel des commandes enregistrées et des flags, sans création automatique.
4. Valider sur base PostgreSQL jetable la concurrence équipes/défis/quotas, puis observer les interactions Discord autorisées.
5. Réconcilier et approuver les choix privés texte/vocal et la capacité avant codage.
6. Seule une validation écrite de toutes les portes du plan de lancement autorise la qualification de « prêt ».

**Aucune migration, merge, publication Discord, modification Vercel/Neon ni ouverture de PR.**


## 5. Vérification directe des services connectés (lecture seule, 10/11/2026)

- **Vercel** : le déploiement Preview de la tête #419 `6887ef7` est `READY` (déploiement `dpl_57smgrMxrdfWMD6jSTvgPaftar5Z`). Ce résultat concerne le build/déploiement, pas le fonctionnement sur Discord.
- Les nouveaux déploiements Preview associés aux mises à jour documentaires sur `docs/audit-cdc-tower-20261110` montrent plusieurs états `CANCELED` et un premier `READY`. **Ne pas les interpréter comme une panne de Production, ni comme validation de ce cahier** ; vérifier causes/quota si nécessaire.
- **Neon** : branche primaire `production` présente (`ready`), branche `tower-migration-test-20261105` présente (`ready`), sauvegarde `backup-tower-migration-test-20261106` présente (`ready`), branche `tower-restore-rehearsal-20261107` présente (`ready`). La présence d'une branche de répétition **ne certifie pas** la réussite d'un exercice de restauration : exiger journaux de recette, checksum, données et requêtes de vérification.
- Aucun secret ni chaîne de connexion affiché ou modifié. Aucune écriture Neon ou variable Vercel.

## 6. Documentation Prisma relue via Context7

La documentation Prisma décrit les conflits transactionnels et l'erreur `P2034` (write conflict/deadlock) : les transactions sensibles aux écritures concurrentes doivent disposer d'une stratégie de retry bornée et de contraintes d'unicité, en complément des verrous adaptés. **La référence retournée peut couvrir une version Prisma différente** : vérifier exactement l'API de Prisma 6.19.3 avant d'introduire une modification. Ne pas changer les garanties de transactions existantes sans tests PostgreSQL.

Lien : https://www.prisma.io/docs/orm/prisma-client/queries/transactions


## 7. Résultats exacts extraits du journal `verify` #419

Journal du job GitHub `129788374141` (run CI 42803989254) :

- Étape **`npm run test:postgres`** : **415 fichiers réussis sur 415, 3 771 tests réussis sur 3 771**, durée Vitest `855.57s`. PostgreSQL de service GitHub Actions, pas Neon/Production. Tests qui simulent les appels Discord via HTTP : **aucune preuve d'une interaction réelle avec le bot**.
- Étape suivante **`npm test`** : **321 fichiers réussis et 94 ignorés (415 total)** ; **2 553 tests réussis et 1 215 ignorés (3 771 total)**, durée `51.96s`. Les tests PostgreSQL sont ignorés dans cette seconde étape car `TEST_DATABASE_URL` n'y est pas configurée ; ils sont couverts par l'étape précédente.
- Job `verify` conclu **SUCCESS**, entre 11:01:20 et 11:19:23 UTC (18 min 03 s). Étapes typegen, TypeScript, ESLint, build ont toutes conclu SUCCESS.

**Interprétation stricte :** la tête de #419 dispose d'une preuve automatisée importante et récente, **non transférable automatiquement à `main` ni aux neuf autres têtes Draft**. Aucune recette Discord réelle ni preuve de bascule migratoire Production. Les 3 771 tests restent une mesure de quantité, pas une garantie d'exhaustivité fonctionnelle.


## 8. Inventaire Vercel des noms de variables (valeurs NON déchiffrées)

Lecture directe du projet Vercel `gamenight`, `filter_project_envs(decrypt=false)` : **43 entrées** (certaines clés répétées par environnement) ; les noms suivants apparaissent sur la cible `production` : `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `TOWER_DISCORD_GENERAL_CHANNEL_ID`. Présence n'implique pas valeur correcte.

Les **quatre clés suivantes sont absentes de la liste retournée** : `TOWER_CHALLENGES_ENABLED`, `TOWER_ONBOARDING_PANEL_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `TOWER_TEAM_DAILY_ENABLED`. Dans les modules examinés, certaines de ces fonctionnalités exigent explicitement la valeur `"true"` pour s'activer ; elles ne sont **pas démontrées actives par cette configuration Vercel**. Certaines fonctionnalités ont aussi des flags communautaires distincts en base. Ne pas créer de nouvelles variables par défaut, même pour un audit : les portes d'activation et autorisations explicites restent impératives.

La liste Vercel signale également `DATABASE_URL` Preview uniquement sur une branche ciblée `preview-tower`; vérifier le binding réel des déploiements Preview nécessaires avant toute recette. Les valeurs, jetons et secrets n'ont pas été consultés ni copiés. **Cela constitue un contrôle de configuration réel, pas une exécution de fonctionnalité.**
