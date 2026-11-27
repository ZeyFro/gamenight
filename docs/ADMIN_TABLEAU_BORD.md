# Tableau de bord staff v2

Flag : `ADMIN_DASHBOARD_V2_ENABLED` (OFF par défaut, éteint = 404). **Sans migration.** Page `/admin/tableau-de-bord` (lien depuis `/admin` quand le flag est ouvert), accès `requireAdmin` (ADMIN seulement, sinon redirection). **Lecture seule** : aucune écriture base, aucune action serveur, aucune écriture Discord (garde statique dans `src/lib/admin-dashboard-v2.test.ts`).

## Contenu (par communauté active, 10 au plus)

- Candidatures d'équipe en attente (`TeamApplication` PENDING).
- Opérations Discord échouées (`NotificationDelivery` FAILED) : compte et 25 dernières (type d'événement, classe d'erreur, tentatives ; jamais de destinataire, de contenu ni de secret).
- Espaces d'équipe archivés à nettoyer (`DiscordTeamSpace.archived`) : la suppression réelle n'a lieu qu'à la dissolution, sur les deux salons enregistrés dans `DiscordTeamSpace` et vérifiés par identifiant. Aucun salon ou rôle hors de ce lien n'est supprimé.
- Contestations Tower ouvertes (`TowerChallengeAppeal` OPEN) dont celles en retard (`dueAt` dépassée).
- Rôles et salons du serveur contre les limites Discord (250 / 500), alerte dès 80 %. Deux GET Discord en lecture seule avec le jeton du bot (budget 4 s) ; échec ou jeton absent : « Indisponible », jamais un zéro trompeur.
- Alerte `/role` : événements ADMIN `ROLE_CAPACITY_ALERT` des 7 derniers jours (écrits par la PR de création automatique de rôle, sans effet tant qu'elle n'est pas fusionnée).

## Hors périmètre (à brancher après fusion des autres sujets)

Signalements de modération (`ModerationReport`, sujet L) et soutiens Nitro : ces tables n'existent pas dans `main` au moment de cette PR ; les ajouter est un simple `count` de plus.
