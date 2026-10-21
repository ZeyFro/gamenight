# Réservation des chantiers — PC fixe, 20 octobre 2026

Base vérifiée : `main` `3e0731b0471dd1d0d42933e2707beb395e83ed1e`. #305–308 fusionnées ; #291, #303 et #309 en brouillon. La session du portable n'est pas présumée arrêtée : #309 appartient à Claude, sa branche reste en lecture seule. Vérifier à nouveau les têtes distantes avant intégration.

Tous les chemins ci-dessous commencent par `C:/Users/Mousiouf/.codex/worktrees/mission-fixe2-` et finissent par `/gamenight`. Branches réservées `codex/fixe2-<chantier>-20261020` ; aucun ancien worktree modifié.

| Agent effectif | Chantier / worktree | Livrable et dépendance |
|---|---|---|
| `/root/a_xp` | `xp-20261020` ; base #291 `7523486` | Preuves XP/boutique et procédure de migration à approuver, sans Production |
| `/root/b_voice` | `voice-20261020` ; base #303 `8155b4f` | Fiabilité du collecteur, tests et lancement persistant préparé ; consentement/rétention/hôte restent à décider |
| `/root/c_discord` | `discord-20261020` ; base main | Validité des offres, rappels/RSVP/attente, réglages sans activation |
| `/root/d_browser` | `browser-20261020` ; base main | Manques de recette média et régressions navigateur sur fixtures ; créneau PostgreSQL exclusif |
| `/root/e_scope` | `scope-20261020` ; base main | Exigences/code/tests/activation ; corrections ciblées des permissions annoncées dans le guide |
| `/root/f_review` | `review-20261020` ; base #309 `f0a4ac6` | Revue indépendante authentification puis correctifs prêts ; branche Claude inchangée |
| `/root` | `coord-20261020` ; base main | Tableau unique `MISSION-20261019.md`, intégrations, CI, déploiements, verrou PostgreSQL |

Réservés au coordinateur : schéma Prisma, auth, package/lockfile, documents centraux. Les autres fichiers appartiennent à leur chantier ; prévenir avant extension. Pas de nouvelle dépendance applicative. Dépendances existantes réutilisées sans régénérer un client partagé.

PostgreSQL et recettes d'intégration exécutés en série, jamais en Production. Ports recette réservés : PostgreSQL `127.0.0.1:55447`, Next `127.0.0.1:3117`, transport Blob simulé `127.0.0.1:3118`. Un stockage simulé ne valide pas Vercel Blob réel. Les tests purs et lectures peuvent avancer en parallèle ; un seul build Next à la fois.

Aucune migration, interruption d'écrivains, modification de rôle, écriture de recette, activation de flag/cron/collecte ni message Discord réel en Production. Aucun hébergement payant choisi. #291/#303 restent brouillon. Incident endpoint du 20 octobre, 10:03:36–10:05:19 UTC : impact indéterminé, preuves et branches conservées ; aucune restauration ou répétition d'appel refusé.

Reprise : lire `MISSION-20261019.md` pour l'état fonctionnel consolidé ; ce fichier est une réservation de travail et ne constitue aucune preuve de livraison. Quota restant non observable.
