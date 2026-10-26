import { beforeEach, describe, expect, it, vi } from "vitest";

const runExecutorBatch = vi.fn();
vi.mock("@/lib/notification-executor", () => ({ runExecutorBatch: (...a: unknown[]) => runExecutorBatch(...a) }));
vi.mock("@/lib/notification-dispatch", () => ({ DISPATCH_RESOLVER: {} }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));
const afterTasks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => Promise<void>) => void afterTasks.push(cb) };
});

import { GET } from "./route";

const req = (authorization?: string) =>
  new Request("https://example.test/api/cron/notification-executor", { headers: authorization ? { authorization } : {} });

describe("/api/cron/notification-executor", () => {
  beforeEach(() => {
    afterTasks.length = 0;
    vi.clearAllMocks();
    runExecutorBatch.mockResolvedValue({ processed: 2, sent: 2, failed: 0 });
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  });

  it("202 immédiat, le lot ne tourne que dans after()", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ enabled: true, status: "accepted" });
    expect(runExecutorBatch).not.toHaveBeenCalled();
    await afterTasks[0]();
    expect(runExecutorBatch).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("cron:notification-executor", "Batch fin.", expect.objectContaining({ sent: 2 }));
  });

  it("erreur du lot journalisée (logger.error), jamais avalée", async () => {
    runExecutorBatch.mockRejectedValue(new Error("boom"));
    await GET(req("Bearer s3cret"));
    await afterTasks[0]();
    expect(logger.error).toHaveBeenCalledWith("cron:notification-executor", expect.any(Error), expect.any(Object));
  });

  it("éteint : {enabled:false} synchrone, rien dans after()", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, processed: 0 });
    expect(afterTasks).toHaveLength(0);
  });

  it("401 mauvais jeton, 503 sans CRON_SECRET, rien lancé", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer s3cret"))).status).toBe(503);
    expect(afterTasks).toHaveLength(0);
  });
});
