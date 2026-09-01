import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Config minimale (Sprint 1, fiabilisation — chantier "Tests automatisés").
 * Un seul alias à porter depuis `tsconfig.json` (`@/*` → `src/*`) — les
 * tests n'ont besoin d'aucun environnement DOM (uniquement des fonctions
 * pures, aucun composant React testé ici), donc pas de `jsdom`/Testing
 * Library : l'environnement `node` par défaut de Vitest suffit.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
