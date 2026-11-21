# Guide de modération — The Tower × GameNight

> **Brouillon à relire par Maxime.** Les échelles de sanctions, les délais et les rôles proposés sont marqués « à valider » : rien n'est décidé tant que tu ne les as pas validés. **À faire relire par un juriste** avant toute application, en particulier la section « Contenu illégal » et la section « Mineurs ». Ce document n'active, n'écrit et ne configure rien (ni Vercel, ni Neon, ni Discord).
>
> Ce que le code fait est tiré de `main` (fichiers cités). Ce qui relève du fonctionnement humain (qui décide, en combien de temps) est une **proposition**.

## 1. Qui peut quoi

### 1.1 Constat : il n'y a pas de rôle applicatif « Modérateur »

Le code ne connaît que deux niveaux, et aucun ne s'appelle « Modérateur » :

| Niveau | Où il est défini | Comment on l'obtient |
| --- | --- | --- |
| **Administrateur de la plateforme** | `UserRole.ADMIN` en base ou identifiant Discord dans `ADMIN_DISCORD_IDS` (`src/lib/admin.ts`) | Variable Vercel ou base (réservé à Maxime) |
| **Rôle de communauté** : `OWNER`, `ADMIN`, `MEMBER` | `Membership.role` (`prisma/schema.prisma`, enum `CommunityRole`) | Liste nominative des OWNER/ADMIN : **À COMPLÉTER par Maxime** (non présente dans le dépôt) |

Les grades Tower (Régulars, Irregular, Ranker, High Ranker) **ne donnent aucun droit de modération** (`docs/DECISIONS_TOWER.md`). Un « modérateur » est donc, selon le cas, un **ADMIN/OWNER de communauté** dans l'application et/ou un **rôle Discord** avec des permissions Discord.

### 1.2 Dans l'application (GameNight)

| Capacité | Administrateur de la plateforme | OWNER / ADMIN de communauté | MEMBER |
| --- | --- | --- | --- |
| Pages `/admin` : messages, badges, joueurs (correction d'XP), nettoyage, communautés, tableau de bord staff | Oui (`requireAdmin`) | Non | Non |
| File des preuves Tower signalées et des contestations (`/admin/tower-appeals`) | — | Oui (ADMIN/OWNER ; jamais sur son propre dossier) | Seulement si désigné arbitre |
| Désigner l'arbitre des contestations visant le staff | — | **OWNER seulement** (arbitre = MEMBER actif, impossible tant qu'une contestation est ouverte) | Non |
| Valider les propositions de défis (`/admin/tower-propositions`), attribuer ou retirer le grade Irregular (`/admin/tower-irregular`) | — | Oui | Non |
| Modérer exploits/fails, cimetière de jeux, expressions (selon les interrupteurs) | — | Oui | Non (création/modification réservées au staff pour cimetière et expressions) |
| Gérer une soirée dont le créateur n'est plus actif | — | Oui | Non |

