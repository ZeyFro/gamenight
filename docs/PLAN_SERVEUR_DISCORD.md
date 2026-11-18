# Plan serveur Discord — The Tower 2.0 (sans écriture)

Plan seulement. Aucune écriture Discord n'a été faite, aucun rôle supprimé, aucun bot touché. Sources : `src/lib/tower-discord-layout.json` (identique à `docs/tower-layout-approved.json`), `scripts/provision-tower-layout.mjs`, `scripts/audit-tower-etage-roles.mjs`, `docs/TOWER_ROLE_REVIEW.md`, `docs/TOWER_FORUM_TAGS.md`, `docs/TOWER_ATLAS_ARRET.md`, `docs/TOWER_TICKET_TOOL_AUDIT.md`, `docs/TOWER_DISCORD_EXECUTION_T17.md`, cahier §3, §4, §6, §16-19, §21, §25. Le cahier s'arrête à §26 : il n'y a pas de §27.

Décisions §26 (approuvées par Maxime le 17/11/2026) appliquées telles quelles : étages permanents ; grades Régulars dès l'inscription, Irregular par attribution manuelle staff (prestige, aucun droit), Ranker >= 30 étages, High Ranker >= 100 étages et au moins 5 défis validés sur la saison en cours ; couleurs gris / violet / or / rouge ; aucun grade ne donne de droit de modération ; récompenses uniquement cosmétiques ; Discord d'abord, GameNight seulement pour équipes, progression et inscriptions.

## 1. Les 7 zones

Principe (cahier §3) : réutiliser les identifiants existants, ne jamais supprimer un salon ou un message, ne pas créer de catégorie par étage. Les permissions ci-dessous sont une proposition de présentation à valider par Maxime ; les catégories existantes gardent leurs overwrites actuels (le script refuse tout écart).

| # | Zone | Statut | Salons (manifeste) | Accès proposé |
| --- | --- | --- | --- | --- |
| 1 | 🏰・LE PORTAIL | existante | 📜 règlement, 🎭 choisir-ses-rôles, 👋 bienvenue (à créer), 📖 guide-de-la-tour (à créer), 📢 annonces | Lecture pour tous, écriture staff/bots seulement. `choisir-ses-rôles` reste géré par YAGPDB. |
| 2 | 🎲・LES ÉPREUVES GAMENIGHT | existante | 📢 annonces-gamenight, 🎮 soirées, 🏆 tournois, 📅 calendrier (à créer), 🎯 défis-communautaires (à créer) | Lecture Régulars+. Annonces postées par le bot GameNight ; discussion dans les fils. |
| 3 | 💬・LE HALL DES RÉGULIERS | existante | 💬 général, 🙋 présentations (à créer), 🎮 qui-joue-ce-soir (à créer), 📰 actualités-gaming, 📊 sondages | Lecture et écriture Régulars+. |
| 4 | ⚔️・LE HALL DES ÉQUIPES | existante | forums 🔎 recherche-de-joueurs, 🛡️ recrutement-équipes, 🌍 projets-et-aventures (à créer) ; 🏆 équipes-et-guildes | Lecture Régulars+, création de posts Régulars+. |
| 5 | 🗼・L'ASCENSION | à créer | 📖 comment-gravir-la-tour, ⚡ épreuves, 🏅 progression-et-rangs, 🎁 récompenses, 📜 chroniques-de-la-tour | Lecture Régulars+, écriture bot GameNight et staff. Preuves, votes et progression passent par le bot / GameNight, pas par des messages libres. |
| 6 | 🔊・LES SALLES DE LA TOUR | existante | vocaux général-1/2, gaming-1/2, ➕ créer-un-vocal (lobby, à créer), 🎵 musique, 💤 afk | Régulars+ : voir, se connecter, parler. Aucun bot de vocaux temporaires installé automatiquement (§17, extension hors v1). |
| 7 | 👑・LE SOMMET | à créer | 🏆 classements, ⭐ hall-of-fame, 👑 rankers, ⚔️ défis-entre-équipes | Classements et hall-of-fame : lecture Régulars+, écriture bot. `rankers` : accès Ranker et High Ranker (accès à un salon, pas un pouvoir). Données réelles seulement (§16). |

Catégories protégées, jamais déplacées : tribunal / logs staff (`576460995472523285`), deux catégories dynamiques Ticket Tool (`734424863988776960`, `734424902400081932`), accès privé Irregular (`854003747595747328`). Catégories d'archive (Team LoL, Overwatch, CS-GO, Valorant, Mudae) : revue seulement, ni déplacement ni suppression dans ce plan.

Les deux catégories à créer n'ont pas de `permission_overwrites` dans le manifeste : le script d'application historique les refuse tant qu'elles ne sont pas déclarées. À la main, créer la catégorie avec les overwrites de la colonne « Accès » avant d'y créer des salons, puis vérifier avec un compte de test non modérateur.

