# Déclarations Discord consolidées — patch unique pour #416

- Fichier du patch : `docs/patches/20261117-declarations-discord-416.patch`
- Branche cible : `refs/pull/416/head` = `d1b70ad10855c000c20ca2ac86f34f91cb870a37`
- Vérification réelle : `git apply --check` **OK** sur cette tête, puis application
  et validation locale du JSON (`JSON_VALID`).
- Le fichier `scripts/discord-commands.json` n'est pas modifié sur notre branche.

## Contenu
Ajoute (ou remplace pour `equipe`) les commandes dont les handlers existent :

| Commande | Sous-commandes déclarées |
|---|---|
| `role` | chercher, attribuer, creer, retirer (option `jeu` autocomplétée) |
| `equipe` | liste, moi, voir, creer, rejoindre, quitter, recrutement, capitaine, membres, transferer, exclure, invitations, espace |
| `joueurs` | annonces, chercher, mes-annonces, publier, retirer |
| `projet` | liste, voir, creer, rejoindre, quitter, recrutement |
| `soiree` | liste, voir, creer, rejoindre, quitter |
| `tournoi` | liste, voir, inscription, desinscription, mes-inscriptions |

`profil`, `boost` et `aide` **ne sont pas déclarés** : aucun handler de commande
slash n'existe dans ce dépôt (ils vivent sur le site ou dans #370/#416). Les
déclarer créerait une commande fantôme.

## Point important : `/role jeu:…`
Discord interdit de mélanger sous-commandes et options au même niveau. Comme
`/role` garde ses sous-commandes, l'option racine `jeu` **ne peut pas** être
déclarée en même temps. Le code accepte la forme racine (utile si #416 choisit
un jour de remplacer les sous-commandes), mais la déclaration proposée utilise
les sous-commandes avec `autocomplete: true` sur `jeu`.
