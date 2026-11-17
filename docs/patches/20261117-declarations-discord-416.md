# Déclarations Discord consolidées — patch pour #416

Deux livrables distincts, pour ne jamais enregistrer une commande sans handler.

## 1. Patch applicable maintenant
`docs/patches/20261117-declarations-discord-416.patch`

- Cible : `refs/pull/416/head` (`d1b70ad`), vérifié par `git apply --check`
  **OK**, puis application réelle et validation du JSON.
- Ajoute uniquement les commandes dont les handlers existent et qui manquent :
  `role` (option `jeu` autocomplétée), `aide`, `profil`, `boost`, `joueurs`,
  `projet`, `soiree`, `tournoi`.
- **Laisse `/equipe` intacte** : #416 possède son handler `discord-team-command.ts`
  (3 sous-commandes) et son test `discord-team-command-manifest.test.ts` exige
  exactement `liste`, `moi`, `rejoindre` avec `equipe_id`. Remplacer ces
  déclarations sans le handler casserait le test et produirait des commandes
  fantômes.
- `aide`, `profil` et `boost` **existent bien** dans le code
  (`src/lib/discord-community-commands.ts`, routés dans `discord-interactions.ts`) :
  le précédent rapport qui les disait absents était faux, corrigé ici et dans
  `scripts/discord-commands.json` (déclaration locale déjà conforme).
- `profil`, `boost`, `aide` n'ont aucune option ; ne pas en inventer.

## 2. Déclaration complète des équipes — conditionnée
`docs/patches/20261117-equipe-declaration.json`

Bloc `/equipe` à 13 sous-commandes (ajout de `capitaine`, `membres`,
`transferer`, `exclure`, `invitations`, `espace`, plus les 7 existantes) pour le
jour où le handler complet est adopté. **Ne pas l'appliquer seul** : le handler
de #416 ne connaît que 3 sous-commandes. Procédure et fichiers requis :
`docs/integration/EQUIPES-416.md`.

Notre handler accepte désormais `equipe_id` comme alias de `equipe` : la
déclaration actuelle de #416 fonctionne sans second handler.

## `/role jeu:…` en racine
Discord interdit de mélanger sous-commandes et option racine. La forme courte
n'est donc pas déclarable tant que `chercher/attribuer/creer/retirer` existent ;
l'autocomplétion est portée par `jeu` dans chaque sous-commande.