## 2. Forums et tags

Tags proposés (5 maximum au départ, outil de découverte et non permission) ; lire d'abord les tags déjà présents et les conserver. Le dry-run signale ceux qui manquent.

| Forum | Tags |
| --- | --- |
| 🔎・recherche-de-joueurs | PC, PlayStation, Xbox, Switch, Cross-play |
| 🛡️・recrutement-équipes | Débutants bienvenus, Détente, Compétitif, Long terme, Recherche capitaine |
| 🌍・projets-et-aventures | Coop, Construction, Exploration, Survival, Événement |

Modèle de publication conseillé : jeu (ou « jeu gratuit / navigateur »), plateforme, disponibilités (heure de Paris), micro oui/non, taille de groupe, style de partie. Pas d'information personnelle dans les tags.

## 3. Rôles et grades

| Grade | Couleur | Condition (§26) | Droits de modération |
| --- | --- | --- | --- |
| Régulars | gris | dès l'inscription | aucun |
| Irregular | violet | attribution manuelle staff (prestige) | aucun |
| Ranker | or | >= 30 étages | aucun |
| High Ranker | rouge | >= 100 étages et >= 5 défis validés sur la saison en cours | aucun |

Règles : les grades sont des rôles de prestige distincts des rôles techniques et staff (§6.2). Aucun grade n'a ADMINISTRATOR, ni gestion des rôles, salons, messages ou fils, ni exclusion, bannissement, exclusion temporaire, mention @everyone, journal d'audit, webhooks (le dry-run vérifie ces bits et bloque s'il en trouve ; il ne retire rien). Les grades doivent se placer sous tous les rôles staff et bots dans la hiérarchie. Le rôle Régulars existant est celui que donne le mécanisme de validation du règlement : le vérifier avant toute modification (§4.3), ne pas en créer un second.

Rôles existants : 197 rôles dont 134 Etage et 13 avec ADMINISTRATOR (revue du 26/10). Décision prudente maintenue : aucun rôle fusionné, renommé, archivé ou supprimé sur cette base.

### Remplacement des rôles d'étage Atlas par la progression GameNight

- L'étage est un compteur permanent en base GameNight (+1 / +2 / +3 selon la difficulté). Aucun nouveau rôle Discord par étage (§6.3).
- Ordre : (1) inventaire en lecture seule des 134 rôles et de leurs dépendances (`node scripts/audit-tower-etage-roles.mjs --check`, ou `--inventory` hors ligne) ; (2) pause de la seule attribution d'étages d'Atlas, sans retirer les rôles ; (3) période d'essai avec de vrais membres sans double progression ; (4) décision séparée, lot par lot, avec liste exacte d'identifiants et accord de Maxime à l'action.
- Aucun rôle n'est supprimé par ce plan ni par les scripts. `safeToDelete` reste faux. Un rôle de dépendance inconnue est conservé. Une suppression n'est pas restaurable à l'identique (nouvel identifiant).
- Les anciens niveaux ne sont pas transférés au compteur neuf sans décision ; les historiques sont conservés.

## 4. Bots et systèmes historiques

| Système | Sort | Détail |
| --- | --- | --- |
| YAGPDB | conserver | Validation du règlement et choix de rôles. Pas de second parcours concurrent ; panneau GameNight à trois boutons en complément (`TOWER_ONBOARDING_PANEL_SETUP.md`). Vérifier le rôle qu'il attribue avant tout changement. |
| Atlas | arrêt partiel | Mettre en pause uniquement l'attribution des étages. Garder ses autres fonctions utiles après vérification (journal d'audit, dépendances salons, rôles de prestige). Retour arrière : restaurer les réglages sauvegardés. |
| Ticket Tool | réparer et réutiliser | Deux panneaux « Aide privée » dans `#requête` : actif non identifié. Relever les deux identifiants de message, les panneaux du tableau de bord, les catégories cibles. Ne rien supprimer avant accord ; ne toucher ni aux tickets ouverts ni aux transcripts. |
| Appy | conserver | Candidatures seulement ; ne pas les confondre avec les tickets d'assistance. |
| Modération | auditer | Pas d'empilement de bots faisant les mêmes actions ; décision après audit. |

## 5. Dry-run (scripts)

