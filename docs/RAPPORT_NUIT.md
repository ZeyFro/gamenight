# Rapport de la nuit du 23 au 24 novembre 2026

Mission : terminer GameNight pour tout ce qui relève du code. Seul agent à fusionner dans `main`, une PR à la fois, CI verte (`verify`, `immutable`) avant chaque fusion. Aucune écriture sur Vercel, Neon ni Discord, aucun secret lu ou écrit.

## 1. PR fusionnées pendant la nuit

| PR | Contenu |
| --- | --- |
| #577 | Vercel : seul `main` déploie (`git.deploymentEnabled`) |
| #578 | Votants et signaleurs de doute Tower : 3 jours de présence (décision de Maxime) |
| #580 | Défi d'équipe : le capitaine confirme les participants, 3 récompenses d'équipe par jour au plus (migration `tower_participant_confirmation`, run vert) |
| #581 | Force-relogin : secret dédié `FORCE_RELOGIN_SECRET`, section « Pour ChatGPT » de ALLUMAGES.md |
| #582 | `MESSAGES_SALONS.md` : messages des 29 salons et des 13 commandes |
| #583 | Plafond Steam : 2 h de jeu par jour pour la validation automatique |
| #584 | XP de tournoi : 5 gains sur 7 jours, 3 participants établis |
| #585 | XP de vote : 10 propositions et 10 gains par soirée |
| #586 | 10 soirées et 5 tournois par personne et par jour |
| #587 | Vocabulaire : plus de « Level up » ni de « deadline », « Qui prévenir ? » vide par défaut (garde de test) |
| #588 | `PROCEDURES_PREUVES.md` : procédure de preuve des 17 éléments non vérifiés en réel |
| #592 | PWA : icône Apple 180×180 opaque, icône maskable dédiée |
| #593 | Cahier : test de bascule des étages (C075), critères de migrations (C061), garde du journal des opérations sensibles (C055), limites des demandes d'ami, quota de 20 MP par jour |
| #591 | Notifications, lot 5 : listes fermées par type, refus avant tout envoi (`notification-kinds.ts`) |
| #594 | Journal d'erreurs serveur en base, 30 jours, page `/admin/erreurs` (migration `server_error_log`, run vert) |
| #589, #590 | ALLUMAGES.md : lot J, regroupement en redéploiements R0 à R5, ordre des prochains lots et tâches cron |
| #579 | Vercel : motif `**` en plus de `*` pour les branches contenant `/` |

Avant la nuit, dans la même journée : #552 à #576 (bugs de l'audit visuel, sécurité, limites de débit, iPhone, OG), voir [AUDIT_FINAL.md](AUDIT_FINAL.md).

**Mises de côté** : aucune PR n'a échoué trois fois sur le même test. **#514** (galerie de preuves) reste en brouillon, jamais fusionnée, comme demandé. Un sous-agent « plafonds » a atteint sa limite de 5 heures : son travail a été repris et fusionné (#583 à #586).

## 2. État des migrations et de la production

- **159 dossiers de migration**, **35 runs « Migrations Production », tous verts**. Dernier run : n° 35, commit `4685ceb2` (migration `20261124120000_server_error_log`). Migrations de la nuit : `tower_participant_confirmation` et `server_error_log`, toutes deux vertes. Aucun arrêt total déclenché.
- **Déploiement de production** : vérifié le 24/11 à 06:12 UTC. Les commits de #579 et #595 avaient été refusés par le quota gratuit de Vercel (100 déploiements par jour, « retry in 24 hours »), pas par le code. Après remise à zéro du quota, le commit `94b9bce6` (#596) s'est déployé en Production avec la configuration de #579 : **#579 est confirmée, aucun revert nécessaire**.

## 3. Ce qui reste, par catégorie

