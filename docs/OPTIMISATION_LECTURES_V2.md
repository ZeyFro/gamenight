# Lectures de navigation/chat et messages Discord

Base : main après la PR #204, commit `19a4673`.

## Changements

- Le header et le polling du chat utilisent `getCurrentUser({ recordActivity: false })` : le même contrôle Auth.js, `forceReloginAt`, sélection de communauté et appartenance, puis lecture des statistiques. Pas de transaction de streak ni de vérification de badges temporels pour ces lectures de fond. Une navigation normale ou une mutation conserve le comportement par défaut. Un onglet de chat laissé ouvert ne prolonge plus le streak à lui seul.
- Le header et chaque appel de polling disposent d'un contexte de lectures communautaires partagé **uniquement pendant cet appel**. Les résolutions répétées sont mutualisées, sans cache de droits global, entre requêtes ou dans les mutations. Les contrôles d'accès aux soirées sont toujours exécutés au polling suivant.
- Les variables des messages sont remplacées en un seul passage. Un pseudo `$& {jeu}` ou un titre contenant des accolades garde sa valeur littérale ; il ne devient pas une nouvelle variable de modèle. Les variables absentes du modèle gardent leurs replis et warnings.

La PR #202 fournit déjà les intentions de création idempotentes, les transactions de roulette, les modèles bot et les optimisations accueil/file vide. Ils ne sont pas réimplémentés ici. Aucune migration, dépendance ou modification de cadence/flag.

## Pings à conserver

| Événement | Fil | MP |
| --- | --- | --- |
| Soirée créée, date changée, validée, rappel | Mention des destinataires éligibles, créateur exclu | Nouveau message selon l'événement |
| Autre modification / fin de soirée | Mise à jour de l'annonce | Invitation éditée |
| Tournoi créé | Mention des invités éligibles, créateur exclu | Invitation |
| Tournoi lancé, terminé, annulé | Mise à jour selon le parcours | Invitation éditée |
| Roulette | Pas de mention | Invitation éditée à la fin, rappel conservé |

Un MP fermé conserve le traitement existant, dont le secours réservé au créateur. La résolution de salons et destinataires reste propre à la communauté. Aucun envoi Discord réel dans cette validation. Les tournois n'ont pas de catégorie `MessageTemplate` dédiée dans le schéma actuel : cette PR n'en invente pas.

## Validation reproductible

`src/lib/current-user-read.integration.test.tsx` utilise le vrai Prisma/Postgres et les vrais loaders/actions, avec OAuth et badge temporel simulés. Il vérifie l'absence de transactions/écritures de progression sur les lectures, l'activité normale conservée, le changement A/B, retrait/suspension et reconnexion forcée. Il compare le nombre de SQL du même header avec/sans contexte, et le polling avec le parcours de visite précédent. Mesures locales/de service, pas de latence ni de coût de production.

Les deux nouvelles régressions de substitution échouent sur main puis passent avec le correctif. Le test d'accès chat vérifie aussi la révocation entre deux polls.

Validation locale : TypeScript, lint ciblé et build direct réussis ; suite sans Postgres : **1 335 réussis, 747 ignorés**, 135 fichiers réussis et 43 suites ignorées. La session cloud ne peut pas lancer PostgreSQL sous un utilisateur non-root : sa namespace ne mappe que UID 0 et interdit le changement d'utilisateur. PostgreSQL 16 officiel téléchargé, mais pas démarré. Aucun test Postgres local annoncé comme réussi ; la CI utilise son service PostgreSQL 16 isolé. Résultats CI et mesures SQL à compléter sur le commit poussé.

## Neon : prochaine mesure opérateur

`scripts/diagnostic-neon-lecture.sql` est entièrement en lecture seule. Il montre taille, fenêtre des compteurs cumulés, connexions et état agrégé de la file ; pas les CU-heures. Sur des petites tables, une lecture séquentielle n'est pas à elle seule la preuve d'un index manquant.

Pour décider du retour à l'offre gratuite, relever dans Neon l'usage de calcul/stockage sur une période comparable et l'état actif/veille, puis l'inventaire réel des jobs externes : URL, cadence et doublons. Le dépôt ne contient pas toute cette configuration. Les crons et onglets qui interrogent la base régulièrement peuvent empêcher la veille, même avec moins de SQL ([documentation Neon](https://neon.com/docs/manage/endpoints/)). Réduire l'executor change le délai des annonces/reprises : aucun changement de ce type effectué ici. Aucun retour au gratuit ni économie chiffrée promis sans mesure d'usage réelle.

Après merge décidé par le mainteneur : vérifier chat A/B, choix de serveur, progression des visites et modèles sur un serveur de test, puis comparer les relevés Neon et Vercel. Les créations doivent rester protégées contre les doubles clics par les intentions de la PR #202.
