# Correction manuelle de l'XP (onglet « Joueurs » de `/admin`)

## À quoi ça sert
Corriger l'XP d'un joueur après un abus détecté (par exemple le farm « création puis
suppression de soirées »). L'onglet **Joueurs** du hub `/admin` permet de chercher un
membre par pseudo Discord, de voir son XP, son niveau, son rang, ses derniers gains
et ses corrections précédentes, puis de **remplacer** son solde d'XP après confirmation.

## Règles
- **Accès** : `requireAdmin()` (variable `ADMIN_DISCORD_IDS` ou rôle `ADMIN`), revérifié à chaque action.
- **Portée** : uniquement la **communauté actuelle** de l'admin (celle choisie dans « Serveurs »).
  Pour corriger l'XP d'un joueur d'un autre serveur, l'admin change d'abord de serveur actif.
  Le formulaire ne choisit jamais la communauté : elle est relue côté serveur à chaque envoi.
- **Niveau et rang** : calculés à la volée depuis le solde (`levelForXp`), rien d'autre à mettre à jour.
  Aucune annonce Discord de montée de niveau pour une correction.
- **Valeur** : entier de 0 à 10 000 000. Si le solde a changé entre l'affichage et la confirmation
  (gain simultané, autre admin), rien n'est écrit et la fiche est rechargée.
- **Journal** : chaque correction écrit une ligne `XpAdjustment` (communauté, joueur et admin avec
  leurs pseudos au moment de la correction, ancienne et nouvelle valeur, raison facultative, date).
  Le journal n'a pas de clé étrangère vers `User` : il survit à la suppression d'un compte.
- **Classements** : un `XpEvent` de motif `ADMIN_ADJUSTMENT` (montant = nouvelle − ancienne valeur,
  `sourceId` = identifiant de la correction) est ajouté au ledger, pour que les classements
  hebdomadaire/mensuel (qui additionnent le ledger) restent cohérents avec le solde corrigé.
- Les **badges** déjà débloqués ne sont pas retirés (ils comptent l'historique des gains).

## Migration (additive) — `20261009230000_admin_xp_adjustment`
1. `ALTER TYPE "XpReason" ADD VALUE 'ADMIN_ADJUSTMENT'`
2. `CREATE TABLE "XpAdjustment"` + deux index.

Aucune ligne existante n'est lue ni modifiée. Elle s'applique au build de **production**
(`prisma migrate deploy`), jamais au build Preview : une Preview branchée sur une base qui n'a
pas encore la migration ne pourra pas utiliser l'onglet « Joueurs » (le reste de l'app est inchangé).

### Avant de merger
- Créer une branche Neon de sauvegarde (comme `backup-avant-multiserveur`).
- Vérifier que `_prisma_migrations` ne contient aucune migration en échec sur la base de production.

### Retour arrière
Le code peut être annulé sans toucher à la base : la table et la valeur d'enum restent inertes.
Une valeur d'enum Postgres ne se retire pas simplement ; si nécessaire, laisser `ADMIN_ADJUSTMENT`
en place et ne supprimer que la table `XpAdjustment` (`DROP TABLE "XpAdjustment"`).
