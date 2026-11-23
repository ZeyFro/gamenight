# Capacité : 100, 500 ou 1 000 membres ?

> Relevé du 23 novembre 2026. Sources : les pages officielles de Vercel (offre Hobby) et de Neon (offres et tarifs, mises à jour en novembre 2026), le projet Neon lu sans rien modifier, le code de `main` et les mesures de l'audit du 20/11 ([AUDIT_APP_20261120.md](AUDIT_APP_20261120.md), volet 2). Les prix sont ceux affichés par les fournisseurs ce jour, hors taxes, **à revérifier au moment de payer**.

## La réponse courte

| Membres actifs | Avec les offres gratuites actuelles | Avec Vercel Pro + Neon Launch |
| --- | --- | --- |
| **100** | Oui, mais à la limite : le calcul gratuit de Vercel (4 h par mois) sera presque épuisé. | Oui, largement. |
| **500** | **Non.** Vercel bloque les fonctions en cours de mois, et Neon arrête sa base. | Oui. |
| **1 000** | **Non.** | Oui, en surveillant l'usage. Coût estimé : **40 à 70 $ par mois**. |

« Membre actif » = quelqu'un qui ouvre le site environ **10 pages par jour**. Ce chiffre est une **hypothèse** : le site ne mesure pas encore sa fréquentation. Si tes membres sont deux fois moins actifs, les seuils doublent.

**Le vrai danger** n'est pas la lenteur, c'est l'**arrêt net**. Une offre gratuite qui atteint sa limite **coupe le service** : jusqu'à 30 jours chez Vercel, jusqu'au mois suivant chez Neon. Il n'y a pas de dégradation douce.

---

## Les limites une par une

### 1. Vercel Hobby — le calcul des pages

| Limite (officielle) | Où on en est | Ça casse à partir de | Symptôme | Solution et coût |
| --- | --- | --- | --- | --- |
| **4 h de calcul actif par mois** | Chaque page est calculée à chaque visite. Selon l'audit, une page fait **17 à 73 requêtes en base**, soit environ 0,1 s de calcul. 4 h ≈ **140 000 pages par mois**, tâches automatiques comprises. | **≈ 100 à 150 membres actifs** (300 pages par membre et par mois). | Plus aucune page ne répond (erreur), parfois pendant **jusqu'à 30 jours**. | **Vercel Pro, 20 $ par mois** : la limite fixe disparaît, l'usage est facturé au-delà du crédit compris. |
| 1 million d'appels de fonctions par mois | Une page, une action ou une tâche = un appel. | ≈ 1 500 à 2 000 membres actifs | Idem | Vercel Pro |
| 100 Go de transfert par mois | Pages de 50 à 400 Ko (840 Ko pour `/bibliotheque/groupe`) | ≈ 1 500 membres actifs | Idem | Vercel Pro (1 To compris) |
| Durée d'une fonction : 300 s au plus | Les tâches longues sont déjà découpées (budgets de 45 à 240 s) | Ne casse pas avec le nombre de membres | — | — |
| **Journaux gardés 1 heure** | — | Dès le premier incident de nuit | Impossible de savoir ce qui s'est passé | Vercel Pro : journaux gardés plus longtemps (durée à vérifier sur l'offre) |
| Usage non commercial seulement | Communauté gratuite, sans revenus | — | — | Rien à faire tant qu'il n'y a pas de revenus |

### 2. Neon (offre gratuite) — la base de données

Relevé du projet : offre **gratuite**, calcul automatique de 0,25 à 2 unités, mise en veille après 5 minutes sans requête. **22 Mo** de données pour **10 comptes**. Environ **48 heures de calcul consommées** du 1er au 22 novembre.

