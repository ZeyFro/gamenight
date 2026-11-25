import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARD_OVERRIDES, LEVERS, buildInventory, renderInventory } from "../../scripts/inventory-write-surface.mjs";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

// Structure seulement (pas de comparaison avec le document : il serait périmé à chaque nouvelle route d'une autre branche ;
// `node scripts/inventory-write-surface.mjs --check=docs/LIVRAISON-BARRIERE.md` le vérifie à la demande).
describe("inventaire des surfaces d'écriture", () => {
  const inventory = buildInventory();

  it("liste toutes les routes de src/app/api, chacune avec un levier défini", () => {
    const files = walk("src/app/api").filter((f) => /route\.ts$/.test(f));
    expect(inventory.routes).toHaveLength(files.length);
    for (const route of inventory.routes) expect(LEVERS[route.kind as keyof typeof LEVERS], route.route).toBeTruthy();
  });

  it("chaque cron et chaque backfill est protégé par CRON_SECRET (garde détectée) et peut écrire", () => {
    const jobs = inventory.routes.filter((r: { kind: string }) => ["cron", "backfill"].includes(r.kind));
    expect(jobs.length).toBeGreaterThanOrEqual(10);
    for (const job of jobs) {
      expect(job.guards, job.route).toContain("CRON_SECRET (Bearer)");
      expect(job.writes, job.route).not.toBe("non");
    }
  });

  it("recense les server actions et les fichiers after(), et rend un tableau Markdown", () => {
    expect(inventory.actions.length).toBeGreaterThan(20);
    expect(inventory.afterFiles).toContain("src/lib/notification-executor-kick.ts");
    expect(renderInventory(inventory)).toContain("| `/api/cron/reminders` |");
  });

  // La détection par expression régulière lit aussi les commentaires : sur cette route, l'en-tête dit que
  // `CRON_SECRET` n'ouvre PLUS l'accès. Sans ce correctif, le document d'incident affirmait le contraire.
  it("attribue à /api/admin/force-relogin son secret dédié, jamais CRON_SECRET", () => {
    const route = inventory.routes.find((r: { route: string }) => r.route === "/api/admin/force-relogin");
    expect(route?.guards).toEqual(GUARD_OVERRIDES["/api/admin/force-relogin"]);
    expect(route?.guards.join(" ; ")).not.toMatch(/(^|; )CRON_SECRET \(Bearer\)/);
    expect(renderInventory(inventory)).toContain("FORCE_RELOGIN_SECRET (Bearer, dédié, jamais CRON_SECRET)");
  });

  // Cahier 27.6 / C093 : une écriture Discord passe par la file puis l'executor. Les actions et les routes
  // peuvent ENFILER (session-space-queue, discord-team-space-queue) mais n'importent jamais un exécuteur ni un
  // adaptateur REST : c'est ce qui rend la règle vérifiable sans capture Discord.
  it("n'importe aucun exécuteur ni adaptateur d'écriture Discord hors de la file", () => {
    const executors = [
      "discord-rest", "discord-dm", "discord-team-space-api", "session-space-api",
      "discord-team-space-runner", "session-space-runner", "discord-team-space-service", "session-space-service",
    ];
    const appFiles = walk("src/app").filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file));
    const offenders = appFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return executors.some((name) => source.includes(`"@/lib/${name}"`) || source.includes(`'@/lib/${name}'`));
    });
    expect(offenders).toEqual([]);
  });
});
