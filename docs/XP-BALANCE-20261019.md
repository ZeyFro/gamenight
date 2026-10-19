# Séparation de la progression et du solde XP

Décision de publication préparée : [opération exacte, impact, sauvegarde/restauration et bascule des writers](XP-ROLLOUT-DECISION-20261019.md). Aucune migration Production n'est autorisée par cette note.

Objectif autorisé : un achat conserve niveau et grade, tout en débitant une réserve dépensable distincte. Garder l'apparence et les règles existantes des autres événements.

Plan : prouver le défaut par tests unitaires rouges, ajouter `xpBalance` initialisé au `xpTotal` existant, mettre à jour tous les writers/lecteurs financiers et les agrégats de progression, compléter les fixtures et tests, puis vérifications ciblées et revue. Tests PostgreSQL uniquement après créneau coordonné avec root.

Le champ `xpTotal` garde le rôle de progression. Gains : même crédit des deux champs. Boutique : solde seul. Paris : mêmes règles de mise, sur le solde disponible, et même baisse de progression qu'avant. Absence et correction admin : même effet sur la progression qu'avant ; même delta sur le solde plafonné à zéro. Saisons : snapshot de progression, reset des deux champs, objets et équipement conservés.

Migration additive requise, sans restitution inventée des pertes historiques : le solde initial reprend la valeur actuelle. Une reconstruction depuis les seuls événements n'est pas fiable après les resets de saison et les débits de paris hors ledger.

**Blocage Production :** `scripts/build.mjs` lance `prisma migrate deploy` au build de Production. Ne pas fusionner cette branche tant que cette migration Production n'est pas explicitement autorisée. Aucun flag Production ni message Discord réel pour la recette. Brouillon seulement, publication coordonnée avec root.

Avant une éventuelle publication ultérieure, prévoir une bascule contrôlée des writers : l'ancien code ne met pas à jour `xpBalance`. Une migration pendant que l'ancienne version reçoit des gains peut désynchroniser le solde avant la mise en ligne du nouveau code. Cette procédure de Production reste à faire examiner ; aucun déploiement de cette branche n'est autorisé actuellement.

| Exigence | Code | Tests | Recette | Activation | Preuve / blocage |
|---|---|---|---|---|---|
| Achat sans perte de progression | `xp-shop.ts`, `member-stats.ts`, schéma | Unitaires boutique et PostgreSQL | `scripts/recette-boutique.mjs` : achats, équipement/retrait, solde insuffisant, grade mobile | Migration requise | Progression et rang restent identiques aux achats ; solde dépensable insuffisant refusé |
| Vrai solde et équipement | `xp-shop.ts`, page boutique, `XpBetForm` | Achats identiques/différents concurrents, insuffisance, équipement/retrait, suspension, isolation | PostgreSQL réel dédié seulement | Bloquée en Production | Solde jamais négatif, objets conservés au reset |
| Tous crédits/débits cohérents | `xp-actions.ts`, backfills, `xp-bets.ts`, `admin-xp.ts`, `seasons.ts` | Gains concurrents, backfills idempotents, achat/admin concurrents, pénalités, paris, reset | PostgreSQL réel dédié seulement | Bloquée en Production | Montants des pénalités et autres règles préservés |
| Affichages de progression | Classement, graphe profil, Wrapped | Classements PostgreSQL global/semaine/mois | Profil/recap sans nouvelle recette navigateur | Pas de flag ajouté | Événements boutique conservés au ledger mais exclus des agrégats de progression |
| Migration locale | `20261019190000_separate_xp_balance` | Table temporaire : initialisation, défaut zéro, refus du négatif | Appliquée uniquement sur le PostgreSQL dédié | Production interdite | Binding et base vérifiés avant migration ; aucune session tierce |

Preuves du 19 octobre 2026 : `tsc --noEmit`, ESLint ciblé et `next build --webpack` verts ; 252 fichiers / 1 979 tests unitaires verts, aucun ignoré (`--exclude '**/*.integration.test.*'`). Six suites PostgreSQL ciblées, 100 tests au total à l'état final, aucun ignoré : `xp-shop`, `xp-balance-migration`, `admin-xp`, `community-progression`, `community-progress-views`, `reward-notifications` ; fichiers exécutés en série, créneau PostgreSQL libéré après vérification de l'absence de connexions. Deux échecs du harnais de migration ont été corrigés (point-virgule dans un commentaire SQL découpé par le test) puis leurs tests repassés verts.

Dépendances réutilisées sans installation. Client Prisma et `.prisma` copiés dans ce worktree : génération isolée vérifiée, hash du schéma généré partagé inchangé. Recette locale authentifiée passée sur `gamenight_test` : acheter deux objets laisse `xpTotal` et le rang inchangés, équiper/retirer ne débite rien, un achat supérieur au solde est refusé même si `xpTotal` suffit ; vue 390×844 sans débordement. Aucun appel Discord réel, aucune opération Neon, aucun changement Production ni flag Production. La recette n'est pas une validation réelle des intégrations externes. Cette PR reste brouillon et ne doit pas être fusionnée : la migration Production et la coexistence/retour arrière avec les anciens writers demandent une stratégie examinée et autorisée avant tout déploiement.
