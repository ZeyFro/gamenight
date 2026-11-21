# Runbook : que faire quand ça se passe mal

> Pour Maxime (propriétaire, non-développeur). **Document de procédure en lecture seule** : il n'a modifié ni Vercel, ni Neon, ni Discord, ni les réglages GitHub. Rien n'est exécuté tant que tu ne le fais pas toi-même, à la main.
>
> Les noms de boutons viennent des documentations officielles et des documents du dépôt ; **les écrans peuvent avoir changé de libellé**. Si un bouton n'a pas exactement ce nom, cherche le plus proche et arrête-toi au moindre doute.
>
> **Ne colle jamais un jeton, un mot de passe, une URL de base de données ou `CRON_SECRET` dans un chat, un ticket, un e-mail ou un fichier du dépôt.** Aucune étape de ce document ne te demande de le faire.

Documents liés : [MIGRATIONS.md](MIGRATIONS.md) (migrations et restauration), [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md) (retours arrière de la soirée d'activation), [PHASE_TEST.md](PHASE_TEST.md) (retour arrière groupe par groupe), [CRONS.md](CRONS.md), [SUPPRESSION_COMPTE.md](SUPPRESSION_COMPTE.md), [CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md).

## Repères à connaître

| Quoi | Où | Piège |
| --- | --- | --- |
| **Production (base)** | Neon : projet `gamenight` (`misty-tooth-45335023`), branche `production` | C'est la **vraie** base. Vérifie le nom de la branche avant tout geste |
| **Bases de test** | Neon : projet `winter-scene-14323342` et branches `tower-migration-test-*` | Ne jamais confondre avec la production |
| **Site** | Vercel : projet `gamenight`, plan **Hobby** | Chaque fusion dans `main` **redéploie la production**, même une PR de documentation |
| **Journaux Vercel** | Projet → **Logs** | Plan Hobby : **1 h seulement**. Capture ce qui t'intéresse avant d'agir |
| **Interrupteurs (drapeaux)** | Vercel → Settings → Environment Variables | Actif **seulement** si la valeur est exactement `true` (minuscules, sans guillemets) |
| **Migrations** | GitHub → Actions → « Migrations Production » | Appliquées automatiquement après fusion dans `main`, jamais au build ; elles ne se défont pas ([MIGRATIONS.md](MIGRATIONS.md)) |
| **Santé du site** | `GET /api/health` | Protégé par `Authorization: Bearer <CRON_SECRET>` : ne jamais le tester depuis un service qui affiche ou journalise l'en-tête |

---

## A. Règle d'or et arbre de décision

### La règle d'or

1. **Choisis la plus petite action qui arrête le dégât**, dans cet ordre de prudence :
   1. couper **un interrupteur** (section B) : réversible, ne touche à aucune donnée ;
   2. revenir au **déploiement précédent** (section C) : réversible, ne touche pas à la base ;
   3. **restaurer la base** (section D) : dernier recours, efface aussi ce que les joueurs ont fait depuis.
2. **Une seule action à la fois**, puis vérifie avant d'en faire une autre.
3. **Ne supprime rien** (défis, étages, preuves, rôles, salons, messages, lignes en base) pour « réparer » : défais dans l'ordre inverse de ce qui a été fait.
4. **Note l'heure** de chaque geste (section I). Les journaux Vercel ne remontent qu'à 1 h : si le dégât est contenu, fais une capture d'écran des erreurs **avant** d'agir.
5. Au moindre doute sur une écriture dans la base ou sur Discord : **ne fais rien de plus** et contacte le développeur (section H).

### Arbre de décision : symptôme, puis action la plus prudente

| Ce que tu vois | Action la plus prudente | Section |
| --- | --- | --- |
| Le bot envoie des messages ou des MP **en boucle** (spam), doublons d'annonces | Couper `NOTIFICATION_EXECUTOR_ENABLED`, puis redéployer | B, F |
| Le bot est **muet** (plus d'annonces ni de MP) | Ne rien couper : lire F pour diagnostiquer | F |
| Un membre voit des données **d'une autre communauté**, ou une récompense est **attribuée deux fois** | Couper l'accès Tower **sans redéploiement** par la requête de retour arrière de [SOIREE_ACTIVATION.md § 2.4](SOIREE_ACTIVATION.md), puis couper `TOWER_CHALLENGES_ENABLED` | B |
| Une **fonction précise** plante (une page, une commande) juste après avoir allumé un interrupteur | Couper cet interrupteur et redéployer | B |
| **Tout le site** plante juste après une fusion dans `main` | 1. Regarder si « Migrations Production » est rouge ou en attente (E). 2. Sinon, revenir au déploiement précédent | E, C |
| Le run **« Migrations Production » est rouge** | **STOP** : ne fusionne rien, ne redéploie pas, lis le journal | E |
| Le build Vercel est rouge après une fusion | Rien à faire en urgence : l'ancien déploiement reste servi. Regarde le journal du build, puis contacte le développeur | C, H |
| Les pages légales affichent une information fausse | Couper `LEGAL_PAGES_ENABLED` seulement si l'erreur est grave (sinon corriger la valeur) | B |
| Un compte a été supprimé par erreur | **Irréversible** côté application (anonymisation). Ne pas restaurer la base sans décision explicite : voir D | D, [SUPPRESSION_COMPTE.md](SUPPRESSION_COMPTE.md) |
| Données perdues, corrompues ou effacées en base | **STOP**, n'écris plus rien, crée une branche de sauvegarde (D, étape 2), contacte le développeur | D, H |
| Un secret a été **publié** (chat, ticket, dépôt, capture) | Considère-le comme compromis : tourne-le tout de suite | G |
| Site inaccessible, sans erreur de ton côté | Regarde les pages d'état de Vercel, Neon et Discord avant de toucher à quoi que ce soit | H |
| Tu ne sais pas | Ne touche à rien d'irréversible. Note ce que tu vois, contacte le développeur | H, I |

---

## B. Couper un interrupteur (drapeau)

Un interrupteur est une variable Vercel. **Elle est active seulement si sa valeur est exactement `true`.** Supprimer la variable, ou mettre `false` (ou toute autre valeur), la coupe. **Le changement ne s'applique qu'après un redéploiement.**

### Pas à pas

1. [vercel.com](https://vercel.com) → ton équipe → le projet `gamenight` → **Settings** → **Environment Variables**.
2. Trouve la variable (barre de recherche en haut de la liste), ligne de l'environnement **Production**.
3. Ouvre son menu `⋯` puis **Edit** : mets `false` et enregistre. Ou **Remove** pour la supprimer. Si la variable est « Sensitive », sa valeur ne se relit pas : tu peux seulement la remplacer ou la supprimer.
4. **Deployments** (barre latérale) → ligne du déploiement de **Production** le plus récent (étiquette Production, statut Ready) → menu `⋯` → **Redeploy** → confirme.
5. Attends le statut **Ready**.
6. **Vérifie** : l'effet attendu (colonne « Effet » ci-dessous) est visible, et **Logs** (filtre Production, niveau Error) ne montre pas de nouvelle erreur.
7. Note l'heure et le nom de la variable (section I).

Un retour de la variable à `true` rallume la fonction après un nouveau redéploiement. Les données créées entre-temps restent en base.

### Interrupteurs de lancement

| Interrupteur | Effet quand tu le coupes | À savoir avant de le couper |
| --- | --- | --- |
| `TOWER_CHALLENGES_ENABLED` | Coupe tout le parcours des défis : `/tower`, `/ascension`, commandes `/tower`, et la clôture automatique des défis | Défis, étages, preuves et votes **restent en base**. Les annonces de preuves et les votes Discord dépendent aussi de lui. Coupure la plus rapide **sans redéploiement** : requête de [SOIREE_ACTIVATION.md § 2.4](SOIREE_ACTIVATION.md) |
| `TOWER_DISCORD_ANNOUNCE_ENABLED` | Plus d'annonces de preuves ni de réussites dans les salons Discord ; les votes par boutons s'arrêtent aussi | Les défis continuent dans l'application. Un message déjà publié se supprime à la main |
| `ACCOUNT_DELETION_ENABLED` | La page `/profil/compte`, l'export et l'action de suppression répondent **404** | Les suppressions **déjà faites** restent irréversibles (anonymisation) |
| `SKIP_LINK_ENABLED` | Le lien d'évitement clavier « Aller au contenu » disparaît | Sans risque : il s'agit d'accessibilité. Le couper dégrade seulement la navigation au clavier |
| `LEGAL_PAGES_ENABLED` | `/mentions-legales`, `/confidentialite` et `/conditions` répondent 404 et leurs liens disparaissent | **À éviter une fois le site public** : un site sans mentions légales est non conforme. Couper seulement pour corriger un contenu erroné, puis rallumer vite |
| `NOTIFICATION_EXECUTOR_ENABLED` | **Plus aucune écriture Discord** : MP, annonces, fils, salons, rôles. La file s'accumule sans rien envoyer | Les réponses directes aux commandes Discord ne passent pas par la file. Au rallumage, **les envois en attente peuvent partir d'un coup** : vérifie l'état de la file avec le développeur avant de rallumer |
| `DISCORD_COMMAND_REGISTRATION_ENABLED` | La route d'enregistrement des commandes répond 404 | **Doit rester éteint** hors du moment où tu enregistres les commandes ([SOIREE_ACTIVATION.md § 9 sexies](SOIREE_ACTIVATION.md)). Le couper n'enlève pas les commandes déjà enregistrées (retrait à la main : Paramètres du serveur Discord → Intégrations). Supprime aussi `DISCORD_COMMAND_REGISTRATION_SECRET` |
| `TOWER_TEAM_DAILY_ENABLED` | Plus de défi d'équipe quotidien attribué (18:00 Europe/Paris) | Il existe **à deux endroits** : variable Vercel **et** variable GitHub Actions du même nom (GitHub → Settings → Secrets and variables → Actions → Variables). Mettre la variable **GitHub** à `false` arrête l'appel **immédiatement, sans redéploiement** ([SOIREE_ACTIVATION.md § 5.4](SOIREE_ACTIVATION.md)). Les attributions déjà faites sont conservées |

Pour les autres interrupteurs (équipes, soirées, boosters, profils…), le retour arrière de chaque groupe est dans [PHASE_TEST.md](PHASE_TEST.md). Une valeur « sensible » ou absente n'est pas lisible dans Vercel : compte sur l'effet constaté, pas sur la valeur.

---

## C. Revenir au déploiement précédent sur Vercel

À utiliser quand le **code** déployé pose problème (erreurs sur tout le site après une fusion, page blanche) et que couper un interrupteur ne suffit pas.

> **Ce que ça ne fait pas : ça ne revient pas en arrière sur la base de données.** Une migration déjà appliquée reste appliquée. Le code précédent tourne alors sur le schéma récent : c'est en général sûr tant que les migrations sont additives ([MIGRATIONS.md](MIGRATIONS.md)), mais demande au développeur au moindre doute.
>
> **Les variables d'environnement ne changent pas** : un interrupteur allumé reste allumé après le retour arrière.

1. Vercel → projet `gamenight` → **Deployments**.
2. Repère le dernier déploiement **Production** qui était bon : statut **Ready**, avant l'heure du problème. Note son identifiant et son commit.
3. Méthode rapide : onglet **Overview** → tuile « Production Deployment » → **Instant Rollback** → choisis le déploiement → **Confirm Rollback**. Autre méthode : sur la ligne de l'ancien déploiement, menu `⋯` → **Promote to Production**.
4. **Vérifie** : l'application répond, la page de connexion s'affiche, **Logs** ne montre plus l'erreur.
5. **Conséquence à connaître** : après un retour arrière, Vercel **arrête d'attribuer automatiquement le domaine de production aux nouveaux déploiements**. Les prochaines fusions dans `main` ne seront **pas mises en ligne** tant que tu n'as pas promu un déploiement à la main (**Promote to Production**). Sur le plan **Hobby**, seul le déploiement immédiatement précédent est peut-être proposé : à vérifier à l'écran.
6. **Ne fusionne plus aucune PR** tant que la cause n'est pas comprise : chaque fusion redéploie.
7. Note l'heure, le déploiement quitté et celui choisi (section I).

---

## D. Restauration Neon par point dans le temps (dernier recours)

À utiliser **seulement** si des **données** sont perdues ou corrompues et que ni un interrupteur ni un retour de déploiement ne règle le problème.

> **Une restauration efface aussi tout ce que les joueurs ont écrit après l'heure choisie** (soirées, votes, XP, preuves). Elle ne se fait **jamais sur la branche `production` sans une décision explicite de ta part**, prise après avoir lu la section « Limites ». En cas d'incident vraiment grave, demande d'abord conseil au développeur et, si besoin, au support Neon (section H).
>
> La restauration instantanée **n'est pas** « Reset from parent » : ce dernier remplace une branche par l'état **courant** de son parent et ne permet pas de revenir en arrière.

### Avant : vérifier ce que ton plan permet

La durée de l'historique restaurable **dépend du plan Neon** et n'est pas vérifiable depuis le dépôt. Lis-la maintenant, pas pendant l'incident : console Neon → projet `gamenight` → réglages du projet (section restauration / conservation de l'historique). Note-la ici : **fenêtre = ______ (lue le __/__/____)**. Au-delà, l'instant voulu n'est plus restaurable.

### Pas à pas

1. **Arrête les écritures si tu le peux** : coupe l'interrupteur à l'origine du dégât (section B) pour ne pas aggraver. Note l'**heure UTC voulue** `T` (juste avant l'incident). Pour une migration, l'heure est dans le résumé du run « Migrations Production », section « Point de restauration Neon ».
2. **Crée d'abord une branche de sauvegarde, toujours.** [console.neon.tech](https://console.neon.tech) → projet **`gamenight`** (identifiant `misty-tooth-45335023`) → **Branches** → branche **`production`** → **Create branch** → depuis l'état **actuel**, nom `sauvegarde-avant-restauration-AAAAMMJJ-HHMM`. Ne supprime **jamais** les branches de sauvegarde existantes (par exemple `backup-avant-tower-migrations-20261030`). Neon peut aussi créer une branche de sauvegarde automatiquement : ne t'y fie pas.
3. **Répète sans risque** : crée une **seconde** branche depuis `production` à l'instant `T`, ouvre-la en lecture (éditeur SQL de cette branche), vérifie qu'elle contient les données attendues (par exemple compte des lignes d'une table connue). La procédure de comparaison est dans [MIGRATIONS.md](MIGRATIONS.md), section « Vérification de restauration Neon ».
4. **Décide, par écrit** : « je restaure `production` à `T` » (ou non). Écris l'heure de la décision. Si tu hésites, **ne restaure pas**.
5. **Restaure** (seulement si décidé) : console Neon → **Branches** → `production` → **Restore** → choisis l'instant `T` → vérifie bien le nom de la branche et l'heure → confirme.
6. **Vérifie** : le site s'ouvre, une page connue affiche des données cohérentes, **Logs** ne montre pas d'erreur de base.
7. **Après** : l'état des **migrations** revient lui aussi en arrière. Ne relance **aucun** run « Migrations Production » et ne fusionne rien avant d'en avoir parlé au développeur : une migration déjà appliquée peut se retrouver « non appliquée » alors que le code la suppose présente.
8. Garde la branche de sauvegarde tant que tu n'es pas certain que tout va bien. Son sort est ta décision.
9. Note tout (section I).

### Limites

- Une restauration est un **dernier recours** : une migration additive qui échoue est déjà annulée par PostgreSQL, sans restauration ([MIGRATIONS.md](MIGRATIONS.md)).
- Si une personne a demandé la suppression de son compte puis que tu restaures à une date antérieure, elle **réapparaît** : il faudra rejouer sa suppression ([SUPPRESSION_COMPTE.md](SUPPRESSION_COMPTE.md)).
- Les messages Discord, rôles et salons déjà créés ne sont **pas** restaurés : ils ne sont pas dans la base.

---

## E. La migration automatique échoue

Le workflow **« Migrations Production »** (GitHub → **Actions**) se lance après une fusion dans `main` qui touche `prisma/migrations/**` ou `prisma/schema.prisma`. Il demande d'abord **ton approbation** (environnement `production-migrations`) : un run « en attente d'approbation » n'est **pas** un échec, mais le site tourne alors sur l'ancien schéma pendant l'attente ([MIGRATIONS.md](MIGRATIONS.md)).

### Si le run est rouge : STOP

1. **Ne fusionne aucune autre PR.** Chaque fusion redéploie la production.
2. **Ne redéploie pas à la main** (pas de **Redeploy**, pas de relance du run) : tu risquerais de mettre en ligne du code qui attend une migration absente, ou de rejouer une migration à moitié connue.
3. **Ne touche à rien dans Neon.**
4. Ouvre le run rouge : lis l'étape en échec et le **résumé du run** (il contient une section « Consignes en cas d'échec »). Fais une capture d'écran.
5. **Note l'heure UTC** du résumé « Point de restauration Neon ».
6. Regarde si le site fonctionne (page de connexion, une page de membre). S'il plante à cause d'une colonne manquante (erreur du type `P2022` dans les logs), fais la section C (déploiement précédent) **et** préviens le développeur.
7. **Contacte le développeur** (section H) avec : le lien du run, la capture, l'heure. Ne lui envoie **aucune URL de base de données**.

### Ce qu'on sait, et ce qui est à vérifier

- PostgreSQL exécute le SQL d'une migration dans une **transaction** : un échec **ne devrait laisser aucun changement partiel** dans la base (d'après [MIGRATIONS.md](MIGRATIONS.md)). **À vérifier par le développeur** avant d'agir : ne le tiens pas pour acquis.
- Prisma marque la migration **« échouée »** et **refuse les migrations suivantes** (erreur `P3009`) tant qu'elle n'est pas résolue. C'est une opération de développeur : on ne modifie **jamais** une migration existante, on en crée une **nouvelle**, additive.
- Si la garde de build est en application stricte (`MIGRATION_GATE_ENFORCE=true`), le build Production d'une PR dont la migration manque **échoue volontairement** et l'ancien déploiement reste servi. C'est le comportement voulu, pas une panne.

