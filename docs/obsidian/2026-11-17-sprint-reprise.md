# Sprint de reprise — 17/11/2026 (livraison partielle, indépendante de Neon)

Branche dédiée non réservée : `feat/freebuff-surface` (5 commits, poussés). Aucune fusion, aucune migration Neon, aucune action Production, aucune commande enregistrée sur le vrai Discord.

## Ce qui a été livré

### LOT 1 — Intégration Freebuff (surface + dispatch)
- `scripts/discord-commands.json` : les commandes canoniques Freebuff sont déclarées (`role`, `equipe`, `joueurs`, `projet`, `soiree`, `tournoi`, `aide`, `profil`, `boost`) + `gamenight`, `tower`, `tower-admin` conservés.
- `src/lib/discord-commands-manifest.test.ts` : le manifest contient bien l'ensemble canonique, sans doublon, sans collision avec Tower.
- `src/lib/discord-interactions.ts` : les commandes Freebuff répondent de façon éphémère « en cours de déploiement » — **jamais d'annonce de succès**.
- `src/lib/discord-interactions.test.ts` : 11 tests qui vérifient ce comportement (réponse éphémère, absence de « activé/réussi/succès/✅ », sous-commandes incluses).

### LOT 2 — Ascension / défis (indépendant des migrations)
- `src/lib/tower-challenges-domain.ts` + `.test.ts` (14 tests) : logique pure des défis disponibles (filtre jeu possédé, préférence défi non joué, tirage déterministe), types de définition, statuts d'attempt, pick déterministe par seed.
- `src/lib/tower-ascension-presentation.ts` + `.test.ts` (9 tests) : présentation Ascension (niveau, titre, rang, progression vers le palier suivant) **réutilisant le modèle XP du cahier** (`xp.ts` : courbe `50×(niveau-1)²`, titres FR, rangs Bronze→Légende), sans nouvelle règle d'attribution.
- Séparation stricte XP individuel / équipe documentée dans le module (l'XP d'équipe reste sur `community-team-score`, jamais additionnée à l'Ascension individuelle).

### LOT 3 — Cohérence Discord / règle « pas de faux succès »
- Le dispatcher Freebuff est couvert par des tests qui garantissent l'absence d'annonce de succès.
- Les handlers existants (`/gamenight setup`, boutons RSVP, Tower) ne sont pas modifiés dans leur comportement ; seul le branchement Freebuff a été ajouté.

### LOT 4 — Tests de parcours (ciblés, services partagés)
- `src/lib/parcours-defi-ascension.test.ts` (4 tests) : parcours navigable pur « sélection jeu → défi disponible → tirage déterministe → complétion → gain XP → passage de niveau → consultation Ascension », avec la séparation individuel/équipe.

## Tests / qualité (sur les fichiers touchés)
- 67 tests passants sur les 5 suites du sprint (manifest, interactions, domain, ascension, parcours).
- ESLint propre sur tous les fichiers touchés.
- `tsc --noEmit --skipLibCheck` propre sur les nouveaux modules.

## Ce qui reste dépendant / à faire plus tard
- Implémentation réelle des handlers Freebuff (role, équipe, joueurs, projet, soiree, tournoi, aide, profil, boost) : le dispatcher répond « en cours de déploiement » en attendant.
- Présentation des étages, historique des défis, classements/saisons, défis disponibles côté Discord/frontend : modèles partiellement prêts (défis + Ascension), affichage à connecter.
- Fonctionnalités dépendant de migrations non appliquées : restées désactivées (aucun changement de schéma, aucune migration).
- Enregistrement réel des commandes Discord et activation : non fait, sur décision distincte.
- PR documentaire #443 conservée en Draft (travaux docs/obsidian d'origine).

## Branches
- Travail livré sur `feat/freebuff-surface` (non réservée). La branche `docs/obsidian-vault-20261115` (PR #443, Draft) n'a pas été modifiée par ces commits de code.
