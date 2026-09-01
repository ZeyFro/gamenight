import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";

/**
 * `isUniqueConstraintViolation` est la seule fonction pure de ce fichier
 * (le reste — `awardXp`, `touchStreak` — écrit en base, hors scope ici).
 * Le calcul XP base + bonus de streak et les seuils de niveau qu'elle
 * utilise (`streakMultiplier`, `levelForXp`) sont déjà couverts par
 * `xp.test.ts` — `xp-actions.ts` ne fait que les appliquer avant d'écrire
 * en base, rien à tester en plus côté pur calcul ici.
 */
describe("isUniqueConstraintViolation", () => {
  it("true pour une PrismaClientKnownRequestError de code P2002", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.19.3",
    });
    expect(isUniqueConstraintViolation(error)).toBe(true);
  });

  it("false pour une PrismaClientKnownRequestError d'un autre code", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "6.19.3",
    });
    expect(isUniqueConstraintViolation(error)).toBe(false);
  });

  it("false pour une erreur générique (pas une PrismaClientKnownRequestError)", () => {
    expect(isUniqueConstraintViolation(new Error("boom"))).toBe(false);
  });

  it("false pour une valeur qui n'est même pas une Error", () => {
    expect(isUniqueConstraintViolation({ code: "P2002" })).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
  });
});
