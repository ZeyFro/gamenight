# Audit final du 23/11/2026

Synthèse des audits de la production et du code. **Un constat par ligne : gravité, où, preuve, correctif, état.** Les détails et les preuves ligne à ligne sont dans [`docs/audit/`](audit/01-securite-owasp.md). Aucune écriture Discord, Vercel ni Neon n'a été faite pour cet audit.

Gravités : 🔴 bloquant lancement · 🟠 important · 🟡 mineur · 🟢 vérifié OK.
États : **Corrigé (PR)** = fusionné dans `main` avec un test · **Restant** = à faire, voir « Prochaines PR » · **Non vérifié** = impossible sans accès réel (appareil, Discord, Neon, cron-job.org), précisé en clair.

## 1. Constats de la production, corrigés

| Gravité | Où | Preuve | Correctif | État |
|---|---|---|---|---|
| 🔴 | Accueil, `/classement`, `/ascension`, `/tower`, Discord | Deux niveaux contradictoires pour la même personne (niveau d'XP et « étage ») | Vocabulaire unique : « Niveau d'XP » (niveau), « Rang » (Bronze à Légende), « Étage » réservé à The Tower ; `levelProgress`, `rankProgress`, `xpLevelLabel` | Corrigé (#554) |
| 🔴 | Accueil contre `/tower` | « Saison 2 · Jour 23/30 » (saison mensuelle d'XP) contre « S3 · 2026 » | Une seule saison affichée, celle de The Tower, en jours civils Europe/Paris ; bascule du 1ᵉʳ décembre et changement d'heure testés | Corrigé (#562) |
| 🔴 | `/admin`, onglet « Messages Discord » | Texte « tout le monde peut gérer » | Faux (accès fermé par `requireAdmin`) ; textes corrigés et garde statique sur les 9 fichiers d'actions et la page | Corrigé (#553) |
| 🟠 | En-tête | Icône de communauté cassée (image absente) | Repli sur l'initiale du serveur | Corrigé (#558) |
| 🟠 | Accueil, Potes, classement | « 18 soirées / 5 joueurs actifs » puis « 0 / 0 » à côté de « Deadlock · 8 fois » ; Potes 8, classement 9, base 10 | Définitions uniques (membres toi compris, autres membres), total relevé au jeu le plus joué, joueurs actifs bornés par les membres | Corrigé (#564) |
| 🟡 | Titres de niveau | Échelle des titres incohérente | Nouvelle échelle exportée et testée | Corrigé (#559) |
| 🟠 | `/notifications` | Titre d'onglet « Notifications » au-dessus d'un 404 | Titre « Introuvable » tant que le centre est éteint ; test titre, 404 et lien de la cloche | Corrigé (#561) |
| 🟠 | Création de soirée | Tous les potes pré-cochés (MP en masse) ; jargon (« deadline », « custom », variables inexpliquées) | Personne n'est prévenu d'office (les amis si Potes = amis) ; textes en français avec exemples | Corrigé (#563) |
| 🟠 | « Jouer maintenant » | Un clic envoyait 31 MP | Personne pré-coché quand le centre de notifications est allumé | Corrigé (#552) |
| 🟡 | Pages sans lien d'accès, pied de page mobile | Pages orphelines, pied de page cassé sur mobile | Liens ajoutés, garde `page-links-coverage.test.ts` | Corrigé (#550, #551) |

## 2. Mineurs du bug 9

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟡 | « Guide » flottant à côté du pseudo ; « Se déconnecter » en bas de l'accueil ; titre « Ce soir, on joue à quoi ? » dupliqué ; salon 🤖・commandes-bot absent de `/guide` | Lien « Guide » retiré de l'accueil (reste dans la barre latérale et le « ? ») ; « Se déconnecter » déplacé en bas de `/profil` ; titre dupliqué corrigé à la source (`AuroraText` rendait son texte deux fois) ; salon 🤖・commandes-bot cité sur `/guide` (texte seulement) | Corrigé (#567) |
| 🟡 | Anglicismes (streak, wishlist, Tierlist, IGDB) ; badge « À vérifier » ; poubelle de la bibliothèque sans confirmation | Vocabulaire français (tier list, liste de souhaits, série, IGDB) ; badge « À vérifier » expliqué (infobulle, lecteur d'écran, page) ; poubelle de la bibliothèque avec confirmation « Annuler / Retirer ». Les badges de provenance « IGDB » des cartes restent tels quels | Corrigé (#568) |
| 🟡 | Onglets admin qui débordent sur mobile | Onglets à la ligne, cibles de 44 px, sans défilement horizontal à 320 px, iPhone 13 et Pixel 7 (page de test isolée ; rendu réel de `/admin` non vérifié visuellement). `LibraryTabs`, `PoteTabs`, `ProfilTabs` utilisent encore le défilement horizontal | Corrigé (#566) |

## 3. Sécurité OWASP des routes ([détail](audit/01-securite-owasp.md))

Aucun constat 🔴 ni haute gravité. Crons et backfills (`verifyCronRequest`, 503 sans secret), iCal, `media`, `compte/export`, `health`, `admin/*` : 🟢.

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟠 | `/api/admin/force-relogin` : `CRON_SECRET` partagé avec tous les crons | Secret dédié `FORCE_RELOGIN_SECRET` (503 sans lui, `CRON_SECRET` n'ouvre plus la route) ; étapes dans `ALLUMAGES.md` § « Pour ChatGPT » | Corrigé (code) ; **variable à créer chez Vercel** (ChatGPT) |
| 🟠 | `/api/igdb/search` sans limite de débit | 30 recherches par minute et par membre (429 au-delà) | Corrigé (#573) |
| 🟠 | `/api/push/subscription` sans limite ni plafond | 10 appels par minute et par membre en plus du plafond de 5 appareils | Corrigé (#573) |
| 🟠 | `/api/discord/interactions` : corps lu en entier avant la signature | 413 au-delà de 64 Ko (Content-Length puis corps lu) | Corrigé (#573) |
| 🟡 | Actions de délégation (équipes, tournois, calendrier, charte) | Test d'accès d'un tiers non membre, sur le modèle de `admin-guards.test.ts` | Restant |
| 🟡 | Écritures sans limite de débit visible | Limite générique par utilisateur (`checkSharedRateLimit` sur les créations) | Restant |

## 4. Bot Discord, tâches planifiées, sauvegarde ([détail](audit/02-bot-cron-sauvegarde.md))

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟢 | Commandes et boutons : réponse différée avant tout accès à la base, donc sous 3 s même base en veille | — | Vérifié en lecture du code ; **non vérifié en réel** (base endormie, Discord) |
| 🟠 | Autocomplétion (tournois, soirées, rôles) : non différable, interroge la base avant de répondre | Course `Promise.race` à ~2 s, liste vide en repli ; appel de santé régulier | Restant |
| 🔴 | Aucun cron déclaré dans `vercel.json` : tout dépend de cron-job.org | Créer les jobs de `docs/CRONS.md`, e-mail d'échec, test à 202 | **Non vérifié** (réglage extérieur de Maxime) |
| 🔴 | Workflow `tower-team-daily` : garde « heure de Paris = 18 » plus stricte que la route (≥ 18) ; un retard de GitHub fait sauter la journée | Garde « heure >= 18 » : un retard de GitHub ne fait plus sauter la journée ; la route reste idempotente par jour. L'exécuteur de notifications rattrapait déjà l'attribution à partir de 18 h | Corrigé (#574) |
| 🟠 | Heure d'été/hiver du défi de 18 h : aucun test des deux nuits de bascule | Des tests existent déjà (`tower-challenge-rules.test.ts`, `tower-team-daily-workflow.test.ts`) ; #574 les complète (retard de 0 et 1 h, jours de bascule) | Constat inexact (corrigé par #574) |
| 🟠 | Vercel Hobby : 2 crons par jour, précision ±59 min, 100 déploiements par jour | Planificateur externe conservé ; **aperçus coupés** : seul `main` est construit | Corrigé (#560) |
| 🔴 | Sauvegarde : 6 h de restauration Neon, restauration jamais éprouvée | Essai de [`procedure-restauration.md`](audit/procedure-restauration.md) sur une branche, branche de sauvegarde avant l'ouverture, export hebdomadaire hors Neon | **Non vérifié** : la règle du dépôt interdit tout accès à Neon depuis ces sessions ; à faire par Maxime |
| 🔴 | Aucune alerte de panne ; `/api/health` sans appelant | Job cron-job.org sur `/api/health` avec e-mail ; lot I (`HOSTING_ALERT_ENABLED`, route `hosting-usage`) | Code livré (#549) ; **réglage extérieur à faire** |
| 🟠 | Journaux : 1 h sur Vercel Hobby, `logger` seulement dans la console | Journal d'erreurs minimal en base (table additive, purge 30 jours) | Restant |
| 🟠 | Calcul Neon (100 h par mois) non mesuré | Relevé manuel hebdomadaire | **Non vérifié** (la mesure automatique exigerait une clé d'API que le dépôt interdit) |

## 5. Triche, notifications iPhone, aperçu du lien ([détail](audit/03-triche-iphone-apercu.md))

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟠 | 1.9 XP de présence farmée par des soirées fantômes | Plafond sur 24 h glissantes dans le ledger ; participants distincts non exigés (à décider) | Corrigé (#569) : plafond de 3 gains par membre et par 24 h, valeur à valider par Maxime |
| 🟠 | 1.4 Preuve Tower validée par 3 faux comptes | Quorum de votants actifs, votes décisifs visibles du staff | Restant (priorité 2) |
| 🟠 | 1.5 Défi d'équipe : coéquipier fantôme récompensé | Participants confirmés par le capitaine, plafond par jour | Restant (priorité 2) |
| 🟡 | 1.3 Ancienneté de 7 jours des votants selon le seul interrupteur | Ancienneté appliquée même interrupteur éteint | Corrigé (#570), puis 3 jours (décision de Maxime) |
| 🟡 | 1.10 XP « voter » : 5 XP par proposition votée, aucun plafond de propositions par soirée | 10 propositions au plus par soirée (la 11e est refusée avec un message) ; 10 gains d'XP « VOTE » au plus par membre et par soirée, comptés dans le ledger | Corrigé (#585) : valeurs validées par Maxime |
| 🟡 | 1.6 Temps de jeu Steam farmé en AFK (validation automatique des défis `temps`) | Temps compté plafonné à 2 h par jour (décision de Maxime), « Signaler un doute » inchangé | Corrigé (#583) : `TOWER_STEAM_DAILY_CAP_MINUTES = 120`, tests purs ; un défi `temps` de plus de 240 min retombe sur la preuve et le vote (`TOWER_STEAM_AUTOVALIDATE.md`) |
| 🟡 | 1.11, 1.14 (tournoi complice, MP en masse) | Plafonds par jour, limite partagée | Restant |
| 🟡 | 1.8, 1.15 plafonds sans test (soirée créée, demandes d'ami) | Tests d'intégration | Partiel : plafond « soirée créée » testé (#569) ; demandes d'ami restantes |
| 🟠 | 2.4 Web Push : `getRegistration("/sw.js")` au lieu de `/service-worker.js` ; abonnement jamais détecté après rechargement | Chemin `/service-worker.js`, test jsdom : abonnement détecté après rechargement | Corrigé (#572) |
| 🟠 | 2.5–2.6 iPhone : aucune détection du mode installé ni guide « Sur l'écran d'accueil » | Détection (`detectPushSupport`), guide « Sur l'écran d'accueil », messages dédiés (navigateur sans push, permission refusée) | Corrigé (#572) ; réception sur iPhone réel non vérifiée |
| 🟡 | 2.7–2.9 icône Apple 180×180, `icon`/`badge` de notification, manifest minimal | Ajouts | Partiel (#572) : icône de notification et `id`/`scope`/`lang` du manifest corrigés ; restent l'icône Apple 180×180 et le `badge` (images à produire) |
| 🟠 | 3.1–3.2 aperçu du lien Discord : ni image `og`, ni balises `openGraph`/`twitter`, ni `metadataBase` | `metadataBase`, `openGraph`, `twitter`, `opengraph-image` 1200×630, `favicon.ico` (aucune métadonnée dynamique) | Corrigé (#571) ; rendu dans Discord non vérifié |
| 🟡 | 3.4 `robots.txt` `Disallow: /` | Règle `Discordbot` si l'aperçu manque | Non vérifié (test réel dans un salon) |

## 6. Visuel et parcours : ce qui n'a PAS été vérifié

Honnêtement, ces contrôles n'ont pas pu être faits complètement :

- **Visuel de chaque page, ordinateur, tablette, iPhone SE, iPhone 13, Pixel 7** : une partie a été contrôlée avec Playwright sur la production (parcours nouveau joueur, mobile, liens) et déposée dans la galerie de preuves de la PR #514, qui reste en Draft. Il n'existe pas de passage exhaustif de toutes les pages dans tous leurs états sur les cinq formats. **Restant.**
- **Parcours complets** (créer et rejoindre une soirée, tournoi, défi Tower, demande d'ami, commandes du bot, suppression de compte) : couverts par les tests unitaires et d'intégration, **jamais joués de bout en bout dans un vrai navigateur connecté avec un compte Discord**. Restant, à faire avec un compte de test dédié.
- **Notifications sur iPhone** et **aperçu du lien dans Discord** : exigent un appareil réel et un salon de test.

## 7. Prochaines PR, par ordre

Faites : XP de présence (#569), XP de vote (#585), ancienneté des votants (#570), aperçu du lien (#571), notifications iPhone (#572), limites de débit (#573), garde du défi de 18 h (#574).

1. **À arbitrer avec Maxime** : preuves Tower validées par de faux comptes (1.4) et coéquipier fantôme (1.5) : quorum de votants « actifs », confirmation des participants par le capitaine.
2. Autocomplétion Discord sous 3 s avec base endormie (course à ~2 s, liste vide en repli).
3. Secret dédié de `force-relogin` (nouvelle variable d'environnement chez Vercel).
4. Plafonds par jour des autres gains d'XP et des MP en masse (1.11, 1.14 ; 1.6 et 1.10 faites) ; tests des plafonds de demandes d'ami (1.15).
5. Icône Apple 180×180 et `badge` de notification (2.7, 2.8).
6. Journal d'erreurs minimal en base (journaux Vercel limités à 1 h).

## 8. À faire par Maxime (aucun accès depuis ces sessions)

1. Créer les jobs cron-job.org de [`CRONS.md`](CRONS.md), dont `/api/health` et `/api/cron/hosting-usage`, avec e-mail d'échec.
2. Essayer la restauration sur une branche Neon ([`procedure-restauration.md`](audit/procedure-restauration.md)) et noter date et durée dans `LANCEMENT_GO.md`.
3. Relever chaque semaine le temps de calcul Neon (limite de 100 h par mois).
4. Tester sur un iPhone réel l'installation sur l'écran d'accueil et une notification, et coller le lien du site dans un salon de test.
5. Quand le quota Vercel le permet, vérifier que la production tourne sur le dernier commit de `main` (la limite de 100 déploiements par jour a bloqué plusieurs déploiements le 23/11).
