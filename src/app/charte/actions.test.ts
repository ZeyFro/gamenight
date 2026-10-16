import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, resolveActiveCommunityId, findActiveMembership, updateMany, revalidatePath } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
  findActiveMembership: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId }));
vi.mock("@/lib/community-access", () => ({ findActiveMembership }));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { updateMany } } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveFairPlayCharterAction } from "./actions";

function form(charter: string, communityId?: string) {
  const data = new FormData();
  data.set("charter", charter);
  if (communityId) data.set("communityId", communityId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "member-a" });
  resolveActiveCommunityId.mockResolvedValue("community-a");
  findActiveMembership.mockResolvedValue({ role: "ADMIN" });
  updateMany.mockResolvedValue({ count: 1 });
});

describe("saveFairPlayCharterAction", () => {
  it("writes only to the server-resolved active community, not a submitted ID", async () => {
    await saveFairPlayCharterAction(form("Be fair", "community-b"));
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "community-a",
        status: "ACTIVE",
        memberships: { some: { userId: "member-a", status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } } },
      },
      data: { fairPlayCharter: "Be fair" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/charte");
  });

  it("denies non-admins and unauthenticated users without writing", async () => {
    findActiveMembership.mockResolvedValue({ role: "MEMBER" });
    await saveFairPlayCharterAction(form("Be fair"));
    getCurrentUser.mockResolvedValue(null);
    await saveFairPlayCharterAction(form("Be fair"));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects overlong text without replacing the existing charter", async () => {
    await saveFairPlayCharterAction(form("x".repeat(5001)));
    expect(updateMany).not.toHaveBeenCalled();
  });
});
