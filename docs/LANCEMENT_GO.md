# Lancement — la ligne d'arrivée (GO / NO-GO)

> Relevé du 23 novembre 2026, en lecture seule. Sources : code de `main`, variables de Production lues dans Vercel (valeurs « Sensibles » illisibles), base Neon lue par une requête `SELECT`, exécutions GitHub. Ce document **remplace** pour le jour J : [CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md), [PLAN_TESTS.md](PLAN_TESTS.md) (à exécuter), [CONTROLE_SECURITE.md](CONTROLE_SECURITE.md) et les 21 constats « avant ouverture » de [AUDIT_APP_20261120.md](AUDIT_APP_20261120.md).
>
> **Règle du lancement** (décision de Maxime) : on lance avec les interrupteurs **déjà allumés**, on n'en allume pas d'autres.
>
> **Lecture.** ✅ fait et vérifié · 🔴 à faire avant l'annonce · 🟠 à faire, non bloquant · ⬜ non vérifiable d'ici (preuve à apporter). Responsables : **Maxime** (comptes, décisions, secrets), **ChatGPT** (gestes dans Discord et dans les consoles, guidé pas à pas), **Claude Code** (code et documentation).

---

## 1. Les critères (liste fermée)

**GO = toutes les lignes 🔴 passées en ✅.** Les lignes 🟠 peuvent attendre la semaine 1.

