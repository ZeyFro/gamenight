import { describe, it, expect } from "vitest";
import { processInBatches } from "@/lib/cron-batch";

/**
 * Fix "cron Steam surdimensionné" — `processInBatches` doit garantir une
 * concurrence RÉELLEMENT bornée (contrairement à
 * `Promise.allSettled(items.map(worker))`, qui démarre tout d'un coup),
 * préserver l'ordre des résultats malgré des temps de résolution variables,
 * isoler les échecs individuels, et respecter `shouldContinue` comme filet
 * de sécurité de budget de temps.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("processInBatches", () => {
  it("ne dépasse jamais batchSize exécutions simultanées", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await processInBatches(items, 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Délai variable pour éviter que tout se résolve dans le même tick.
      await delay(item % 2 === 0 ? 5 : 15);
      active -= 1;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("ordre des résultats = ordre des items en entrée, indépendamment de l'ordre de résolution", async () => {
    const items = [30, 5, 20, 10];

    const { results } = await processInBatches(items, 2, async (ms) => {
      await delay(ms);
      return ms;
    });

    const values = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    expect(values).toEqual([30, 5, 20, 10]);
  });

  it("un worker rejeté n'empêche pas les autres d'aboutir (isolation par lot)", async () => {
    const items = [1, 2, 3, 4];

    const { results, processedCount } = await processInBatches(items, 2, async (item) => {
      if (item === 2) throw new Error("échec compte 2");
      return item;
    });

    expect(processedCount).toBe(4);
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
    expect(results[3]).toEqual({ status: "fulfilled", value: 4 });
  });

  it("shouldContinue à false arrête avant le lot suivant, processedCount reflète seulement ce qui a tourné", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let batchesStarted = 0;

    const { results, processedCount } = await processInBatches(
      items,
      2,
      async (item) => item,
      { shouldContinue: () => (batchesStarted += 1) <= 1 }
    );

    expect(processedCount).toBe(2);
    expect(results).toHaveLength(2);
  });

  it("shouldContinue vérifié avant le premier lot aussi : false d'emblée = rien de traité", async () => {
    const items = [1, 2, 3];

    const { results, processedCount } = await processInBatches(
      items,
      2,
      async (item) => item,
      { shouldContinue: () => false }
    );

    expect(processedCount).toBe(0);
    expect(results).toHaveLength(0);
  });

  it("liste vide : ne fait rien, ne plante pas", async () => {
    const { results, processedCount } = await processInBatches([], 3, async (item) => item);
    expect(results).toEqual([]);
    expect(processedCount).toBe(0);
  });
});
