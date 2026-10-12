import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, runExecutorBatch, logger } = vi.hoisted(() => ({
  afterMock: vi.fn<(task: () => Promise<void>) => void>(),
  runExecutorBatch: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => afterMock(task) }));
vi.mock("@/lib/notification-executor", () => ({ runExecutorBatch }));
vi.mock("@/lib/notification-dispatch", () => ({ DISPATCH_RESOLVER: { resolve: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger }));

import { kickNotificationExecutor, resetNotificationExecutorKickForTests } from "./notification-executor-kick";

describe("kickNotificationExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationExecutorKickForTests();
    runExecutorBatch.mockResolvedValue({ processed: 1, sent: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ne fait rien sans NOTIFICATION_EXECUTOR_ENABLED=true", () => {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      if (value === undefined) vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", ""); else vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", value);
      kickNotificationExecutor();
    }
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("planifie un seul passage pour une rafale d'enqueue", () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    kickNotificationExecutor(); kickNotificationExecutor(); kickNotificationExecutor();
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("lance runExecutorBatch avec un owner « event: » et lève l'indicateur au début du passage", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    kickNotificationExecutor();
    const task = afterMock.mock.calls[0][0];
    const running = task();
    // Pendant le passage, une nouvelle livraison peut redemander un passage.
    kickNotificationExecutor();
    expect(afterMock).toHaveBeenCalledTimes(2);
    await running;
    expect(runExecutorBatch).toHaveBeenCalledTimes(1);
    expect(runExecutorBatch.mock.calls[0][0].owner).toMatch(/^event:[0-9a-f-]{36}$/);
  });

  it("journalise (sans jeter) un échec du batch : le cron reprendra", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    runExecutorBatch.mockRejectedValue(new Error("boom"));
    kickNotificationExecutor();
    await expect(afterMock.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("executor-kick", expect.any(Error), { effect: "cron_fallback" });
  });

  it("hors requête (after() jette) : info, pas d'exception, et le suivant peut replanifier", () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    afterMock.mockImplementationOnce(() => { throw new Error("`after` was called outside a request scope. Read more: x"); });
    expect(() => kickNotificationExecutor()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith("executor-kick", expect.stringContaining("Hors requête"));
    expect(logger.error).not.toHaveBeenCalled();
    kickNotificationExecutor();
    expect(afterMock).toHaveBeenCalledTimes(2);
  });

  it("autre erreur d'after() : journalisée en erreur, jamais propagée à la mutation métier", () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    afterMock.mockImplementationOnce(() => { throw new Error("autre"); });
    expect(() => kickNotificationExecutor()).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
