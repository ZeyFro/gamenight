import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Config minimale (Sprint 1, fiabilisation — chantier "Tests automatisés").
 * Un seul alias à porter depuis `tsconfig.json` (`@/*` → `src/*`) — la
 * quasi-totalité des tests n'ont besoin d'aucun environnement DOM
 * (fonctions pures/intégration Postgres), donc l'environnement `node` par
 * défaut de Vitest reste le défaut GLOBAL ici, jamais changé pour `jsdom`.
 *
 * Bug remonté en test réel (page de suppression de tournoi bloquée,
 * V2) — un premier test de composant a été ajouté (`.test.tsx`,
 * DeleteTournamentDialog) pour vérifier RÉELLEMENT le comportement DOM
 * du bouton "Oui, supprimer" (un clic unique ne soumet qu'une fois,
 * bouton désactivé pendant l'appel) — la course corrigée était
 * spécifiquement une race JS/DOM, jamais démontrable par un test de
 * logique métier seul. Ce fichier précis déclare son propre environnement
 * DOM via `// @vitest-environment jsdom` (docblock Vitest, pas ce
 * fichier de config) — TOUS les autres tests restent inchangés sur
 * `node`, jamais un jsdom global imposé à des suites qui n'en ont pas
 * besoin.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      "server-only": require.resolve("next/dist/compiled/server-only/empty"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
