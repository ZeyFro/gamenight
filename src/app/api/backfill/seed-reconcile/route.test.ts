import { beforeEach, describe, expect, it, vi } from "vitest";

const runSeedReconciliation = vi.fn();
vi.mock("@/lib/seed-reconciliation", () => ({
  runSeedReconciliation: () => runSeedReconciliation(),
}));
// `after()` n'existe que dans un contexte de requête Next : callback exécuté tout de suite.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => void) => cb() };
});

import { GET, POST, maxDuration } from "./route";

function req(method: string, authorization?: string) {
  return new Request("https://example.test/api/backfill/seed-reconcile", {
    method,
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/backfill/seed-reconcile", () => {
  beforeEach(() => {
    runSeedReconciliation.mockReset().mockResolvedValue({});
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it("déclare maxDuration = 300", () => {
    expect(maxDuration).toBe(300);
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("%s avec le bon Bearer → 202 et lance la réconciliation", async (method, handler) => {
    const res = await handler(req(method, "Bearer s3cret"));
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("accepted");
    expect(runSeedReconciliation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("%s sans/avec mauvais Bearer → 401, rien lancé", async (method, handler) => {
    expect((await handler(req(method))).status).toBe(401);
    expect((await handler(req(method, "Bearer nope"))).status).toBe(401);
    expect(runSeedReconciliation).not.toHaveBeenCalled();
  });

  it("sans CRON_SECRET côté serveur → 503 (fail-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req("POST", "Bearer s3cret"))).status).toBe(503);
    expect(runSeedReconciliation).not.toHaveBeenCalled();
  });

  it("une erreur du traitement en arrière-plan ne fait pas échouer la réponse", async () => {
    runSeedReconciliation.mockRejectedValue(new Error("boom"));
    const res = await POST(req("POST", "Bearer s3cret"));
    expect(res.status).toBe(202);
  });
});
