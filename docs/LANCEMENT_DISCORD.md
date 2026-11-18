# Lancement The Tower 2.0 — textes prêts à coller dans Discord

> **Règle d'or (cahier §31-32 du brief de lancement, §25 point 17 du cahier) : ne jamais présenter une fonction non activée comme disponible.**
> Chaque fonction porte une étiquette : **[DISPONIBLE]**, **[DISPONIBLE APRÈS ACTIVATION]** ou **[PRÉVUE]**. Les étiquettes sont celles de l'état réel du dépôt au 17/11/2026 (voir [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md)). **À la soirée d'activation, le staff retire les lignes dont l'étiquette n'est pas devenue vraie, puis enlève l'étiquette des lignes devenues vraies.** Ne rien coller tel quel avant ce contrôle.
> Ce document n'écrit rien sur Discord et ne touche aucune variable Vercel. Chaque bloc ci-dessous fait moins de 2 000 caractères (limite Discord) ; coller un bloc = un message.

## 0. Légende et état de départ

| Étiquette | Sens |
| --- | --- |
| [DISPONIBLE] | Livré et utilisable aujourd'hui sans action du staff (soirées, calendrier, bibliothèque, tournois, équipes de tournoi, XP, badges, classement, recherche de joueurs `/joueurs`). |
| [DISPONIBLE APRÈS ACTIVATION] | Code livré sur `main`, mais interrupteur éteint, commandes non enregistrées ou catalogue non importé. Devient vrai après la soirée d'activation ([ACTIVATION_TOUR.md](ACTIVATION_TOUR.md)) **et** son contrôle. |
| [PRÉVUE] | Règle décidée (§26, 17/11/2026) mais code pas encore sur `main` (PR brouillon #370, #406, #407, #408, #416) ou pas encore alignée. Ne pas annoncer comme active. |

Décisions citées : « §26 » = décisions approuvées par Maxime le 17/11/2026 (voir [DECISIONS_TOWER.md](DECISIONS_TOWER.md) quand la PR #450 est fusionnée).

## 1. Guide du nouveau membre

### Message 1 — Bienvenue (salon d'accueil)

```
👋 **Bienvenue sur The Tower !**

Ici, on joue ensemble : soirées, tournois, équipes et une progression infinie, l'**Ascension**.

**Tu peux commencer sans rien installer** : lis le règlement, prends ton rôle **Régulars**, présente-toi et viens discuter. Le site GameNight n'est utile que pour les équipes, ta progression et les inscriptions.

**3 premières actions (2 minutes) :**
1️⃣ Lis le règlement et valide-le pour obtenir **Régulars**.
2️⃣ Dis bonjour et dis à quoi tu joues.
3️⃣ Passe dans un salon vocal, ou regarde les soirées prévues.

Aucune obligation de participer à tout. Joue à ton rythme.
```

> Contrôle avant collage : le rôle Régulars est bien attribué par le mécanisme d'accueil existant (YAGPDB) ; le tester avec un vrai compte neuf (jamais l'aperçu administrateur).

### Message 2 — Que faire sur le serveur

```
🧭 **Où trouver quoi**

🔎 **Trouver des joueurs** — forum « Recherche de joueurs » : jeu, plateforme, horaires (heure de Paris), micro oui/non. [DISPONIBLE APRÈS ACTIVATION : forums à créer par le staff]
🎲 **Rejoindre une soirée** — les soirées s'organisent sur GameNight : disponibilités, vote du jeu, inscription. [DISPONIBLE]
🏆 **Tournois** — inscriptions et brackets sur GameNight. [DISPONIBLE]
🧗 **Commencer l'Ascension** — défis, preuves, étages. [DISPONIBLE APRÈS ACTIVATION]
👥 **Équipes** — créer ou rejoindre une équipe de 2 à 8 joueurs. [PRÉVUE pour la règle 2 à 8 ; création d'équipe déjà possible sur GameNight, limites actuelles différentes]

Un doute ? Pose ta question dans le salon d'entraide ou ouvre un ticket au staff.
```

### Message 3 — Se connecter à GameNight (optionnel)

```
🌐 **GameNight, c'est optionnel pour discuter**

Tu en as besoin pour : t'inscrire à une soirée ou un tournoi, gérer ton équipe, suivre ton Ascension.

**Connexion :** bouton « Se connecter avec Discord ». Tu dois être membre du serveur The Tower (compte lié à ton Discord, rien d'autre n'est demandé).
Tu peux lier ta bibliothèque Steam pour voir les jeux en commun avec les autres. C'est facultatif.

🔒 Tes données restent celles de ta communauté : un autre serveur ne voit rien de toi.
Une annonce de soirée peut te mentionner ; tu règles tes notifications dans ton profil. [DISPONIBLE]
```

## 2. Règles exactes de l'Ascension (décisions §26 du 17/11/2026)

> Tout le contenu de cette section est la règle **décidée**. L'Ascension dans son ensemble est **[DISPONIBLE APRÈS ACTIVATION]**. Les écarts entre la règle décidée et le code actuel sont listés à la section 6 : tant qu'un écart n'est pas corrigé, la ligne concernée garde **[PRÉVUE]** et n'est pas annoncée comme active.

### Message R1 — Principe, étages, grades

```
🧗 **L'Ascension — règles (1/4)**

**Étages**
• Défi facile : **+1 étage** · moyen : **+2** · difficile : **+3**.
• Les étages sont **permanents** : tu ne les perds jamais. [DISPONIBLE APRÈS ACTIVATION]

**Grades**
• **Régulars** : dès ton inscription (gris).
• **Irregular** : attribué à la main par le staff — prestige, aucun droit (violet).
• **Ranker** : à partir de **30 étages** (or).
• **High Ranker** : à partir de **100 étages** ET **au moins 5 défis validés sur la saison en cours** (rouge).
• Aucun grade ne donne de droit de modération. Les récompenses sont purement cosmétiques.
[PRÉVUE : grades et couleurs — le code actuel diffère, voir écarts]
```

### Message R2 — Défis

```
🎯 **L'Ascension — règles (2/4) : les défis**

**Défis solo**
• Tu peux demander **1 défi toutes les 12 h** au maximum.
• Tu as **48 h** pour le réaliser et déposer ta preuve.
• **2 réussites validées par jour au maximum** (solo + équipe confondus).

**Défi d'équipe**
• **1 par jour et par équipe**, attribué à **18:00 (heure de Paris)**. [PRÉVUE : le code actuel attribue à 09:00]

**Équipes**
• **2 à 8 joueurs**, **1 seule équipe principale** par joueur et par communauté.
• Délai de **7 jours** avant de rejoindre une autre équipe.
• Tout membre GameNight actif peut en créer une ; le créateur est **capitaine**.
[PRÉVUE : PR #370, non fusionnée]

Preuves : captures de jeu et descriptions. Aucune IA ne valide une preuve : ce sont les membres qui votent.
```

### Message R3 — Votes et contestation

```
🗳️ **L'Ascension — règles (3/4) : votes et contestation**

**Vote d'une preuve**
• Le vote dure **24 h**. Il faut **au moins 3 votants distincts**.
• Il faut une **majorité stricte** de « oui ». Égalité = non validé.
• **Tu ne peux pas voter sur ta propre preuve.**
• Pas assez de votants à 24 h : **une seule prolongation de 24 h**, puis **rejet sans pénalité**. Tu peux alors **soumettre à nouveau une fois**. [PRÉVUE : le code actuel laisse le vote ouvert]

**Contestation**
• Ouverte **48 h après la décision**, **1 contestation par défi**.
• Tranchée par un **arbitre indépendant fixe**, choisi à l'avance et journalisé (jamais par un membre impliqué).
[PRÉVUE : PR #407, non fusionnée]
```

### Message R4 — Saisons, classement, récompenses

```
🏁 **L'Ascension — règles (4/4) : saisons et récompenses**

**Saisons**
• **Saison 1 : du 1er décembre 2026 au 31 mars 2027.**
• Puis : avril–juin · **saison d'été juillet–août** · septembre–novembre. [PRÉVUE : le code actuel place S1 du 4 janvier au 28 mars]

**Classement** — départage dans cet ordre :
1) le nombre d'étages gagnés,
2) le nombre de défis difficiles,
3) la date d'atteinte la plus ancienne.
[DISPONIBLE APRÈS ACTIVATION]

**Récompenses**
• Uniquement **cosmétiques** : titres, badges, cadres, distinctions saisonnières. Elles durent **jusqu'à la saison suivante**.
• Aucune récompense payante, aucun pouvoir d'administration.
[PRÉVUE : l'attribution automatique des titres et cadres n'est pas livrée ; podium en lecture seule disponible après activation]
```

## 3. Messages d'accueil

### Annonce d'ouverture (à publier **seulement après** le contrôle de la soirée d'activation)

```
🗼 **L'Ascension ouvre !**

Depuis ce soir, tu peux grimper la Tour : demande un défi avec `/tower defi`, dépose ta preuve, fais voter la communauté, gagne des étages.

📜 Règles complètes : épinglées dans #ascension-règles.
🆘 Un souci ? Un ticket au staff, ou @ un modérateur.

Les équipes, les contestations et les saisons arrivent par étapes : on ne l'annonce que quand c'est vraiment actif.
```

> Mention `@everyone` interdite sans accord du propriétaire. Retirer la phrase finale si tout est déjà actif. Ne coller que si `/tower` répond réellement pour un compte non modérateur.

### Accueil individuel (MP ou réponse de bienvenue, pour un humain du staff)

```
Salut {pseudo} ! Bienvenue sur The Tower 🙂
Tu peux juste discuter et jouer avec nous. Si tu veux t'inscrire aux soirées ou à l'Ascension, tout part de GameNight (connexion Discord).
Dis-moi à quoi tu joues et je te présente quelqu'un !
```

### Rappel du règlement de bonne conduite (court)

```
Rappel : on est là pour s'amuser. Respect, pas de spam, pas de pub, pas de triche sur les défis. Preuves honnêtes uniquement. Le staff tranche en cas de litige.
```

## 4. FAQ

> À coller dans un salon FAQ. Une question par message si besoin (< 2 000 caractères chacune). Les réponses reflètent l'état réel ; adapter les étiquettes à l'activation.

**Dois-je utiliser GameNight pour participer ?**
Non pour discuter, jouer en vocal et rencontrer du monde. Oui pour les inscriptions aux soirées et tournois, les équipes et l'Ascension.

**Comment gagner des étages ?**
Par les défis : facile +1, moyen +2, difficile +3. Les étages sont permanents. [DISPONIBLE APRÈS ACTIVATION]

**Combien de défis par jour ?**
Un défi solo toutes les 12 h au plus, 48 h pour le réaliser, et au maximum 2 réussites validées par jour (solo + équipe). [DISPONIBLE APRÈS ACTIVATION]

**Qui valide mes preuves ?**
La communauté : 24 h de vote, au moins 3 votants distincts, majorité stricte, jamais sur sa propre preuve. Aucune IA. [DISPONIBLE APRÈS ACTIVATION pour le vote ; prolongation et rejet sans quorum : PRÉVUE]

**Mon vote n'a pas atteint le quorum, que se passe-t-il ?**
Une prolongation de 24 h, puis rejet sans pénalité, avec une nouvelle soumission possible. [PRÉVUE]

**Je ne suis pas d'accord avec un résultat.**
Une contestation par défi, dans les 48 h après la décision, tranchée par l'arbitre indépendant. [PRÉVUE]

**C'est quoi un Irregular, un Ranker, un High Ranker ?**
Irregular : prestige donné par le staff. Ranker : 30 étages. High Ranker : 100 étages et au moins 5 défis validés sur la saison. Aucun grade ne donne de droit de modération. [PRÉVUE]

**Puis-je perdre mes étages ?**
Non, ils sont permanents. Seules les distinctions de saison expirent à la saison suivante.

**Combien de joueurs dans une équipe ?**
2 à 8, une seule équipe principale, 7 jours d'attente avant d'en rejoindre une autre. [PRÉVUE]

**Les récompenses coûtent-elles quelque chose ?**
Non. Titres, badges, cadres, distinctions saisonnières seulement. Jamais payant, jamais administratif.

**Quand commence la saison 1 ?**
Le 1er décembre 2026 (décision), jusqu'au 31 mars 2027. [PRÉVUE : calendrier du code à aligner]

**Mes données sont-elles visibles par d'autres serveurs ?**
Non. L'accès aux données collectives exige d'être membre actif de la communauté concernée.

**Y a-t-il une IA ou des salons vocaux temporaires ?**
Pas dans la première version. [PRÉVUE, hors périmètre v1]

## 5. Contrôles avant de coller

1. Chaque étiquette relue contre [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md) (état du jour).
2. Test avec un compte neuf non modérateur sur mobile.
3. Aucun message n'annonce une fonction dont l'étiquette est encore [PRÉVUE].
4. Aucun secret, ID privé ou lien d'administration dans les messages.

## 6. Écarts entre décisions §26 et code actuel (`main` au 17/11/2026)

| Règle | Décidée (17/11/2026) | Code actuel | Fichier |
| --- | --- | --- | --- |
| Défi d'équipe | 18:00 Europe/Paris | 09:00 | `docs/TOWER_TEAM_DAILY_CRON.md`, `src/lib/tower-team-daily.ts` |
| Équipes | 2 à 8 | 2 à 20, plusieurs équipes possibles | `src/lib/community-teams-rules.ts` (#370 le corrige, non fusionnée) |
| High Ranker | 100 étages + 5 défis validés sur la saison | 100 + une saison terminée | `src/lib/tower-ranks.ts` |
| Irregular | attribution manuelle du staff | rang par défaut en dessous de 30 | `src/lib/tower-ranks.ts` |
| Couleurs | gris / violet / or / rouge | non décrites dans le code comme décidé (ancienne décision : bleu / violet / or) | `docs/TOWER_DECISIONS_26_20261104.md` |
| Saison 1 | 1/12/2026 → 31/03/2027 | 4/01 → 28/03 | `src/lib/tower-challenge-seasons.ts` |
| Saisons suivantes | avril–juin, juillet–août, septembre–novembre | S4 septembre–décembre | `src/lib/tower-challenge-seasons.ts` |
| Vote sans quorum | prolongation 24 h puis rejet | vote reste ouvert | `src/lib/tower-challenge-voting.ts` |
| Contestation | 48 h après décision, arbitre fixe | non livrée (#407) | — |
| Départage | étages, défis difficiles, date | conforme | `src/lib/tower-standings.ts` |
| Quotas solo | 12 h, 48 h, 2/jour | conforme | `src/lib/tower-challenge-rules.ts` |
| Vote | 24 h, 3 votants, majorité stricte, pas son propre vote | conforme | `src/lib/tower-challenge-voting.ts` |

Ces écarts sont **notés, pas corrigés** par cette PR (documentation seulement).
