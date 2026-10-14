import { describe, expect, it } from "vitest";
import { resolveInvitedCandidates } from "./session-announce";

/**
 * Bug remonté (test réel Discord, 26/09) — `resolveInvitedCandidates`
 * (fonction pure, extraite de `resolveAnnounceRendering`/`resolveThreadReminder`)
 * sélectionne les candidats aux mentions d'une soirée encore VOTING : les
 * invités `ACTIVE`, dédupliqués, jamais le créateur. Tourne sans
 * `TEST_DATABASE_URL` (voir `session-announce.integration.test.ts` pour le
 * scénario bout en bout, DB réelle).
 */
describe("resolveInvitedCandidates", () => {
  function invite(userId: string, status: "ACTIVE" | "REVOKED") {
    return { status, user: { id: userId } };
  }

  it("ne retient que les invitations ACTIVE, jamais les REVOKED", () => {
    const result = resolveInvitedCandidates(
      [invite("actif", "ACTIVE"), invite("revoque", "REVOKED")],
      "createur"
    );
    expect(result.map((u) => u.id)).toEqual(["actif"]);
  });

  it("exclut toujours le créateur, même s'il figure dans les invités passés (défense en profondeur — ne devrait jamais arriver en pratique)", () => {
    const result = resolveInvitedCandidates(
      [invite("createur", "ACTIVE"), invite("invite-1", "ACTIVE")],
      "createur"
    );
    expect(result.map((u) => u.id)).toEqual(["invite-1"]);
  });

  it("déduplique un même utilisateur apparaissant plusieurs fois", () => {
    const result = resolveInvitedCandidates(
      [invite("invite-1", "ACTIVE"), invite("invite-1", "ACTIVE")],
      "createur"
    );
    expect(result.map((u) => u.id)).toEqual(["invite-1"]);
  });

  it("aucun invité ACTIVE (tous révoqués, ou aucune invitation) → liste vide", () => {
    expect(resolveInvitedCandidates([invite("revoque", "REVOKED")], "createur")).toEqual([]);
    expect(resolveInvitedCandidates([], "createur")).toEqual([]);
  });
});