### A. Base de données et déploiement

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| A1 | Migrations à jour | Claude Code | ✅ **151 migrations appliquées sur 151** dans `prisma/migrations`, 0 inachevée, 0 annulée, dernière `20261121100000_account_deletion_log`. Dernier run « Migrations Production » : **n° 27, vert**, 21/11 03:24 UTC (27 runs, tous verts). Les migrations s'appliquent **automatiquement à la fusion** dans `main` (aucune approbation : environnement sans relecteur, constaté sur #525 à #527) ; après chaque fusion à migration, vérifier que le run est vert. | Requête `SELECT` sur `_prisma_migrations` (faite) ; GitHub → Actions → « Migrations Production ». |
| A2 | Production déployée sur le dernier `main`, état READY | Claude Code | ✅ à chaque fusion (dernier relevé : déploiement READY de #517) | Vercel → Deployments : le premier est « Production · Ready ». |
| A3 | Aucune fusion pendant la semaine du lancement, Dependabot compris | Maxime | ✅ les 5 PR Dependabot (#501, #502, #504, #505, #506) restent ouvertes | Liste des PR ouvertes. |
| A4 | Sauvegarde : retour arrière possible | Maxime + ChatGPT | 🔴 L'offre Neon gratuite ne garde que **6 heures** d'historique : une erreur vue le lendemain n'est plus réparable. Créer une **branche de sauvegarde** juste avant l'annonce. | Capture de la branche de sauvegarde datée dans la console Neon. |

### B. Pages légales et données personnelles

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| B1 | Pages légales en ligne, complètes | Claude Code | ✅ `LEGAL_PAGES_ENABLED` et les 4 `LEGAL_*` posés ; plus aucun « À COMPLÉTER » (#516, test qui échoue s'il en réapparaît un) ; âge minimum **13 ans** | `/mentions-legales`, `/confidentialite`, `/conditions` s'ouvrent sans connexion. |
| B2 | Adresse de contact lue | Maxime | 🟠 renseignée (adresse personnelle, publiée en clair) ; une adresse dédiée éviterait le spam | Un e-mail de test reçu et lu. |
| B3 | Région du stockage de fichiers (Vercel Blob) | Maxime | 🟠 inconnue ; la politique dit « réseau mondial de Vercel » (vrai, mais imprécis) | Capture de Vercel → Storage → le magasin Blob → région. |
| B4 | Export et suppression de compte | Maxime | ✅ code + interrupteur allumé + migration appliquée ; 🔴 **test humain à faire** (compte de test) | Fichier JSON exporté (gardé privé) ; capture « Ancien membre » après suppression. |

### C. Discord

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| C1 | **13 commandes enregistrées** | ChatGPT (guidé) + Maxime | 🔴 l'enregistrement s'arrêtait à 5/13 sur la limite de débit Discord ; corrigé par la **PR #518**. Après fusion : ouvrir `/admin/discord-commands`, « Enregistrer », recliquer tant qu'il reste des lignes « en attente ». | Capture du tableau : 13 lignes « enregistrée » ou « déjà à jour ». Procédure de preuve : [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md) § C002. |
| C2 | **Catalogue de défis rempli** | ChatGPT (guidé) | 🔴 **0 défi en base** (relevé du 22/11). Après C1 : `/tower-admin importer` (89 défis solo, dont 2 hors jeu et 1 à preuve ancienne) puis `/tower-admin importer-equipe` (30 défis d'équipe, si les équipes sont activées). Aucune annonce n'est envoyée. | Réponse privée « X défis ajoutés » ; `/tower` montre des défis. |
| C3 | Bot sans Administrateur | ChatGPT (guidé) | 🔴 le rôle **Workshop** (Administrateur) est porté par 12 bots, et GameNight a Administrateur via **AppBot** : suivre [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) | Capture des rôles de chaque bot, sans Administrateur ; tests de [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) passés. Procédure de preuve : [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md) § C011 et § C056. |
| C4 | Message du guide corrigé | ChatGPT | 🔴 il dit encore « Tes étages actuels restent en place » ; texte de remplacement dans [MESSAGES_LANCEMENT.md](MESSAGES_LANCEMENT.md) | Capture du message édité, datée. |
| C5 | Salon de retours et de bugs | ChatGPT | 🔴 à créer ou désigner, avec un message épinglé | Lien du salon. |
| C6 | Portail Discord Developer vérifié | Maxime | ⬜ adresse de retour OAuth, adresse des interactions, scopes | Capture des réglages. |
| C7 | Annonces et MP partent bien | Maxime | ⬜ `NOTIFICATION_EXECUTOR_ENABLED` présent mais valeur cachée ; dépend aussi de cron-job.org | Une soirée de test crée une annonce dans le bon salon et un MP. Procédure de preuve : [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md) § C003 et § C093. |

### D. Fonctionnement et surveillance

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| D1 | Tâches automatiques actives | Maxime | ⬜ aucune n'est créée par le code ; à vérifier sur cron-job.org, au minimum `notification-executor`, `reminders`, `close-sessions` | Capture de la liste des tâches et de leur dernier résultat (200 ou 202). |
| D2 | Alerte de panne | Maxime | 🔴 aucune surveillance prouvée ; un moniteur doit appeler `/api/health` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` | Capture du moniteur et d'une alerte de test reçue. |
| D3 | Capacité suffisante pour l'afflux | Maxime | 🔴 voir [CAPACITE.md](CAPACITE.md) : l'offre gratuite de Vercel (4 h de calcul par mois) et celle de Neon peuvent **couper le site** au-delà d'une centaine de membres actifs | Décision écrite : offres payantes prises, ou plafond d'invitations fixé. |
| D4 | Runbook prêt | Maxime | 🟠 [RUNBOOK.md](RUNBOOK.md) : tableau « Qui contacter » à remplir | Tableau rempli. |

### E. Sécurité

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| E1 | Pages d'administration refusées aux visiteurs | Claude Code | ✅ `/admin` renvoie à l'accueil, `/api/compte/export` 401, cron 401, `/api/admin/discord-commands` en GET 405 (relevé du 22/11) | [CONTROLE_SECURITE.md](CONTROLE_SECURITE.md). |
| E2 | Aucun secret dans le code ni dans le navigateur | Claude Code | ✅ | Idem. |
| E3 | Double authentification sur Vercel, Neon, Discord, GitHub | Maxime | ⬜ | Capture de chaque page « Sécurité » du compte. |
| E4 | Preview isolée de la Production (constat V4-15) | Maxime + ChatGPT | 🔴 **écart trouvé** : `AUTH_SECRET`, `DISCORD_CLIENT_SECRET`, `DISCORD_WEBHOOK_URL`, `STEAM_API_KEY`, `IGDB_*` et `DEEPL_API_KEY` sont partagés entre Production et Preview. Un même `AUTH_SECRET` rend les sessions d'une Preview valables en Production. Donner à Preview son propre `AUTH_SECRET` et retirer `DISCORD_WEBHOOK_URL` de Preview. | Capture des variables : ces clés en « Production » seulement, ou avec une valeur propre à Preview. |
| E5 | En-têtes de sécurité réels | Maxime | ⬜ vérifiés dans le code seulement | Rapport de securityheaders.com sur l'adresse du site. |
| E6 | Politique de sécurité du navigateur (CSP) bloquante | Claude Code | 🟠 en mode « observation » : à durcir après le lancement | — |

### F. Tests humains ([PLAN_TESTS.md](PLAN_TESTS.md))

| # | Critère | Responsable | Statut réel | Preuve attendue |
| --- | --- | --- | --- | --- |
| F1 | Compte hors serveur refusé ; compte neuf accueilli | Maxime | 🔴 à faire | Captures N1 et N2. |
| F2 | Parcours membre sur ordinateur **et** téléphone | Maxime | 🔴 à faire | Captures R1 à R8 et N5. |
| F3 | Pings : créateur jamais mentionné, aucun `@everyone` | Maxime | 🔴 à faire (après C1 et C7) | Captures Discord. |
| F4 | Admin : contestation tranchée, commandes vérifiées | Maxime | 🟠 à faire | Captures A1 à A3. |

---

## 2. État des 21 constats « avant ouverture » de l'audit

Le triage de l'audit marque 15 constats « corrigé ». **Mais 5 d'entre eux ne sont corrigés que derrière un interrupteur éteint**, et la règle du lancement est de ne pas en allumer d'autres. Ils ne sont donc **pas visibles en Production**.

| Constat | Sujet | Statut dans l'audit | État réel en Production |
| --- | --- | --- | --- |
| V1-03 | Contact et signalement de contenu illicite | corrigé | ✅ pages légales en ligne |
| V1-04 | Export des données | corrigé | ✅ allumé (test humain : B4) |
| V1-05 | Fichiers effacés avec le compte | corrigé | ✅ allumé |
| V1-07 | Information sur les identifiants de plateformes | corrigé | ✅ politique en ligne |
| V1-09 | Tableau données, finalités, durées | corrigé | ✅ politique en ligne |
| V1-10 | Durées de conservation | action humaine | ✅ durées écrites dans la politique (#516). La purge automatique reste éteinte, ce que la politique dit. |
| V1-13 | Droit à l'image | corrigé | ✅ conditions en ligne |
| V1-14 | Région du stockage des médias | action humaine | 🟠 à faire (B3) |
| V1-15 | Sous-traitants et transferts hors UE | corrigé | ✅ politique en ligne, certifications DPF vérifiées le 22/11 |
| V1-17 | Vidéo YouTube chargée sans clic | corrigé | 🟠 **seulement mentionné** dans la politique : le chargement au clic (`MEDIA_PRIVACY_ENABLED`) est éteint |
| V1-19 | Âge minimum | corrigé | ✅ 13 ans |
| V1-22 | Conditions des API tierces | corrigé | ✅ |
| V1-23 | Lien « Aller au contenu » | action humaine | ✅ `SKIP_LINK_ENABLED` allumé |
| V3-02 | Connexion : « réservé aux membres » | corrigé | 🔴 **non visible** : `LAUNCH_TEXTS_ENABLED` éteint |
| V3-11 | Deux « étages » côte à côte | codé | ✅ décision du 23/11 : « Niveau d’XP » pour l’XP, « Étage » pour la Tour (PR Code 8) |
| V3-12 | Phrase sur la conservation des étages | corrigé | 🔴 **non visible** sur le site : `LAUNCH_TEXTS_ENABLED` éteint. À dire au moins dans Discord (C4). |
| V3-15 | The Tower dans le menu | corrigé | 🔴 **non visible** : `NAV_TOWER_ENABLED` éteint. La Tour n'est atteignable que par l'adresse `/tower`. |
| V3-18 | Blocs techniques sur la page de soirée | corrigé | 🔴 **non visible** : `LAUNCH_TEXTS_ENABLED` éteint |
| V3-23 | Lien d'évitement (doublon de V1-23) | action humaine | ✅ |
| V4-01 | Dependabot | corrigé | ✅ actif (5 PR en attente) |
| V4-15 | Isolation Preview / Production | action humaine | 🔴 écart trouvé (E4) |

> **Total des 21 constats : 14 ✅, 2 🟠 (V1-14, V1-17), 5 🔴 (V3-02, V3-12, V3-15, V3-18, V4-15).** Les constats V1-12 (EXIF), V3-07 et V3-08 (signalements) sont classés « après ouverture » ; ils restent sans objet tant que la galerie et la commande « Signaler » sont éteintes.

**Décision demandée à Maxime pour V3-02, V3-12, V3-15 et V3-18.** Ces quatre corrections sont **déjà dans le code** et ne demandent qu'un interrupteur d'affichage : `LAUNCH_TEXTS_ENABLED` et `NAV_TOWER_ENABLED`, sans migration et sans risque pour les données. Les laisser éteints contredit le produit : la Tour hors du menu, et un visiteur extérieur qui ne sait pas que l'accès est réservé. Je recommande une **exception à la règle** pour ces deux interrupteurs d'affichage. Sinon, ces quatre constats restent rouges.

---

## 3. Ce qui reste rouge (résumé)

1. **C1** : 13 commandes enregistrées (après fusion de #518).
2. **C2** : catalogue de défis vide.
3. **C3** : bots et GameNight sans Administrateur.
4. **C4, C5** : message du guide corrigé, salon de retours.
5. **A4** : branche de sauvegarde Neon juste avant l'annonce (6 h d'historique seulement).
6. **D2, D3** : alerte de panne ; décision de capacité (offres payantes ou plafond).
7. **E4** : séparer les secrets Preview / Production.
8. **F1 à F3** : tests humains.
9. **V3-02, V3-12, V3-15, V3-18** : décision sur `LAUNCH_TEXTS_ENABLED` et `NAV_TOWER_ENABLED`.

**Ordre conseillé** : A4 → E4 → C3 → (fusion #518) C1 → C2 → C4, C5 → D2, D3 → F1 à F3 → décision V3 → annonce.
