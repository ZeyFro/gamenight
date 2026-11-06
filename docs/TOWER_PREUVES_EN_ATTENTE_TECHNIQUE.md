# Preuves sans quorum — suivi technique (option B)

**Décidé :** à 24 h sans trois votes distincts, la preuve reste `SUBMITTED`, sans nouveau vote ni récompense. À J+7, un marqueur persistant la rend visible dans la file staff, sans message, DM, ping ou notification automatique. À J+30, si elle reste sans quorum, elle reçoit un horodatage d'archive, sans décision, récompense ni suppression.

## Contrat proposé
- Âge calculé depuis `submittedAt`, en UTC, sans réinitialiser le vote.
- À J+7 : enregistrer `staffReportedAt` une seule fois et rendre le dossier visible dans la file de modération ; aucun envoi Discord, DM, ping ou intention d'outbox.
- À J+30 : enregistrer `archivedAt`, sans changer l'historique des votes ni le statut `SUBMITTED` ; ne pas marquer `REJECTED`, ne pas attribuer d'étages et ne pas supprimer la preuve.
- Exclure les contestations ouvertes, les preuves déjà tranchées et les preuves archivées.
- Contrôle concurrence : deux crons simultanés n'émettent pas deux signaux et ne font pas basculer la même preuve deux fois.
- La file admin est un signal consultable, pas une action de décision. Les décisions motivées et l'arbitrage indépendant restent dans le parcours de contestation après refus, pas dans le traitement des preuves sans quorum.
- Conserver les preuves selon la politique de confidentialité que Claude doit définir ; aucun nettoyage physique automatique.

## Tests
Sous quorum à 24 h -> attente ; J+7 -> marqueur unique et ligne visible dans la file sans envoi ; second passage inchangé ; J+30 -> archive horodatée, statut `SUBMITTED`, preuve conservée, zéro récompense ; vote tardif rejeté ; preuve approuvée entre deux passages intacte.

## Blocage
`TowerChallengeAttemptStatus` et `TowerChallengeAttempt` nécessitent des changements de `prisma/schema.prisma` (réservé #325/#370) et le calcul des récompenses utilise `src/lib/tower-challenges.ts` (réservé #373). Aucun code de purge ou migration lancé dans cette PR.
