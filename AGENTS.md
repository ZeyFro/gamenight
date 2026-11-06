# AGENTS.md

## Contexte du projet (6 lignes)
- GameNight est l'application centrale de soirées, profils, équipes et progression de The Tower 2.0.
- Le dépôt est `ZeyFro/gamenight`; l'application utilise Next.js, TypeScript, Prisma et PostgreSQL/Neon.
- Discord est l'espace communautaire ; Vercel héberge l'application.
- Le cahier canonique est `docs/CAHIER_DES_CHARGES.md`; les décisions ultérieures approuvées peuvent le préciser.
- Une fonction n'est « terminée » qu'avec une preuve de son fonctionnement réel, distincte des tests et du déploiement.
- Les données de Production ne servent jamais aux tests.

## Boucle de travail
Après chaque PR ouverte, passe immédiatement à la première tâche suivante non bloquée, sans attendre une autorisation. Utilise des PR empilées : la PR suivante part de la branche de la précédente tant que celle-ci n'est pas fusionnée. Une PR traite un seul sujet ; réutilise les PR #325 et #329 au lieu de recréer leur travail. Les opérations sensibles doivent être idempotentes.

## Seuls cas d'arrêt
Arrête-toi et demande une décision uniquement si :
1. la tâche dépend d'un point encore ouvert dans « Décisions encore ouvertes » (§26) du cahier ;
2. elle implique une migration Prisma ou toute action sur la base de Production ;
3. elle implique une modification de permissions ou la suppression d'un rôle Discord ;
4. les tests restent en échec après deux tentatives de correction ;
5. la demande contredit le cahier des charges.
Une décision §26 déjà tranchée par une décision ultérieure approuvée n'est plus bloquante ; cite cette décision dans la PR.

## Qualité et commandes
- Vérifie les instructions locales et l'état de la branche avant de modifier ; ne pousse jamais directement sur `main` et ne force-push jamais.
- Préfère les tests ciblés suffisants ; ne lance pas toute la suite si les fichiers touchés ont une couverture ciblée suffisante.
- Commandes usuelles : `npm run lint -- <fichiers>`, `npx tsc --noEmit`, `npx vitest run <fichier-de-test>`, `git diff --check`.
- Pour un changement dépendant de PostgreSQL, utilise uniquement une base jetable locale : `npm run test:postgres` quand le test ciblé ne suffit pas.
- Documente les preuves et limites ; ne présente jamais un plan, un test isolé ou une CI verte comme une validation réelle de Production ou de Discord.

## Poste de travail
Maxime travaille sur trois PC : PC fixe, Portable 1 et Portable 2. Le nom du poste et ses chemins sont indiqués dans `~/.codex/AGENTS.md`, bloc « Machine actuelle ». Consulte ce bloc dans l'environnement local concerné ; ne mets jamais de chemin absolu en dur dans le code ou la documentation du dépôt.
