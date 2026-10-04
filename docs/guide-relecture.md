# Guide de relecture des PR #135 à #156

État au 2026-10-04 (soir). **#136 (CI) est mergée** et **#137 (hook SessionStart) est passée en Ready** par Maxime ; les autres PR sont en **Draft**, sans conflit avec `main`, avec un aperçu Vercel « success ». #155 et #156 ont été ajoutées après la première version de ce guide. Les tests locaux (Postgres Docker, `tsc`, `lint`, `next build`) étaient verts avant chaque push ; la CI GitHub Actions (#136, mergée) s'exécute sur les PR ouvertes ou mises à jour **après** ce merge ; les anciennes branches n'ont pas de check CI tant qu'on n'y pousse pas.

## ⚠️ Migrations : MERGE MANUEL

Trois PR contiennent une migration Prisma (appliquée à la base de production par `prisma migrate deploy` au build Vercel), pas deux :

| PR | Migration | Nature |
| -- | --------- | ------ |
| **#135** | `20261002120000_communities_expand` | additive (nouvelles tables) |
| **#142** | `20261003120000_add_steam_now_playing` | additive (2 colonnes nullables sur `User`) |
| **#149** | `20261004100000_align_schema_drift` | alignement (`DROP DEFAULT` + renommage d'index) |

Ne pas merger ces trois PR via l'aperçu seul. Les appliquer dans l'ordre des horodatages (#135 → #142 → #149).

## Tableau

| PR | Sujet | Ce que Maxime verra | Risque | Ordre |
| -- | ----- | ------------------- | ------ | ----- |
| #136 | CI GitHub Actions | **Déjà mergée.** Un check « verify » sur les PR (à rendre obligatoire) | faible | fait |
| #137 | Hook SessionStart cloud | Rien dans l'app ; sessions Claude cloud prêtes à tester (**passée en Ready par Maxime**) | faible | 2 |
| #138 | npm audit (patch) | Rien ; `next` 16.3.1 → 16.3.8 corrige la faille critique | moyen | 3 |
| #153 | `/api/igdb/search` borné | Rien en usage normal ; requête > 100 caractères tronquée | faible | 4 |
| #144 | Repli des GIF klipy bloqués | Un dégradé à la place d'une bannière invisible | faible | 5 |
| #143 | Backfill IGDB Coop | Rien ; le cron couvre plus de jeux par passe | moyen | 6 |
| #141 | Activité Steam sur `/potes` | La ligne « A joué récemment à… » apparaît pour plus de comptes | moyen | 7 |
| #147 | Code mort retiré | Rien | faible | 8 |
| #148 | Accessibilité | Rien de visuel (libellés, `aria-pressed`, `sizes`) | faible | 9 |
| #145 | Tests unitaires `src/lib` | Rien | faible | 10 |
| #154 | Test `.env.example` ↔ code | Rien | faible | 11 |
| #152 | Route `/api/health` | Rien ; sonde pour un monitoring (Bearer `CRON_SECRET`) | faible | 12 |
| #155 | `robots.txt` | Page nouvelle `/robots.txt` (`Disallow: /`) | faible | 12 bis |
| #156 | Titres d'onglet par page | Rien tant que `PAGE_TITLES_ENABLED` est éteint ; sinon « Calendrier · GameNight »… | faible | 12 ter |
| #140 | Archivage immédiat des fils | Rien tant que le nouveau drapeau est éteint | faible | 13 |
| #135 | Fondations multi-communautés | Rien (nouvelles tables non branchées) · **MERGE MANUEL** | moyen | 14 |
| #142 | Indicateur « En jeu » | Rien tant que `STEAM_NOW_PLAYING_ENABLED` est éteint · **MERGE MANUEL** | moyen | 15 |
| #149 | Alignement du schéma | Rien · **MERGE MANUEL** | moyen | 16 |
| #139 | Refonte « centre de commande » | Une nouvelle page `/design-preview` (données fictives) | faible | 17 |
| #150 | Rapport CSP bloquant | Un document, aucun code | faible | 18 |
| #151 | Backlog et ce guide | Deux documents | faible | 19 |
| #146 | CLAUDE.md « Outils » | Rien ; à relire une fois #136 et #137 mergées | faible | 20 |

Les PR de documentation ou de tests (#145, #146, #150, #151, #154) n'ont aucun effet sur l'application : leur « faible » veut dire « sans risque ».

## Pourquoi cet ordre

1. **#136 : fait.** Les nouveaux pushs passent par la CI.
2. **#138 tôt** : corrige une faille critique de `next`. Patch seulement, mais il touche tout : surveiller le build Vercel.
3. **Corrections de comportement** (#143, #141) avant les nouveautés : elles agissent sur des crons en production sans drapeau.
4. **Migrations en fin de file, une à la fois**, après avoir lu la description de la PR : vérifier le build Vercel après chacune.
5. **#146 en dernier** : ses lignes décrivent #136 et #137 comme « à confirmer une fois mergée ».

## Points d'attention

- **Conflit prévisible entre #142 et #152** (`README.md`) : la deuxième des deux à être mergée devra résoudre le conflit (les deux ajoutent un paragraphe dans la même zone). Aucun autre conflit détecté entre les 20 PR (test `git merge-tree` sur toutes les paires qui modifient un fichier commun : `README.md`, `CLAUDE.md`, `prisma/schema.prisma`, `steam-library-sync/route.ts`).
- **Aucune PR n'est testée contre un vrai Neon ni un vrai Discord** (règle du dépôt). Les aperçus Vercel ne montrent rien de nouveau tant que les drapeaux sont éteints.
- **Interaction #154 ↔ #156** : le test de #154 échouera tant que `PAGE_TITLES_ENABLED` n'est pas dans `.env.example`. La seconde des deux PR mergée doit y ajouter `# PAGE_TITLES_ENABLED=` (je n'ai pas pu : fichier protégé par un hook).
- **Drapeaux nouveaux, tous éteints par défaut** : `STEAM_NOW_PLAYING_ENABLED` (#142), `DISCORD_THREAD_CLOSE_ON_END_ENABLED` (#140), `PAGE_TITLES_ENABLED` (#156). Aucun drapeau existant n'est activé par ces PR.
- **#139** modifie 19 fichiers mais ajoute surtout une page nouvelle ; aucune page existante n'est modifiée.
- Ce classement de risque est une estimation de lecture, pas un audit de sécurité. `/security-review` reste recommandé avant #135 et #140 (accès, Discord).
