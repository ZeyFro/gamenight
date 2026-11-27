# Permissions des bots du serveur The Tower — retirer Administrateur sans rien casser

> Relevé du 23 novembre 2026. **Constat** : le rôle **Workshop**, qui donne **Administrateur**, est porté par 12 bots (Vexera a déjà été expulsé). GameNight a lui aussi Administrateur, par le rôle **AppBot**. Un bot Administrateur peut tout faire sur le serveur : si **un seul** de ces 12 jetons fuit, ou si l'éditeur d'un bot est piraté, le serveur entier est perdu (salons supprimés, membres bannis, messages effacés).
>
> **Sources.** Pour GameNight : le code (`docs/PHASE_TEST.md`, « Droits minimaux de GameNight »). Pour les 11 autres bots : leur fonctionnement public connu. **Je ne vois pas leur configuration sur ton serveur** : les permissions ci-dessous sont celles des fonctions habituelles. Vérifie sur le tableau de bord de chaque bot quelles fonctions sont vraiment allumées, et coche seulement celles-là.
>
> **Pour ChatGPT** : ce plan s'applique dans l'application Discord, compte propriétaire du serveur, sans outil externe. Ne supprime aucun rôle et n'expulse aucun bot sans l'accord écrit de Maxime.

---

## 1. Les bots, un par un

Noms des permissions tels qu'ils apparaissent dans Discord en français.

**Socle commun** (presque tous les bots) : *Voir les salons*, *Envoyer des messages*, *Intégrer des liens*, *Voir l'historique des messages*. Les lignes ci-dessous disent ce qu'il faut **en plus**.

