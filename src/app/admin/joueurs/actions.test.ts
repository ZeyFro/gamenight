import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, applyXpAdjustment, writeCommunityIdForUser, checkRateLimit, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), applyXpAdjustment: vi.fn(), writeCommunityIdForUser: vi.fn(),
  checkRateLimit: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdmin }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...(await original<typeof import("@/lib/rate-limit")>()), checkRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/admin-xp", async (original) => ({ ...(await original<typeof import("@/lib/admin-xp")>()), applyXpAdjustment }));

import { adjustPlayerXpAction } from "./actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}
const valid = { userId: "u1", communityId: "c1", newXp: "500", expectedOldXp: "1596", reason: "abus" };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin1", discordName: "Admin" });
  writeCommunityIdForUser.mockResolvedValue("c1");
  checkRateLimit.mockReturnValue(true);
  applyXpAdjustment.mockResolvedValue({ ok: true, oldXp: 1596, newXp: 500 });
});

describe("adjustPlayerXpAction", () => {
  it("refuse un non-admin sans toucher à la base", async () => {
    requireAdmin.mockResolvedValue(null);
    expect(await adjustPlayerXpAction(form(valid))).toEqual({ ok: false, error: "unauthorized" });
    expect(applyXpAdjustment).not.toHaveBeenCalled();
  });

  it("applique avec l'identité de l'admin et la communauté lues côté serveur", async () => {
    expect(await adjustPlayerXpAction(form({ ...valid, adminId: "pirate", adminName: "Pirate" }))).toEqual({ ok: true });
    expect(applyXpAdjustment).toHaveBeenCalledWith({
      adminId: "admin1", adminName: "Admin", communityId: "c1", userId: "u1", newXp: 500, expectedOldXp: 1596, reason: "abus",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("refuse si la communauté actuelle de l'admin n'est plus celle de la fiche", async () => {
    writeCommunityIdForUser.mockResolvedValue("c2");
    expect(await adjustPlayerXpAction(form(valid))).toEqual({ ok: false, error: "community_changed" });
    expect(applyXpAdjustment).not.toHaveBeenCalled();
  });

  it("refuse un admin sans communauté active", async () => {
    writeCommunityIdForUser.mockResolvedValue(null);
    expect(await adjustPlayerXpAction(form(valid))).toEqual({ ok: false, error: "not_member" });
    expect(applyXpAdjustment).not.toHaveBeenCalled();
  });

  it("refuse les valeurs invalides avant tout accès", async () => {
    for (const patch of [{ newXp: "-5" }, { newXp: "abc" }, { expectedOldXp: "" }, { userId: "" }, { reason: "x".repeat(501) }]) {
      expect(await adjustPlayerXpAction(form({ ...valid, ...patch }))).toEqual({ ok: false, error: "invalid" });
    }
    expect(applyXpAdjustment).not.toHaveBeenCalled();
  });

  it("applique la limite de fréquence", async () => {
    checkRateLimit.mockReturnValue(false);
    expect(await adjustPlayerXpAction(form(valid))).toEqual({ ok: false, error: "rate_limited" });
    expect(applyXpAdjustment).not.toHaveBeenCalled();
  });

  it("transmet les refus métier et rafraîchit la fiche", async () => {
    applyXpAdjustment.mockResolvedValue({ ok: false, reason: "stale" });
    expect(await adjustPlayerXpAction(form(valid))).toEqual({ ok: false, error: "stale" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });
});
