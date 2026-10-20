# Bascule multi-serveurs et ouverture à The Tower

Complément du 8 octobre : [stabilisation V2, mesures et diagnostics opérateur](STABILISATION_V2.md).
Les builds Preview ne lancent plus de migration ; la procédure de production
est conservée. Aucun flag ni réglage distant n’a été changé par ce chantier.

Ce document est une procédure opérateur, **pas un compte rendu d'activation**.
Constat fourni par le mainteneur le 7 octobre 2026 : The Tower est déjà ACTIVE
via setup et les XP sont distincts, mais les noms, la navigation et les salons
automatiques manquaient. Les valeurs actuelles des flags n’ont pas été consultées
ni modifiées dans ce chantier.
PR A #196, PR B #197 et OAuth #198 sont acquis ; l'application de
`20261006190000_community_progression` en production a été confirmée par le
mainteneur, sans accès à cette base pendant ce chantier. The Tower n'est pas
déclaré prêt sur la seule base des tests simulés ci-dessous.

## Installation automatique et reprise

`/gamenight setup` signé vérifie les droits Gérer le serveur/Administrateur de
l’appelant, acquitte immédiatement la commande avec une réponse différée
éphémère, puis travaille dans `after()` (route 120 s, budget 90 s). Il lit le
vrai nom et l’icône du guild, y compris sur une communauté déjà ACTIVE et sur
default ; la synchronisation quotidienne existante actualise ensuite ces
métadonnées sans changer les slugs, appartenances ou XP.

