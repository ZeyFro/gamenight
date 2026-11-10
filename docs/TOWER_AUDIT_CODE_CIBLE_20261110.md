# Vérification ciblée du code — 10 novembre 2026

> Relevé **lecture seule sur `main`**, issu des fichiers GitHub cités ci-dessous. N'a pas exécuté les tests ni contrôlé Discord/Vercel/Neon en fonctionnement. Complément à [la proposition de cahier](TOWER_AUDIT_CDC_PROPOSITION_20261110.md). Les constats sont des preuves de présence de code, jamais une garantie d'activation.

| Fonction | Preuve dans `main` | Verdict | Action |
|---|---|---|---|
| Équipes persistantes | `src/lib/community-teams.ts` (213 lignes) : `createCommunityTeam`, `joinCommunityTeam`, `leaveCommunityTeam`, `setCommunityTeamRecruitment` | **Code présent** | Revue des permissions + parcours multi-utilisateurs |
| Capacité équipes | `src/lib/community-teams-rules.ts` : `maxMembers: ...min(2).max(20)` | **Écart confirmé** : main accepte 20, décision du 04/11 limite à 8 | Reprendre la PR #370, pas de correctif concurrent |
| Petite annonce joueur | `src/lib/player-classifieds.ts` : annonces non expirées, membres ACTIVE, sous `playerClassifiedsEnabled` | **Code présent, activation non prouvée** | Tester flag et parcours réel, rechercher réutilisation dans les forums |
| Moteur de défis Tower | `src/lib/tower-challenges.ts` (792 lignes) : attribution solo, défi quotidien équipe, soumission preuve, vote, règlement, classement et vote de saison | **Code présent** | Vérifier contrats réels, flag, migration, quotas, interaction après redémarrage |
| Intégration Discord des défis | `src/lib/discord-tower-challenges.ts` (251 lignes) : interactions signées, présentation des défis, preuves, votes | **Code présent, commandes enregistrées non prouvées** | Recette Discord autorisée, ne pas déduire activation d'un fichier |
| Commandes staff | `src/lib/discord-tower-admin.ts` : vérification des permissions + actions ajouter/désactiver/importer | **Code présent** | Vérifier les limites d'autorisation et l'enregistrement effectif |
| Panneau d'accueil | `src/lib/tower-onboarding-panel.ts` : trois boutons Trouver des joueurs, Rejoindre une soirée, Commencer l'Ascension | **Code présent, publication volontairement non câblée à une route admin/cron** | Conserver la décision YAGPDB et tester depuis un nouveau compte |
| Destinations accueil | Même fichier : destinations `/joueurs`, `/sessions`, `/tower` | **À confirmer** : vérifier que les pages existent et restent accessibles suivant les droits | Test liens non authentifié + membre |
| Config serveur | `src/lib/tower-config.ts` : variable serveur avec fallback historique, garde propriétaire explicite | **Code présent** | Contrôler cohérence avec config réelle sans afficher les secrets |
| Build sans migration | `scripts/build.mjs` : `prisma generate`, puis `next build`, sans `migrate deploy` | **Confirmé par lecture** | Maintenir migration Production hors build, sous accord séparé |

## Écarts et décisions de mise en œuvre prioritaires

1. **Contradiction mesurable** : équipe max 20 sur `main` vs décision 2–8. #370 doit être traité selon la coordination #400, pas doublé.
2. **Parcours d'accueil** : le panneau de trois boutons existe ; preuve de sa publication sur Discord absente. Ne pas recréer une interface concurrente avant recette.
3. **Matchmaking** : petites annonces en base sous flag et forums Discord déjà déclarés existants par le propriétaire ; la passerelle « sélectionner un jeu → voir recherches/recrutements/projets pertinents » n'est pas prouvée.
4. **Vocal privé à la demande** : pas de preuve dans les fichiers ciblés qu'un système générique de groupes vocaux privés temporaires est livré ; réaliser un audit de l'existant avant d'ajouter des commandes.
5. **Sécurité / capacité** : une simulation à 500/2 000/10 000 inscrits requiert un modèle de concurrence, rate limits, quotas de salons temporaires et des tests en environnement contrôlé ; aucune capacité mesurée ici.

## Suite recommandée pour l'audit intégral

- Inventorier récursivement les sources, tests, schéma Prisma, migrations, workflows et code de déploiement sur SHA épinglé.
- Construire une matrice complète par exigence : référence, fichiers, tests, PR, flags, migrations, résultat réel et responsable.
- Vérifier la tête exacte des PR, les vérifications CI et les conflits de réservation #400 avant toute modification de code.
- Ne pas faire de nouveau développement sur les branches réservées à Claude/Work ; ne pas créer de onzième PR.

**État de publication :** document de travail non fusionné, à relire ; aucune autorisation de modifier Discord, Neon ou Production.
