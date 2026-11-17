# Coffre Obsidian GameNight

Le coffre est le dossier `docs/` du dépôt : les notes existantes sont réutilisées telles quelles, sans copie. Les notes de navigation sont ici, dans `docs/obsidian/`.

## Ouvrir le coffre
Obsidian → *Ouvrir un dossier comme coffre* → dossier `docs/` du clone local. Le dossier `.obsidian/` reste local (ignoré par Git).

## Notes pivot
- [[00-Tableau-de-bord]] — priorités et état courant
- [[01-Cahier-des-charges]]
- [[02-Architecture-technique]]
- [[03-Developpement]]
- [[04-Discord-The-Tower]]
- [[05-Backlog-et-fonctionnalites]]
- [[06-Bugs-et-incidents]]
- [[07-Decisions-techniques]]
- [[08-Procedures-de-deploiement]]

## Règles
- Aucun secret, jeton, URL de connexion ni identifiant privé dans les notes (voir [[SECURITE_CLAUDE]]).
- Ne pas modifier le cahier canonique ni les migrations Prisma depuis le coffre.
- Une note = un sujet ; on ajoute un lien vers le document existant plutôt qu'une copie.
- Les modifications passent par une branche et une PR, jamais par un push sur `main`.
- Les documents datés (état, rapports) sont historiques ; l'état courant est dans [[REPRISE_AUTONOME]] et l'issue GitHub #400.
