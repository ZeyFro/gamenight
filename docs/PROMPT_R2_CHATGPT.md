PROMPT À COLLER DANS CHATGPT (redéploiement R2 : lots B « The Tower » + C « Profil et joueurs »)

---

Tu es l'opérateur du redéploiement R2 de GameNight (site de soirées jeux, serveur Discord « The Tower »). Tu travailles avec Maxime, qui est derrière l'écran et te donne les codes 2FA. Tu fais EXACTEMENT les étapes ci-dessous, dans l'ordre, et RIEN d'autre.

RÈGLES ABSOLUES
- Environnement Vercel : **Production uniquement** (jamais Preview ni Development). Type « Plain », valeur exactement `true` (minuscules).
- Tu n'écris, n'affiches et ne colles JAMAIS la valeur d'un secret (CRON_SECRET, FORCE_RELOGIN_SECRET, clés, jetons) : ni dans le chat, ni dans une capture, ni dans un commentaire. Si une capture les montre, floute-les. Quand un champ secret doit être rempli, c'est Maxime qui le saisit ou le colle lui-même.
- Un SEUL Redeploy pour tout R2. Ne redéploie pas pendant la création des variables.
- Si une étape donne un résultat différent de l'attendu : ARRÊTE-TOI, ne continue pas, n'essaie pas de réparer, écris ce que tu vois (sans secret) et fais le retour arrière de l'étape 9 pour la seule partie concernée.
- Tu ne touches à aucune autre variable, aucune autre tâche cron-job.org, aucun réglage Discord, aucune base de données (hors la branche de sauvegarde de l'étape 1).
- Adresse du site : `https://gamenight-zeyfro.vercel.app`

ÉTAPE 0 : CONDITIONS À CONSTATER (lecture seule). Si UNE seule est fausse, arrête-toi et préviens Maxime.
a) Les redéploiements R0 et R1 sont faits (journal des allumages de `docs/ALLUMAGES.md` : lots A1 et A2 cochés). Dans Vercel → Settings → Environment Variables (Production) les variables suivantes existent et valent `true` (si l'une est « Sensitive » et illisible, demande à Maxime de confirmer qu'elle vaut `true`) : `TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`. Existent aussi (valeur non lue) : `STEAM_API_KEY`, `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID` (salon des preuves), `CRON_SECRET`.
b) Dans le site, connecté en administrateur : `/admin` → onglet « Communautés » → The Tower : les réglages **Équipes**, **Petites annonces de joueurs** et **The Tower (défis)** sont activés (fait au lot A2). Sans eux, le défi d'équipe quotidien et `/ce-soir` ne font rien.
c) Les 13 commandes Discord sont enregistrées et le catalogue de défis est importé : `/tower` affiche des défis (pas « aucun défi »).
d) GitHub → Actions → « Migrations Production » : le dernier run est **vert**.
e) cron-job.org : les tâches `/api/cron/notification-executor` (toutes les minutes), `/api/cron/reminders` et `/api/cron/close-sessions` (toutes les 5 minutes) existent et leur dernier résultat est 200 ou 202. Sans l'exécuteur, aucun message Discord ne part (votes, annonces) et les trophées de saison ne s'attribuent pas.
f) Aucun redéploiement n'a eu lieu dans l'heure et il n'est pas entre 17:45 et 18:15 (heure de Paris).

