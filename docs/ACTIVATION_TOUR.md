# Activation de la Tour en une soirée

Décision du propriétaire du 17 novembre 2026. Elle remplace « un interrupteur par jour » : les 4 interrupteurs sont conservés mais activés le même soir.

## Prérequis

- Migrations Tower appliquées en Production (voir [MIGRATIONS.md](MIGRATIONS.md)).
- Commandes `/tower` et `/tower-admin` enregistrées sur le serveur The Tower. Corriger d'abord le 403 : réinviter l'application (`scope=bot applications.commands`, permissions minimales de `src/lib/discord-setup-permissions.ts`), relancer l'enregistrement et lire le champ `code` de la réponse.
- `NOTIFICATION_EXECUTOR_ENABLED=true` (sans lui, rien n'est envoyé).

## Le soir de l'activation

1. Vercel : `TOWER_CHALLENGES_ENABLED=true` et `TOWER_DISCORD_ANNOUNCE_ENABLED=true`, avec **un seul redéploiement**.
2. Base de Production, drapeau communautaire :
   ```sql
   UPDATE "Community" SET "towerChallengesEnabled" = true WHERE "discordGuildId" = '553922938101825536';
   ```
3. Sur Discord : `/tower-admin importer`, puis `/tower-admin importer-equipe` (voir « Catalogue saison 1 » ci-dessous).

## Catalogue saison 1

Les deux commandes n'importent pas de fichier fourni à l'exécution : elles lisent des tableaux TypeScript du dépôt, regroupés par `src/lib/tower-challenge-import-packs.ts`. Aucun argument n'est à saisir.

| Commande | Fichiers lus | Contenu |
| --- | --- | --- |
| `/tower-admin importer` | `tower-challenge-starter-catalogue.ts` (26 défis de départ) + **`tower-s1-solo-catalogue.ts`** | +60 défis solo : 20 faciles (+1 étage), 25 moyens (+2), 15 difficiles (+3) |
| `/tower-admin importer-equipe` | `tower-team-challenge-starter-catalogue.ts` (10) + **`tower-s1-team-catalogue.ts`** | +20 défis d'équipe : 6 faciles, 9 moyens, 5 difficiles (équipes activées pour la communauté) |

- Format d'une entrée : `title`, `instructions`, `rewardFloors` (barème décidé : 1, 2 ou 3). Pas de champ de difficulté séparé.
- Limites : titre 120 caractères, consigne 1500 (colonnes VarChar et parseur de `/tower-admin ajouter`) ; les tests limitent le barème S1 à 1-3.
- Idempotent : déduplication sur le titre (insensible à la casse) par communauté et par mode ; un second passage ajoute 0 défi et ne réactive aucun défi désactivé. Les titres S1 sont distincts de ceux du pack de départ (test).
- Chaque consigne porte les règles du cahier §18-20 : preuve postérieure à l'attribution, exploit jamais réutilisé d'un autre défi, aucun achat requis (jeu gratuit accepté), aucune validation par IA. `src/lib/tower-s1-catalogue.test.ts` les contrôle avec le parseur réel.
- L'import n'envoie aucune annonce. Contrôle ensuite : `/tower-admin defis page:1` (12 défis par page).

## Contrôle

- `/tower` répond et affiche le catalogue importé.
- Une annonce de test part dans le salon configuré via la file existante.
- Aucune erreur dans les logs Vercel ni dans l'executor.

## Retour arrière

| Élément | Action |
| --- | --- |
| Annonces | `TOWER_DISCORD_ANNOUNCE_ENABLED` retiré ou ≠ `true`, redéploiement |
| Parcours de défis | `TOWER_CHALLENGES_ENABLED` retiré ou ≠ `true`, redéploiement |
| Communauté | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` |
| Catalogue importé | Conservé ; aucune suppression nécessaire |
