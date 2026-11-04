# Plan de recette isolée GameNight — 4 novembre 2026

**État : plan uniquement. Aucune opération Neon, Vercel ou Discord exécutée.**

Objectif : tester le parcours web et les règles Tower sans données Production ni publication sur The Tower. Références : cahier des charges The Tower 2.0 × GameNight, sections 21.5, 22 et 25 ; `docs/PREVIEW_TOWER_ISOLATION.md` ; `docs/TOWER_RECETTE_SCENARIOS.md`.

## Deux parcours distincts

| Parcours | Environnement | Résultat attendu |
| --- | --- | --- |
| Connexion OAuth, profils et équipes | Preview Vercel à alias stable, base fictive et application GameNight Recette | Recette web ; aucun bot ni cron |
| Interactions bot, notifications et défi quotidien | Environnement séparé à concevoir et approuver ultérieurement | Pas réalisable sur la Preview actuelle : #369 bloque les écritures Discord et crons |

Ne jamais définir artificiellement VERCEL_ENV=production dans une Preview pour contourner ces protections. L'application de recette sert d'abord à OAuth web, sans invitation de bot. L'ajout d'un bot, de permissions ou d'un environnement permettant ses écritures est une opération distincte.

## 1. Inventaire avant tout changement

- [ ] Relever le SHA à tester et les migrations qu'il contient. #370 exige sa migration ; ne pas inclure #325.
- [ ] Vérifier en lecture seule l'identité, l'état archivé ou actif et le schéma de la branche Neon existante `preview-gamenight`. Les chiffres de septembre et novembre présents dans les anciennes docs sont historiques.
- [ ] Vérifier que User, Account, Session, Community, Membership et les tables métier ne contiennent aucune donnée réelle. Si une donnée réelle est détectée : arrêt ; ne pas copier, purger ou réinitialiser sans décision.
- [ ] Comparer l'historique Prisma et les migrations du SHA retenu ; arrêt sur migration inachevée ou absente du checkout.
- [ ] Relever les variables Vercel héritées et spécifiques à la branche sans imprimer leurs valeurs. Identifier la cible SQL par métadonnées non secrètes.
- [ ] Vérifier dans Discord si le serveur privé et l'application de recette existent déjà avant toute création, puis relever leurs IDs. Aucun ID provenant seulement d'un ancien compte rendu ne vaut vérification.

Livrable : tableau SHA / projet Neon / branche / base / endpoint direct et poolé (sans identifiants de connexion) / migrations manquantes / projet et branche Vercel / IDs Discord.

## 2. Mise à niveau du schéma de recette — après accord

- [ ] Préserver la branche existante : aucune suppression, restauration Production ni reset depuis Production.
- [ ] Si la compute est archivée, présenter son activation et ses conséquences avant toute opération.
- [ ] Faire un dry-run du runner de migration disponible sur le SHA approuvé, avec cible directe vérifiée et liste exacte des migrations manquantes.
- [ ] Appliquer uniquement cette liste sur la base fictive après accord explicite ; vérifier les migrations terminées et la concordance du schéma. Ne pas utiliser db push pour masquer une divergence.
- [ ] Peupler uniquement les données synthétiques nécessaires : communauté de recette, utilisateurs fictifs, équipes et défis. Les vraies connexions OAuth des testeurs produiront ensuite leurs données de recette ; aucune copie des comptes Production.
- [ ] Ne pas exécuter les seeds génériques sans lecture préalable de leurs effets et garde explicite de cible.

## 3. Preview web à URL stable — après accord

- [ ] Sélectionner une branche Git de recette et un SHA approuvé ; conserver les protections Preview de #369.
- [ ] Vérifier les possibilités d'alias stable du compte Vercel gratuit avant de retenir une URL. Ne pas promettre de domaine ou environnement payant.
- [ ] Configurer DATABASE_URL uniquement pour cette branche Preview vers la compute de recette ; garder les autres branches et Production intactes.
- [ ] Configurer AUTH_URL sur l'URL stable réellement obtenue, AUTH_SECRET distinct et identifiants OAuth de GameNight Recette. Saisir les secrets directement dans les interfaces sécurisées ; aucune valeur dans Git, capture ou rapport.
- [ ] Configurer dans le Developer Portal la redirection Auth.js sous l'URL stable avec le chemin /api/auth/callback/discord, après vérification du chemin réellement exposé par le déploiement. Cette étape OAuth reste soumise à l'accord de Maxime.
- [ ] Vérifier le callback OAuth, la disponibilité de la communauté de recette et les Membership ACTIVE nécessaires à la connexion fermée par défaut. Un utilisateur fictif seul ne peut pas se connecter par OAuth.
- [ ] Ne fournir aucun bot token, webhook, identifiant de salon Production ni CRON_SECRET à cette Preview. Désactiver notifications et automatisations conformément au document d'isolation.
- [ ] Tower reste OFF pour le premier contrôle d'isolation. L'activation des règles Tower web en recette est une seconde étape explicite, après preuve de la cible et validation de leur absence d'effet Discord.

Les acceptations des conditions du Developer Portal sont présentées au propriétaire au moment de l'action. Aucun bot invité, aucune commande enregistrée et aucune tâche cron-job.org touchée.

## 4. Preuves de recette

| Contrôle | Preuve attendue |
| --- | --- |
| Cible de la Preview | SHA, URL et correspondance endpoint → branche Neon de recette |
| Cron Preview | 503 même avec authentification valide, vérifié en tests automatisés ; aucun cron externe créé |
| Écritures Discord | Tests prouvant que POST, PATCH, PUT, DELETE et webhooks ne déclenchent aucun envoi |
| OAuth | Heure UTC, identité du compte test, URL finale sans paramètres OAuth sensibles, erreur classée sans secret |
| Recherche jeux | Minecraft puis jeu avec accent présent dans le catalogue fictif ; résultats et doublons consignés |
| Équipes | Membres actifs, 2–8, exclusivité, délai et capitanat selon #370, uniquement sur base fictive |
| Quotas et votes | Tests PostgreSQL locaux : limites, concurrence, auto-vote refusé, absence de double récompense |
| Nouvelle connexion | Déconnexion/reconnexion puis vérification de la communauté et de l'accès aux équipes |

Une simulation locale ne valide pas une interaction Discord réelle. Le test melah3 en Production demandé séparément ne crée aucun contenu et ne doit pas être présenté comme une recette isolée.

## 5. Arrêt et remise en état

- [ ] Si la cible SQL est ambiguë, si un secret Production est hérité ou si un envoi Discord est possible : arrêter la recette authentifiée.
- [ ] Préparer le retrait des seules variables Preview ajoutées, après inventaire ; ne jamais copier la configuration Production en repli.
- [ ] Ne pas promouvoir, redéployer ou rollback Production ; ne supprimer aucune branche/base Neon et ne restaurer aucun snapshot Production.
- [ ] Consigner ce qui a été configuré, les tests exécutés et les éléments non vérifiés. Maintenir le parcours bot/crons explicitement non validé tant que son environnement distinct n'est pas approuvé.

## Accords à demander au moment de la mise en œuvre

1. Opérations précises sur la branche Neon de recette, une fois la liste des migrations et la cible relevées.
2. Variables Vercel limitées à la branche Preview, alias stable et OAuth de l'application de recette, avec liste concrète des changements.
3. Éventuelle activation Tower web sur recette après vérification d'isolation.
4. Environnement bot/crons : plan séparé avant toute autorisation ; aucune dérogation au verrou Preview dans ce plan.
