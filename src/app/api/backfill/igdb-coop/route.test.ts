import { beforeEach, describe, expect, it, vi } from "vitest";

const runIgdbCoopBackfill = vi.fn();
vi.mock("@/lib/backfill-igdb-coop", () => ({
  runIgdbCoopBackfill: () => runIgdbCoopBackfill(),
}));
// `after()` n'existe que dans un contexte de requête Next : on exécute le
// callback tout de suite pour pouvoir vérifier le lancement.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => void) => cb() };
});

import { GET, POST } from "./route";

function req(method: string, authorization?: string) {
  return new Request("https://example.test/api/backfill/igdb-coop", {
    method,
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/backfill/igdb-coop", () => {
  beforeEach(() => {
    runIgdbCoopBackfill.mockReset().mockResolvedValue({});
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("%s avec le bon Bearer → 202 et lance le backfill", async (method, handler) => {
    const res = await handler(req(method, "Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(runIgdbCoopBackfill).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("%s sans/avec mauvais Bearer → 401, rien lancé", async (method, handler) => {
    expect((await handler(req(method))).status).toBe(401);
    expect((await handler(req(method, "Bearer nope"))).status).toBe(401);
    expect(runIgdbCoopBackfill).not.toHaveBeenCalled();
  });

  it("GET sans CRON_SECRET côté serveur → 503 (fail-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("GET", "Bearer s3cret"))).status).toBe(503);
    expect(runIgdbCoopBackfill).not.toHaveBeenCalled();
  });
});
