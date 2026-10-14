import { describe, expect, it } from "vitest";
import {
  THREAD_CLEANUP_DELETE_DELAY_MS,
  decideThreadCleanup,
  slotStatusFromRows,
  type ThreadCleanupState,
} from "./discord-thread-cleanup";

const now = new Date("2026-09-30T12:00:00.000Z");

function state(overrides: Partial<ThreadCleanupState> = {}): ThreadCleanupState {
  return {
    threadCreated: true,
    archive: { status: "none", sentAt: null },
    deleteEnqueued: false,
    ...overrides,
  };
}

describe("decideThreadCleanup", () => {
  it("fil créé, jamais archivé : archive d'abord (jamais une suppression directe)", () => {
    expect(decideThreadCleanup(state(), now)).toBe("archive");
  });

  it("aucun fil créé : rien à faire", () => {
    expect(decideThreadCleanup(state({ threadCreated: false }), now)).toBe("nothing");
  });

  it("archivage en attente : attend", () => {
    expect(decideThreadCleanup(state({ archive: { status: "pending", sentAt: null } }), now)).toBe("wait");
  });

  it("archivé depuis moins de 24 h : attend", () => {
    const sentAt = new Date(now.getTime() - THREAD_CLEANUP_DELETE_DELAY_MS + 1);
    expect(decideThreadCleanup(state({ archive: { status: "sent", sentAt } }), now)).toBe("wait");
  });

  it("archivé depuis exactement 24 h : supprime", () => {
    const sentAt = new Date(now.getTime() - THREAD_CLEANUP_DELETE_DELAY_MS);
    expect(decideThreadCleanup(state({ archive: { status: "sent", sentAt } }), now)).toBe("delete");
  });

  it("archivé sans horodatage d'envoi : attend, jamais une date inventée", () => {
    expect(decideThreadCleanup(state({ archive: { status: "sent", sentAt: null } }), now)).toBe("wait");
  });

  it("archivage en échec terminal : bloque la suppression et le signale", () => {
    expect(decideThreadCleanup(state({ archive: { status: "failed", sentAt: null } }), now)).toBe("archive_failed");
  });

  it("archivage refusé définitivement (skipped) : rien à faire", () => {
    expect(decideThreadCleanup(state({ archive: { status: "skipped", sentAt: null } }), now)).toBe("nothing");
  });

  it("suppression déjà programmée (auto, manuelle ou rétention) : jamais doublée", () => {
    const sentAt = new Date(now.getTime() - 2 * THREAD_CLEANUP_DELETE_DELAY_MS);
    expect(decideThreadCleanup(state({ archive: { status: "sent", sentAt }, deleteEnqueued: true }), now)).toBe(
      "nothing"
    );
    expect(decideThreadCleanup(state({ deleteEnqueued: true }), now)).toBe("nothing");
  });
});

describe("slotStatusFromRows", () => {
  const row = (status: string, sentAt: Date | null = null) => ({
    targetSlot: "slot",
    operation: "SEND",
    status,
    sentAt,
    discordThreadId: null,
  });

  it("aucune ligne : none", () => {
    expect(slotStatusFromRows([])).toEqual({ status: "none", sentAt: null });
  });

  it("la plus récente non-SKIPPED fait foi", () => {
    const sentAt = new Date("2026-09-29T00:00:00.000Z");
    expect(slotStatusFromRows([row("SKIPPED"), row("SENT", sentAt), row("FAILED")])).toEqual({
      status: "sent",
      sentAt,
    });
  });

  it("uniquement des SKIPPED : skipped", () => {
    expect(slotStatusFromRows([row("SKIPPED")])).toEqual({ status: "skipped", sentAt: null });
  });

  it("FAILED / PENDING / RESERVED", () => {
    expect(slotStatusFromRows([row("FAILED")]).status).toBe("failed");
    expect(slotStatusFromRows([row("PENDING")]).status).toBe("pending");
    expect(slotStatusFromRows([row("RESERVED")]).status).toBe("pending");
  });
});
