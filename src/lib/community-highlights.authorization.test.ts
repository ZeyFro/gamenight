import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "MEMBER" as "MEMBER" | "ADMIN" | "OWNER",
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  createOnce: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (work: (tx: unknown) => unknown) => work({
      $queryRaw: (strings: TemplateStringsArray) => strings.join("").includes('FROM "Community"')
        ? [{ status: "ACTIVE", name: "serveur" }]
        : [{ status: "ACTIVE", role: mocks.role }],
      communityHighlight: { create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany },
    }),
  },
}));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: async () => "community-1" }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedTransactionPrisma: (tx: unknown) => tx }));
vi.mock("@/lib/creation-intent", () => ({ createOnce: mocks.createOnce }));

import { deleteCommunityHighlight, saveCommunityHighlight } from "./community-highlights";

describe("community highlight moderation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_HIGHLIGHTS_ENABLED", "true");
    mocks.role = "MEMBER";
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  const input = { kind: "FAME", title: "Sauvetage", description: "Souvenir validé." };

  it("refuses member creation, editing and deletion", async () => {
    expect(await saveCommunityHighlight("member", null, input)).toBe(false);
    expect(await saveCommunityHighlight("member", "highlight-1", input)).toBe(false);
    expect(await deleteCommunityHighlight("member", "highlight-1")).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