Limites connues : **aucune action « exclure / bannir un membre » n'existe dans l'application** (on ne trouve que le statut d'appartenance `REMOVED`, posé par la synchronisation avec Discord). Exclure ou bannir se fait donc **sur Discord**. Retirer un contenu d'un membre précis (message de preuve, annonce, fil) est une action Discord manuelle ; GameNight n'efface jamais de message Discord de lui-même.

### 1.3 Dans Discord

La modération Discord repose sur les **permissions des rôles Discord** du serveur, pas sur GameNight. Permissions proposées pour un rôle « Modérateur » (**à valider**, noms exacts à vérifier dans Discord) : gérer les messages, mettre en sourdine/exclure temporairement, expulser, gérer les fils. **Bannir** : proposé à Maxime et aux administrateurs seulement.

Côté bot : seul « Gérer le serveur » (ou Administrateur) ouvre `/tower-admin` et `/gamenight setup` (vérifié dans `src/lib/discord-interactions.ts`, en plus de l'affichage Discord). Le bot **ne sanctionne jamais automatiquement** (ni suppression, ni mute, ni ban, ni retrait de rôle).

> Rappel de prudence : le bot ne doit pas garder le droit Administrateur (voir « Droits minimaux » dans [PHASE_TEST.md](PHASE_TEST.md)).

## 2. Échelle de sanctions (proposition, **à valider**)

| Niveau | Mesure | Quand | Qui peut la décider |
| --- | --- | --- | --- |
| 1 | **Rappel** (message privé ou dans le fil, ton neutre) | Première entorse légère : hors-sujet, spam léger, ton limite | Tout modérateur |
| 2 | **Avertissement** noté au journal | Récidive après rappel, ou entorse nette | Tout modérateur |
| 3 | **Retrait de contenu** (message, preuve, annonce, média) | Contenu hors règles ; peut s'ajouter à un niveau 1 ou 2 | Tout modérateur ; urgence : immédiat, sans attendre |
| 4 | **Exclusion temporaire** (sourdine Discord, durée proposée de quelques heures à 7 jours) | Harcèlement, provocation répétée, triche avérée sur les défis | Un modérateur, avec un second avis si possible |
| 5 | **Bannissement** | Faits graves ou récidive après niveau 4 ; contenu illégal | **Maxime** (ou deux administrateurs d'accord) |

Principes : la sanction est **proportionnée** et **motivée par écrit** au journal (section 9) ; on informe le membre de la règle concernée sauf danger ; on ne sanctionne pas sur la foi d'un seul signalement non vérifié ; un modérateur **ne tranche jamais un dossier qui le concerne** ou qui concerne un proche.

Triche aux défis Tower : une preuve rejetée par le vote n'est pas une sanction ; la triche répétée ou la falsification volontaire suit l'échelle ci-dessus.

## 3. Escalade et délais cibles (proposition, **à valider**)

| Situation | Premier traitement | Qui décide | Délai cible |
| --- | --- | --- | --- |
| Signalement ordinaire | Lire, vérifier le contexte, rappel ou avertissement | Modérateur de service | Première réponse sous 24 h |
| Harcèlement, menaces, doxxing | Masquer/retirer le contenu, prévenir Maxime | Maxime informé ; décision à deux | Retrait dès le constat, information de Maxime sous 1 h |
| Contenu illégal ou mineur concerné | Voir sections 6 et 7 : retrait immédiat, conservation, signalement | Maxime | Retrait dès le constat, décision le jour même |
| Contestation de sanction | Réexamen par une autre personne que le décideur initial | Maxime ou un second modérateur | Réponse sous 72 h |
| Contestation Tower (preuve rejetée) | Voir section 5 | Staff ou arbitre selon le dossier | La contestation doit être déposée dans les 48 h |

Qui est de service à quel moment : **À COMPLÉTER par Maxime** (noms, créneaux ; aucun nom n'est inventé ici).

## 4. Commandes du bot utiles (manifeste `scripts/discord-commands.json`, 13 commandes)

Une commande enregistrée dont l'interrupteur est éteint répond « désactivé » ; `/aide` donne l'état réel. Les commandes sans restriction de permission vérifient côté serveur que la personne est membre actif.

| Commande | Utilité pour la modération |
| --- | --- |
| `/aide` | Liste les commandes GameNight et leur état : premier réflexe pour savoir ce qui est actif. |
| `/Signaler` (clic droit sur un message, Applications) | Un membre actif signale un message : ticket privé dans le salon staff, aucune sanction automatique ; 5 signalements par membre et par heure, un par message et par membre. Actif seulement avec `DISCORD_REPORT_COMMAND_ENABLED` et un salon staff configuré (`docs/SIGNALEMENT_CONTEXTUEL.md`). |
| `/tower-admin` (Gérer le serveur) | Gère le catalogue de défis : `ajouter`, `ajouter-mesure`, `defis` (liste), `desactiver` (retire un défi inadapté sans toucher aux tentatives), `importer`, `importer-equipe`. |
| `/gamenight setup` (Gérer le serveur) | Active GameNight sur ce serveur ; pas un outil de modération. |
| `/tower` | `defi`, `progression`, `classement`, `vote`, `equipe` : utile pour comprendre ce que voit un membre qui conteste. |
| `/profil` | Étage, niveau, badges et équipes d'un membre (le sien). |
| `/equipe` | `liste`, `moi`, `rejoindre` : repérer une équipe concernée par un litige. |
| `/projet` | `liste`, `voir`, `rejoindre`, `quitter`, `creer`, `recrutement`, `espace` : même base que les équipes. |
| `/joueurs` | `annonces`, `chercher`, `mes-annonces`, `publier`, `retirer` : annonces de joueurs (durée 24 h) ; le membre retire les siennes. |
| `/soiree` | `liste`, `voir`, `creer`, `rejoindre`, `quitter` : retrouver une soirée visée par un signalement. |
| `/tournoi` | `liste`, `voir`, `inscription`, `desinscription`, `mes-inscriptions`. |
| `/role` | `chercher`, `attribuer`, `creer`, `retirer` : rôles de jeu sans permission ; ne sert jamais à modérer. |
| `/boost` | Avantages Booster Discord (cosmétiques) ; sans lien avec la modération. |

## 5. Contestations Tower (preuves, votes, appels)

Règles décidées (`docs/DECISIONS_TOWER.md`, constantes dans `src/lib/tower-challenge-*.ts`) :

- **Preuve** : 48 h pour la déposer. Max 2 récompenses validées par jour (solo + équipe).
- **Vote** : 24 h, au moins 3 votants distincts, majorité stricte, égalité = non validé, jamais sur sa propre preuve (ni pour un participant de l'équipe concernée). Votants : membre actif depuis au moins 7 jours.
- **Sans quorum** : une seule prolongation de 24 h, puis rejet **sans pénalité** ; le joueur peut resoumettre une fois.
- **Validation automatique Steam** (défis mesurables, `docs/TOWER_STEAM_AUTOVALIDATE.md`) : fenêtre de doute de 6 h ; « Signaler un doute » (membre actif depuis 7 jours, jamais l'auteur, un seul par défi) renvoie le défi au vote communautaire. Aucune IA ne valide une preuve.
- **Contestation d'un rejet** : ouverte 48 h après l'annonce du résultat, une seule par défi, avec un motif.

Qui examine une contestation (code de `canReviewTowerChallengeAppeal`) :

1. Cas général : un **ADMIN ou OWNER de communauté** qui n'est ni l'auteur, ni participant, ni votant sur ce défi.
2. Si l'auteur est lui-même staff, ou si un arbitre est attaché au dossier : **seul l'arbitre désigné** (un MEMBER non staff, nommé par un OWNER) peut décider.
3. Annuler un rejet (`OVERTURNED`) crédite les étages sauf si le plafond de 2 récompenses par jour est atteint (le dossier reste alors en attente).

> **Écart à trancher par Maxime** : `docs/DECISIONS_TOWER.md` dit « tranchée par l'arbitre fixe », alors que le code n'impose l'arbitre que pour les dossiers de membres du staff ; pour les autres, le staff tranche. Ce guide décrit le code ; à aligner dans un sens ou dans l'autre.

Conduite pour le staff : lire la preuve et le motif, ne pas juger un dossier où l'on a voté ou joué, motiver la décision au journal (section 9), ne jamais « refaire » le vote à la main hors de l'outil. Il n'y a pas de délai de décision imposé par le code : cible proposée, 72 h après dépôt (**à valider**).

## 6. Contenu illégal

> **Principes seulement, à faire relire par un juriste.** Aucun article de loi n'est cité ici volontairement.

1. **Retrait prompt** : masquer ou supprimer le contenu dès qu'il est constaté, sans attendre la décision de sanction.
2. **Conservation** : avant de supprimer, noter le lien du message, l'identifiant du membre, la date et l'heure, et faire une capture lisible. **Ne jamais copier, enregistrer ni rediffuser** un contenu manifestement gravissime (notamment impliquant des mineurs) : noter seulement où il se trouvait. Accès restreint aux personnes qui en ont besoin ; durée de conservation : **À COMPLÉTER** après avis juridique.
3. **Signalement aux autorités compétentes** et à la plateforme concernée (Discord pour un contenu hébergé sur Discord), par Maxime ou la personne qu'il désigne. Procédure exacte et interlocuteurs : **À COMPLÉTER par Maxime avec le juriste**.
4. **Contact de l'éditeur** : les pages légales (`LEGAL_PAGES_ENABLED`, `LEGAL_PUBLISHER`, `LEGAL_PUBLICATION_DIRECTOR`, `LEGAL_CONTACT_EMAIL`) sont éteintes tant que les valeurs ne sont pas fournies : **À COMPLÉTER par Maxime** (nom, adresse de contact). Aucune information d'éditeur n'est inventée.
5. **Demandes de retrait de tiers** (média de galerie, message) : traiter comme un signalement ; pour la galerie, le créateur de la soirée ou un administrateur peut retirer le média.

## 7. Mineurs

- L'âge minimum d'accès est celui de Discord et la valeur `LEGAL_MIN_AGE` des pages légales (13, 15 ou 16, **non décidée : À COMPLÉTER par Maxime**).
- Un membre qui dit être mineur n'est pas pour autant exclu s'il respecte les règles de Discord et du serveur ; la **sécurité d'abord**.
- Toute demande ou échange à caractère sexuel ou déplacé impliquant un mineur : retrait immédiat, **information de Maxime tout de suite**, conservation des repères (section 6), signalement. Ne jamais mener d'« enquête » privée auprès du mineur.
- Ne jamais demander de pièce d'identité ni d'information personnelle pour vérifier un âge.
- Bannissement : décision de Maxime (niveau 5).

## 8. Harcèlement

- Définition de travail : comportement répété, ciblé, qui dégrade la participation d'une personne (moqueries répétées, suivi d'une personne de salon en salon, MP non voulus, divulgation d'informations personnelles).
- Réponse : retrait du contenu, protection de la personne ciblée d'abord (la laisser choisir comment elle veut être contactée), échelle de sanctions section 2, **niveau 4 ou 5 possible dès le premier fait** en cas de menace ou de divulgation d'informations personnelles.
- Pas de médiation forcée. Ne pas révéler l'identité de la personne qui a signalé.
- Les demandes de suppression de compte ou d'export de données (`/profil/compte`, `docs/SUPPRESSION_COMPTE.md`) ne retirent **aucun message Discord** : le retrait des messages publiés est manuel, par le staff, à la demande de la personne.

## 9. Journal des décisions (modèle)

À tenir dans un lieu **privé au staff** (emplacement : **À COMPLÉTER par Maxime**). Pas de capture ni de donnée inutile ; ne jamais y coller un secret.

| Date | Réf. | Signalement (qui / comment) | Membre concerné (pseudo + ID Discord) | Lien ou description du contenu | Règle concernée | Mesure (niveau 1 à 5) | Décideur | Délai de traitement | Preuves conservées (où) | Contestation (oui / non, issue) | Clos le |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AAAA-MM-JJ | M-001 | | | | | | | | | | |
| | | | | | | | | | | | |

Revue : une fois par semaine pendant la [semaine 1](SEMAINE_1.md), puis à un rythme **À COMPLÉTER**.

## 10. Reste à décider (récapitulatif)

- [ ] Valider ou corriger l'échelle (section 2), les délais (section 3), les permissions Discord du rôle Modérateur (section 1.3).
- [ ] Liste nominative des OWNER/ADMIN et des modérateurs, et qui est de service.
- [ ] Trancher l'écart « arbitre fixe » (section 5).
- [ ] Contact éditeur, procédure de signalement aux autorités, durée de conservation, `LEGAL_MIN_AGE` : relecture juridique.
- [ ] Salon staff privé et `DISCORD_REPORT_STAFF_CHANNEL_ID` si `/Signaler` doit être actif au lancement.
- [ ] Lieu privé du journal des décisions.
