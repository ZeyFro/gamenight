import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, upsert, update, transaction } = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userNotificationPreference: { findMany, upsert },
    user: { update },
    $transaction: transaction,
  },
}));

import {
  filterUsersByNotificationPreference,
  isAvailableNotificationCategory,
  isPersonalNotificationEnabled,
  setOwnNotificationPreference,
} from "./notification-preferences";

describe("notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    upsert.mockReturnValue({ operation: "upsert" });
    update.mockReturnValue({ operation: "update" });
    transaction.mockResolvedValue([]);
  });

  it("sans ligne catégorielle, conserve exactement silenceReminders", () => {
    expect(isPersonalNotificationEnabled({ silenceReminders: false }, "SESSION")).toBe(true);
    expect(isPersonalNotificationEnabled({ silenceReminders: true }, "SESSION")).toBe(false);
    expect(isPersonalNotificationEnabled({ silenceReminders: true }, "ROULETTE")).toBe(false);
  });

  it("une ligne catégorielle est prioritaire sur le champ legacy", () => {
    expect(
      isPersonalNotificationEnabled(
        { silenceReminders: true, notificationPreferences: [{ category: "SESSION", enabled: true }] },
        "SESSION"
      )
    ).toBe(true);
    expect(
      isPersonalNotificationEnabled(
        { silenceReminders: false, notificationPreferences: [{ category: "ROULETTE", enabled: false }] },
        "ROULETTE"
      )
    ).toBe(false);
  });

  it("valide uniquement les catégories réellement opérationnelles", () => {
    expect(isAvailableNotificationCategory("SESSION")).toBe(true);
    expect(isAvailableNotificationCategory("ROULETTE")).toBe(true);
    expect(isAvailableNotificationCategory("TOURNAMENT")).toBe(false);
    expect(isAvailableNotificationCategory("__proto__")).toBe(false);
  });

  it("filtre les destinataires sélectionnés sans pouvoir en réintroduire un autre", async () => {
    findMany.mockResolvedValue([
      { userId: "refuse", enabled: false },
      { userId: "accepte-malgre-legacy", enabled: true },
    ]);
    const candidates = [
      { id: "refuse", silenceReminders: false },
      { id: "accepte-malgre-legacy", silenceReminders: true },
      { id: "legacy-refuse", silenceReminders: true },
    ];

    await expect(filterUsersByNotificationPreference(candidates, "SESSION")).resolves.toEqual([
      candidates[1],
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: { in: candidates.map((user) => user.id) }, category: "SESSION" },
      select: { userId: true, enabled: true },
    });
  });

  it("écrit uniquement pour l'identité authentifiée et synchronise le legacy des soirées", async () => {
    await setOwnNotificationPreference("session-user", "SESSION", false);
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_category: { userId: "session-user", category: "SESSION" } },
      create: { userId: "session-user", category: "SESSION", enabled: false },
      update: { enabled: false },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "session-user" },
      data: { silenceReminders: true },
    });
  });

  it("rend les roulettes indépendantes sans modifier silenceReminders", async () => {
    await setOwnNotificationPreference("session-user", "ROULETTE", true);
    expect(upsert).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});
