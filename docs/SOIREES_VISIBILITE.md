# Soirées : visibilité, candidatures, coorganisateur, espace Discord temporaire

Interrupteur : `SESSION_VISIBILITY_ENABLED` (exactement `true`, OFF par défaut). Migration additive `20261118130300_session_visibility_waitlist` (après #416 ; appliquée après fusion par `migrate-production.yml`).

## Règles
- **Privée** (défaut, valeur des soirées existantes) : créateur et invités actifs uniquement, invisible aux autres dans toutes les listes et API (calendrier, accueil, profil, `/ce-soir`, iCal, médias). Flag éteint : toute valeur stockée est lue comme privée.
- **Publique** : visible dans « Soirées ouvertes » (`/sessions`) pour les membres actifs de la communauté ; « Rejoindre » crée une invitation ACTIVE. Un invité retiré par l'organisateur ne peut pas revenir seul.
- **Sur candidature** : « Candidater » crée une `SessionApplication` PENDING ; le créateur ou le coorganisateur accepte (crée l'invitation) ou refuse depuis `/sessions/[id]/invites`. Une candidature refusée ne se rouvre pas.
- **Garantie de non-fuite** : la visibilité n'élargit jamais `accessibleSessionWhere` (`session-access.ts`). Les soirées ouvertes passent par une liste distincte (`discoverableSessionWhere`) aux informations minimales (date, jeu, organisateur, places), jamais le contenu. Tests : `session-visibility.test.ts`, `session-visibility.integration.test.ts`.
- **Coorganisateur** (un seul, choisi par le créateur parmi les invités actifs) : gère invitations, candidatures et créneau ; ne supprime ni ne transmet la soirée. Perdre son invitation lui retire le rôle.
- **Liste d'attente** : réutilise les places existantes (`attendanceCapacity`, `SessionSeat`, promotion FIFO). Sur une soirée publique pleine, « Rejoindre » place en liste d'attente ; acceptation d'une candidature idem.

## Espace Discord temporaire
- Créé 30 min avant le début (soirée planifiée avec au moins un invité actif) : fil PRIVÉ dans le salon des soirées + salon vocal PRIVÉ (@everyone sans « Voir », participants avec Voir/Connexion/Parler, jamais de gestion). Participants = créateur, coorganisateur, invités actifs (ou places confirmées si la soirée a une capacité), 90 maximum (plafond Discord de 100 overwrites).
- Supprimé après la fin (statut terminé/annulé, ou début + 6 h faute d'heure de fin) **seulement si le vocal est vide**, vérifié participant par participant (`GET /guilds/{id}/voice-states/{user}`, REST sans gateway) ; lecture impossible = on ne supprime pas. Passages répétés jusqu'à 24 h après la fin, puis le staff nettoie à la main.
- Écritures Discord uniquement par la file : événement ADMIN `SESSION_SPACE_SYNC` → `NotificationDelivery` (BOT) → executor (`sync_session_space`, `session-space-runner.ts`). Balayage (création et nettoyage) dans `/api/cron/reminders` (file seulement). Accès d'un participant (rejoindre, accepter, retirer) synchronisé par l'intention `member`.
- Permissions requises côté bot (à vérifier par le propriétaire avant activation) : Gérer les salons, Gérer les fils, Créer des fils privés, Voir les salons. Aucune activation réalisée par cette PR.

## Limites connues
- Pas d'heure de fin de soirée dans le modèle : fin présumée = début + 6 h.
- Le fil d'annonce privé existant (invitations) est conservé tel quel ; l'espace temporaire est un second fil, éphémère, le temps de la soirée.
- Un changement de date après la création de l'espace ne le recrée pas.