| Bot | À quoi il sert | Permissions minimales en plus du socle | Encore utile ? (critère) |
| --- | --- | --- | --- |
| **GameNight** (rôle AppBot) | Le site : annonces de soirées, tournois et défis, MP, commandes `/tower-admin`, `/aide`… | Les 13 permissions de `PHASE_TEST.md` (masque `395408788496`) : socle + *Gérer les salons*, *Gérer les rôles*, *Créer des fils publics*, *Créer des fils privés*, *Envoyer des messages dans les fils*, *Gérer les fils*, *Se connecter*, *Parler* et **_Mentionner @everyone, @here et tous les rôles_** (voir « GameNight et les mentions » ci-dessous). Ne jamais retirer cette dernière. | **Oui**, indispensable. |
| **Appy** | Formulaires de candidature (staff, équipes) par MP, résultats postés dans un salon, rôle donné à l'acceptation | *Gérer les rôles* (seulement si un rôle est donné à l'acceptation) | Oui s'il sert aux candidatures du staff. GameNight a ses propres candidatures d'**équipe**, éteintes : pas de doublon au lancement. |
| **Atlas** | Bot à tout faire : modération, journaux, niveaux, messages de bienvenue | Selon les modules allumés : *Gérer les messages* ; *Gérer les rôles* ; *Expulser*, *Bannir*, *Exclure temporairement des membres* (modération) ; *Voir les logs du serveur* (journaux) | **Retirer** (décision du 23/11) : doublon avec MEE6 et YAGPDB. |
| **Discord.Me** | Référencer le serveur sur l'annuaire discord.me (« bump », nombre de membres) | *Créer une invitation* | **Garder** (décision du 23/11). |
| **Koya** | Vérification des nouveaux arrivants, anti-raid, rôles par réaction, bienvenue | *Gérer les rôles* ; *Ajouter des réactions* ; *Expulser des membres* (anti-raid) ; *Gérer les messages* | Oui s'il fait la vérification à l'entrée. Sinon doublon avec MEE6 ou Atlas. |
| **MEE6** | Niveaux et rôles de niveau, modération, bienvenue, rôles par réaction, alertes | *Gérer les rôles* (rôles de niveau) ; *Gérer les messages* ; *Ajouter des réactions* ; modération si utilisée : *Expulser*, *Bannir*, *Exclure temporairement* ; *Voir les logs du serveur* | **Garder**, mais **couper son module Niveaux** (décision du 23/11) : seul l'XP GameNight compte. Sans niveaux, *Gérer les rôles* ne sert plus qu'aux rôles par réaction. |
| **MonitoRSS** | Publie des flux RSS (actualités, sites) dans des salons | *Gérer les webhooks* seulement si l'on veut un nom et un avatar personnalisés | Oui si des flux sont actifs. Vérifier sur son tableau de bord. |
| **PatchBot** | Publie les notes de mise à jour des jeux | *Gérer les webhooks* (facultatif, même raison) | Oui si des jeux sont suivis. GameNight a des actualités de jeux, mais dans le site, pas dans Discord. |
| **RPBot** | Jeu de rôle : fiches de personnages, dés, messages « au nom » d'un personnage | *Gérer les webhooks* (messages au nom d'un personnage) ; *Gérer les messages* (effacer le message d'origine) | À vérifier : utilisé seulement s'il y a des parties de jeu de rôle sur le serveur. |
| **Ticket Tool** | Tickets d'aide : crée un salon privé par demande | *Gérer les salons* ; *Gérer les rôles* (droits du salon de ticket) ; *Joindre des fichiers* ; *Gérer les messages* ; *Créer des fils privés* (mode « fil ») | Oui s'il sert à l'aide ou à la modération. Il ajoute lui-même ses droits sur les salons qu'il crée. |
| **UnbelievaBoat** | Économie (monnaie, boutique, jeux de hasard), modération | *Gérer les rôles* (rôles achetés en boutique) ; modération si utilisée | **Couper son économie** (décision du 23/11) : seul l'XP GameNight compte. Sans boutique, il n'a plus besoin de *Gérer les rôles*. |
| **YAGPDB** | Commandes personnalisées, rôles automatiques, modération, journaux | *Gérer les rôles* ; *Gérer les messages* ; *Gérer les pseudos* (si utilisé) ; modération si utilisée ; *Voir les logs du serveur* | **Garder** (décision du 23/11). |

**Ce qu'aucun bot ne devrait garder** : *Administrateur* ; *Gérer le serveur* (sauf demande précise d'un bot de configuration) ; *Mentionner @everyone, @here et tous les rôles* (sauf un bot d'annonces décidé par Maxime : **GameNight**, voir ci-dessous).

### GameNight et les mentions (décision de Maxime, 23/11/2026)

Les rôles du serveur **Gaming, Minecraft, Yama, Otaku, Chef-Otaku, The-Hell, Citoyen-Des-Etoile, Ranker et Régulars** ne sont **pas** mentionnables par tout le monde. Un bot sans le droit *Mentionner @everyone, @here et tous les rôles* peut écrire `@Minecraft` dans un message, mais **personne n'est notifié**.

- **Quand on retire Administrateur à GameNight, il garde ce droit** (masque `395408788496`, 13 permissions). Il est dans le lien d'invitation de [PHASE_TEST.md](PHASE_TEST.md) § 3.
- **Ce que le code fait aujourd'hui** : les pings de soirée et de tournoi visent les **membres** invités (`allowedMentions.users`), ce qui ne demande pas ce droit. Le bot n'envoie **jamais** @everyone ni @here (retiré dans `discord-rest.ts`, pour tous les envois). Le seul ping de **rôle** prévu est celui du rôle de jeu (`buildGameRolePing`, question Q19), pas encore branché : c'est lui qui a besoin de ce droit.
- **Garde-fous** : `src/lib/discord-bot-permissions.test.ts` échoue si le masque perd ce droit, si la documentation ne donne plus le même masque, ou si une mention de rôle ou @everyone apparaît ailleurs que dans `notification-policy.ts`. La pré-vérification `/api/admin/tower-preflight` (lecture seule, `TOWER_DISCORD_PREFLIGHT_ENABLED`) liste les permissions qui manquent réellement au bot sur le serveur, dont celle-ci.
- **Vérifier après le retrait d'Administrateur** : ouvrir la pré-vérification ; `botPermissions.missing` doit être vide.

**Décision de Maxime (23/11)** : garder **MEE6 et YAGPDB**, **retirer Atlas** ; **garder Discord.Me** ; **couper les niveaux et la monnaie de MEE6 et d'UnbelievaBoat** (seul l'XP GameNight compte : désactiver le module Niveaux de MEE6 et l'économie d'UnbelievaBoat sur leur tableau de bord, puis retirer leurs rôles de niveau ou de boutique devenus inutiles). Chaque bot retiré, c'est un jeton de moins qui peut fuir.

---

### GameNight et le forum « 🔎・recherche-de-joueurs » (D3, 27/11/2026)

