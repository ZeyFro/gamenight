# L7-13 — repli PWA hors ligne

- Worktree `.codex-worktrees/pwa-hors-ligne-next`, branche `feat/pwa-hors-ligne-next`, rebasé sur `main` après #263 (`ba76ebfb32a345bcf3057dffe5190606009106cc`).
- Sous-agents lecture seule Darwin et Lagrange : manifest/icônes présents, aucun worker existant; le layout et les pages contiennent des données privées par compte/serveur. Ils recommandent un repli statique sans cache de pages/API.
- Ajout d’un service worker de production qui précache uniquement `/offline.html`; il intercepte les navigations GET same-origin pour afficher ce repli si le réseau échoue. Aucun HTML authentifié, API, mutation ou réponse utilisateur n’est mis en cache. L’enregistrement est désactivé en développement.
- Validations locales : 8 tests exécutant le worker (install, activation, fallback, exclusion POST/API/cross-origin/ressources et absence de cache des pages privées), ESLint ciblé et TypeScript réussis.
- Limite vérifiée et affichée : seules l’installation et la page d’indisponibilité fonctionnent hors ligne; les pages et données du compte nécessitent le réseau. Test navigateur/appareil réel et build production restent à vérifier en CI/preview.
