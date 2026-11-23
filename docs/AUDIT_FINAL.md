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
| 🟡 | « Guide » flottant à côté du pseudo ; « Se déconnecter » en bas de l'accueil ; titre « Ce soir, on joue à quoi ? » dupliqué ; salon 🤖・commandes-bot absent de `/guide` | Voir PR « accueil et guide » | En cours (PR ouverte par un sous-agent, numéro à inscrire à la fusion) |
| 🟡 | Anglicismes (streak, wishlist, Tierlist, IGDB) ; badge « À vérifier » ; poubelle de la bibliothèque sans confirmation | Voir PR « bibliothèque et vocabulaire » | En cours (idem) |
| 🟡 | Onglets admin qui débordent sur mobile | Voir PR « onglets admin mobile » | En cours (idem) |

## 3. Sécurité OWASP des routes ([détail](audit/01-securite-owasp.md))

Aucun constat 🔴 ni haute gravité. Crons et backfills (`verifyCronRequest`, 503 sans secret), iCal, `media`, `compte/export`, `health`, `admin/*` : 🟢.

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟠 | `/api/cron/force-relogin` : un seul `CRON_SECRET` pour tous les crons | Secret dédié par route sensible, rotation documentée | Restant |
| 🟠 | `/api/igdb/search` sans limite de débit | `checkRateLimit` par utilisateur | Restant |
| 🟠 | `/api/push/subscription` sans limite ni plafond | Limite par utilisateur, plafond d'abonnements | Restant |
| 🟠 | `/api/discord/interactions` : corps lu en entier avant la signature | Refuser plus de 64 Ko avant lecture | Restant |
| 🟡 | Actions de délégation (équipes, tournois, calendrier, charte) | Test d'accès d'un tiers non membre, sur le modèle de `admin-guards.test.ts` | Restant |
| 🟡 | Écritures sans limite de débit visible | Limite générique par utilisateur (`checkSharedRateLimit` sur les créations) | Restant |