Le relais des annonces de joueurs publie un post par annonce dans le forum `🔎・recherche-de-joueurs` et **supprime** ce post quand l'annonce est retirée, que le compte est supprimé ou que le profil est masqué (à l'expiration, il est seulement fermé : archivé et verrouillé). Sur **ce forum** (permissions du salon, pas seulement du serveur), le rôle de GameNight doit avoir :

| Permission | Pourquoi |
| --- | --- |
| *Voir le salon* et *Envoyer des messages* | créer les posts |
| *Mentionner @everyone, @here et tous les rôles* | le ping du rôle de jeu (opt-in), jamais @everyone ni @here |
| **_Gérer les fils_** | **supprimer** un post (`DELETE` d'un fil) et archiver/verrouiller un fil |

Sans *Gérer les fils*, la suppression est refusée par Discord : GameNight **replie alors sur l'archivage + verrouillage** du fil et signale l'échec dans `/admin/erreurs` (« permission Gérer les fils manquante ? »). Le contenu reste alors lisible : l'accorder avant d'allumer `PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED`. Avant chaque suppression, GameNight vérifie par un `GET` que l'identifiant est bien un fil public de ce forum ; sinon il refuse de supprimer.

## 2. Deux règles de Discord à connaître avant de commencer

1. **La hiérarchie des rôles.** Un bot ne peut donner ou retirer **que** les rôles placés **en dessous** de son propre rôle. Sans Administrateur, MEE6 (rôles de niveau), Koya et YAGPDB (rôles automatiques), UnbelievaBoat (rôles de boutique), Appy et GameNight (rôles de jeu) doivent avoir leur rôle **au-dessus** des rôles qu'ils distribuent, mais **en dessous** des rôles du staff.
2. **Les salons privés.** Administrateur voit tous les salons, même privés. Sans lui, un bot ne voit un salon privé que si on l'y autorise. Pour chaque salon privé où un bot doit écrire ou lire (journaux d'Atlas ou de YAGPDB, salon staff, salon de candidatures d'Appy, catégorie des tickets…), ajoute le rôle du bot avec *Voir le salon* et ce dont il a besoin.

---

## 3. Le plan pas à pas (pour ChatGPT)

**Durée** : environ 1 h 30, à faire dans un moment calme, **pas** le soir du lancement. **Règle** : un seul bot à la fois ; on teste ; on passe au suivant.

### Étape 0 — Préparer (10 min)

1. Se connecter avec le **compte propriétaire** du serveur.
2. **Paramètres du serveur → Rôles → Workshop** : faire une capture de l'onglet *Permissions* et de l'onglet *Gérer les membres*, qui doit lister les 12 bots.
3. Même chose pour **AppBot**.
4. **Paramètres du serveur → Rôles** : faire une capture de l'**ordre** des rôles.
5. Ouvrir un salon de test privé, par exemple `#test-bots`, visible seulement par le staff.

### Étape 1 — Donner à chaque bot ses permissions minimales, **avant** de retirer quoi que ce soit (30 min)

Chaque bot a un **rôle intégré** à son nom (icône de robot, il ne peut pas être supprimé).

1. **Paramètres → Rôles →** rôle intégré du bot → *Permissions*.
2. Cocher le socle et les permissions « en plus » du tableau du § 1, **seulement pour les fonctions vraiment utilisées** (regarder le tableau de bord du bot).
3. Enregistrer. Rien ne change encore pour le bot, puisqu'il a toujours Administrateur par Workshop.
4. Pour GameNight, le plus simple est de **réinviter** l'application avec le lien de `PHASE_TEST.md` (§ 3, permissions `395408788496`) : réinviter ajoute les droits sans rien retirer.

### Étape 2 — Ranger la hiérarchie (10 min)

1. **Paramètres → Rôles** : glisser les rôles intégrés de MEE6, Koya, YAGPDB, UnbelievaBoat, Appy et GameNight **au-dessus** des rôles qu'ils distribuent (rôles de niveau, de jeu, de boutique, rôle « vérifié »…).
2. Les garder **en dessous** des rôles d'administration et de modération humains.
3. Capture du nouvel ordre.

### Étape 3 — Ouvrir les salons privés aux bots qui en ont besoin (10 min)

Pour chaque salon ou catégorie privés utilisés par un bot :

1. Réglages du salon → *Permissions* → ajouter le rôle du bot.
2. Cocher *Voir le salon*, *Envoyer des messages*, *Intégrer des liens*, *Voir l'historique des messages*, plus *Joindre des fichiers* pour les journaux.
3. Cas connus : le salon staff des signalements (GameNight), les salons de journaux (Atlas, YAGPDB), la catégorie des tickets (Ticket Tool) et le salon des candidatures (Appy).

### Étape 4 — Retirer Workshop, un bot à la fois (40 min)

Ordre conseillé, du moins risqué au plus important :

**Atlas (à expulser) → Discord.Me → PatchBot → MonitoRSS → RPBot → Appy → UnbelievaBoat → Koya → YAGPDB → MEE6 → Ticket Tool → GameNight.**

Pour chaque bot :

1. **Paramètres → Membres** → le bot → retirer le rôle **Workshop**. Pour GameNight, retirer **AppBot**.
2. Faire **le test** du § 4 dans `#test-bots`.
3. Test réussi : noter « OK » et l'heure, passer au bot suivant.
4. Test raté : **remettre Workshop** au bot (retour arrière immédiat), noter le message d'erreur, et chercher la permission manquante dans le § 1 (souvent un salon privé non ouvert ou un rôle mal placé). Corriger, puis réessayer.

### Étape 5 — Fermer la porte (5 min)

1. Quand **plus aucun membre** ne porte Workshop : **Paramètres → Rôles → Workshop → Permissions** → **décocher Administrateur**. Ne pas supprimer le rôle : on peut s'en servir pour revenir en arrière.
2. Même chose pour **AppBot** quand GameNight ne le porte plus.
3. Capture finale de Workshop et d'AppBot sans Administrateur.
4. Vérifier qu'aucun autre rôle de bot n'a Administrateur : **Paramètres → Rôles**, ouvrir chaque rôle intégré.

---

## 4. Le test de chaque bot

| Bot | Test rapide dans `#test-bots` (ou le salon habituel) | Réussi si… |
| --- | --- | --- |
| Discord.Me | Sa commande de « bump » | Il répond, ou on décide de le retirer |
| PatchBot | Ouvrir son tableau de bord et regarder le dernier message envoyé | Les notes de patch continuent d'arriver dans leur salon |
| MonitoRSS | Son tableau de bord → « tester » un flux | L'article de test arrive dans le salon du flux |
| RPBot | Sa commande d'aide, un lancer de dés | Il répond ; un message « au nom d'un personnage » s'affiche |
| Appy | Lancer un formulaire de candidature de test | MP reçu ; résultat posté ; rôle donné si prévu |
| UnbelievaBoat | Commande de solde, puis achat d'un rôle de test s'il y a une boutique | Il répond ; le rôle est donné |
| Koya | Faire entrer un compte de test, ou utiliser sa commande de test | Vérification et rôle d'arrivée fonctionnent |
| Atlas | Supprimer un message de test | L'événement apparaît dans le salon de journaux |
| YAGPDB | Une commande personnalisée ; un rôle automatique de test | Il répond ; le rôle est donné |
| MEE6 | Gagner un niveau avec un compte de test, ou sa commande de niveau | Le rôle de niveau est donné |
| Ticket Tool | Ouvrir un ticket de test | Le salon de ticket est créé, le staff le voit, la fermeture marche |
| GameNight | `/aide` ; `/tower-admin defis` (avec « Gérer le serveur ») ; sur le site, créer une soirée de test | Réponses privées ; annonce de la soirée dans son salon ; MP reçu |

---

## 5. Retour arrière

- **Un bot casse** : lui remettre Workshop (ou AppBot), c'est immédiat. Puis chercher la permission manquante.
- **Plusieurs bots cassent** : remettre Administrateur sur le rôle Workshop et redonner Workshop aux bots concernés. Le serveur revient exactement à l'état de départ, grâce aux captures de l'étape 0.
- **Rien n'est supprimé** dans tout ce plan : ni rôle, ni bot, ni salon.

## 6. Après

- Noter dans le journal de modération la date, ce qui a été retiré et qui l'a fait.
- Une fois par mois : **Paramètres → Rôles**, vérifier qu'aucun bot n'a récupéré Administrateur. Certains bots le redemandent quand on les réinvite.
- Un nouveau bot ne reçoit jamais Workshop : on lui donne ses permissions minimales dès l'invitation.
