import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { createOnce } from "./creation-intent";

describe("createOnce", () => {
  beforeEach(() => {
    mocks.transaction.mockReset().mockResolvedValue({ result: { id: "session" }, replayed: false });
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

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000, maxWait: 5_000 });
  });
});
