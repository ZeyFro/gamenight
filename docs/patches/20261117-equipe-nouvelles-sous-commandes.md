# `/equipe` — nouvelles sous-commandes (fichier réservé #416)

Fichier concerné : `scripts/discord-commands.json` (propriétaire #416).
**Non modifié ici.** Le code les accepte déjà : ajouter ces sous-commandes au
tableau `options` de la commande `equipe`.

```json
{ "type": 1, "name": "capitaine", "description": "Afficher le capitaine de l’équipe", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true } ] },
{ "type": 1, "name": "membres", "description": "Lister les membres", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true } ] },
{ "type": 1, "name": "transferer", "description": "Transférer la capitainerie", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true },
  { "type": 3, "name": "membre", "description": "Nom Discord ou mention du successeur", "required": true } ] },
{ "type": 1, "name": "exclure", "description": "Exclure un membre (capitaine)", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true },
  { "type": 3, "name": "membre", "description": "Nom Discord ou mention", "required": true } ] },
{ "type": 1, "name": "invitations", "description": "État du recrutement", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true } ] },
{ "type": 1, "name": "espace", "description": "État ou création de l’espace Discord", "options": [
  { "type": 3, "name": "equipe", "description": "Nom de l’équipe", "required": true },
  { "type": 5, "name": "creer", "description": "Créer l’espace s’il n’existe pas (capitaine)", "required": false } ] }
```

`membre` reste une option texte (nom exact ou identifiant) : elle acceptera
`autocomplete` quand la liste des membres sera exposée par le routeur.
