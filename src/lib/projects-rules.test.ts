import { describe, expect, it } from "vitest";
import {
  PROJECT_ARCHIVE_DELAY_MS,
  acceptDecision,
  entryDecision,
  projectInputSchema,
  projectOrganizerEnabled,
  shouldArchive,
  shouldClose,
  validateEndsAt,
  type ProjectLike,
} from "./projects-rules";

const NOW = new Date("2026-11-20T18:00:00.000Z");
const H = 3_600_000;
const open: ProjectLike = { status: "OPEN", endsAt: new Date(NOW.getTime() + 48 * H), organizerId: "org", maxEntries: 2 };

describe("interrupteur et saisie", () => {
  it("n'est actif que pour la valeur exacte true", () => {
    expect(projectOrganizerEnabled({ PROJECT_ORGANIZER_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", " true"]) expect(projectOrganizerEnabled({ PROJECT_ORGANIZER_ENABLED: value })).toBe(false);
  });
  it("valide nom, description et places", () => {
    expect(projectInputSchema.safeParse({ name: "Expédition", description: "Finir la campagne ensemble" }).success).toBe(true);
    expect(projectInputSchema.safeParse({ name: "ab", description: "Finir la campagne ensemble" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ name: "Expédition", description: "court" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ name: "Expédition", description: "Finir la campagne ensemble", maxEntries: "1" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ name: "Expédition", description: "Finir la campagne ensemble", maxEntries: "201" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ name: "Expédition", description: "Finir la campagne ensemble", maxEntries: "8" }).success).toBe(true);
  });
});

describe("validateEndsAt", () => {
  it("exige une fin entre 1 h et 90 jours", () => {
    expect(validateEndsAt(new Date(NOW.getTime() + 30 * 60_000), NOW)).toBe("too_soon");
    expect(validateEndsAt(new Date(NOW.getTime() - H), NOW)).toBe("too_soon");
    expect(validateEndsAt(new Date(NOW.getTime() + H), NOW)).toBe("ok");
    expect(validateEndsAt(new Date(NOW.getTime() + 91 * 24 * H), NOW)).toBe("too_far");
    expect(validateEndsAt(new Date("nope"), NOW)).toBe("invalid");
  });
});

describe("entryDecision", () => {
  it("accepte un membre sur un projet ouvert, et un retrait redéposé", () => {
    expect(entryDecision(open, "u", null, NOW)).toEqual({ ok: true, reuse: false });
    expect(entryDecision(open, "u", "WITHDRAWN", NOW)).toEqual({ ok: true, reuse: true });
  });
  it("refuse l'organisateur, les doublons, les refus et les projets clos ou échus", () => {
    expect(entryDecision(open, "org", null, NOW)).toEqual({ ok: false, reason: "own" });
    expect(entryDecision(open, "u", "PENDING", NOW)).toEqual({ ok: false, reason: "pending" });
    expect(entryDecision(open, "u", "ACCEPTED", NOW)).toEqual({ ok: false, reason: "member" });
    expect(entryDecision(open, "u", "DECLINED", NOW)).toEqual({ ok: false, reason: "declined" });
    expect(entryDecision({ ...open, status: "CLOSED" }, "u", null, NOW)).toEqual({ ok: false, reason: "closed" });
    expect(entryDecision({ ...open, endsAt: NOW }, "u", null, NOW)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("acceptDecision", () => {
  it("valide seulement une entrée en attente, dans la limite de places", () => {
    expect(acceptDecision(open, "PENDING", 1)).toBe("ok");
    expect(acceptDecision(open, "PENDING", 2)).toBe("full");
    expect(acceptDecision(open, "ACCEPTED", 0)).toBe("not_pending");
    expect(acceptDecision(open, "DECLINED", 0)).toBe("not_pending");
    expect(acceptDecision({ ...open, status: "CLOSED" }, "PENDING", 0)).toBe("closed");
    expect(acceptDecision({ ...open, maxEntries: null }, "PENDING", 500)).toBe("ok");
  });
});

describe("clôture et archivage", () => {
  it("clôt à la date de fin, jamais avant, jamais deux fois", () => {
    expect(shouldClose({ status: "OPEN", endsAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(true);
    expect(shouldClose({ status: "OPEN", endsAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(false);
    expect(shouldClose({ status: "CLOSED", endsAt: new Date(NOW.getTime() - H) }, NOW)).toBe(false);
  });
  it("archive exactement 7 jours après la clôture", () => {
    const closedAt = new Date("2026-11-10T12:00:00.000Z");
    expect(shouldArchive({ status: "CLOSED", closedAt }, new Date(closedAt.getTime() + PROJECT_ARCHIVE_DELAY_MS - 1))).toBe(false);
    expect(shouldArchive({ status: "CLOSED", closedAt }, new Date(closedAt.getTime() + PROJECT_ARCHIVE_DELAY_MS))).toBe(true);
    expect(shouldArchive({ status: "OPEN", closedAt: null }, NOW)).toBe(false);
    expect(shouldArchive({ status: "ARCHIVED", closedAt }, new Date(closedAt.getTime() + 30 * 24 * H))).toBe(false);
  });
});
