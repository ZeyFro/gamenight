import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/discord-role-autocreate", () => ({ runRoleCreationAction: mocks.run }));

import { performDiscordAction } from "./notification-executor";

const deadline = new Date(Date.now() + 20_000);
const now = new Date();
beforeEach(() => vi.clearAllMocks());

describe("performDiscordAction — create_game_role", () => {
  const action = { kind: "create_game_role", requestId: "req-1", communityId: "c1" } as const;

  it("délègue au runner avec l'échéance de la livraison", async () => {
    mocks.run.mockResolvedValue({ ok: true, data: {} });
    expect(await performDiscordAction(action, deadline, now)).toEqual({ ok: true, data: {} });
    expect(mocks.run).toHaveBeenCalledWith({ requestId: "req-1", communityId: "c1" }, deadline, undefined, now);
  });

  it("propage tel quel un échec (retentable ou définitif)", async () => {
    const failure = { ok: false, kind: "invalid_request", message: "x", retryable: false };
    mocks.run.mockResolvedValue(failure);
    expect(await performDiscordAction(action, deadline, now)).toEqual(failure);
  });
});
