# /tournoi v1 — lecture seule

Commande `/tournoi` livrée le 17/11/2026, **désactivée par défaut**
(`DISCORD_TOURNAMENT_COMMAND_ENABLED=false`).

## Portée

| Sous-commande | Contenu |
| --- | --- |
| `/tournoi liste [statut]` | Tournois de la communauté : à venir (inscriptions), en cours, terminés, tous |
| `/tournoi voir tournoi:<id>` | Détail : jeu, statut, format, participants, organisateur, vainqueur |

Aucune écriture : ni création, ni inscription, ni score, ni annonce. Tout cela
reste sur GameNight (`/tournois`).

## Règles réutilisées

- **Données** : `Tournament` / `TournamentParticipant` (compteur), `champion` /
  `championTeam` — les mêmes champs que la page `/tournois`.
- **Portée** : uniquement la communauté du serveur Discord (`Community.discordGuildId`),
  et seulement pour un membre `ACTIVE`. Un tournoi d'une autre communauté n'est
  jamais lisible, même avec son identifiant.
- **Confidentialité** : aucun identifiant Discord, aucune donnée privée ; noms
  d'affichage déjà publics sur le site.

## Déclaration Discord (à intégrer par le propriétaire de #416)

`scripts/discord-commands.json` est réservé par #416 : bloc à ajouter tel quel.

```json
{
  "name": "tournoi",
  "type": 1,
  "description": "Les tournois GameNight (lecture seule)",
  "default_member_permissions": null,
  "integration_types": [0],
  "contexts": [0],
  "options": [
    { "type": 1, "name": "liste", "description": "Les tournois de la communauté", "options": [
      { "type": 3, "name": "statut", "description": "avenir, encours, termines ou tous", "required": false,
        "choices": [
          { "name": "à venir", "value": "avenir" },
          { "name": "en cours", "value": "encours" },
          { "name": "terminés", "value": "termines" },
          { "name": "tous", "value": "tous" }
        ] }
    ]},
    { "type": 1, "name": "voir", "description": "Détail d’un tournoi", "options": [
      { "type": 3, "name": "tournoi", "description": "Identifiant affiché par /tournoi liste", "required": true, "min_length": 1, "max_length": 40 }
    ]}
  ]
}
```

`choices` portent les valeurs réellement attendues par le handler (`avenir`,
`encours`, `termines`, `tous`) ; une valeur inconnue retombe sur « à venir + en
cours », jamais sur une erreur.

## Limites

- **Inscription depuis Discord** : volontairement absente de cette v1. Elle passe
  par `tournament-registration.ts` (statut `REGISTRATION`, capacité, doublons) et
  mérite son propre lot avec ses tests, plutôt qu'un ajout précipité.
- **Enregistrement réel** : accord #400 requis, aucun `--execute`.
- **Choix de serveur** : `statut` est une option à `choices`, pas d'autocomplétion
  (elle demanderait le câblage des interactions type 4 côté bot).

## Vérifications

`src/lib/discord-tournament-commands.test.ts` — 10 cas : interrupteur fermé sans
lecture base, MP/horodatage/app refusés, non-membre sans requête, filtre par
communauté du serveur, liste par défaut (à venir + en cours), traduction des
filtres de statut, vainqueur affiché, tournoi d'une autre communauté introuvable,
états vides et absence de donnée privée.

## Inscriptions (17/11/2026)

`/tournoi inscription`, `/tournoi desinscription`, `/tournoi mes-inscriptions`,
derrière `DISCORD_TOURNAMENT_WRITE_ENABLED` (fermé par défaut, distinct de la
lecture).

- **Une seule logique** : `registerTournamentParticipant` (existant) et
  `unregisterTournamentParticipant` (extrait de `unregisterFromTournamentAction`
  et désormais partagé par le site et Discord — l'action web appelle le service,
  plus aucune copie).
- **Identité** : toujours celle du contexte Discord (`guild_id` + `discordId`
  relus en base). Aucune option ne permet de désigner un autre joueur.
- **Réponses distinctes** : inscrit, déjà inscrit, complet, inscriptions
  fermées, tournoi inexistant, autre communauté, désinscription impossible
  (pas inscrit / tournoi démarré). L'éligibilité est lue avant l'écriture pour
  formuler la réponse ; le service reste l'autorité.
- **Désinscription** : refusée dès que le statut n'est plus `REGISTRATION`,
  verrou `FOR UPDATE` conservé, compteur `tournamentsParticipatedCount`
  décrémenté seulement si une ligne a été retirée.
- **Intégration** : les lignes écrites sont exactement celles du site
  (`TournamentParticipant`), donc l'inscription Discord apparaît immédiatement
  dans `/tournois/[id]` et inversement.

### Autocomplétion

`src/lib/discord-tournament-autocomplete.ts` est **complet et testé** mais non
routé : `src/lib/discord-interactions.ts` est réservé par #408. Le patch
`docs/patches/20261117-autocomplete-routage.patch` ajoute les 6 lignes à insérer
après le `PONG` (vérifié en dry-run sur la tête #408 `3465c39`).

Choix proposés : `inscription` → tournois `REGISTRATION` de la communauté où le
joueur n'est pas inscrit et où il reste de la place ; `desinscription` → ceux où
il est inscrit. Maximum 25, recherche sans accent, valeur = identifiant (le
handler relit l'état avant tout écriture).

### Déclaration Discord mise à jour (propriétaire #416)

Ajouter aux `options` de `tournoi` :

```json
{ "type": 1, "name": "inscription", "description": "S’inscrire à un tournoi ouvert", "options": [
  { "type": 3, "name": "tournoi", "description": "Tournoi (autocomplétion)", "required": true,
    "autocomplete": true, "min_length": 1, "max_length": 40 } ]},
{ "type": 1, "name": "desinscription", "description": "Se retirer d’un tournoi", "options": [
  { "type": 3, "name": "tournoi", "description": "Tournoi (autocomplétion)", "required": true,
    "autocomplete": true, "min_length": 1, "max_length": 40 } ]},
{ "type": 1, "name": "mes-inscriptions", "description": "Tes inscriptions aux tournois" }
```

## Sprint 17/11 — autocomplétion active et boutons

- Le routage des interactions **type 4** est en place sur la branche
  `agent/preflight-20261116` : `src/lib/discord-autocomplete.ts` aiguille
  `/tournoi` vers `buildAutocompleteResponse`. Le même bloc de 5 lignes est fourni
  par `docs/patches/20261117-autocomplete-routage.patch` pour #408 (dry-run vérifié
  sur `3465c39`), afin que les deux branches convergent à la fusion.
- Sélection sans identifiant : `inscription`/`desinscription` proposent 25 choix au
  plus, libellés « nom · jeu · places », recherche sans accent, valeur = identifiant
  relu avant écriture.
- Boutons : l'annonce d'un tournoi porte « Je viens » (`gn:tournament:join:<id>`) et
  « Je me désinscris » (`gn:tournament:leave:<id>`). Les deux passent par
  `respondToTournamentRsvp(..., kind)` → `registerTournamentParticipant` /
  `unregisterTournamentParticipant`, avec vérification du message d'annonce, du
  serveur, du salon et de l'appartenance. Un clic rejoué est idempotent.
- Tournoi complet, fermé, commencé ou supprimé : réponses distinctes, aucune écriture.