Avant toute création, le bot doit avoir Gérer les salons, Voir les salons,
Envoyer des messages, Intégrer des liens, Voir l’historique, Gérer les fils,
Créer des fils publics et privés, Envoyer des messages dans les fils.
Le diagnostic liste précisément les droits absents du rôle ou d’un salon
déjà configuré. Aucun rôle Administrateur n’est exigé.
Sources : [création de salons Discord](https://docs.discord.com/developers/resources/guild#create-guild-channel),
[permissions](https://docs.discord.com/developers/topics/permissions),
[réponses différées](https://docs.discord.com/developers/interactions/receiving-and-responding).

L’installation crée la catégorie GameNight puis les salons texte soirées et
tournois avec des overwrites explicites : membres du serveur peuvent voir
l’historique et participer aux fils ; le bot publie et gère les fils. Les
soirées publient leur annonce dans un fil privé non invitable, avec accès du
créateur et des invités actifs seulement (administrateurs/modérateurs Discord
avec Gérer les fils gardent leurs droits). Les tournois utilisent une annonce
et un fil public du serveur. Un non-membre de la communauté ou un non-invité
ne gagne aucun accès applicatif.

Les deux CommunityChannelConfig sont enregistrées séparément et la communauté
est activée après validation des destinations. Relancer sur ACTIVE complète
les manques. Les IDs existants, permissions de salons manuels et configurations
désactivées sont conservés. Pour default, les salons historiques d’environnement
du même guild sont enregistrés sans en créer d’autres ; une config absente de Discord ou incompatible
nécessite sa correction explicite, sans remplacement silencieux.
Sans destination bot valide, une nouvelle soirée/tournoi nondefault est refusée
avant création : aucun repli vers le webhook historique.

Les verrous nommés de la table existante CronLock évitent les installations
concurrentes sans migration : `community-setup:<guild>`, bail 180 s (supérieur
à la durée de route). Les salons créés sont retrouvés par leur topic
`GameNight:<guild>:SESSION|TOURNAMENT` ; une catégorie GameNight unique est
réutilisée. Une catégorie homonyme multiple ou plusieurs topics identiques
sont signalés pour arbitrage.

Une erreur partielle garde les salons/configs acquis. Un 429 ou refus explicite
permet de retenter ; un POST dont le résultat est incertain (timeout, 5xx ou
réponse illisible) conserve le verrou `community-setup-create:<guild>:<slot>`.
Relancer retrouve la ressource visible et reprend sans second POST. Si aucune
ressource n’apparaît, setup explique l’incertitude et reste fermé : un opérateur
doit confirmer l’absence et la fin de la requête précédente avant de supprimer
uniquement ce verrou de création et relancer. C’est une limite de l’API Discord
sans clé d’idempotence, pas une garantie « exactement une fois ».
Aucune intervention de ce type n’a été effectuée ici.

Le sélecteur permanent du header (ordinateur/mobile) montre le vrai nom et
l’icône du serveur choisi. Changer revalide l’appartenance, sauvegarde la
préférence User, invalide le cache des pages et revient à l’accueil ; aucune
déconnexion. Les panneaux chat/notifications repartent avec les données du
serveur choisi. Un serveur accessible unique est choisi automatiquement.

## Implémentation et règles de connexion

Le provider conserve `issuer: "https://discord.com"` et les contrôles Auth.js,
et demande `identify email guilds`. Le callback `signIn` utilise le Bearer du
nouveau compte OAuth, jamais le token du bot, pour
`GET https://discord.com/api/v10/users/@me/guilds?limit=200`.
Il n'appelle plus `/guilds/{guild}/members/{user}` pour chaque communauté.
Une page courte termine le parcours ; une page pleine exige la suivante avec
`after` égal au plus grand snowflake reçu. Exactement 200 résultats exigent donc
une dernière page vide. Budget total 8 s, plafond 25 pages, absence de progression,
doublons, corps invalide, timeout et HTTP non-200 : snapshot rejeté intégralement.
Une réponse HTTP 200 vide valide est distinguée d'une erreur remplacée par `[]`.

La connexion est **fermée par défaut** (S0) : la synchronisation est toujours
exécutée, quelle que soit la valeur de `AUTH_REQUIRE_GUILD_MEMBER`,
`COMMUNITY_ISOLATION_ENABLED` ou `COMMUNITY_PICKER_ENABLED`. Un compte sans
Membership dans une communauté ACTIVE (existant ou nouveau) est refusé ; un
nouveau compte refusé n'est pas créé. `AUTH_REQUIRE_GUILD_MEMBER` est sans
effet (laissée en place, ignorée). Les `discordId` de `ADMIN_DISCORD_IDS`
passent toujours, même si l'API Discord échoue (simple upsert, sans
synchronisation). Une session déjà ouverte reste valable jusqu'à son
expiration : la reconnexion forcée admin (`forceReloginAt`) est une opération
distincte. Les cookies OAuth anciens ne sont pas enrichis lors d'un rendu.
`jwt`, `session` et les pages ne consultent pas Discord pour l'appartenance.
Le cron des profils garde son rôle distinct de rafraîchissement des avatars.

| Situation à la connexion fraîche | Traitement |
| --- | --- |
| Guild connu et communauté ACTIVE | Membership créé MEMBER ; LEFT réactivé ; rôle existant conservé ; `lastVerifiedAt` mis à jour. |
| REMOVED | Jamais réactivé automatiquement, même si le guild est retourné. Intervention administrative distincte requise. |
| Communauté PENDING, LEFT, SUSPENDED ou ARCHIVED | Aucun accès et aucune activation par OAuth. L'activation relève de setup signé avec droits Discord ou de l'admin plateforme. |
| Guild inconnu | Ignoré ; aucune création/activation par OAuth. Installation/provisionnement puis setup sont requis. |
| Départ confirmé par un snapshot complet | Membership ACTIVE de communauté ACTIVE devient LEFT avec date ; préférence invalide supprimée. Retour confirmé : LEFT redevient ACTIVE. |
| Liste complète valide vide | Même règle de départ ; aucun repli vers default. Les communautés suspendues et REMOVED restent intacts. |
| Erreur, scope absent ou page partielle | Nouvelle connexion refusée (admins `ADMIN_DISCORD_IDS` acceptés sans synchronisation) ; aucune mutation Membership ou révocation depuis la liste partielle. Une ancienne session n'est pas révoquée par cette erreur seule. |
| Communauté ACTIVE sans association à un guild | Non autorisable par OAuth ; son ancienne appartenance devient LEFT. Vérifier l'association de default avant le déploiement S0. |
| Aucun serveur autorisé | Tout compte sans serveur autorisé est refusé : jamais vu, retour arrière complet (aucune ligne User) ; existant, les départs validés par l'instantané sont conservés avant le refus. Un admin de `ADMIN_DISCORD_IDS` est accepté sans accès collectif. |
| Plusieurs serveurs, choix absent/invalide | Choix explicite requis ; résolution active vide, aucun repli silencieux vers un autre serveur. Sélecteur OFF conserve la règle historique default/premier Membership valide. |

Profil et Membership sont écrits dans une transaction ; verrou User pour les
connexions concurrentes, unicité existante `(communityId, userId)` et
`skipDuplicates`. Un snapshot antérieur à la dernière vérification Membership
persistée ne remplace pas cette vérification. Cette protection utilise les
lignes existantes : elle ne crée pas de journal global de snapshots vides pour
un utilisateur n'ayant jamais eu de Membership. Discord ne fournit pas de
snapshot transactionnel entre ses pages ; une réponse apparemment valide mais
silencieusement tronquée ne peut pas être détectée sans signal de l'API.

Le départ réel d'un utilisateur Discord est découvert à sa **prochaine connexion
OAuth**, pas instantanément par Gateway : aucun listener de départ utilisateur
n'a été ajouté. Un retrait Membership ou une suspension en base coupe l'accès
à la requête suivante ; le cron guild-sync détecte séparément le départ du bot.
En cas de retrait urgent, utiliser le retrait administratif, sans attendre OAuth.
Les permissions `owner`/`permissions` des guilds OAuth ne deviennent jamais un
rôle admin dans l'application et ne remplacent pas les contrôles de setup.

`seed-reconcile` conserve/crée la ligne default mais ne rattache plus
automatiquement les comptes sans Membership (S0, quels que soient les drapeaux) :
OAuth est la source d'admission, chaque pote est rattaché à sa prochaine connexion.
Les rôles OWNER/ADMIN de communauté ne sont plus attribués automatiquement (le rattachement supprimé était le seul code qui le faisait) : sur une base neuve ou un nouveau serveur, promotion manuelle ; la production garde ses rôles existants.

## Préconditions et sauvegarde — à effectuer réellement par l'opérateur

1. Valider/revoir puis déployer cette PR dans une étape autorisée séparée.
   Les checks GitHub/Vercel seuls ne valident pas les chemins Discord réels.
2. Prendre une sauvegarde restaurable de la base, vérifier son intégrité et
   noter le commit, les migrations appliquées, les flags et la configuration
   des crons. Conserver la procédure de restauration ; aucun rollback SQL de
   migration A/B n'est prévu. Ne jamais redéployer le code antérieur aux clés A/B.
3. Vérifier `_prisma_migrations` (72 migrations acquises), les clés communautaires,
   les statistiques historiques de default, la provenance nullable historique,
   les rôles admin/OWNER et les intentions REWARD existantes. Cette PR n'ajoute
   ni ne modifie de migration et ne demande aucun backfill de progression neuf.
4. Tant que isolation/picker sont OFF et qu'aucun second serveur n'est ACTIVE,
   lancer l'existant `/api/backfill/seed-reconcile`, authentifié Bearer
   `CRON_SECRET`, et attendre son log final (202 lance le travail après réponse).
   Vérifier `Community.slug=default`, status ACTIVE, `discordGuildId` du serveur
   historique correct et `CommunityMemberStats` acquis. Le seed ne crée aucun
   Membership (S0) : vérifier seulement que ceux déjà en base sont intacts. Un
   LEFT/REMOVED déjà présent ne doit pas être écrasé.
5. Préparer un environnement d'essai avec application/bot Discord et base
   **séparés** ; ne pas brancher un bot de production sur des tests. Ne jamais
   considérer un benchmark local ou un build Preview comme un test de production.
6. Conserver les secrets globaux existants : Auth, client OAuth, token du bot,
   clé publique d'application, chiffrement OAuth, `CRON_SECRET`. Ils concernent
   l'installation, pas The Tower ; aucun secret ni variable par guild à ajouter.
   Les variables guild/salons historiques sont un fallback de default seulement.

## Portail Discord, commandes, installation et salons

Ces opérations sont **à vérifier réellement**, aucune exécutée dans cette PR.

1. Dans le Developer Portal, activer l'installation **serveur** (Guild Install),
   avec scopes d'installation `bot` et `applications.commands`. La connexion
   utilisateur demande séparément `identify email guilds` depuis Auth.js.
   Vérifier le redirect exact `https://<hôte>/api/auth/callback/discord` pour
   chaque environnement autorisé ; conserver issuer, PKCE et CSRF.
2. Configurer Interactions Endpoint URL
   `https://<hôte>/api/discord/interactions` et la clé publique globale
   `DISCORD_APP_PUBLIC_KEY`. Le PING signé est acquitté même avec setup OFF ;
   signature absente/invalide doit être refusée. Aucune permission de setup
   ne doit venir de la liste OAuth de guilds.
3. Configurer l'URL d'événements `https://<hôte>/api/discord/webhook-events`
   et l'événement `APPLICATION_AUTHORIZED` ; vérifier signature/PING. Le
   webhook provisionne PENDING avec auto-create ON ; guild-sync le rattrape.
4. Inspecter la simulation `node scripts/register-discord-commands.mjs`.
   L'enregistrement global réel est une opération opérateur séparée : l'option
   `--execute` effectue un PUT remplaçant **toutes** les commandes globales.
   Fusionner/inventorier les éventuelles commandes existantes avant ce PUT.
   Enregistrer une fois `/gamenight setup`, puis vérifier sa disponibilité et
   ses droits Gérer le serveur/Administrateur ; aucun nouvel enregistrement
   n'est nécessaire pour chaque serveur suivant.
5. Installer le même bot sur le serveur d'essai/The Tower via le lien Guild
   Install. Ne pas remplacer `DISCORD_BOT_GUILD_ID` par l'ID The Tower.
   Vérifier l'installation dans le bon guild, webhook ou cron → PENDING.
6. Donner au rôle du bot les permissions listées dans « Installation
   automatique et reprise ». Setup crée les salons texte dédiés et leurs
   overwrites ; aucune préparation manuelle de salons n’est requise.
   Les fils de soirées sont privés ; vérifier leur confidentialité, et les
   permissions effectives/overwrites du serveur. Les salons acceptés par le
   resolver sont les types 0/5 ; préférer un salon texte type 0 et vérifier que
   le parcours de fils requis fonctionne réellement sur le type choisi.
7. Un membre Gérer le serveur/Administrateur lance `/gamenight setup` **après**
   la bascule sécurisée ci-dessous, ou un admin plateforme active PENDING dans
   `/admin?tab=communautes`. Setup active ce guild, pas les autres ; il ne crée
   pas de Membership ni de rôle admin. SUSPENDED/ARCHIVED ne se réactivent pas.
8. La configuration admin des salons existants reste disponible. L'écran
   actuel n'est pas une délégation admin à chaque gestionnaire Discord :
   `/gamenight setup` configure désormais automatiquement les deux salons ;
   l’écran admin sert à conserver ou corriger une destination personnalisée.
   Chaque salon est vérifié à l'installation et à l'envoi ; salon absent,
   mauvais guild ou mauvais type : aucun repli vers default ou un autre serveur.
   L'absence d'UI de suspension/retrait de salon est une limite administrative
   existante, pas une obligation de créer une PR par serveur.

## Ordre de bascule — aucun flag changé dans ce chantier

Planifier une courte fenêtre contrôlée : ces flags sont globaux et leur
activation impacte aussi default. Ne rendre aucun second guild ACTIVE avant
que la frontière d'accès soit opérationnelle.

| Ordre | Action opérateur | Contrôle avant de continuer |
| --- | --- | --- |
| 1 | Déployer le login guilds (porte fermée par défaut) ; sauvegarde et seed ci-dessus. | Login default/OAuth issuers fonctionne ; les comptes historiques ne passent que s'ils sont sur le serveur de la communauté `default` ET que `default.discordGuildId` est renseigné (variable `DISCORD_BOT_GUILD_ID` en Production ET en Preview). |
| 2 | `COMMUNITY_ADMIN_ENABLED=true` ; configurer et vérifier les salons default et ceux du guild d'essai encore PENDING. | L'admin plateforme n'accorde pas un accès collectif à un non-membre ; salons étrangers refusés. |
| 3 | `COMMUNITY_CHANNELS_ENABLED=true`, flags globaux bot SESSION/TOURNAMENT appropriés, `NOTIFICATION_EXECUTOR_ENABLED=true`. | Annonces default dans son guild ; crons authentifiés installés, aucune destination empruntée par un autre guild. |
| 4 | Dans la fenêtre contrôlée, activer `COMMUNITY_ISOLATION_ENABLED=true` et `COMMUNITY_PICKER_ENABLED=true` ensemble. | Membres default rattachés par leur dernière connexion OAuth ; zéro serveur ferme les parcours ; plusieurs serveurs sans choix ne donnent rien. |
| 5 | Utiliser **une seule fois**, après validation des étapes précédentes, le mécanisme existant `forceReloginAt` via Réglages admin/route admin autorisée. | Un ancien JWT est refusé ; nouvelle connexion autorise `guilds`, peuple/revalide les Membership et évite une boucle. Cette action globale peut annoncer la reconnexion sur Discord : opération réelle distincte, non exécutée ici. |
| 6 | Aucune action : la porte est fermée par défaut (S0), `AUTH_REQUIRE_GUILD_MEMBER` est sans effet. | Compte sans guild autorisé refusé, ancien compris ; admin `ADMIN_DISCORD_IDS` accepté sans accès collectif. |
| 7 | `COMMUNITY_AUTO_CREATE_ENABLED=true`, webhook et cron `community-guild-sync`, puis `COMMUNITY_SETUP_COMMAND_ENABLED=true`. | Guilds nouveaux seulement PENDING tant qu'aucun setup/admin autorisé n'a activé ; setup OFF n'agit pas. |
| 8 | Installer ou relancer setup sur The Tower, puis connexions fraîches de la cohorte limitée. | Setup complète ACTIVE sans doublons ; deux serveurs en parallèle satisfont la matrice réelle suivante. |

Les flags MP (`DISCORD_DM_*`) restent des choix globaux séparés ; activer
uniquement les catégories voulues après essai réel. Les guilds/salons The Tower
sont des lignes de configuration, jamais des env nouvelles. Le flag maître
executor et son cron sont nécessaires aux livraisons bot et aux reprises.
Pour default, les gains WEBHOOK acquis conservent leur tentative immédiate
historique ; leurs reprises après interruption/échec exigent le même executor.
Ne pas retirer la configuration du transport WEBHOOK tant que des intentions
WEBHOOK restent en attente, même après activation du bot. Vérifier les reprises
admin REWARD et la purge sans renotification selon le document PR B.

Crons requis : notification-executor chaque minute via cron externe (Vercel
Hobby ne fournit pas cette cadence), community-guild-sync quotidien pour les
installations/départs du bot, refresh-discord-profiles selon la cadence existante.
Conserver les autres crons métier/retention existants et leurs flags ; les
cleanups commencent en dry-run. `CRON_SECRET` absent → 503, non une réussite.
Ne pas ajouter de job cron ni de secret par serveur.

## Essai limité et critère d'ouverture — encore non effectués réellement

Sur une application/bot d'essai séparés d'abord, puis sur la cohorte The Tower
dans une étape opérateur autorisée :

- Comptes zéro, default seulement, The Tower seulement, commun A/B ; choix A
  puis B ; prochains événements, listes, XP/streaks, badges, classements et
  notifications ne mélangent pas les serveurs. Un lien direct exige aussi
  Membership et invitation/créateur ; changer de choix ne donne aucun droit.
- Ancien cookie et `forceReloginAt`, reconnexion fraîche, consentement `guilds`,
  retour sans `iss`, issuer Discord et issuer étranger sur l'environnement
  simulé ; vérifier l'issuer réel Discord sans conserver code/token dans les logs.
- Départ/retour avec **reconnexion OAuth**, retrait REMOVED, suspension et choix
  devenu invalide ; tester aussi le retrait pendant une livraison en attente.
- Installation du bot, commande signée, refus sans Gérer le serveur, salons
  absents/étrangers, confidentialité des fils, mentions/MP et destinations des
  récompenses. Aucune annonce du serveur B ne doit atteindre default.
- Reprise après erreur/timeout/429, pagination, aucune révocation depuis une
  réponse partielle ; tentatives concurrentes, backlog et réservations expirées.
- Réconciliation, fermeture de saison, retention d'abord dry-run, historique
  default intact, purge in-app ne réarme pas un ancien gain.

Noter commit/flags effectifs, comptes et guilds de test, résultats et logs
expurgés. N'ouvrir à toute la communauté qu'après validation et surveillance
du backlog, des erreurs d'accès et de la latence. Aucune garantie de performance
production ne découle du benchmark local ci-dessous.

## Ajouter les serveurs suivants sans développement spécifique

Les prérequis globaux et les commandes étant déjà installés : installer le bot,
laisser webhook/cron créer PENDING, faire setup avec les droits requis (ou
activation admin de secours), laisser setup enregistrer SESSION/TOURNAMENT, puis
faire une connexion fraîche des membres. Choisir le serveur dans le header, vérifier
un événement et sa destination. Aucune PR, migration, variable serveur, liste
d'IDs codée ou nouvel enregistrement global de commande n'est requis.
Un utilisateur déjà connecté doit se reconnecter pour découvrir sa nouvelle
appartenance ; ne déclencher aucune reconnexion globale par ajout de serveur.

## Retour arrière compatible avec les migrations acquises

1. Stopper les nouvelles activations (`COMMUNITY_SETUP_COMMAND_ENABLED=false`
   et auto-create OFF si nécessaire), **conserver isolation et picker ON**.
   Arrêter temporairement executor/crons concernés si un envoi paraît incorrect :
   cela suspend les reprises, ne supprime ni intentions ni crédits.
2. Suspendre uniquement la communauté concernée via une intervention opérateur
   autorisée sur `Community.status=SUSPENDED` ; l'UI actuelle ne propose pas ce
   bouton. Identifier la ligne par son guild configuré, vérifier la cible et
   sauvegarder son statut, puis modifier cette seule ligne dans une transaction.
   Ne pas changer son guild, reparent les données ou supprimer les Membership.
   Setup/OAuth ne doivent pas contourner cette suspension. S0 : suspendre une
   communauté empêche la reconnexion de ses membres sans autre communauté ACTIVE
   (admins exceptés) ; ne jamais suspendre `default`. Les résolveurs
   revalident le statut et les destinataires avant les prochains envois.
3. Corriger la configuration et reprendre sur une cohorte, puis restaurer les
   flags/crons nécessaires et le statut après vérification autorisée. Les flags
   bot OFF/config absente gardent les intentions REWARD en attente ; certains
   autres résolveurs ont des échecs terminaux nécessitant un réessai admin.
4. **Ne jamais éteindre l'isolation pour “revenir au mono-serveur” une fois que
   des données nondefault existent** : le client flags OFF est transparent,
   même si ces communautés sont suspendues. Suspendre seul n'efface pas cette
   fuite potentielle lorsque l'isolation est OFF. Un retour complet aux flags
   OFF exigerait une restauration/quarantaine contrôlée, pas une simple bascule.
5. Aucun DROP, down-migration ni modification des 72 migrations. Un rollback
   de code doit rester compatible A/B et conserver le correctif issuer OAuth ;
   privilégier suspension et correction ciblée. Un restore de sauvegarde est
   une décision DBA séparée, avec perte des données postérieures à traiter.

## Preuves locales et reproduction

Installation automatique (7 octobre 2026) : suite finale `npm run test:postgres`
en série sur la base locale jetable `gamenight_installation_test`,
**2 040 tests, 170 fichiers, 0 échec, 0 ignoré**. Les nouveaux scénarios couvrent
setup ACTIVE/default, noms/icônes et cron suivant, salons historiques/manuels,
permissions effectives, concurrence Postgres, 429, réponse perdue, échec SQL
partiel et bail expiré. Le parcours avec deux guilds simulés exerce les vraies
actions de sélection/création puis l’executor : annonces/fils dans le bon guild,
soirées privées non invitables, invitations isolées, aucun webhook historique.
Tests DOM du sélecteur : sauvegarde avant navigation, état d’attente, refus
d’appartenance et serveur unique. TypeScript, ESLint et `next build` direct
passent avec une DATABASE_URL locale ; aucune migration ajoutée ou de production,
aucune dépendance nouvelle ni appel Discord réel. Les essais physiques sur
ordinateur/mobile et sur Discord restent à réaliser par l’opérateur.

Versions réellement installées et consultées le 7 octobre 2026 : Next
16.3.8, next-auth 5.0.0-beta.32, @auth/core 0.41.3, Prisma 6.19.3,
Vitest 4.1.11 ; Node local 24.19.0, PostgreSQL local 16.15,
`SHOW TimeZone=Europe/Paris`. Aucune dépendance ajoutée ou mise à jour.

Sources officielles vérifiées :
[Discord — guilds et pagination](https://docs.discord.com/developers/resources/user#get-current-user-guilds),
[Discord — OAuth2](https://docs.discord.com/developers/topics/oauth2),
[interactions signées](https://docs.discord.com/developers/interactions/receiving-and-responding),
[commandes](https://docs.discord.com/developers/interactions/application-commands),
[Auth.js — configuration OAuth](https://authjs.dev/guides/configuring-oauth-providers),
[callbacks signIn/JWT](https://authjs.dev/reference/core).
Le callback signIn et le TokenSet ont aussi été inspectés dans la version
installée ; le provider Discord garde PKCE par défaut. Les tests de #198
utilisent toujours le callback réel Auth.js avec token/profil simulés.

Créer une base locale jetable `gamenight_load_rollout`, puis :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_load_rollout node scripts/benchmark-communities.mjs
```

Le script refuse tout hôte autre que 127.0.0.1 et tout nom hors
`gamenight_load_*`, applique les migrations existantes à **cette base seule**,
puis TRUNCATE/seed 100 et 1 000 communautés. Config Vitest dédiée : il ne lance
pas la suite générale. Les seuls HTTP autorisés sont des guilds OAuth fictifs.
Rapport JSON dans le dossier temporaire système ; exemplaire mesuré conservé
dans [COMMUNITY_LOAD_RESULTS.json](COMMUNITY_LOAD_RESULTS.json).

| Volume | Utilisateurs | Membership | Soirées | XP events | Badges gagnés | Notifications |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 communautés | 501 | 502 | 300 | 2 510 | 502 | 200 |
| 1 000 communautés | 5 001 | 5 002 | 3 000 | 25 010 | 5 002 | 2 000 |

Un membre commun à deux communautés et cinq autres membres par serveur.
Les 1 000 communautés sont celles de l'installation, pas 1 000 guilds d'un
utilisateur Discord. Un warmup puis dix lectures, et huit appels concurrents
par parcours ; fonctions applicatives réelles, pas de navigateur/réseau Vercel.
Requêtes = événements SQL émis par Prisma, y compris transactions et joins ;
le batching Prisma peut réduire leur nombre lors de lectures concurrentes.

| Parcours | p50 / p95 ms à 100 | p50 / p95 ms à 1 000 | SQL par lecture | HTTP Discord par lecture |
| --- | ---: | ---: | ---: | ---: |
| Connexion OAuth fraîche simulée | 9,16 / 10,75 | 11,04 / 14,38 | 13 | 1 simulé |
| Résolution de communauté | 1,73 / 4,83 | 3,86 / 6,16 | 3 | 0 |
| Sélecteur | 0,83 / 1,49 | 1,62 / 1,81 | 2 | 0 |
| Accueil (`loadHomeData`) | 38,76 / 86,19 | 93,79 / 189,36 | 96 | 0 |
| Classement global du serveur | 4,79 / 5,90 | 4,93 / 9,30 | 5 | 0 |
| Progression du lecteur | 3,62 / 4,54 | 2,79 / 6,21 | 6 | 0 |
| Liste des soirées accessibles du serveur choisi | 4,38 / 8,10 | 4,06 / 6,79 | 7 | 0 |

À 1 000 communautés, le groupe de huit appels finit en 88,30 / 8,37 / 4,40 /
808,23 / 15,51 / 13,93 / 24,69 ms dans l'ordre du tableau, aucun rejet.
Seed + tous parcours : 2,06 s à 100 et 5,94 s à 1 000 (hors démarrage du runner).
L'accueil reste coûteux (96 SQL), en particulier ses résolutions répétées ;
aucun chantier général d'optimisation n'est inclus. Les comptes de requêtes
restent constants entre volumes, aucune lecture Community sans WHERE détectée.
Le matcher OAuth filtre par guilds de l'utilisateur sur l'index unique
`discordGuildId` ; sélecteur/résolution filtrent les Membership par `userId`
indexé. L'admin et les crons système ont encore des inventaires globaux,
notamment un appel salons par guild pour l'écran admin : ce n'est pas un
travail exécuté à chaque connexion/page/session utilisateur.

Historique antérieur à S0 (mécanisme « guard seed » / porte AUTH seule supprimé,
chiffres non rejoués pour S0). Validation ciblée avant le dernier ajustement du guard seed : 196 tests
auth/isolation/intégration dans 12 fichiers, puis 94 tests de chemins finaux
dans sept fichiers. Après le test isolant spécifiquement la porte AUTH seule,
les suites OAuth et seed/default ont encore passé 26 tests sur deux fichiers.
Ces résultats ciblés ne sont pas additionnés (fichiers/scénarios qui se
recouvrent).

Commande mutations (base jetable d'intégration distincte de la charge) :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_community_rollout node scripts/verify-community-oauth-mutations.mjs
```

Avant l'ajout du guard seed pour la porte AUTH seule, la suite Postgres complète
en série a passé **2 012 tests, 166 fichiers, 0 échec, 0 ignoré**. Elle n'a pas
été rejouée après ce petit changement ; les 26 intégrations ci-dessus ciblent le
comportement affecté. Sur l'état final : TypeScript sans émission, ESLint et
`next build` directs passent ; le build utilise une `DATABASE_URL` locale, sans
migration. Le résultat complet Postgres n'est donc pas revalidé après le guard
seed. Aucun test Neon, configuration réelle, commande Discord `--execute`,
reconnexion globale réelle ou merge effectué ici. Aucun ignoré dans la suite
complète acquise ou les derniers tests ciblés ; les suites Postgres sans
`TEST_DATABASE_URL` restent explicitement skipped.
