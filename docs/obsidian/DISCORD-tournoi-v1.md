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
