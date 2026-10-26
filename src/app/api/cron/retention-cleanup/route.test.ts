import { beforeEach, describe, expect, it, vi } from "vitest";

const runRetentionCleanup = vi.fn();
vi.mock("@/lib/retention-runner", () => ({ runRetentionCleanup: (...a: unknown[]) => runRetentionCleanup(...a) }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));
const afterTasks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => Promise<void>) => void afterTasks.push(cb) };
});

import { GET } from "./route";

const req = (authorization?: string) =>
  new Request("https://example.test/api/cron/retention-cleanup", { headers: authorization ? { authorization } : {} });

describe("/api/cron/retention-cleanup", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    runRetentionCleanup.mockResolvedValue({ stoppedReason: "completed", durationMs: 5, errors: [] });
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("RETENTION_CLEANUP_ENABLED", "true");
    vi.stubEnv("RETENTION_CLEANUP_MODE", "");
  });

  it("202 immédiat ; dry-run par défaut, exécuté seulement dans after()", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ enabled: true, dryRun: true, status: "accepted" });
    expect(runRetentionCleanup).not.toHaveBeenCalled();
    await afterTasks[0]();
    expect(runRetentionCleanup).toHaveBeenCalledWith({ dryRun: true });
  });

  it("MODE=execute → dryRun false", async () => {
    vi.stubEnv("RETENTION_CLEANUP_MODE", "execute");
    await GET(req("Bearer s3cret"));
    await afterTasks[0]();
    expect(runRetentionCleanup).toHaveBeenCalledWith({ dryRun: false });
  });

  it("erreur journalisée, jamais avalée", async () => {
    runRetentionCleanup.mockRejectedValue(new Error("boom"));
    await GET(req("Bearer s3cret"));
    await afterTasks[0]();
    expect(logger.error).toHaveBeenCalledWith("cron:retention-cleanup", expect.any(Error), expect.any(Object));
  });

  it("éteint : réponse synchrone inchangée, rien dans after()", async () => {
    vi.stubEnv("RETENTION_CLEANUP_ENABLED", "");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, dryRun: true, report: null });
    expect(afterTasks).toHaveLength(0);
  });

  it("401 / 503", async () => {
    expect((await GET(req())).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer s3cret"))).status).toBe(503);
    expect(afterTasks).toHaveLength(0);
  });
});