- `node scripts/tower-discord-dryrun.mjs --inventory <fichier.json>` : hors ligne, fichier `{ "channels": [...], "roles": [...] }` (réponses brutes des GET Discord).
- `node scripts/tower-discord-dryrun.mjs --live` : GET `channels` et `roles` seulement, avec `DISCORD_BOT_TOKEN` et `DISCORD_BOT_GUILD_ID` dans l'environnement ; le jeton n'est jamais affiché ni écrit. Sans `--apply` ni autre option d'écriture : ce mode n'existe pas.
- `--json` (sortie machine), `--strict` (code 1 tant qu'il reste des éléments à créer, corriger ou bloquants).
- `node scripts/provision-tower-layout.mjs` sans `--apply` appelle maintenant ce même diff (plus d'instantané écrit sur disque). Son mode `--apply` historique reste protégé par `TOWER_DISCORD_APPLY=I_UNDERSTAND` et n'est pas utilisé par ce plan.
- Sortie : `=` conforme, `~` à renommer/corriger, `+` à créer, `!` bloquant, `?` à revoir à la main, puis un bilan. Sections : salons et forums (avec tags), grades, rôles Etage (compte seulement).
- Tests : `npx vitest run src/lib/tower-layout-dryrun.test.ts` (Discord simulé, vérifie GET seulement, aucun jeton dans la sortie, absence de mode d'écriture).

## 6. Checklist Maxime (environ 1 h 45, à la main)

Prérequis : accès administrateur, un compte de test non modérateur, la sortie du dry-run enregistrée avant et après. Rien n'est supprimé à aucune étape.

1. (10 min) Lancer le dry-run `--live` et garder la sortie. Exporter à la main la liste des rôles (nom, couleur, position) pour pouvoir revenir en arrière. Arrêter si une ligne `!` bloquante apparaît sur un salon réutilisé.
2. (10 min) Grades : créer les rôles manquants Régulars (seulement s'il n'existe pas déjà celui du règlement), Irregular, Ranker, High Ranker avec les couleurs gris, violet, or, rouge, sans aucune permission de modération. Les placer sous les rôles staff et bots. Corriger toute couleur signalée `~`.
3. (10 min) Zones 5 et 7 : créer 🗼・L'ASCENSION et 👑・LE SOMMET avec les overwrites du tableau (§1), puis leurs salons. Vérifier avec le compte de test.
4. (10 min) Salons manquants des zones 1 à 3 et 6 (bienvenue, guide-de-la-tour, calendrier, défis-communautaires, présentations, qui-joue-ce-soir, créer-un-vocal). Renommer ceux signalés `~`, sans déplacer de salon existant avant audit des permissions.
5. (15 min) Zone 4 : créer les trois forums et leurs tags (§2) ; conserver les tags existants.
6. (10 min) Relancer le dry-run : il ne doit plus rester de `+`, de `~` ni de `!` hors éléments volontairement différés.
7. (15 min) Atlas : relever les rôles Etage, la position et les permissions du rôle Atlas, les règles d'attribution (tableau de bord Atlas), le journal d'audit. Ne rien modifier. Lancer `audit-tower-etage-roles.mjs --check` pour le compte et les dépendances.
8. (10 min) Atlas : décider avec accord explicite du moment de la pause de l'attribution d'étages ; la faire après la bêta, jamais pendant. Garder les 134 rôles.
9. (10 min) Ticket Tool et YAGPDB : relever les deux panneaux (identifiants de message, nom au tableau de bord) et le rôle donné par YAGPDB. Noter lequel garder ; ne rien désactiver aujourd'hui.
10. (10 min) Recette : se connecter avec le compte de test (nouveau membre), lire le règlement, obtenir Régulars, voir les zones 1 à 4, 6, ne voir aucun salon staff, ne pas pouvoir écrire dans `rankers`.

Hors checklist (décisions à part) : suppression des 134 rôles Etage, suppression ou désactivation du panneau Ticket Tool doublon, archivage des catégories d'équipes et Mudae.

## 7. Écarts à noter (code ou docs plus anciens contre §26 du 17/11)

| Sujet | Existant | Décidé |
| --- | --- | --- |
| Couleurs | `docs/TOWER_DECISIONS_26_20261104.md` : Irregular bleu, Ranker violet `#8b5cf6`, High Ranker or | Régulars gris, Irregular violet, Ranker or, High Ranker rouge (ce plan) |
| High Ranker | `src/lib/tower-ranks.ts` : >= 100 étages et au moins une saison terminée | >= 100 étages et >= 5 défis validés sur la saison en cours |
| Irregular | `tower-ranks.ts` : rang par défaut sous 30 étages | attribution manuelle staff (prestige), Régulars dès l'inscription |
| Saison 1 | docs du 04/11 : 4 janvier au 28 mars 2027 ; ouverture 4 janvier | 1er décembre 2026 au 31 mars 2027 ; lancement semaine du 1er décembre |
| Défi d'équipe | docs du 04/11 : 09:00 Paris | 18:00 Europe/Paris |
| Rôles Discord de grade | `tower-ranks.ts` : statut applicatif seulement, aucune attribution de rôle Discord | rôles de grade présents sur le serveur : attribution manuelle par le staff tant qu'aucune synchronisation n'est livrée (non décidée ici) |

Ces écarts sont signalés, pas corrigés ici.
