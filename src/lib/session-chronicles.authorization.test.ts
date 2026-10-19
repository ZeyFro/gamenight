import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "MEMBER",
  status: "ACTIVE",
  invited: true,
  author: "creator",
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: (work: (tx: unknown) => unknown) => work({
    $queryRaw: (strings: TemplateStringsArray) => strings.join("").includes('FROM "Community"')
      ? [{ status: "ACTIVE", slug: "community", name: "Serveur" }]
      : [{ status: mocks.status, role: mocks.role }],
    session: { updateMany: mocks.updateMany },
  }),
} }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: async () => "community-1" }));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: async () => "community-1" }));
vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: async () => ({ session: { findFirst: mocks.findFirst } }),
  scopedTransactionPrisma: (tx: unknown) => tx,
}));
vi.mock("@/lib/session-access", () => ({
  accessibleSessionWhere: (userId: string) => ({ OR: [{ createdById: userId }, { invites: { some: { userId, status: "ACTIVE" } } }] }),
}));

import { saveSessionChronicle } from "./session-chronicles";

describe("chronicle editing permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_CHRONICLES_ENABLED", "true");
    mocks.role = "MEMBER";
    mocks.status = "ACTIVE";
    mocks.author = "creator";
    mocks.invited = true;
    mocks.findFirst.mockImplementation(async ({ where }) =>
      (where.createdById && where.createdById !== mocks.author) || (!mocks.invited && mocks.author !== "viewer")
        ? null : { communityId: "community-1", createdById: mocks.author });
    mocks.updateMany.mockImplementation(async ({ where }) => ({ count: where.createdById && where.createdById !== mocks.author ? 0 : 1 }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["ADMIN", "OWNER"])("allows an invited community %s to edit a finished session chronicle", async role => {
    mocks.role = role;
    expect(await saveSessionChronicle("viewer", "session-1", "Souvenir")).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", status: "DONE", OR: [{ createdById: "viewer" }, { invites: { some: { userId: "viewer", status: "ACTIVE" } } }] },
      data: { chronicle: "Souvenir" },
    });
  });

  it("keeps author editing without a community admin role", async () => {
    mocks.author = "viewer";
    expect(await saveSessionChronicle("viewer", "session-1", "Souvenir")).toBe(true);
  });

  it("refuses an ordinary invited member, including an app admin without a community role", async () => {
    expect(await saveSessionChronicle("viewer", "session-1", "Souvenir")).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an uninvited admin and an inactive membership", async () => {
    mocks.role = "ADMIN";
    mocks.invited = false;
    expect(await saveSessionChronicle("viewer", "session-1", "Souvenir")).toBe(false);
    mocks.invited = true;
    mocks.status = "REMOVED";
    expect(await saveSessionChronicle("viewer", "session-1", "Souvenir")).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