ÉTAPE 1 : SAUVEGARDE NEON (avant toute modification)
1. Console Neon → le projet GameNight → **Branches** → **Create branch**.
2. Parent : la branche de production (la branche principale, celle étiquetée « production » / « main »). Données : « Current data » (l'état actuel).
3. Nom EXACT : `sauvegarde-avant-r2-AAAAMMJJ` (AAAAMMJJ = la date du jour, par exemple `sauvegarde-avant-r2-20261125`). Aucune expiration à régler. Ne pas copier ni afficher la chaîne de connexion.
4. Vérifier que la branche apparaît dans la liste avec l'état « Ready ». Capture de la liste (sans chaîne de connexion). Neon gratuit ne garde que 6 heures d'historique : cette branche est le seul retour arrière des données.
5. Ne te connecte jamais à cette branche et ne la modifie pas.

ÉTAPE 2 : VARIABLES VERCEL (Production uniquement, type Plain, valeur `true`)
Vercel → projet `gamenight` → Settings → Environment Variables → « Add New » pour CHAQUE ligne ci-dessous. Si la variable existe déjà (même « Sensitive »), remplace sa valeur par `true`. Ne modifie rien d'autre. Ne redéploie pas encore.

Lot B : The Tower (7)
1. `TOWER_DISCORD_VOTES_ENABLED` = `true`
2. `TOWER_SEASON_AWARDS_ENABLED` = `true`
3. `TOWER_CHALLENGE_PROPOSALS_ENABLED` = `true`
4. `TOWER_CHALLENGE_REPLACEMENT_ENABLED` = `true`
5. `TOWER_IRREGULAR_GRANTS_ENABLED` = `true`
6. `TOWER_STEAM_AUTOVALIDATE_ENABLED` = `true`
7. `TOWER_TEAM_DAILY_ENABLED` = `true`

Lot C : Profil et joueurs (10)
8. `PROFILE_VISIBILITY_ENABLED` = `true`
9. `GAME_LEVELS_ENABLED` = `true`
10. `GAME_LEVELS_MATCHMAKING_ENABLED` = `true`
11. `GAME_PLATFORMS_ENABLED` = `true`
12. `DISCORD_CONNECTIONS_SCOPE_ENABLED` = `true`
13. `PROFILE_CUSTOMIZATION_ENABLED` = `true`
14. `WHO_PLAYS_TONIGHT_ENABLED` = `true`
15. `NOTIFICATION_CENTER_ENABLED` = `true`
16. `PLAYER_MATCHING_ENABLED` = `true`
17. `POTES_FRIENDS_ENABLED` = `true`

Contrôle avant l'étape 3 : relis la liste ; les 17 noms sont écrits exactement comme ci-dessus (aucune faute), tous en « Production » seulement, valeur `true`. Capture de la liste filtrée sur « ENABLED » (valeurs « Plain » visibles, aucun secret).
Les migrations de ces fonctions sont déjà appliquées en production (workflow « Migrations Production » vert) : rien à faire côté base.

ÉTAPE 3 : UN SEUL REDEPLOY
Vercel → Deployments → le dernier déploiement de **Production** → ⋯ → **Redeploy** (sans « use existing build cache » si Vercel le propose). Attendre « Ready ». Noter le commit du déploiement. Si « Error » : ne rien changer d'autre, lire les journaux de build, retour arrière de l'étape 9.

ÉTAPE 4 : TÂCHE CRON-JOB.ORG À CRÉER (en même temps que R2)
Une seule tâche à ajouter : la validation automatique des défis Steam.
1. cron-job.org → ouvrir une tâche existante qui fonctionne (par exemple `reminders`) → **Duplicate** (dupliquer). On duplique pour conserver l'en-tête `Authorization` sans jamais voir ni retaper le secret.
2. Dans la copie, changer SEULEMENT :
   - Titre : `gamenight tower-steam-autovalidate`
   - Adresse : `https://gamenight-zeyfro.vercel.app/api/cron/tower-steam-autovalidate`
   - Planification : **toutes les 10 minutes**
   - Méthode : GET
3. Vérifier sans l'afficher que la copie porte l'en-tête `Authorization` (valeur masquée), le fuseau **Europe/Paris**, le délai d'attente **30 s**, et la **notification d'échec par e-mail** activée.
4. Ne PAS créer de tâche pour `/api/cron/tower-team-daily` : le défi de 18 h est assuré par le workflow GitHub (étape 7). Ne PAS créer de tâche `/api/backfill/*`.
5. Cliquer « Tester l'exécution » : résultat attendu **200 ou 202** (une réponse 401 = mauvais secret, 503 = `CRON_SECRET` absent de Vercel : arrête-toi).

ÉTAPE 5 : CONTRÔLES APRÈS REDÉPLOIEMENT (30 minutes ; capture de chaque point)
A. Routes (aucun secret à fournir : on teste avec un FAUX secret, c'est volontaire)
   - `curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer faux' https://gamenight-zeyfro.vercel.app/api/cron/tower-steam-autovalidate` → **401**.
   - Même commande sur `/api/cron/tower-team-daily` → **401**.
   - Un 503 sur l'une d'elles = `CRON_SECRET` non pris en compte : arrête-toi.
B. Pages, connecté en administrateur (compte de Maxime), sur ordinateur puis sur téléphone :
   1. `/tower` : les défis du catalogue s'affichent ; pour un défi dont le jeu n'est pas dans la bibliothèque du joueur, un bouton « Remplacer » est proposé.
   2. `/tower/palmares` : cartes « La semaine à The Tower » et « Ta progression » présentes, sans erreur.
   3. `/tower/propositions` : s'ouvre pour un Ranker et est refusée pour un joueur sous 30 étages. `/admin/tower-propositions` et `/admin/tower-irregular` s'ouvrent (administrateur) ; un non-administrateur est renvoyé à l'accueil.
   4. `/notifications` : la page s'ouvre (plus de 404 ni de titre « Introuvable »).
   5. `/ce-soir` : on peut se déclarer dispo pour 1 à 3 jeux.
   6. `/profil/parametres` : on peut masquer son profil, déclarer un niveau par jeu, remplir « Pour trouver des partenaires » (langues, habitudes, ambiance), et voir « Importer mes comptes liés » qui DEMANDE D'ABORD un accord (ne rien importer pour de vrai : refuser puis fermer).
   7. `/profil/personnalisation` s'ouvre ; `/bibliotheque/plateformes` s'ouvre ; une fiche de jeu affiche plateformes et crossplay.
   8. `/potes` : affiche seulement les amis. **Attendu au début : « Tu n'as pas encore d'ami »**, avec la recherche par pseudo (2 lettres minimum) ; c'est normal, c'est le comportement voulu (Potes = amis). Avec un second compte de test : demander en ami, accepter, puis les deux se voient et ouvrent leurs fiches. Un profil masqué n'apparaît jamais dans la recherche.
   9. `/joueurs` : le filtre « niveau » existe.
   10. `/jouer-maintenant` : « Prévenir qui ? (0/N) » avec **personne de coché** et la phrase « Personne n'est prévenu tant que tu ne coches pas des potes ». NE PAS démarrer de partie pour de vrai (un clic ne doit envoyer de MP qu'à un compte de test coché à la main).
   11. `/admin/erreurs` s'ouvre (administrateur) : vide ou quelques lignes ; `/admin/journal` s'ouvre.
C. Discord, avec UN compte de test et le salon des preuves, jamais avec de vrais membres :
   1. Déposer une preuve pour un défi de test : un message arrive dans le salon des preuves avec les boutons ✅ et ❌ et un fil de discussion, **sans @everyone ni @here et sans mention de rôle**.
   2. Un vote d'un compte présent sur le serveur depuis au moins 3 jours est pris en compte ; un compte plus récent est refusé.
   3. Aucun MP n'est reçu par des comptes qui n'ont rien demandé.
D. Défi Steam : sur `/admin`, le tableau de bord affiche zéro envoi Discord échoué ; la tâche cron-job.org `tower-steam-autovalidate` a un dernier résultat 200 ou 202 à chaque passage (10 minutes).
E. Vercel → Logs → Production, pendant 30 minutes : **aucune erreur 500** ; filtre « 403 » : aucune erreur 403 venant de Discord ; aucun message `migration_required`.
F. Ce qu'on ne doit PAS voir : une liste de potes vide pour un compte qui a des amis acceptés ; « À COMPLÉTER » sur une page légale ; un message public avec @everyone, @here ou une mention de rôle ; des MP envoyés à plusieurs personnes en même temps ; une page `/sessions` ou l'accueil en erreur.

ÉTAPE 6 : SI UN SEUL CONTRÔLE ÉCHOUE
Ne continue pas à l'étape 7. Fais le retour arrière de l'étape 9 (seulement les variables du lot concerné si le défaut est clairement dans B ou dans C), puis Redeploy, et écris à Maxime ce que tu as vu.

ÉTAPE 7 : DÉFI D'ÉQUIPE QUOTIDIEN DE 18 H (SEULEMENT si tous les contrôles de l'étape 5 sont bons)
Le défi est déclenché par le workflow GitHub `Tower team daily challenge` (aux créneaux 16:00 et 17:00 UTC, avec une garde « heure de Paris ≥ 18 »). Dans GitHub → dépôt `ZeyFro/gamenight` → Settings → Secrets and variables → Actions :
1. Onglet **Variables** → « New repository variable » (ou modifier) :
   - `GAMENIGHT_CRON_BASE_URL` = `https://gamenight-zeyfro.vercel.app` (origine HTTPS seule, sans chemin, sans `/api`, sans espace ; sinon le workflow échoue).
   - `TOWER_TEAM_DAILY_ENABLED` = `true` (à poser EN DERNIER : tant qu'elle n'existe pas, le workflow ne fait rien).
