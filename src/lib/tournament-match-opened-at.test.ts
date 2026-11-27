import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Décision du 26/11/2026 : `TournamentMatch.scheduledAt` porte l'HEURE D'OUVERTURE d'un match d'équipes (les deux équipes
 * connues), départ du délai de repli de l'arbitrage (48 h sans déclaration). Ce n'est PAS une heure planifiée par les
 * capitaines. Garde statique : aucun autre code (affichage, notification, tri, rappel, export) ne la lit ni ne l'écrit en
 * pensant à un rendez-vous. Tout nouvel usage doit être examiné et ajouté ici avec sa justification.
 */
const ALLOWED = new Map([
  ["src/lib/tournament-teams.ts", "pose l'ouverture au lancement et la lit pour l'arbitrage"],
  ["src/lib/tournament-teams-read.ts", "calcule l'heure d'ouverture de l'arbitrage affichée sur la page"],
  ["src/lib/tournaments.ts", "pose l'ouverture d'un tour suivant quand ses deux équipes sont connues (mode équipes)"],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
}

describe("TournamentMatch.scheduledAt = heure d'ouverture, jamais un rendez-vous", () => {
  it("seuls les modules de l'arbitrage des tournois d'équipes l'utilisent", () => {
    const users = walk("src")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
      .filter((file) => {
        // Code seulement : les commentaires qui citent la colonne (documentation) ne comptent pas.
        const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        // Un fichier qui touche aux matchs de tournoi ET mentionne scheduledAt (le seul autre scheduledAt du schéma est Roulette).
        return /tournamentMatch|TournamentMatch|\bmatch(es)?\b/.test(source) && /\bscheduledAt\b/.test(source)
          && !/\broulette/i.test(source);
      })
      .map((file) => file.split("\\").join("/"))
      .sort();
    expect(users).toEqual([...ALLOWED.keys()].sort());
  });

  it("le schéma documente le sens de la colonne", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const model = schema.slice(schema.indexOf("model TournamentMatch {"), schema.indexOf("}", schema.indexOf("model TournamentMatch {")));
    expect(model).toMatch(/scheduledAt\s+DateTime\?/);
    expect(model).toContain("heure d'ouverture");
  });
});
