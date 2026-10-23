import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEVERS, buildInventory, renderInventory } from "../../scripts/inventory-write-surface.mjs";

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
});
