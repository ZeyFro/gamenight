# Potes = amis (cahier C128)

Décision de Maxime (23/11/2026, Q20) : **Potes = seulement les amis GameNight**, avec demande d’ami à accepter et recherche par pseudo ; un non-ami voit si une soirée est publique (il peut la rejoindre) ou privée (sur invitation). Les classements gardent la règle actuelle.

Interrupteur **`POTES_FRIENDS_ENABLED`** (éteint par défaut, valeur exacte `true`), migration **`20261123150000_friendships`** (additive : une table `Friendship` et un type `FriendshipStatus`).

## Règles

- Une ligne par **paire** de membres (`pairKey` = identifiants triés), quel que soit le sens de la demande. États : `PENDING`, `ACCEPTED`, `DECLINED`.
- **Demander** : seulement à un membre ACTIF de la communauté active, jamais soi-même, jamais un **profil masqué** (indistinct d’un membre inexistant). 10 demandes par minute et **20 par jour** et par personne (limite partagée entre serveurs).
- **Demande croisée** (A demande à B alors que B avait déjà demandé à A) : vaut acceptation.
- **Répondre** : seul le destinataire, et une seule fois. **Le refus est silencieux** : le demandeur continue de voir « envoyée », ne peut pas renvoyer ; celui qui a refusé peut, plus tard, demander lui-même.
- **Annuler** une demande envoyée ; **retirer** une amitié (l’un ou l’autre) : chacun pourra redemander.
- **Aucune notification** (ni MP Discord ni annonce) : la demande se voit dans `/potes` (« Demandes reçues »).
- **Recherche** par pseudo : 2 à 32 caractères, insensible à la casse, 20 résultats au plus, membres de la communauté active seulement, jamais soi, jamais un profil masqué.

## Ce que voit un non-ami

`getPoteAccess` (`src/lib/community-isolation.ts`) renvoie `self`, `friend`, `stranger` ou `none`. Pour un `stranger` (membre visible mais pas ami) : fiche réduite (`StrangerPoteCard`) avec pseudo, avatar, état de la demande et ses **soirées à venir** : **publique** (« la rejoindre dans Soirées ouvertes »), **sur candidature**, **privée** (seulement comptée : « n soirées privées : sur invitation seulement », jamais de date, de jeu, d’invités ni d’identifiant). `canViewPote` est **faux** : niveau, badges, bibliothèque, tierlist, statistiques, identifiants de jeu et toutes les sous-pages restent en 404. L’accès au contenu d’une soirée reste celui des invitations.

## Interrupteur éteint

`/potes` liste toute la communauté comme avant ; `canViewPote` est inchangé ; la table n’est jamais lue.

## Suppression de compte

Les lignes `Friendship` du compte (demandeur ou destinataire) sont supprimées (`account-deletion-plan.ts`).

## Retour arrière

Éteindre `POTES_FRIENDS_ENABLED` (aucune donnée perdue). Retour arrière de la migration : `prisma/rollbacks/20261123150000_friendships.sql` (supprime la table, donc toutes les amitiés).

## Tests

`src/lib/friends-rules.test.ts` (règles pures) et `src/lib/friends.integration.test.ts` (PostgreSQL : demande, croisement, refus silencieux, annulation, recherche, accès à une fiche, soirées vues par un non-ami).
