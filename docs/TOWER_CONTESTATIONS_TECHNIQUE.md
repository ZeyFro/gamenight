# Contestation 7B — conception technique, NON IMPLÉMENTÉE

Le propriétaire a choisi : auteur de la preuve refusée, motif obligatoire, délai envisagé **7 jours** après refus, décision motivée du modérateur ; si l'auteur est le modérateur, **arbitre indépendant** nommé par le propriétaire, sans droits administrateur Discord.

## Modèle recommandé (migration future)
- `TowerChallengeAppeal` : `communityId`, `attemptId` **unique**, `authorUserId`, `reason` (limité), `createdAt`, `dueAt`, `status` (OPEN/UPHELD/OVERTURNED), `reviewerUserId`, `decisionReason`, `decidedAt`.
- Garder le vote communautaire initial immuable, aucune réouverture.
- Conserver dans la base le lien vers la preuve d'origine et ses auteurs ; ne jamais effacer un dossier en cours de contestation.
- Bouton « Contester » visible uniquement pour `REJECTED` durant 7 jours. Autorisation validée dans la transaction, pas seulement l'UI.
- Si `authorUserId` est le modérateur, interdire toute validation par ce modérateur, y compris via API ou commande ; l'arbitre indépendant doit être un membre distinct et non impliqué.
- **Renversement d'un refus** : la même transaction doit vérifier que la récompense n'a jamais été donnée, recalculer le plafond de deux réussites/jour pour l'auteur et chaque participant, et poser un marqueur d'attribution idempotent. Si plafond atteint, rester en attente de remise à zéro selon les règles déjà applicables aux équipes.
- Journal auditable des décisions, sans exposition publique des données de modération.

## Tests PostgreSQL requis
Aucun auteur tiers ne peut contester, délai exact J+7, double clic et double décision simultanés, arbitre distinct, interdiction de se juger, deux récompenses/jour, pas de double attribution, décisions conservées après purge.

## Blocage technique
`prisma/schema.prisma` est modifié par les PR **#325 et #370**, `src/lib/tower-challenges.ts` par **#373**. Conformément à la règle « pas de fichier modifié par une autre PR ouverte », aucune migration ou handler n'est ajouté dans cette PR. La rédaction des règles publiques appartient à Claude.