| Limite (officielle) | Où on en est | Ça casse à partir de | Symptôme | Solution et coût |
| --- | --- | --- | --- | --- |
| **100 heures de calcul par mois** | ≈ 48 h au 22/11 avec 10 comptes. La base est éveillée environ 1/3 du temps, souvent par les tâches automatiques. | Dès qu'elle reste éveillée en continu : 0,25 unité × 720 h = 180 h. Soit **≈ 50 à 100 membres actifs** répartis sur la journée. | **Toute l'application tombe** (base suspendue) jusqu'au mois suivant. | **Neon Launch** : 0,106 $ par heure de calcul, sans minimum. Base éveillée en continu à 0,25 unité : **≈ 19 $ par mois** ; avec des soirées chargées (0,5 à 1 unité) : **25 à 40 $**. |
| 1 Go de stockage | 22 Mo pour 10 comptes, soit ≈ 2 Mo par compte, rien n'étant purgé | ≈ 5 000 comptes (beaucoup plus tôt si la galerie ou le chat grossissent) | Écritures refusées | Neon Launch : 0,35 $ par Go et par mois. Ou allumer la purge (`RETENTION_CLEANUP_ENABLED`) plus tard. |
| **6 heures d'historique** pour revenir en arrière | — | Dès le premier jour | Une erreur vue le lendemain n'est plus réparable | Neon Launch : historique plus long, réglable (à vérifier sur l'offre). En attendant : une **branche de sauvegarde** avant chaque étape risquée. |
| Taille de calcul maximale : 2 unités | — | ≈ 1 000+ membres connectés en même temps | Pages lentes le soir | Neon Launch (jusqu'à 16 unités) |
| Mise en veille après 5 minutes | — | Pas une casse | La première page après un moment calme met 0,5 à 1 s de plus | Rien à faire (c'est ce qui économise le calcul) |

### 3. Connexions à la base (Prisma)

| Limite | Où on en est | Ça casse à partir de | Symptôme | Solution et coût |
| --- | --- | --- | --- | --- |
| Connexions simultanées | Le code passe par le **regroupeur de connexions** de Neon (adresse « pooled », pilote serverless `@prisma/adapter-neon`). Le regroupeur accepte jusqu'à 10 000 clients ; la base elle-même 225 connexions directes. | Pas avant plusieurs milliers de visiteurs **simultanés** | Erreurs de connexion | Rien à faire |
| Nombre de requêtes par page (17 à 73) | Chaque requête traverse le réseau | Pas une casse, mais c'est ce qui consomme le calcul Vercel et Neon | Pages plus lentes sous charge | Plus tard : mettre en cache les pages les plus lourdes (`/`, `/sessions`, `/potes`). Pas avant le lancement. |

### 4. Discord — le bot

| Limite (Discord) | Où on en est | Ça casse à partir de | Symptôme | Solution et coût |
| --- | --- | --- | --- | --- |
| Environ 50 appels par seconde pour un bot, plus des limites par salon et par action | Tous les messages passent par une **file d'attente**. L'exécuteur respecte déjà le 429 de Discord et réessaie plus tard. | Pas une casse : les messages partent **en retard** lors d'une rafale (grosse soirée, 100 invitations) | MP et annonces décalés de quelques minutes | Rien à faire |
| Messages privés en masse | Un MP n'est envoyé qu'à ceux qu'une action concerne | Discord peut bloquer un bot qui envoie trop de MP à des inconnus | MP refusés | Ne pas allumer d'autres MP au lancement (règle déjà décidée) |
| 250 rôles et 500 salons par serveur | Les fonctions qui en créent (équipes, rôles de jeu, boosters) sont **éteintes** | — | — | Rien à faire tant qu'elles restent éteintes |
| Enregistrement des commandes | ≈ 5 écritures puis attente (limite constatée) | — | « Enregistrer » s'arrêtait à 5/13 | Corrigé par la PR #518 (attente et reprise) |

### 5. Tâches planifiées

| Limite | Où on en est | Ça casse à partir de | Symptôme | Solution et coût |
| --- | --- | --- | --- | --- |
| cron-job.org coupe un appel au bout de 30 s | Les tâches longues répondent tout de suite et continuent après (prévu dans le code) | — | — | Rien à faire |
| Fréquence des appels | Chaque appel réveille la base Neon et consomme du calcul Vercel. Un appel par minute = 43 000 appels par mois. | Avec Neon gratuit, un appel toutes les 1 à 4 minutes **empêche la mise en veille** et épuise les 100 h | Base suspendue en fin de mois | Espacer les tâches non urgentes (toutes les 10 à 15 min). Garder `notification-executor` fréquent : les envois immédiats passent déjà par `after()`, la tâche n'est qu'un filet. |
| Exécuteur des messages | Budget de 50 s par passage | Plusieurs centaines de messages par minute | Retards | Rien à faire |

### 6. Stockage de fichiers (Vercel Blob)

La galerie des soirées est **fermée** (pas de stockage privé configuré). Seules les bannières de profil sont stockées. Pas de risque au lancement tant que la galerie reste fermée.

---

## Le minimum à faire avant le lancement

1. **Passer Neon en Launch** (sans minimum, ≈ 20 à 40 $ par mois). C'est le risque le plus probable : la base gratuite s'éteint quand les 100 h sont épuisées, et **tout** le site tombe avec elle. Bonus : un historique plus long pour revenir en arrière.
2. **Passer Vercel en Pro** (20 $ par mois) **avant** d'inviter plus d'une centaine de personnes actives. Sinon, plafonne les invitations à environ 100 membres pendant la semaine 1 et regarde la consommation chaque jour (Vercel → Usage).
3. **Créer une alerte de dépense ou d'usage** sur les deux consoles, à 50 % et 80 %.
4. **Espacer les tâches automatiques non urgentes** sur cron-job.org (synchronisations Steam, profils, nettoyages : toutes les 10 à 15 minutes au lieu de chaque minute).
5. **Prendre une branche de sauvegarde Neon** juste avant l'annonce (6 h d'historique seulement en offre gratuite).

**Coût mensuel du minimum recommandé** : environ **40 à 60 $** (Vercel Pro 20 $ + Neon Launch 20 à 40 $) pour 1 000 membres actifs. Avec les seules offres gratuites, ne dépasse pas **une centaine de membres actifs**.

## Ce qui n'a pas pu être mesuré

- La consommation réelle de Vercel ce mois-ci : la page Usage n'est pas lisible d'ici. Regarde Vercel → Usage → « Active CPU » et « Function Invocations ».
- La fréquence réelle des tâches sur cron-job.org.
- Le comportement réel de tes membres (pages par jour). Une semaine de mesure après l'ouverture affinera les seuils.
