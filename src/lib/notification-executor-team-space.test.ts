import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), createRole: vi.fn(), sendChannel: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/discord-team-space-runner", () => ({ runTeamSpaceAction: mocks.run }));

import { performDiscordAction } from "./notification-executor";

const deadline = new Date(Date.now() + 20_000);
beforeEach(() => vi.clearAllMocks());

describe("performDiscordAction — sync_team_space", () => {
  const action = { kind: "sync_team_space", intent: "member", teamId: "team-1", communityId: "c1", discordId: "100000000000000022" } as const;

  it("délègue au runner avec l'échéance de la livraison et renvoie un succès sans référence de message", async () => {
    mocks.run.mockResolvedValue({ ok: true, data: {} });
    expect(await performDiscordAction(action, deadline, new Date())).toEqual({ ok: true, data: {} });
    expect(mocks.run).toHaveBeenCalledWith(
      { intent: "member", teamId: "team-1", communityId: "c1", discordId: "100000000000000022" },
      deadline
    );
  });

  it("propage tel quel un échec (retentable ou définitif)", async () => {
    const failure = { ok: false, kind: "server_error", message: "x", retryable: true };
    mocks.run.mockResolvedValue(failure);
    expect(await performDiscordAction(action, deadline, new Date())).toEqual(failure);
  });
});
