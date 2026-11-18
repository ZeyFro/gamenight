# /joueurs — recherche de partenaires (v1)

Commandes : `chercher`, `annonces`, `mes-annonces`, `publier`, `retirer`.
Flags : `DISCORD_PLAYER_COMMAND_ENABLED`, `DISCORD_PLAYER_WRITE_ENABLED`
(fermés par défaut ; l'écriture est indépendante de la lecture).

## Un seul modèle

`PlayerClassified` — celui de la page `/joueurs`, avec les règles partagées
`playerClassifiedSchema` et `playerClassifiedExpiresAt` (24 h). Aucune table, aucun
stockage parallèle. Les annonces Discord apparaissent sur `/joueurs` et celles
publiées sur le site sont lisibles par `/joueurs annonces`.

Porte d'accès identique au site : `getPlayerClassifiedCommunityId` (membre actif +
`playerClassifiedsEnabled`), puis appartenance `ACTIVE` au serveur Discord.

## Limite de champs, assumée

Le modèle ne contient que `gameId` et `message` (240 caractères). Plateforme,
nombre de joueurs recherchés, niveau et disponibilités **n'ont pas de colonne** :
ils ne sont pas inventés et ne sont pas stockés. Le message libre peut les
contenir. Les ajouter demande une migration Prisma → accord explicite.

## Fichiers réservés #408

`src/lib/player-classifieds*.ts` et `src/app/joueurs/**` sont réservés : ce module
les **importe** sans les modifier. `publier`/`retirer` réimplémentent le minimum
d'écriture (schéma + expiration + propriété) parce qu'aucun service d'écriture
n'est exporté aujourd'hui. Quand #408 exposera `createPlayerClassified` /
`deletePlayerClassified`, ces deux fonctions devront les appeler : il ne doit
rester qu'une seule copie de la règle.

## Sécurité

- l'auteur est toujours l'utilisateur du contexte Discord (jamais une option) ;
- `retirer` refuse toute annonce dont `createdById` n'est pas l'appelant ;
- limite de 5 publications par fenêtre de rate-limit ;
- réponse privée, aucune mention, aucun identifiant Discord.

## Correctif du 17/11 — une seule logique d'écriture

`src/lib/player-listings.ts` est désormais **le** service d'écriture des annonces :
`createPlayerListing`, `deletePlayerListing`, `listCommunityListings`,
`listOwnListings`, `filterListings`. Il porte la validation du schéma partagé,
l'expiration 24 h, la limite de débit, l'anti-doublon (même auteur + jeu + message
encore actif) et le contrôle d'auteur.

- Discord : `/joueurs publier|retirer|annonces|mes-annonces|chercher` n'a plus
  aucune requête d'écriture propre.
- Web : l'action `src/app/joueurs/actions.ts` n'est pas modifiée par cette extraction.
- Le web garde sa logique locale : la synchronisation d’écriture web → service partagé reste à faire (état transitoire assumé).

Nouveautés de parcours : `mes-annonces` distingue les annonces **expirées**,
`chercher` filtre jeu/message/auteur sans accent, et les réponses portent un lien
`/joueurs` **uniquement** quand l'origine Vercel est résolvable.

## Annonces interactives et correctifs (17/11)

- Boutons d'annonce : « Je suis intéressé » (`gn:listing:interest:<id>`),
  « Contacter l'auteur » (`gn:listing:contact:<id>`) et lien GameNight (style 5)
  **seulement** si l'origine Vercel est résolvable. Un identifiant invalide ne
  produit aucun bouton.
- `respondToListingInteraction` refuse : annonce retirée, expirée, autre serveur,
  non-membre, compte Discord inconnu, limite de débit, auteur qui clique sur sa
  propre annonce. **Aucune candidature n'est enregistrée** : aucun modèle
  n'existe, le message renvoie vers l'auteur (`<@id>`) au lieu de simuler.
- Correctif de messages : `deletePlayerListing` distingue `deleted`,
  `not_owner`, `rate_limited`, `missing`. La limite de débit affiche désormais le
  message de limite (et non « introuvable »), et aucun cas n'annonce une
  suppression qui n'a pas eu lieu.
- Helpers inutilisés retirés (`isSameListingMessage`, alias `PlayerListingView`) ;
  les issues mortes `unavailable` ont disparu des types du service.

## Boutons réellement affichés (17/11)

`/joueurs annonces`, `/joueurs chercher` et la confirmation de `publier` joignent
désormais des composants au payload (`editSetupResponse({ components })`) :

- une rangée par annonce **active**, au maximum 4 (Discord plafonne à 5) ;
- boutons « Je suis intéressé », « Contacter l'auteur » et, si l'origine Vercel
  est résolvable, « Ouvrir GameNight » ;
- aucune rangée pour une annonce expirée ;
- `retirer` n'envoie aucun composant.

Chaque clic est revérifié côté serveur (annonce existante, non expirée, même
serveur, membre actif) : un bouton ne peut pas agir sur l'annonce d'une autre
communauté. L'intérêt reste **non persisté** et le message le dit.
