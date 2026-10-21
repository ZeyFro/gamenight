import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findDefaultCommunityId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/default-community", () => ({ findExistingDefaultCommunityId: mocks.findDefaultCommunityId }));

import { createOnce, lockCreationMembers } from "./creation-intent";

describe("createOnce", () => {
  beforeEach(() => {
    mocks.transaction.mockReset().mockResolvedValue({ result: { id: "session" }, replayed: false });
    mocks.findDefaultCommunityId.mockReset().mockResolvedValue("default-id");
  });

  it("bounds transaction acquisition separately from transaction execution", async () => {
    await createOnce(
      "creator",
      "SESSION",
      undefined,
      async () => ({ id: "session" }),
      (session) => session.id,
      async (_tx, id) => ({ id }),
    );

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000, maxWait: 10_000 });
  });

  it("résout null dans le client transactionnel et garde les deux verrous en ordre dans une requête", async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([
      { communityStatus: "ACTIVE", userId: "creator", membershipStatus: "ACTIVE" },
    ]);
    const tx = { $queryRaw: queryRaw } as unknown as import("@prisma/client").Prisma.TransactionClient;

    await lockCreationMembers(tx, null, ["creator"]);

    expect(mocks.findDefaultCommunityId).toHaveBeenCalledWith(tx);
    expect(queryRaw).toHaveBeenCalledOnce();
    const sql = queryRaw.mock.calls[0][0].join("?");
    expect(sql.indexOf("locked_community AS MATERIALIZED")).toBeLessThan(sql.indexOf("locked_members AS MATERIALIZED"));
    expect(sql).toContain("JOIN locked_community");
    expect(sql.match(/FOR SHARE/g)).toHaveLength(2);
  });

  it("refuse quand la communauté ou un membre n'est pas ACTIVE", async () => {
    for (const row of [
      { communityStatus: "ACTIVE", userId: null, membershipStatus: null },
      { communityStatus: "SUSPENDED", userId: "creator", membershipStatus: "ACTIVE" },
    ]) {
      const queryRaw = vi.fn().mockResolvedValueOnce([row]);
      const tx = { $queryRaw: queryRaw } as unknown as import("@prisma/client").Prisma.TransactionClient;

      await expect(lockCreationMembers(tx, "community-b", ["creator"])).rejects.toThrow("Le serveur ou un invité n’est plus accessible");
    }
  });
});
