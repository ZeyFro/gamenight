# Preuves sans quorum — suivi technique (option B)

**Décidé :** à 24 h sans trois votes distincts, la preuve reste `SUBMITTED`, sans nouveau vote ni récompense. À J+7, un marqueur persistant la rend visible dans la file staff, sans message, DM, ping ou notification automatique. À J+30, si elle reste sans quorum, elle reçoit un horodatage d'archive, sans décision, récompense ni suppression.

## Contrat implémenté dans #407
- Âge calculé depuis `submittedAt`, en UTC, sans réinitialiser le vote.
- À J+7 : enregistrer `staffReportedAt` une seule fois et rendre le dossier visible dans la file de modération ; aucun envoi Discord, DM, ping ou intention d'outbox.
- À J+30 : enregistrer `archivedAt`, sans changer l'historique des votes ni le statut `SUBMITTED` ; ne pas marquer `REJECTED`, ne pas attribuer d'étages et ne pas supprimer la preuve.
- Exclure les contestations ouvertes, les preuves déjà tranchées et les preuves archivées.
- Contrôle concurrence : deux crons simultanés n'émettent pas deux signaux et ne font pas basculer la même preuve deux fois.
- La file admin est un signal consultable, pas une action de décision. Les décisions motivées et l'arbitrage indépendant restent dans le parcours de contestation après refus, pas dans le traitement des preuves sans quorum.
- Conserver les preuves selon la politique de confidentialité que Claude doit définir ; aucun nettoyage physique automatique.

## Tests
Sous quorum à 24 h -> attente ; J+7 -> marqueur unique et ligne visible dans la file sans envoi ; second passage inchangé ; J+30 -> archive horodatée, statut `SUBMITTED`, preuve conservée, zéro récompense ; vote tardif rejeté ; preuve approuvée entre deux passages intacte.

## État et activation

Le vieillissement, les marqueurs persistants et la file staff sont implémentés dans #407 ; les anciennes réservations #325/#373 ne décrivent plus leur état. La contestation après refus utilise un arbitre fixe préconfiguré, journalisé et gelé tant qu’un dossier est ouvert. Son délai de 24 h commence à la première annonce Discord effectivement livrée, jamais à la mise en file.

La branche intègre les correctifs de #406 et main : protection des équipes dissoutes, confidentialité du secours roulette, fixtures VAPID et alignements du schéma Prisma avec le SQL publié. Aucun SQL existant n’est modifié. Ordre des migrations : #370 (`20261104140000_tower_team_membership_policy`), #406 (`20261105120000_tower_launch_channels_appeals_matchmaking`), puis #407 (`20261106150000_tower_fixed_arbiter`).

La disponibilité réelle reste conditionnée au schéma cible validé, à la configuration préalable de l’arbitre et aux drapeaux/salons documentés dans `docs/tower-challenges.md`. Les migrations distantes, configurations et droits Discord exigent leurs validations séparées ; aucun test local ni CI verte ne prouve une activation réelle. Aucun nettoyage physique automatique n’est introduit.

## Validation locale de la synchronisation du 12 novembre 2026

Node 22.23.4, installation `npm ci` propre et client Prisma 6.19.3 généré dans le worktree isolé. Les 10 suites unitaires/simulées ciblées passent (83 tests), puis les quatre suites PostgreSQL contestations, annonce effective, équipes et MP soirées passent séquentiellement (103 tests, aucun ignoré). La base Docker jetable locale a reçu les 121 migrations ; les identifiants Neon projet/branche sont absents. Typegen Next, TypeScript, ESLint ciblé et `git diff --check` passent. Aucun SQL publié modifié ; aucune migration distante, annonce Discord réelle, activation ni nouvelle CI distante revendiquée.
