import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/booster-support-runner", () => ({ runBoosterSyncAction: mocks.run }));

import { performDiscordAction } from "./notification-executor";

const deadline = new Date(Date.now() + 20_000);
const now = new Date();
beforeEach(() => vi.clearAllMocks());

describe("performDiscordAction — sync_booster_support", () => {
  const action = { kind: "sync_booster_support", intent: "member", communityId: "c1", discordId: "100000000000000011" } as const;

  it("délègue au runner avec l'échéance de la livraison", async () => {
    mocks.run.mockResolvedValue({ ok: true, data: {} });
    expect(await performDiscordAction(action, deadline, now)).toEqual({ ok: true, data: {} });
    expect(mocks.run).toHaveBeenCalledWith({ intent: "member", communityId: "c1", discordId: "100000000000000011" }, deadline, undefined, now);
  });

  it("propage tel quel un échec", async () => {
    const failure = { ok: false, kind: "rate_limited", message: "x", retryable: true };
    mocks.run.mockResolvedValue(failure);
    expect(await performDiscordAction(action, deadline, now)).toEqual(failure);
  });
});
