import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  applyDecision,
  canManageSession,
  discoverableSessionWhere,
  effectiveVisibility,
  isDiscoverableVisibility,
  joinDecision,
  parseSessionVisibility,
  sessionEndedAt,
  sessionSpaceDue,
  sessionVisibilityEnabled,
  SESSION_ASSUMED_DURATION_MS,
  SESSION_SPACE_LEAD_MS,
} from "./session-visibility";

const NOW = new Date("2026-11-20T18:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 24 * 3_600_000);
const base = { visibility: "PUBLIC", status: "SCHEDULED", date: FUTURE, createdById: "creator" };

describe("interrupteur et valeurs", () => {
  it("n'est actif que pour la valeur exacte true", () => {
    expect(sessionVisibilityEnabled({ SESSION_VISIBILITY_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "yes", " true"]) {
      expect(sessionVisibilityEnabled({ SESSION_VISIBILITY_ENABLED: value })).toBe(false);
    }
  });

  it("toute valeur inconnue devient PRIVATE (fail-closed)", () => {
    expect(parseSessionVisibility("PUBLIC")).toBe("PUBLIC");
    expect(parseSessionVisibility("APPLICATION")).toBe("APPLICATION");
    for (const value of [undefined, null, "", "public", "OPEN", 3, {}]) expect(parseSessionVisibility(value)).toBe("PRIVATE");
  });

  it("flag éteint : une soirée stockée PUBLIC est traitée comme PRIVATE", () => {
    expect(effectiveVisibility("PUBLIC", false)).toBe("PRIVATE");
    expect(effectiveVisibility("APPLICATION", false)).toBe("PRIVATE");
    expect(effectiveVisibility("PUBLIC", true)).toBe("PUBLIC");
    expect(isDiscoverableVisibility("PRIVATE")).toBe(false);
  });
});

describe("canManageSession (coorganisateur)", () => {
  const session = { createdById: "creator", coOrganizerId: "co" };
  it("le créateur gère toujours", () => {
    expect(canManageSession("creator", session, false)).toBe(true);
    expect(canManageSession("creator", { createdById: "creator" }, true)).toBe(true);
  });
  it("le coorganisateur gère seulement flag allumé", () => {
    expect(canManageSession("co", session, true)).toBe(true);
    expect(canManageSession("co", session, false)).toBe(false);
  });
  it("un tiers ne gère jamais, même sans coorganisateur", () => {
    expect(canManageSession("other", session, true)).toBe(false);
    expect(canManageSession("other", { createdById: "creator", coOrganizerId: null }, true)).toBe(false);
    expect(canManageSession("", { createdById: "creator", coOrganizerId: null }, true)).toBe(false);
  });
});

describe("joinDecision", () => {
  it("accepte une soirée PUBLIC ouverte", () => {
    expect(joinDecision(base, "u", null, NOW, true)).toEqual({ ok: true, alreadyIn: false });
    expect(joinDecision(base, "u", "ACTIVE", NOW, true)).toEqual({ ok: true, alreadyIn: true });
  });
  it("refuse flag éteint, soirée absente, propre soirée", () => {
    expect(joinDecision(base, "u", null, NOW, false)).toEqual({ ok: false, reason: "disabled" });
    expect(joinDecision(null, "u", null, NOW, true)).toEqual({ ok: false, reason: "not_found" });
    expect(joinDecision(base, "creator", null, NOW, true)).toEqual({ ok: false, reason: "own" });
  });
  it("refuse PRIVATE et APPLICATION (jamais de jointure directe)", () => {
    expect(joinDecision({ ...base, visibility: "PRIVATE" }, "u", null, NOW, true)).toEqual({ ok: false, reason: "not_public" });
    expect(joinDecision({ ...base, visibility: "APPLICATION" }, "u", null, NOW, true)).toEqual({ ok: false, reason: "not_public" });
    expect(joinDecision({ ...base, visibility: "garbage" }, "u", null, NOW, true)).toEqual({ ok: false, reason: "not_public" });
  });
  it("refuse une soirée terminée, annulée ou passée", () => {
    for (const status of ["DONE", "CANCELLED"]) expect(joinDecision({ ...base, status }, "u", null, NOW, true)).toEqual({ ok: false, reason: "closed" });
    expect(joinDecision({ ...base, date: new Date(NOW.getTime() - 1) }, "u", null, NOW, true)).toEqual({ ok: false, reason: "closed" });
  });
  it("un invité retiré par l'organisateur ne revient pas seul", () => {
    expect(joinDecision(base, "u", "REVOKED", NOW, true)).toEqual({ ok: false, reason: "removed" });
  });
});

describe("applyDecision", () => {
  const app = { ...base, visibility: "APPLICATION" };
  it("accepte une candidature sur soirée APPLICATION", () => {
    expect(applyDecision(app, "u", null, null, NOW, true)).toEqual({ ok: true, reuse: false });
    expect(applyDecision(app, "u", null, "WITHDRAWN", NOW, true)).toEqual({ ok: true, reuse: true });
    expect(applyDecision(app, "u", null, "PENDING", NOW, true)).toEqual({ ok: true, reuse: true });
  });
  it("refuse hors APPLICATION, flag éteint, déjà invité, propre soirée", () => {
    expect(applyDecision(base, "u", null, null, NOW, true)).toEqual({ ok: false, reason: "not_application" });
    expect(applyDecision({ ...base, visibility: "PRIVATE" }, "u", null, null, NOW, true)).toEqual({ ok: false, reason: "not_application" });
    expect(applyDecision(app, "u", null, null, NOW, false)).toEqual({ ok: false, reason: "disabled" });
    expect(applyDecision(app, "u", "ACTIVE", null, NOW, true)).toEqual({ ok: false, reason: "invited" });
    expect(applyDecision(app, "creator", null, null, NOW, true)).toEqual({ ok: false, reason: "own" });
  });
  it("une candidature refusée ou un retrait ne se rouvre pas", () => {
    expect(applyDecision(app, "u", null, "DECLINED", NOW, true)).toEqual({ ok: false, reason: "declined" });
    expect(applyDecision(app, "u", "REVOKED", "ACCEPTED", NOW, true)).toEqual({ ok: false, reason: "declined" });
  });
  it("refuse une soirée fermée", () => {
    expect(applyDecision({ ...app, status: "CANCELLED" }, "u", null, null, NOW, true)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("discoverableSessionWhere", () => {
  const where = discoverableSessionWhere("me", { communityIds: ["c1"], includesDefault: false }, NOW) as { AND: unknown[] };

  it("ne cible que PUBLIC et APPLICATION, jamais PRIVATE", () => {
    expect(where.AND).toContainEqual({ visibility: { in: ["PUBLIC", "APPLICATION"] } });
    expect(JSON.stringify(where)).not.toContain("PRIVATE");
  });
  it("exclut mes soirées, celles où je suis déjà invité, le passé et les statuts terminaux", () => {
    expect(where.AND).toContainEqual({ createdById: { not: "me" } });
    expect(where.AND).toContainEqual({ invites: { none: { userId: "me", status: "ACTIVE" } } });
    expect(where.AND).toContainEqual({ date: { gt: NOW } });
    expect(where.AND).toContainEqual({ status: { in: ["VOTING", "SCHEDULED"] } });
  });
  it("est borné aux communautés de l'utilisateur (une portée vide ne voit rien)", () => {
    expect(where.AND).toContainEqual({ OR: [{ communityId: { in: ["c1"] } }] });
    const empty = discoverableSessionWhere("me", { communityIds: [], includesDefault: false }, NOW) as { AND: unknown[] };
    expect(empty.AND).toContainEqual({ OR: [{ communityId: { in: [] } }] });
  });
});

describe("fenêtre de l'espace Discord", () => {
  const start = new Date("2026-11-20T20:00:00.000Z");
  const scheduled = { status: "SCHEDULED", date: start };

  it("n'est dû que de 30 min avant le début jusqu'à la fin présumée", () => {
    expect(sessionSpaceDue(scheduled, new Date(start.getTime() - SESSION_SPACE_LEAD_MS - 1))).toBe(false);
    expect(sessionSpaceDue(scheduled, new Date(start.getTime() - SESSION_SPACE_LEAD_MS))).toBe(true);
    expect(sessionSpaceDue(scheduled, start)).toBe(true);
    expect(sessionSpaceDue(scheduled, new Date(start.getTime() + SESSION_ASSUMED_DURATION_MS))).toBe(false);
  });
  it("n'est jamais dû hors statut SCHEDULED", () => {
    for (const status of ["VOTING", "DONE", "CANCELLED"]) expect(sessionSpaceDue({ status, date: start }, start)).toBe(false);
  });
  it("la fin : statut terminal ou début + durée présumée", () => {
    expect(sessionEndedAt({ status: "DONE", date: start }, start)).toBe(true);
    expect(sessionEndedAt({ status: "CANCELLED", date: start }, start)).toBe(true);
    expect(sessionEndedAt(scheduled, new Date(start.getTime() + SESSION_ASSUMED_DURATION_MS - 1))).toBe(false);
    expect(sessionEndedAt(scheduled, new Date(start.getTime() + SESSION_ASSUMED_DURATION_MS))).toBe(true);
  });
});
