# /soiree v1 — soirées GameNight depuis Discord

Commande `/soiree` livrée le 17/11/2026, **désactivée par défaut** :
`DISCORD_SESSION_COMMAND_ENABLED=false`, et écritures séparées derrière
`DISCORD_SESSION_WRITE_ENABLED=false`.

## Aucun second système

| Ce que fait Discord | Ce qui est réellement écrit |
| --- | --- |
| `/soiree creer` | une `Session` `VOTING` via `createVotingSessionInTransaction` (la fonction du formulaire `/sessions`) + une `Proposal` du créateur + `attendanceCapacity` |
| `/soiree rejoindre` | une `SessionInvite` `ACTIVE` via `inviteToSession` |
| `/soiree quitter` | `revokeSessionInvite` (statut `REVOKED`, contributions passées intactes) |
| `/soiree liste` / `voir` | lecture par `accessibleSessionWhereFor` / `getSessionAccessRole` |

Les soirées créées depuis Discord apparaissent donc dans `/sessions`, se votent
et se gèrent comme les autres — et inversement.

## Règles réutilisées

- **Accès** : créateur ou invité `ACTIVE` uniquement (`session-access.ts`), jamais
  un accès administrateur implicite.
- **Horaires** : `resolveSessionSchedule` valide date/heure et la fenêtre de vote
  (refus si la soirée est à moins de 30 min). Les dates sont interprétées par
  `parseDateAndTime` (fuseau de l'application, Europe/Paris), pas celui du serveur.
- **Capacité** : `Session.attendanceCapacity` (champ existant), contrôlée à
  l'inscription avec le créateur compté (`invites + 2 > capacité` → complet).
- **Idempotence** : réinscription → `already`, désinscription rejouée →
  `not_invited` ; aucune ligne dupliquée (`@@unique([sessionId, userId])`).
- **Pas d'annonce** : `announceViaBot: false` et `notifiedUserIds: []` — une
  commande Discord ne déclenche aucune annonce ni mention en masse.
- **Séparation des compteurs** : rien ici ne touche XP, XP d'équipe ou étages
  d'Ascension ; seuls `Session`, `Proposal` et `SessionInvite` sont écrits.

## Déclaration Discord (à intégrer par le propriétaire de #416)

`scripts/discord-commands.json` est **réservé par #416** : je ne l'ai pas modifié.
Bloc à ajouter (les autres commandes restent inchangées) :

```json
{
  "name": "soiree",
  "type": 1,
  "description": "Organise et rejoins les soirées GameNight",
  "default_member_permissions": null,
  "integration_types": [0],
  "contexts": [0],
  "options": [
    { "type": 1, "name": "liste", "description": "Les prochaines soirées accessibles" },
    { "type": 1, "name": "voir", "description": "Détail d’une soirée", "options": [
      { "type": 3, "name": "soiree", "description": "Identifiant affiché par /soiree liste", "required": true, "min_length": 1, "max_length": 40 }
    ]},
    { "type": 1, "name": "creer", "description": "Créer une soirée (jeu, date, heure)", "options": [
      { "type": 3, "name": "jeu", "description": "Jeu proposé", "required": true, "min_length": 2, "max_length": 80 },
      { "type": 3, "name": "date", "description": "AAAA-MM-JJ", "required": true, "min_length": 10, "max_length": 10 },
      { "type": 3, "name": "heure", "description": "HH:MM (Europe/Paris)", "required": true, "min_length": 4, "max_length": 5 },
      { "type": 4, "name": "places", "description": "Places totales, toi compris (2 à 20)", "required": false, "min_value": 2, "max_value": 20 }
    ]},
    { "type": 1, "name": "rejoindre", "description": "S’inscrire à une soirée", "options": [
      { "type": 3, "name": "soiree", "description": "Identifiant de la soirée", "required": true, "min_length": 1, "max_length": 40 }
    ]},
    { "type": 1, "name": "quitter", "description": "Se désinscrire d’une soirée", "options": [
      { "type": 3, "name": "soiree", "description": "Identifiant de la soirée", "required": true, "min_length": 1, "max_length": 40 }
    ]}
  ]
}
```

## Blocages assumés

- **Titre et description de soirée** : le modèle `Session` n'a aucun champ pour
  les stocker. Les ajouter exige une migration (`Session.title String?`,
  `Session.description String?`) — **non faite**, aucune autorisation. La
  commande n'accepte donc pas ces options plutôt que de les jeter en silence ou
  de les ranger dans un champ détourné (`customReminderMessage`, chat…).
- **Enregistrement réel de la commande** : accord #400 requis, aucun appel
  `--execute` effectué.
- **Autocomplétion et boutons** : l'identifiant de soirée est affiché par
  `/soiree liste` et recopié dans les sous-commandes. L'autocomplétion
  (interaction type 4) et les boutons d'inscription demandent le câblage des
  handlers d'interactions du bot, hors de cette v1 (aucun test réel possible
  sans serveur Discord autorisé).

## Vérifications

`src/lib/discord-session-commands.test.ts` — 17 cas : interrupteurs fermés par
défaut (aucune lecture base), séparation lecture/écriture, MP/horodatage/app
refusés, liste et détail filtrés par l'accès réel, inscription idempotente au
nom du créateur, capacité et créateur, désinscription via révocation, création
par `createVotingSessionInTransaction` sans annonce Discord et sans
`decidedGameId` forcé, refus d'une soirée trop proche, places et jeu invalides.

## Sprint 17/11 — sélection et places

- Autocomplétion `/soiree voir|rejoindre|quitter` (`src/lib/discord-session-autocomplete.ts`,
  routée par `src/lib/discord-autocomplete.ts`) : même périmètre que `/soiree liste`
  (`loadUpcomingSessions`), donc aucune soirée privée d'un autre joueur ne fuit.
- Libellés : jeu · date Europe/Paris · places **réellement** libres (capacité −
  organisateur − invités actifs). `rejoindre` ne propose pas les soirées où l'on est
  déjà, `quitter` ne propose que les siennes.
- Boutons déjà en place sur les annonces : `gn:seat:join|leave:<id>`, avec réponse
  privée et idempotence (`joinSession` → `already`, `leaveSession` → `not_invited`).
- Les erreurs (complète, terminée, introuvable, non invité) restent des messages
  distincts ; aucune soirée parallèle n'est créée.
