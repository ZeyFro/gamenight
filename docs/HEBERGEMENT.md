# Hébergement : rester en gratuit, surveiller, savoir partir

> Décision de Maxime (Q11–Q12, 23/11/2026) : **rester sur les offres gratuites** de Neon et de Vercel, avec une **alerte avant saturation**, et préparer une **migration future vers un serveur local ou OVH**. Chiffres détaillés : [CAPACITE.md](CAPACITE.md).

## 1. Les limites des offres gratuites

| Service | Limite | Ce qui se passe au-delà | Relevé |
| --- | --- | --- | --- |
| Neon (base de données), offre gratuite | 100 heures de calcul par mois | La base **s'arrête** jusqu'au mois suivant : le site ne répond plus | ≈ 48 h le 22/11 pour 10 comptes |
| Neon | 1 Go de stockage | Les écritures sont **refusées** | 22 Mo le 22/11 |
| Vercel Hobby (site) | 4 heures de calcul actif par mois, 1 million d'appels de fonctions, 100 Go de transfert | Le site peut être **coupé jusqu'à 30 jours** | Voir le tableau de bord Vercel → Usage |

## 2. L'alerte avant saturation

Objectif : prévenir Maxime **avant** l'arrêt, à 70 % puis 90 % d'une limite, pour avoir le temps de réagir (purge, réduction des tâches planifiées, ou changement d'offre).

- **Neon** : lire la consommation du mois par l'API officielle de Neon (lecture seule), comparer aux limites, et poster un message dans le salon staff par la file de notifications existante. Il faut une **clé d'API Neon en lecture** (`NEON_API_KEY`, Sensitive), posée par ChatGPT dans Vercel.
- **Vercel** : le tableau de bord envoie déjà des e-mails à l'approche des limites Hobby. Vérifier dans **Settings → Billing / Usage** que les notifications d'usage sont activées pour l'adresse de Maxime.
- **Où** : une tâche planifiée protégée (`CRON_SECRET`), une fois par jour, comme les autres tâches (liste dans [CRONS.md](CRONS.md)).

État : **codé** (`HOSTING_ALERT_ENABLED`, route `GET /api/cron/hosting-usage`) pour la **taille de la base** : 200 sous 70 % de la limite, **503 au-delà**, ce qui fait prévenir par e-mail le moniteur externe (cron-job.org traite tout code hors 2xx comme un échec). Lecture seule, aucune clé supplémentaire.

**Ce qui n'est PAS automatisé : le temps de calcul Neon** (100 h par mois, la limite la plus proche : ≈ 48 h le 22/11). Le lire par l'API Neon exigerait une clé d'API à **accès complet** au projet (elle peut supprimer la base et ses sauvegardes) et un appel externe que le dépôt interdit ; il n'existe pas de lecture par SQL. **Relevé à la main chaque semaine** : Neon → Billing (dans [SEMAINE_1.md](SEMAINE_1.md)), alerte à 70 h. Si Maxime veut quand même l'automatiser, c'est une décision à part, à prendre en connaissance de ce risque.

## 3. Partir plus tard vers un serveur local ou OVH

Le code ne dépend d'aucun service propriétaire indispensable : Next.js tourne sur n'importe quel serveur Node.js, et la base est un PostgreSQL standard.

| Élément | Aujourd'hui | Sur un serveur local ou OVH (VPS) |
| --- | --- | --- |
| Site Next.js | Vercel | `npm ci && npm run build && npm start` derrière un proxy HTTPS (Caddy ou Nginx avec Let's Encrypt) ; ou une image Docker. Node.js 22. |
| Base PostgreSQL | Neon (Francfort) | PostgreSQL 16 sur le serveur, ou base gérée OVH. Copie : `pg_dump` depuis Neon, `pg_restore` vers la nouvelle base, puis `prisma migrate deploy` pour vérifier. |
| Tâches planifiées (`/api/cron/*`) | Service externe | `cron` du serveur appelant les mêmes adresses avec `Authorization: Bearer <CRON_SECRET>`. |
| Travail après réponse (`after()`) | Fonctions Vercel | Fonctionne aussi sur un serveur Node classique. |
| Fichiers (bannières) | Vercel Blob | Dossier du serveur ou stockage objet compatible S3 (OVH Object Storage) ; adaptation du code de stockage nécessaire. |
| Variables d'environnement | Vercel | Fichier d'environnement du serveur (jamais dans le dépôt), mêmes noms. |
| Discord | URL Vercel | Changer dans le portail Discord : l'URL de redirection OAuth (`/api/auth/callback/discord`) et l'URL des interactions (`/api/discord/interactions`). |
| Domaine | `*.vercel.app` | Un nom de domaine à soi (environ 10 € par an), pointé vers le serveur. |

**Coût indicatif** : un petit VPS OVH (2 cœurs, 4 Go) coûte environ 5 à 10 € par mois et suffit pour plusieurs centaines de membres actifs. À revérifier au moment du choix.

**Ordre conseillé le jour venu** : 1. louer le serveur et y installer PostgreSQL ; 2. copier la base pendant une heure creuse ; 3. déployer le site avec les mêmes variables ; 4. tester sur une adresse provisoire ; 5. basculer le domaine et les URL Discord ; 6. garder Neon et Vercel une semaine en secours, puis les fermer.
