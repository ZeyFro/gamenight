# Preuves sans quorum — suivi technique (option B)

**Décidé :** à 24 h sans trois votes distincts, preuve reste `SUBMITTED`, sans nouveau vote ni récompense ; signalement du dossier au staff à J+7 ; archivage sans récompense à J+30 si pas de décision. L'archivage n'est **pas** une suppression.

## Contrat proposé
- Âge calculé depuis `submittedAt`, en UTC, sans réinitialiser le vote.
- À J+7 : produire **une seule** intention de notification staff par tentative (idempotence sur `category,eventType,sourceId,occurrence`) ; ne jamais notifier le salon public ni DM vers une Preview.
- À J+30 : état distinct `ARCHIVED_PENDING_QUORUM` ou archive horodatée, **sans changer l'historique des votes** ; ne pas marquer `REJECTED`, ne pas attribuer d'étages.
- Exclure les contestations ouvertes, les preuves déjà tranchées et les preuves archivées.
- Contrôle concurrence : deux crons simultanés n'émettent pas deux signaux et ne font pas basculer la même preuve deux fois.
- Prévoir une file admin où un modérateur peut statuer ; si sa propre preuve, arbitre indépendant.
- Conserver les preuves selon la politique de confidentialité que Claude doit définir ; aucun nettoyage physique automatique.

## Tests
Sous quorum à 24 h -> en attente ; J+7 -> un seul signal, second passage inchangé ; J+30 -> archive et zéro récompense ; tentative de vote tardif rejetée ; preuve approuvée entre deux passages intacte.

## Blocage
`TowerChallengeAttemptStatus` et `TowerChallengeAttempt` nécessitent des changements de `prisma/schema.prisma` (réservé #325/#370) et le calcul des récompenses utilise `src/lib/tower-challenges.ts` (réservé #373). Aucun code de purge ou migration lancé dans cette PR.
