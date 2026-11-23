# Passation de Claude Code A vers Claude Code B (23/11/2026, 08:55 UTC)

État relevé sur GitHub à 08:55 UTC. `main` = `413b2962` (fusion de #537). Les points de reprise restent [REPRISE_AUTONOME.md](REPRISE_AUTONOME.md), [CAHIER_FINAL.md](CAHIER_FINAL.md) et [LANCEMENT_GO.md](LANCEMENT_GO.md).

## 1. File de fusion (dans cet ordre, une PR à la fois)

Pour chaque PR, dans l'ordre :
1. Mettre la branche à jour avec main.
2. Attendre que `verify` et `immutable` soient vertes (~25 min).
3. Retirer le mode brouillon.
4. Fusionner (méthode « merge »).

| # | PR | Migration | État à 08:55 | Reste à faire |
| --- | --- | --- | --- | --- |
| 1 | #525 Code 1 défis (`claude/code1-defis-variete`) | `20261123100000_tower_challenge_variety` | à jour avec main, `verify` en cours (lancée à 08:32, tête `332d5f1e`) | fusionner dès le vert, écrire « APPROBATION À FAIRE : #525 », vérifier le run « Migrations Production » |
| 2 | #534 actus en français (B) | non | à jour avec main, `verify` en cours (lancée à 08:43) ; sera en retard après #525 | mettre à jour, CI, fusionner |
| 3 | #533 pluriels (B, brouillon) | non | en retard sur main, CI verte sur l'ancienne base | mettre à jour, CI, retirer le brouillon, fusionner |
| 4 | #535 « Victime » → « Recrue » (B) | non | en retard, CI verte sur l'ancienne base | mettre à jour, CI, fusionner |
| 5 | #536 sous-pages du profil (B, brouillon) | non | en retard, CI verte sur l'ancienne base | mettre à jour, CI, retirer le brouillon, fusionner |
| 6 | #526 Code 2 équipes (`claude/code2-equipes`) | `20261123110000_team_identity` | ouverte | mettre à jour, CI, fusionner, « APPROBATION À FAIRE : #526 » |
| 7 | #527 Code 3 joueurs (`claude/code3-joueurs`) | `20261123120000_player_matching_profile` | ouverte, CI verte sur `865436fe` | idem, « APPROBATION À FAIRE : #527 » |
| 8 | #529 Code 6 journal (`claude/code6-journal`) | `20261123130000_sensitive_operation_log` | ouverte | idem, « APPROBATION À FAIRE : #529 » |
| 9 | #530 débit partagé (`claude/securite-debit-partage`) | `20261123140000_shared_rate_limit` | ouverte ; **sera en conflit après #529** | voir le piège 3, puis idem, « APPROBATION À FAIRE : #530 » |
| 10 | #538 décisions de Maxime (docs, `claude/docs-decisions-maxime`) | non | CI verte sur `ab322af9`, sera en retard | mettre à jour, CI, fusionner |
| 11 | #539 Code 8 petites décisions (`claude/code8-petites-decisions`) | non | CI en cours | idem ; conflit possible avec #533 (pluriels sur les mêmes pages) : garder les deux changements |
| 12 | #506 Dependabot radix-dialog 1.3.1 | non | contrôle visuel fait (captures identiques au pixel près, mobile et ordinateur) | mettre à jour, CI, fusionner |
| 13 | #502 Dependabot setup-node v7 | non | ouverte | une par une après #506 |
| 14 | #501 Dependabot checkout v7 | non | ouverte (garde corrigée par #523) | en dernier |

L'ordre des PR sans migration (2 à 5, 10 à 14) est libre ; l'important est **une seule fusion à la fois**.

## 2. Migrations : fusionnées, approuvées

- **Aucune des 5 PR à migration (#525, #526, #527, #529, #530) n'est fusionnée ni approuvée.** Décision Q21 de Maxime : les fusionner maintenant, une par une.
- Après chaque fusion, écrire en une ligne « APPROBATION À FAIRE : #numéro ». ChatGPT approuve pour Maxime : GitHub → Actions → run « Migrations Production » → Review deployments → `production-migrations` → Approve and deploy (1 à 2 min).
- Vérifier que le run devient vert avant la PR à migration suivante. **S'il est rouge : STOP**, aucune autre fusion.
- Entre la fusion et l'approbation, Vercel sert le nouveau code sur l'ancien schéma : approuver vite.
- Chaque migration a son fichier de retour arrière dans `prisma/rollbacks/<nom>.sql` (exigé par `migrations-rollback.test.ts`, depuis #528).

## 3. Cahier final et LANCEMENT_GO

| Lot | État |
| --- | --- |
| Code 1 défis (C023, C019) | codé, PR #525 ouverte |
| Code 2 équipes (C032, C048) | codé, PR #526 ouverte |
| Code 3 joueurs (C036, C038, C039) | codé, PR #527 ouverte |
| Code 4 bascule et retour arrière (C075, C061) | **fait**, #528 fusionnée |
| Code 6 journal (C055) | codé, PR #529 ouverte |
| Sécurité : CSP bloquante et HSTS | **fait**, #524 fusionnée, vérifié en production |
| Sécurité : débit partagé | codé, PR #530 ouverte |
| Sécurité : Dependabot | #504 et #505 fusionnées ; #506, #502, #501 restent |
| Permissions et mentions du bot | **fait**, #537 fusionnée (masque 395408788496) |
| Code 8 petites décisions (Q6, Q10, Q13) | **en cours** : PR #539, CI en cours |
| Code 5 notifications (Q17–Q19 : MP personnels, moments marquants, ping de jeu sur abonnement) | à faire, débloqué |
| Code 7 Potes = amis (C128 : demande d'ami, recherche par pseudo, soirée publique ou privée vue par un non-ami) | à faire, migration nécessaire |
| Code 9 alerte avant saturation Neon et Vercel (Q11–Q12, [HEBERGEMENT.md](HEBERGEMENT.md)) | à faire ; il faudra que ChatGPT pose une clé `NEON_API_KEY` en lecture seule |

Les lots Code 7, 8 et 9, la ligne C128 et les réponses de Maxime (Q1–Q21) ne sont dans `main` qu'après la fusion de #538. LANCEMENT_GO.md : V3-11 passe à ✅ avec #539.

## 4. Interrupteurs prêts ([ALLUMAGES.md](ALLUMAGES.md))

- Lots A à G2 : prêts dans ALLUMAGES.md, à allumer par ChatGPT dans Vercel, un lot à la fois, chacun vérifié avant le suivant.
- Lot H (version de #538) :
  - Rétention : une semaine en simulation, puis exécution réelle (Q5).
  - Web Push : 3 clés VAPID, voir [WEB_PUSH_VAPID.md](WEB_PUSH_VAPID.md) (Q7).
  - `SESSION_VIDEO_ENABLED` : **ne pas allumer**. À la place, poser `DISCORD_PHOTOS_CHANNEL_ID` après #539 (Q6).
  - Présence vocale : oui, avec ses 4 migrations ; revérifier qu'elles sont appliquées (Q8).
- Défis d'équipe quotidiens à 18 h (Q9) : variables du dépôt pour `tower-team-daily.yml`.

## 5. Travail commencé et non poussé

Rien : tout est poussé. Les PR #539 et #538 portent le dernier travail. Les dossiers de travail dans le dossier temporaire de la session sont anciens et sans importance.

## 6. Pièges connus

1. **Règle stricte de main** (ruleset 27102401) : `verify` et `immutable` (GitHub Actions) doivent être vertes **sur une branche à jour avec main**, et toutes les discussions de relecture doivent être résolues. « 2 of 2 required status checks are expected » veut dire : la branche est en retard, sa CI ne compte plus. Il n'y a pas d'autre solution que mettre à jour et attendre ~25 min.
2. **Mise à jour d'une branche** : `update_pull_request_branch` avec le SHA complet de la tête, ou sans SHA.
3. **Conflit #530 après #529** : les deux PR touchent `CLAUDE.md`, `docs/CONTROLE_SECURITE.md`, `prisma/schema.prisma` (chacune ajoute un modèle à la fin), `src/app/api/admin/discord-commands/route.ts` et `route.test.ts` (imports et mocks `recordSensitiveOperation` et `checkSharedRateLimit`). Pour résoudre : `git merge origin/main` en local et garder les deux côtés, puis lancer `npx prisma validate`, tsc et le test de la route.
4. **Test instable en local seulement** : `src/components/BottomNav.browser.test.tsx` échoue toujours en local et passe en CI. Localement, lancer les tests unitaires avec `env -u TEST_DATABASE_URL npx vitest run`.
5. **Tests d'intégration** : un fichier à la fois, jamais deux lancements en parallèle, et ne jamais changer de branche pendant qu'un lancement utilise le dossier de travail (sinon le lancement n'est plus valable).
6. **Concurrence des équipes** (P2034) : déjà corrigée par #531 et #532 (5 essais avec attente croissante). Si l'erreur revient, chercher une vraie cause.
7. **Garde de `community-scope`** : un nouveau modèle avec une colonne `communityId` doit passer par le client scopé. #529 a contourné le problème avec `communityRef`.
8. **Garde `account-deletion-plan`** : toute nouvelle relation vers `User` doit être classée.
9. **Courriel de Maxime** : c'est `LEGAL_CONTACT_EMAIL`. Ne jamais l'écrire dans le dépôt ni dans un texte.
10. **Contradiction à trancher** : faire valider les preuves par une IA (Q1–Q4, prévu après le lancement) contredit la ligne du cahier § 9 « Aucune IA ne doit valider automatiquement les preuves dans la version initiale ». C'est signalé dans QUESTIONS_MAXIME.md (#538).
11. **Question ouverte pour Maxime** : sur /ascension, « Niveau d'XP 3 » s'affiche à côté de « Niveau 27 ». Faut-il garder ce nom ?
