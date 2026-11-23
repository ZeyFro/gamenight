# Votes de preuves Tower sur Discord (`TOWER_DISCORD_VOTES_ENABLED`)

OFF par défaut, sans migration. S'ajoute aux annonces de preuve : exige `TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, `TOWER_DISCORD_GUILD_ID` et `TOWER_DISCORD_CHANNEL_ID`. Éteint, le comportement antérieur est inchangé (un seul vote définitif, boutons « Valider » / « Refuser »).

## Ce que le drapeau change
- **Message public** : boutons ✅ Valider / ❌ Refuser. Chaque vote, modification de vote, prolongation et règlement met en file une édition du même message (créneau `…:TOWER:<tentative>:proof`, opération `EDIT`) ; le contenu est relu à l'envoi, une rafale de votes se réduit à la dernière édition. Le message affiche le nombre de votants, jamais le détail pour/contre. Au règlement (validée, refusée, clos sans quorum) les boutons disparaissent.
- **Un fil par preuve** : créé depuis le message public (créneau `…:proof-thread`, une fois par soumission, avec le rang de resoumission de #465), archivage automatique 3 jours.
- **Votants** : membre actif de la communauté avec au moins 3 jours d'ancienneté (`Membership.joinedAt`). Ni auto-vote, ni vote d'un participant de l'équipe concernée, un seul vote par personne.
- **Vote modifiable** jusqu'à l'échéance (24 h, plus la prolongation unique de 24 h sans quorum, règles de #465). Le `createdAt` d'origine est conservé : le décompte du quorum ne change pas. L'échéance dépassée, la modification est refusée (`CLOSED`).

## Limites connues
- L'ancienneté est celle de la Membership GameNight, pas la date d'arrivée sur le serveur Discord (non stockée ; la lire demanderait un appel REST par votant).
- Si l'annonce publique n'a jamais été mise en file (annonces éteintes à la soumission), aucune édition n'est créée.
- Aucune écriture Discord directe : tout passe par la file et l'executor (`edit_channel_message`, `create_thread`).

## Dépendance
Fondée sur les règles de #465 (`voteExtendedAt`, `quorumResubmissions`, créneau `:rN`) : **à fusionner après #465**.