- **Code** : [CAHIER_FINAL.md](CAHIER_FINAL.md) recompté sur ses 148 lignes : 58 faites, 40 codées et éteintes (en attente d'allumage), 11 codées non vérifiées en réel, 1 partielle (C029 : exploits insolites et distinctions humoristiques, derrière `COMMUNITY_HIGHLIGHTS_ENABLED`), 5 côté Discord, 24 sans code, 9 reportées après le lancement, **0 « Non fait »**. Restent deux points de code mineurs de l'audit : test d'accès d'un tiers non membre sur les actions de délégation, et limite d'écriture générique ([AUDIT_FINAL.md](AUDIT_FINAL.md), lignes « Restant »).
- **Allumages** : tout est préparé dans [ALLUMAGES.md](ALLUMAGES.md), lots A à J, 6 redéploiements R0 à R5, avec variables exactes, ordre, vérifications et retour arrière.
- **Preuves en réel** : [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md), une procédure par élément.
- **Discord** : [MESSAGES_SALONS.md](MESSAGES_SALONS.md), [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md).
- **Non vérifiable d'ici** : `robots.txt` pour l'aperçu Discord (3.4), `badge` monochrome des notifications iPhone (2.8), rendu visuel réel de `/admin` sur mobile.

## 4. À faire par ChatGPT (dans l'ordre)

1. Créer `FORCE_RELOGIN_SECRET` : [ALLUMAGES.md](ALLUMAGES.md) § « Pour ChatGPT » (a).
2. Vérifier ou créer les **19 tâches cron-job.org** : même section, (b) (adresse, horaire, fuseau, en-tête `Authorization: Bearer <CRON_SECRET>`, e-mail d'échec).
3. Poser les interrupteurs par redéploiement **R0 à R5** : [ALLUMAGES.md](ALLUMAGES.md) § « Regroupement » et § « Ordre des prochains lots » (c).
4. Enregistrer les 13 commandes (`/admin/discord-commands`), importer le catalogue de défis : [LANCEMENT_GO.md](LANCEMENT_GO.md) C1, C2.
5. Publier les messages des salons : [MESSAGES_SALONS.md](MESSAGES_SALONS.md) ; permissions des bots : [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md).
6. Séparer les secrets Preview et Production (E4) : [LANCEMENT_GO.md](LANCEMENT_GO.md) E4.

## 5. À faire par Maxime (humain seulement)

- Code 2FA demandé lors des connexions Vercel, Neon, Discord, GitHub (E3).
- Test sur un vrai iPhone (installation sur l'écran d'accueil puis notifications).
- Test avec un pote : demande d'ami, soirée, tournoi, défi d'équipe.
- Branche de sauvegarde Neon avant l'annonce (A4) et essai de restauration si personne d'autre n'a accès à Neon.
- Décision de capacité (D3), relevé hebdomadaire du temps de calcul Neon, tableau « Qui contacter » du runbook.

## 6. Décisions prises seul cette nuit, pour validation

1. **Annonce publique « Jouer maintenant » conservée** : le sous-agent du lot 5 l'avait retirée ; je l'ai remise comme moment marquant public, sans aucune mention (`INSTANT_SESSION_ANNOUNCE`, mise à jour comprise). Le comportement visible ne change pas.
2. **Pas de ping de rôle de jeu branché** : la garde existe (`buildGameRolePing`, abonnés opt-in), aucun appelant. Option la plus restrictive ; à brancher si Maxime le demande.
3. **Quota de 20 MP par jour et par personne** (`assertDmQuota`).
4. **Lot 5** : trois types techniques ajoutés aux listes fermées (mise à jour publique, contexte de fil, action système) ; une combinaison inconnue est refusée avant l'envoi.
5. **Plafonds** : valeurs validées par Maxime ; participants distincts non exigés pour la présence (le plafond de 3 par jour suffit) ; seuil de 3 jours appliqué avec `>=`.
6. **Journal d'erreurs** : aucun interrupteur, première apparition / dernière apparition par empreinte, purge à 30 jours par la tâche mensuelle, non-admins renvoyés à l'accueil, Prisma chargé à l'écriture seulement (pour le workflow « Tower challenge rules »).
7. **#579 gardée malgré le quota Vercel** : le refus venait du quota ; confirmé le 24/11 par le déploiement réussi de `94b9bce6`.
8. **Icônes** : icône Apple et maskable générées ; `badge` monochrome non fait (rien pour le contrôler visuellement).
9. **Regroupement des allumages** en 6 redéploiements (R0 à R5) pour limiter les codes 2FA.