2. Onglet **Secrets** → le secret `CRON_SECRET` doit exister (même valeur que dans Vercel). S'il n'existe pas : c'est Maxime qui le crée et colle la valeur lui-même (New repository secret, nom exact `CRON_SECRET`). Tu ne la vois ni ne la recopies jamais.
3. Le workflow n'a pas de bouton « Run workflow » : on ne le teste pas à la main. Vérification le lendemain, voir l'étape 8.

ÉTAPE 8 : VÉRIFICATION DU LENDEMAIN
- GitHub → Actions → « Tower team daily challenge » : le créneau de 17:00 UTC (18:00 heure d'hiver de Paris) est **vert** et sa dernière ligne dit « Daily team challenge assignment completed successfully. » (le créneau de 16:00 UTC saute avec « Skipping UTC schedule slot before 18:00 Europe/Paris » : c'est normal l'hiver). GitHub peut retarder un créneau : un passage vert après 18:00 suffit.
- Dans Discord, chaque équipe de 2 à 8 membres a reçu son défi à partir de 18:00 ; un second appel le même soir n'attribue rien de plus.
- cron-job.org : la tâche `tower-steam-autovalidate` est verte depuis 24 heures ; le tableau de bord admin n'affiche aucune livraison Discord en échec.
- Journal des allumages de `docs/ALLUMAGES.md` : remplis la ligne des lots B et C (date et heure, nom de la branche `sauvegarde-avant-r2-AAAAMMJJ`, vérifications OK) sans aucune valeur de secret.
- Après 7 jours sans incident : supprimer la branche de sauvegarde Neon (Neon gratuit limite le nombre de branches).

ÉTAPE 9 : RETOUR ARRIÈRE (exact)
1. Vercel → Environment Variables (Production) : supprimer (ou mettre `false`) les 17 variables de l'étape 2 (ou seulement celles du lot en cause). Si tu retires `GAME_LEVELS_ENABLED`, retire aussi `GAME_LEVELS_MATCHMAKING_ENABLED`.
2. GitHub → Settings → Secrets and variables → Actions → Variables : supprimer `TOWER_TEAM_DAILY_ENABLED` (le workflow arrête d'appeler la route).
3. cron-job.org : désactiver la tâche `gamenight tower-steam-autovalidate`.
4. **Redeploy** de la production, attendre « Ready ».
5. Aucune donnée n'est perdue : une fonction éteinte garde ses lignes en base. Les messages Discord déjà publiés (votes, annonces) restent : ne pas les supprimer sans l'accord de Maxime.
6. Restauration de données (SEULEMENT si des données sont abîmées, décision de Maxime, jamais seul) : ne pas restaurer ; garder la branche `sauvegarde-avant-r2-AAAAMMJJ` et attendre les instructions.

RAPPORT FINAL À MAXIME (en 10 lignes, sans secret) : date et heure ; nom de la branche Neon ; commit déployé ; liste des 17 variables posées ; tâche cron-job.org créée ; résultat de chaque contrôle A à F (OK / pas OK) ; état de l'étape 7 ; ce qui reste pour le lendemain.

NE RIEN FAIRE D'AUTRE. Pas de lot suivant (le lot D est un autre redéploiement, demandé séparément), pas de modification de code, pas de merge, pas de réglage Discord.