---

## F. Incident Discord : bot muet ou spam

### Spam, doublons, messages en boucle

1. **Coupe tout de suite** `NOTIFICATION_EXECUTOR_ENABLED` (section B) et redéploie. Plus aucune écriture Discord ne part.
2. Note ce qui a été publié (salon, heure, nombre) avec des captures.
3. **Supprime à la main** sur Discord les messages erronés ; le code ne les supprime jamais. Ne rejoue pas la file.
4. Ne rallume pas avant d'avoir compris la cause avec le développeur (section H) : au rallumage, les envois encore en file peuvent partir.

### Bot muet

1. Regarde si Discord a une panne : [discordstatus.com](https://discordstatus.com).
2. Vercel → **Logs** (dernière heure) : filtre **Request Path** = `/api/cron/notification-executor`. Des appels récents en **200 ou 202** = l'executor tourne. Aucun appel = le cron externe (cron-job.org ou équivalent) ne tourne pas : vérifie qu'il est actif ([CRONS.md](CRONS.md), les cadences sont hors dépôt).
3. Si la réponse contient `enabled:false` : `NOTIFICATION_EXECUTOR_ENABLED` n'est pas à `true` en Production.
4. Une erreur Discord `50013` (permission manquante) : voir « Droits minimaux de GameNight » dans [PHASE_TEST.md](PHASE_TEST.md). Ne relance pas en boucle (limite de débit 429).
5. Si `/admin/tableau-de-bord` est disponible (`ADMIN_DASHBOARD_V2_ENABLED=true`) : regarde les « opérations Discord échouées ».
6. Sans cause claire : contacte le développeur (section H).

---

## G. Fuite de secret : rotation

**Principe : un secret qui a été vu par quelqu'un qui ne devait pas le voir est compromis, même s'il a été supprimé ensuite** (un message ou un commit supprimé reste lisible dans l'historique et les copies). On le **remplace**, on ne se contente pas de le cacher. Ne colle jamais la nouvelle valeur ailleurs que dans le champ prévu de Vercel (ou de GitHub).

### Jeton du bot Discord (`DISCORD_BOT_TOKEN`)

1. [discord.com/developers/applications](https://discord.com/developers/applications) → ton application → **Bot** → **Reset Token**. Le nouveau jeton n'est affiché **qu'une fois** ; l'ancien est invalidé **tout de suite** : le bot s'arrête jusqu'à l'étape 3.
2. Copie-le directement.
3. Vercel → Settings → Environment Variables → `DISCORD_BOT_TOKEN` (Production) → **Edit**, colle la nouvelle valeur, de préférence en **Sensitive**, enregistre.
4. **Redeploy** (section B, étape 4) et attends **Ready**.
5. Vérifie : `/aide` répond dans Discord ; une annonce de test part.
6. Vide ton presse-papiers (copie un mot quelconque).

### Autres secrets

| Secret | Où le tourner | À mettre à jour ensuite |
| --- | --- | --- |
| `CRON_SECRET` | Génère une nouvelle valeur aléatoire (gestionnaire de mots de passe), remplace-la dans Vercel | Le **secret GitHub** `CRON_SECRET` (Settings → Secrets and variables → Actions), **chaque** service de cron externe, le moniteur de `/api/health`. **Redeploy** |
| `DISCORD_CLIENT_SECRET` | Developer Portal → ton application → **OAuth2** → réinitialiser le secret | Vercel, puis **Redeploy**. Les connexions échouent entre les deux |
| `AUTH_SECRET` | Nouvelle valeur aléatoire dans Vercel | **Redeploy**. Effet : **tous les membres sont déconnectés** |
| Mot de passe de la base (`DATABASE_URL`) | Procédure dédiée : [NEON_OWNER_PASSWORD_ROTATION.md](NEON_OWNER_PASSWORD_ROTATION.md) (fenêtre approuvée, snapshot frais d'abord) | Vercel `DATABASE_URL` Production, **Redeploy** |
| `PRODUCTION_MIGRATION_DATABASE_URL` (secret GitHub) | Même rotation côté Neon | Mets à jour le secret de l'environnement GitHub `production-migrations` |
| `DISCORD_COMMAND_REGISTRATION_SECRET` | Supprime-le (il ne sert qu'à l'enregistrement des commandes) | Supprime aussi `DISCORD_COMMAND_REGISTRATION_ENABLED`, **Redeploy** |
| `BLOB_READ_WRITE_TOKEN`, `SESSION_MEDIA_BLOB_TOKEN`, `STEAM_API_KEY`, `IGDB_CLIENT_SECRET` | Console du service concerné (Vercel Blob, Steam, IGDB/Twitch) | Vercel, puis **Redeploy** |

Après toute rotation : regarde **Logs** (erreurs d'authentification), vérifie la connexion avec ton compte, note l'heure (section I). Si le secret a été publié dans le dépôt, préviens le développeur : l'historique Git doit être traité. Si des **données personnelles** ont pu être exposées, voir « Ce que ce runbook ne couvre pas ».

---

## H. Qui contacter

> **À COMPLÉTER par Maxime** avant le lancement : aucun nom, e-mail ni numéro n'est inventé ici. Ne note **aucun mot de passe ni jeton** dans ce tableau.

| Rôle | Nom | Moyen de joindre (e-mail, Discord, téléphone) | Quand |
| --- | --- | --- | --- |
| Propriétaire (décideur) | À COMPLÉTER par Maxime | À COMPLÉTER par Maxime | Toute décision de restauration ou de coupure longue |
| Développeur / Claude Code | À COMPLÉTER par Maxime | À COMPLÉTER par Maxime | Migration en échec, erreurs de code, doute sur une écriture en base |
| Support Vercel | À COMPLÉTER par Maxime (lien du support de ton compte) | À COMPLÉTER par Maxime | Déploiement bloqué, retour arrière impossible |
| Support Neon | À COMPLÉTER par Maxime (lien du support de ton compte) | À COMPLÉTER par Maxime | Restauration impossible, base injoignable |
| Support Discord | À COMPLÉTER par Maxime (lien du support développeurs / Trust & Safety) | À COMPLÉTER par Maxime | Bot suspendu, limites de l'API |
| Juriste (données personnelles) | À COMPLÉTER par Maxime | À COMPLÉTER par Maxime | Fuite de données personnelles |

Pages d'état publiques (à regarder avant de conclure à une panne de ton côté) : [vercel-status.com](https://www.vercel-status.com), [neonstatus.com](https://neonstatus.com), [discordstatus.com](https://discordstatus.com).

Quand tu contactes quelqu'un, donne : **l'heure** (UTC et Paris), **ce que tu vois** (capture), **ce que tu as déjà fait**, **le lien** du run, du déploiement ou de la page concernée. **Jamais** de jeton, de mot de passe ni d'URL de base.

---

## I. Après l'incident : noter

Remplis ceci **pendant** l'incident, pas après (les journaux Vercel s'effacent en 1 h). Garde-le hors du dépôt ou dans une issue privée, sans aucun secret.

| Champ | Valeur |
| --- | --- |
| Date et heure de début (UTC et Paris) | |
| Heure de détection, et par qui | |
| Symptôme observé (captures) | |
| Cause (confirmée ou supposée : dis laquelle) | |
| Actions faites, dans l'ordre, avec l'heure de chacune | |
| Interrupteurs modifiés (nom, ancienne valeur, nouvelle valeur) | |
| Déploiement quitté / déploiement choisi | |
| Restauration Neon ? (branche de sauvegarde, heure `T`) | |
| Messages Discord à supprimer ou supprimés à la main | |
| Heure de fin, état final vérifié | |
| Ce qui reste à faire (et qui) | |
| Ce qu'on change pour que ça ne se reproduise pas | |

Ensuite : rallume les interrupteurs coupés **un à un** (section B), avec le développeur si l'incident touchait aux données ou à Discord.

---

## Ce que ce runbook ne couvre pas

- **Une panne de Vercel, Neon ou Discord elle-même** : on ne peut qu'attendre et suivre leurs pages d'état (section H).
- **Un bug dans le code** : la correction est un travail de développeur, par PR (en Draft, avec CI verte), jamais par un geste de ce document.
- **L'annulation d'une migration** : Prisma n'annule pas une migration. On corrige par une **nouvelle** migration additive ([MIGRATIONS.md](MIGRATIONS.md)).
- **La perte d'accès à un compte** (Vercel, Neon, GitHub, Discord Developer Portal, double authentification, nom de domaine, DNS) : à traiter auprès de chaque service.
- **La restauration du serveur Discord** (rôles, salons, permissions, messages supprimés) : rien dans la base ne permet de les recréer. Les rôles et salons créés par GameNight ne sont jamais supprimés par le code.
- **La modération de contenu** (contenu illicite, harcèlement, signalements) : relève du guide de modération prévu dans [CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md).
- **Une fuite de données personnelles** : au-delà du colmatage technique (section G), elle peut imposer des **obligations légales** (par exemple une notification à l'autorité de protection des données dans un délai court). Voir avec un juriste, sans attendre.
- **Les dépassements de quotas et la facturation** (Vercel Hobby, Neon, Discord : 250 rôles, 500 salons) : à surveiller avant le lancement ([CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md)).
- **Une sauvegarde hors Neon** : il n'en existe aucune dans le dépôt. La seule protection de la base est l'historique et les branches de Neon.
- **Atlas et les autres bots tiers** (YAGPDB, Ticket Tool, Appy) : leurs réglages ne sont pas dans ce dépôt.