## 4. Bot Discord, tâches planifiées, sauvegarde ([détail](audit/02-bot-cron-sauvegarde.md))

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟢 | Commandes et boutons : réponse différée avant tout accès à la base, donc sous 3 s même base en veille | — | Vérifié en lecture du code ; **non vérifié en réel** (base endormie, Discord) |
| 🟠 | Autocomplétion (tournois, soirées, rôles) : non différable, interroge la base avant de répondre | Course `Promise.race` à ~2 s, liste vide en repli ; appel de santé régulier | Restant |
| 🔴 | Aucun cron déclaré dans `vercel.json` : tout dépend de cron-job.org | Créer les jobs de `docs/CRONS.md`, e-mail d'échec, test à 202 | **Non vérifié** (réglage extérieur de Maxime) |
| 🔴 | Workflow `tower-team-daily` : garde « heure de Paris = 18 » plus stricte que la route (≥ 18) ; un retard de GitHub fait sauter la journée | Retirer la garde, créneau de rattrapage, ou cron-job.org en fuseau Europe/Paris | Restant |
| 🟠 | Heure d'été/hiver du défi de 18 h : aucun test des deux nuits de bascule | Deux tests de `isTowerTeamDailyDue` / `getTowerParisDayKey` | Restant |
| 🟠 | Vercel Hobby : 2 crons par jour, précision ±59 min, 100 déploiements par jour | Planificateur externe conservé ; **aperçus coupés** : seul `main` est construit | Corrigé (#560) |
| 🔴 | Sauvegarde : 6 h de restauration Neon, restauration jamais éprouvée | Essai de [`procedure-restauration.md`](audit/procedure-restauration.md) sur une branche, branche de sauvegarde avant l'ouverture, export hebdomadaire hors Neon | **Non vérifié** : la règle du dépôt interdit tout accès à Neon depuis ces sessions ; à faire par Maxime |
| 🔴 | Aucune alerte de panne ; `/api/health` sans appelant | Job cron-job.org sur `/api/health` avec e-mail ; lot I (`HOSTING_ALERT_ENABLED`, route `hosting-usage`) | Code livré (#549) ; **réglage extérieur à faire** |
| 🟠 | Journaux : 1 h sur Vercel Hobby, `logger` seulement dans la console | Journal d'erreurs minimal en base (table additive, purge 30 jours) | Restant |
| 🟠 | Calcul Neon (100 h par mois) non mesuré | Relevé manuel hebdomadaire | **Non vérifié** (la mesure automatique exigerait une clé d'API que le dépôt interdit) |

## 5. Triche, notifications iPhone, aperçu du lien ([détail](audit/03-triche-iphone-apercu.md))

| Gravité | Où | Correctif | État |
|---|---|---|---|
| 🟠 | 1.9 XP de présence farmée par des soirées fantômes | Plafonner `PARTICIPATE` par joueur et par jour, exiger plusieurs participants distincts | Restant (priorité 1) |
| 🟠 | 1.4 Preuve Tower validée par 3 faux comptes | Quorum de votants actifs, votes décisifs visibles du staff | Restant (priorité 2) |
| 🟠 | 1.5 Défi d'équipe : coéquipier fantôme récompensé | Participants confirmés par le capitaine, plafond par jour | Restant (priorité 2) |
| 🟡 | 1.3 Ancienneté de 7 jours des votants selon le seul interrupteur | Appliquer l'ancienneté même interrupteur éteint | Restant |
| 🟡 | 1.6, 1.10, 1.11, 1.14 (temps Steam AFK, XP de vote, tournoi complice, MP en masse) | Plafonds par jour, limite partagée | Restant |
| 🟡 | 1.8, 1.15 plafonds sans test (soirée créée, demandes d'ami) | Tests d'intégration | Restant |
| 🟠 | 2.4 Web Push : `getRegistration("/sw.js")` au lieu de `/service-worker.js` ; abonnement jamais détecté après rechargement | Corriger le chemin, test jsdom | Restant (priorité 3) |
| 🟠 | 2.5–2.6 iPhone : aucune détection du mode installé ni guide « Sur l'écran d'accueil » | Détection et texte d'aide | Restant (priorité 3) ; **réception sur iPhone réel non vérifiée** |
| 🟡 | 2.7–2.9 icône Apple 180×180, `icon`/`badge` de notification, manifest minimal | Ajouts | Restant |
| 🟠 | 3.1–3.2 aperçu du lien Discord : ni image `og`, ni balises `openGraph`/`twitter`, ni `metadataBase` | `opengraph-image.tsx`, métadonnées | Restant (priorité 3) ; rendu dans Discord **non vérifié** |
| 🟡 | 3.4 `robots.txt` `Disallow: /` | Règle `Discordbot` si l'aperçu manque | Non vérifié (test réel dans un salon) |

## 6. Visuel et parcours : ce qui n'a PAS été vérifié

Honnêtement, ces contrôles n'ont pas pu être faits complètement :

- **Visuel de chaque page, ordinateur, tablette, iPhone SE, iPhone 13, Pixel 7** : une partie a été contrôlée avec Playwright sur la production (parcours nouveau joueur, mobile, liens) et déposée dans la galerie de preuves de la PR #514, qui reste en Draft. Il n'existe pas de passage exhaustif de toutes les pages dans tous leurs états sur les cinq formats. **Restant.**
- **Parcours complets** (créer et rejoindre une soirée, tournoi, défi Tower, demande d'ami, commandes du bot, suppression de compte) : couverts par les tests unitaires et d'intégration, **jamais joués de bout en bout dans un vrai navigateur connecté avec un compte Discord**. Restant, à faire avec un compte de test dédié.
- **Notifications sur iPhone** et **aperçu du lien dans Discord** : exigent un appareil réel et un salon de test.

## 7. Prochaines PR, par ordre

1. XP de présence : plafond et participants distincts (1.9) + test d'intégration.
2. Preuves et défis d'équipe : quorum de votants actifs, participants confirmés (1.4, 1.5).
3. Web Push et aperçu : chemin du service worker, détection iPhone, `opengraph-image` et métadonnées (2.4, 2.5, 3.1, 3.2).
4. Sécurité des routes : limites IGDB et push, plafond du corps des interactions, secret dédié de `force-relogin`.
5. Défi de 18 h : garde du workflow et tests des changements d'heure.
6. Autocomplétion Discord sous 3 s avec base endormie.

## 8. À faire par Maxime (aucun accès depuis ces sessions)

1. Créer les jobs cron-job.org de [`CRONS.md`](CRONS.md), dont `/api/health` et `/api/cron/hosting-usage`, avec e-mail d'échec.
2. Essayer la restauration sur une branche Neon ([`procedure-restauration.md`](audit/procedure-restauration.md)) et noter date et durée dans `LANCEMENT_GO.md`.
3. Relever chaque semaine le temps de calcul Neon (limite de 100 h par mois).
4. Tester sur un iPhone réel l'installation sur l'écran d'accueil et une notification, et coller le lien du site dans un salon de test.
5. Quand le quota Vercel le permet, vérifier que la production tourne sur le dernier commit de `main` (la limite de 100 déploiements par jour a bloqué plusieurs déploiements le 23/11).
