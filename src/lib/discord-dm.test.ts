import { describe, expect, it } from "vitest";
import { dmFallbackSlot, dmSlot, parseDmRole } from "./discord-dm";

describe("parseDmRole", () => {
  it("lit le kind et le userId d'un rôle de MP", () => {
    expect(parseDmRole("dm:announce:user-1", "dm:")).toEqual({ kind: "announce", userId: "user-1" });
  });

  it("garde un kind composé (plusieurs `:`) et prend le dernier segment comme userId", () => {
    expect(parseDmRole("dm:reminder:60:user-1", "dm:")).toEqual({ kind: "reminder:60", userId: "user-1" });
  });

  it("refuse un mauvais préfixe, un rôle sans userId ou sans kind", () => {
    expect(parseDmRole("dm-fallback:announce:user-1", "dm:")).toBeNull();
    expect(parseDmRole("dm:announce:", "dm:")).toBeNull();
    expect(parseDmRole("dm:user-1", "dm:")).toBeNull();
    expect(parseDmRole("thread", "dm:")).toBeNull();
  });

  it("lit un rôle de mention de secours", () => {
    expect(parseDmRole("dm-fallback:announce:user-1", "dm-fallback:")).toEqual({ kind: "announce", userId: "user-1" });
  });
});

describe("slots", () => {
  it("le rôle d'un slot de MP est relu tel quel par parseDmRole (même découpage que les résolveurs)", () => {
    const slot = dmSlot("TOURNAMENT", "t1", "announce", "u1");
    expect(slot).toBe("default-guild:TOURNAMENT:t1:dm:announce:u1");
    const role = slot.split(":").slice(3).join(":");
    expect(parseDmRole(role, "dm:")).toEqual({ kind: "announce", userId: "u1" });

    const fallbackRole = dmFallbackSlot("TOURNAMENT", "t1", "announce", "u1").split(":").slice(3).join(":");
    expect(parseDmRole(fallbackRole, "dm-fallback:")).toEqual({ kind: "announce", userId: "u1" });
  });
});
