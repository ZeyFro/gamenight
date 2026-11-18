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

---

# Plan de la soirée d'activation (lancement de la semaine du 1er décembre 2026)

> Plan de préparation, pas une exécution : rien n'a été activé, aucune commande Discord enregistrée, aucune variable Vercel modifiée. Chaque action réelle reste exécutée par Maxime (ou sous son accord explicite). Statut de chaque fonction : [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md). Textes à publier : [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md).

## Les 4 interrupteurs et leur ordre

Le texte de décision du 17/11 parle de « 4 interrupteurs » sans les nommer ; la section ci-dessus ne décrit que trois actions. Lecture retenue ici (**à confirmer par Maxime**) :

| N° | Interrupteur | Où | Obligatoire le soir ? |
| --- | --- | --- | --- |
| 1 | `TOWER_CHALLENGES_ENABLED=true` | Vercel Production | Oui |
| 2 | `TOWER_DISCORD_ANNOUNCE_ENABLED=true` | Vercel Production (même redéploiement que le 1) | Oui |
| 3 | `Community.towerChallengesEnabled = true` | Base de Production, serveur The Tower | Oui |
| 4 | `TOWER_TEAM_DAILY_ENABLED=true` | Vercel Production | **Non, tant que les prérequis ci-dessous ne sont pas remplis** |

Prérequis hors interrupteurs : `NOTIFICATION_EXECUTOR_ENABLED=true` ; `CRON_SECRET` défini ; commandes `/tower` et `/tower-admin` visibles.

Pourquoi cet ordre : 1 et 2 partent ensemble (un seul redéploiement) mais ne servent à rien sans 3 ; 3 est la porte d'accès par communauté (jamais une autre communauté) ; l'import du catalogue exige 1 et 3 ; 4 est le dernier car il génère des attributions automatiques.

## Prérequis à cocher avant la soirée

- [ ] Pile de PR (#370, #406, #407, #408, #416) fusionnée ou explicitement écartée du périmètre ; migrations appliquées en Production selon [MIGRATIONS.md](MIGRATIONS.md) (CI verte, environnement `production-migrations`).
- [ ] Application GameNight réinvitée avec `applications.commands` ; `node scripts/register-tower-guild-commands.mjs --check` (lecture seule) lu, puis `--execute` par Maxime ; `--check` relancé ; commandes visibles pour un compte membre et un compte modérateur.
- [ ] Salons configurés : `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `TOWER_DISCORD_GENERAL_CHANNEL_ID` renseignés (valeurs jamais dans le dépôt).
- [ ] Arbitre indépendant désigné (obligatoire avant d'annoncer les contestations).
- [ ] Valeurs précédentes relevées (pour le retour arrière) : environnement ET base.
- [ ] Catalogue relu ([TOWER_SAISON1_CATALOGUE_30.md](TOWER_SAISON1_CATALOGUE_30.md)) : le code contient 26 défis solo et 10 d'équipe, soit 36 et non 30 : trancher avant l'import.
- [ ] Textes de [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md) relus, étiquettes mises à jour.

## Qui fait quoi

| Rôle | Actions |
| --- | --- |
| Maxime (propriétaire) | Seul à modifier Vercel, la base de Production, Discord (enregistrement des commandes, publication des messages) ; décide du go/no-go. |
| Claude (ce dépôt) | Prépare et relit les documents, vérifie l'état du code et des PR ; n'écrit rien sur Discord, Vercel ni Neon. |
| Arbitre indépendant | Joignable pendant la soirée ; ne vote pas ; tranche toute contestation (dès qu'elle est livrée). |
| Testeurs réels (3 au moins, hors auteur) | Compte non modérateur : un défi, une preuve, trois votes distincts. Aucun faux compte. |

## Déroulé (ordre exact)

| Étape | Action | Qui | Contrôle immédiat |
| --- | --- | --- | --- |
| H+0 | Relever les valeurs actuelles des interrupteurs et du flag communautaire | Maxime | Notées sans secret |
| H+0:15 | Interrupteurs 1 et 2 sur Vercel Production, **un seul redéploiement** | Maxime | Déploiement READY, aucune erreur de build |
| H+0:30 | Interrupteur 3 (requête SQL ci-dessus) | Maxime | 1 ligne mise à jour, aucune autre communauté |
| H+0:40 | `/tower-admin importer` puis `/tower-admin importer-equipe` | Maxime | Rapport « ajouté / déjà présent » ; relancer = 0 ajout (idempotence) |
| H+0:50 | Section « Contrôle » ci-dessus, avec un compte non modérateur | Maxime + testeur | `/tower` répond, catalogue visible |
| H+1:10 | Parcours réel : défi, preuve, 3 votes distincts, récompense, quota | Testeurs | Étages crédités une seule fois |
| H+1:40 | Interrupteur 4 seulement si ses prérequis sont remplis ; observer le premier passage du cron | Maxime | `enabled=true`, `failed=0`, `complete=true` |
| H+2:00 | Go/no-go ; annonce d'ouverture publiée **seulement si tout est vert** | Maxime | Étiquettes du guide à jour |

### Condition de l'interrupteur 4 (défi d'équipe quotidien)

À ne pas activer tant que : l'attribution à **18:00 Europe/Paris** (décision) n'est pas alignée avec le code (09:00, voir `docs/TOWER_TEAM_DAILY_CRON.md`) ; les règles d'équipe 2–8 / équipe unique (#370) ne sont pas fusionnées ; la cadence externe n'a pas été constatée en lecture. Sinon, laisser OFF et garder la ligne « défi d'équipe » en [PRÉVUE] dans les textes. Le workflow `.github/workflows/tower-team-daily.yml` est fusionné (#396) ; le fonctionnement reste à observer.

## Contrôles supplémentaires

- Aucune erreur dans les logs Vercel ni dans l'executor (`/api/cron/notification-executor`, réponse 202, résultat dans les logs).
- Une seule annonce par réussite, sans doublon.
- Un compte d'une autre communauté ne voit aucune donnée de The Tower.
- Aucun rôle Discord ni permission modifié (les rangs restent affichés dans GameNight).
- Plafond de 2 réussites par jour et délai de 12 h vérifiés une fois chacun.

## Arrêt et retour arrière

Arrêt immédiat si : donnée d'une autre communauté, récompense double, annonce en boucle, erreur 5xx persistante. Ne rien supprimer ; défaire dans l'ordre inverse.

| Ordre | Action |
| --- | --- |
| 1 | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` : coupe l'accès sans redéploiement ; à faire en premier si l'incident touche les données |
| 2 | Interrupteur 4 : `TOWER_TEAM_DAILY_ENABLED` retiré ou ≠ `true` |
| 3 | `TOWER_DISCORD_ANNOUNCE_ENABLED` et `TOWER_CHALLENGES_ENABLED` retirés ou ≠ `true`, un redéploiement |
| 4 | Annonce erronée déjà partie : supprimée à la main par Maxime ; ne pas rejouer la file |
| 5 | Catalogue, étages et preuves conservés (aucune suppression) |

Les migrations ne se défont pas par ce plan : suivre [MIGRATIONS.md](MIGRATIONS.md) et [TOWER_SNAPSHOT_RESTORE_PROCEDURE.md](TOWER_SNAPSHOT_RESTORE_PROCEDURE.md).
