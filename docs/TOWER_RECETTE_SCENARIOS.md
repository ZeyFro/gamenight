# Recette web et OAuth — scénarios à exécuter sur des données fictives

**Préconditions (à valider séparément) :**

- URL stable de branche Vercel confirmée (branch alias), jamais une URL de commit.
- Branche Neon `preview-gamenight` remise au schéma courant **sans copie des données réelles**.
- La variable `DATABASE_URL` de cette Preview pointe vers l'hôte exact de la branche Neon de recette (comparaison d'hôtes, jamais de mot de passe imprimé).
- `AUTH_URL` correspond au domaine fixe, `AUTH_SECRET` propre à la Preview, `DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET` de **l'application Discord de recette**, renseignés dans Vercel par le propriétaire.
- Guild Discord de recette distincte de The Tower ; `Community` fictive active et rattachée à cette guild. Aucun bot ni webhook ayant des droits dans The Tower n'est disponible en Preview.
- `VERCEL_ENV=preview` : crons refusés, messages Discord sortants interdits. Aucune tâche cron-job.org ne cible la Preview.
- Les comptes Discord des deux testeurs peuvent apparaître dans la base de recette via OAuth ; ce sont des données de test réelles, isolées, à purger ensuite. Ne jamais recopier leurs tokens ni emails dans des rapports.

## Scénario A — nouveau membre

1. Ouvrir l'URL stable en navigation privée.
2. Cliquer « Se connecter avec Discord » et s'authentifier avec un compte autorisé dans la guild sandbox.
3. Vérifier l'arrivée dans GameNight, la communauté de recette sélectionnée et l'accès à `/equipes`.
4. Sur une autre communauté non autorisée, vérifier qu'aucune donnée privée n'est accessible.
5. Se déconnecter puis se reconnecter sans boucle, vérifier absence de `CallbackRouteError`.

**Preuves :** heure UTC, URL finale sans paramètres de connexion, capture sans secrets, message d'erreur visible éventuellement.

## Scénario B — choix du serveur et session

1. Utiliser un compte appartenant à deux communautés de test actives.
2. Se connecter en navigation privée.
3. Vérifier l'affichage du choix de serveur (correctif #361).
4. Sélectionner la communauté sandbox, ouvrir `/equipes`, revenir à l'accueil.
5. Répéter après déconnexion. Aucune boucle ni changement implicite de serveur.

## Scénario C — équipes et concurrence

1. Avec le compte A, créer une équipe de 2 membres.
2. Avec le compte B, rejoindre l'équipe et observer le compteur 2/2.
3. Tenter depuis B une autre équipe dans la même communauté : refus explicite.
4. Quitter l'équipe avec B, puis tenter de rejoindre une autre : délai de 7 jours.
5. En données fictives uniquement, avancer le dernier départ de plus de 7 jours ; une nouvelle adhésion devient possible.
6. Tester une soumission simultanée à deux équipes : une seule inscription doit réussir.
7. Simuler 31 jours d'inactivité du capitaine, tester le cron **uniquement en dry-run** d'abord puis, après accord séparé sur base fictive, vérifier le transfert au membre le plus ancien sans modification du créateur historique.

## Scénario D — aucun effet externe

1. Appeler la route cron de recette avec en-tête autorisé : HTTP 503, **aucune exécution**.
2. Créer une soirée fictive, vérifier qu'aucun message n'arrive sur The Tower.
3. Vérifier qu'aucun webhook Discord, MP, fil, archive ni suppression ne peut partir de la Preview.
4. Vérifier les destinataires des envois éventuels par rapport à la guild sandbox exclusivement. Sur Preview actuelle, **toutes** les écritures Discord sont interdites.
5. Vérifier les logs seulement par catégorie, sans cookie, token, email ni réponse Discord.

## Scénario E — contrôle manuel AlexGG / melah3 sur production

La connexion réelle au site public ne doit servir qu'à vérifier l'accès et la navigation, sans créer de contenu de test indésirable. Le compte `melah3` ne pourra jamais contribuer à un quorum de production après la mise en place du filtre de comptes de test ; à l'heure actuelle ce filtre est **non implémenté**.

**Ne pas enregistrer les résultats comme « réussis » avant d'avoir des preuves.**
