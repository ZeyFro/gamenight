# Séparation de la progression et du solde XP

Objectif autorisé : un achat conserve niveau et grade, tout en débitant une réserve dépensable distincte. Garder l'apparence et les règles existantes des autres événements.

Plan : prouver le défaut par tests unitaires rouges, ajouter `xpBalance` initialisé au `xpTotal` existant, mettre à jour tous les writers/lecteurs financiers et les agrégats de progression, compléter les fixtures et tests, puis vérifications ciblées et revue. Tests PostgreSQL uniquement après créneau coordonné avec root.

Le champ `xpTotal` garde le rôle de progression. Gains : même crédit des deux champs. Boutique : solde seul. Paris : mêmes règles de mise, sur le solde disponible, et même baisse de progression qu'avant. Absence et correction admin : même effet sur la progression qu'avant ; même delta sur le solde plafonné à zéro. Saisons : snapshot de progression, reset des deux champs, objets et équipement conservés.

Migration additive requise, sans restitution inventée des pertes historiques : le solde initial reprend la valeur actuelle. Une reconstruction depuis les seuls événements n'est pas fiable après les resets de saison et les débits de paris hors ledger.

**Blocage Production :** `scripts/build.mjs` lance `prisma migrate deploy` au build de Production. Ne pas fusionner cette branche tant que cette migration Production n'est pas explicitement autorisée. Aucun flag Production ni message Discord réel pour la recette. Brouillon seulement, publication coordonnée avec root.

Avant une éventuelle publication ultérieure, prévoir une bascule contrôlée des writers : l'ancien code ne met pas à jour `xpBalance`. Une migration pendant que l'ancienne version reçoit des gains peut désynchroniser le solde avant la mise en ligne du nouveau code. Cette procédure de Production reste à faire examiner ; aucun déploiement de cette branche n'est autorisé actuellement.

| Exigence | Code | Tests | Recette | Activation | Preuve / blocage |
|---|---|---|---|---|---|
| Achat sans perte de progression | `xp-shop.ts`, `member-stats.ts`, schéma | Unitaires boutique et PostgreSQL | Pas de recette navigateur sur cette branche | Migration requise | Rouge initial observé : 3 échecs ; après correction, achat et grade conservés |
| Vrai solde et équipement | `xp-shop.ts`, page boutique, `XpBetForm` | Achats identiques/différents concurrents, insuffisance, équipement/retrait, suspension, isolation | PostgreSQL réel dédié seulement | Bloquée en Production | Solde jamais négatif, objets conservés au reset |
| Tous crédits/débits cohérents | `xp-actions.ts`, backfills, `xp-bets.ts`, `admin-xp.ts`, `seasons.ts` | Gains concurrents, backfills idempotents, achat/admin concurrents, pénalités, paris, reset | PostgreSQL réel dédié seulement | Bloquée en Production | Montants des pénalités et autres règles préservés |
| Affichages de progression | Classement, graphe profil, Wrapped | Classements PostgreSQL global/semaine/mois | Profil/recap sans nouvelle recette navigateur | Pas de flag ajouté | Événements boutique conservés au ledger mais exclus des agrégats de progression |
| Migration locale | `20261019190000_separate_xp_balance` | Table temporaire : initialisation, défaut zéro, refus du négatif | Appliquée uniquement sur le PostgreSQL dédié | Production interdite | Binding et base vérifiés avant migration ; aucune session tierce |

Preuves du 19 octobre 2026 : `tsc --noEmit` et ESLint ciblé verts ; 252 fichiers / 1 979 tests unitaires verts, aucun ignoré (`--exclude '**/*.integration.test.*'`). Six suites PostgreSQL ciblées, 100 tests au total à l'état final, aucun ignoré : `xp-shop`, `xp-balance-migration`, `admin-xp`, `community-progression`, `community-progress-views`, `reward-notifications` ; fichiers exécutés en série, créneau PostgreSQL libéré après vérification de l'absence de connexions. Deux échecs du harnais de migration ont été corrigés (point-virgule dans un commentaire SQL découpé par le test) puis leurs tests repassés verts.

Dépendances réutilisées sans installation. Client Prisma et `.prisma` copiés dans ce worktree : génération isolée vérifiée, hash du schéma généré partagé inchangé. Aucun appel Discord réel, aucune opération Neon, aucun changement distant ni flag Production. Build Next et recette navigateur de cette branche restent à vérifier ; un succès des tests locaux ne vaut pas validation des intégrations externes.
