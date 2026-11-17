import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), updateMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { cronLock: { upsert: mocks.upsert, updateMany: mocks.updateMany } },
}));

import { withRoleCreationLock } from "./discord-role-lock";

let locked = false;
let active = 0;
let maxActive = 0;

beforeEach(() => {
  locked = false;
  active = 0;
  maxActive = 0;
  mocks.upsert.mockReset();
  mocks.updateMany.mockReset();
  mocks.upsert.mockResolvedValue({});
  mocks.updateMany.mockImplementation(async ({ data }: { data: { lockedAt: Date | null } }) => {
    if (data.lockedAt === null) {
      locked = false;
      return { count: 1 };
    }
    if (locked) return { count: 0 };
    locked = true;
    return { count: 1 };
  });
});

const run = async () => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, 30));
  active -= 1;
  return "ok";
};

describe("verrou de création de rôle", () => {
  it("sérialise deux créations simultanées du même jeu", async () => {
    const results = await Promise.all([
      withRoleCreationLock({ guildId: "g1", key: "hades ii", run }),
      withRoleCreationLock({ guildId: "g1", key: "hades ii", run }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["acquired", "acquired"]);
    expect(maxActive).toBe(1);
    expect(mocks.updateMany.mock.calls.some(([call]) => call.data.lockedAt === null)).toBe(true);
  });

  it("retourne `busy` sans exécuter la création si le verrou reste pris", async () => {
    locked = true;
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const result = await withRoleCreationLock({ guildId: "g1", key: "hades ii", run, waitMs: 10 });
    expect(result).toEqual({ status: "busy" });
    expect(active).toBe(0);
  });

  it("libère le verrou même si la création échoue", async () => {
    await expect(
      withRoleCreationLock({
        guildId: "g1",
        key: "erreur",
        run: async () => {
          throw new Error("discord_50013");
        },
      })
    ).rejects.toThrow("discord_50013");
    expect(locked).toBe(false);
  });
});
