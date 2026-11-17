# `/role` — option racine `jeu` (fichier réservé #416)

Fichier concerné : `scripts/discord-commands.json` (propriétaire #416).
**Non modifié ici.** Le code (`discord-role-command.ts`) accepte déjà les deux
formes : sous-commande `attribuer|chercher|creer|retirer` et option racine.

Bloc à ajouter au tableau `options` de la commande `role` :

```json
{ "type": 3, "name": "jeu", "description": "Ton jeu (ex. Valorant)", "required": true, "autocomplete": true }
```

Et sur chaque option `jeu` des sous-commandes : `"autocomplete": true`.
Après application, `/role jeu:Valorant` est proposé par Discord ; sans elle,
`/role attribuer jeu:Valorant` reste fonctionnel.
