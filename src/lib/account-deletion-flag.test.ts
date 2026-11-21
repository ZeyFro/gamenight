import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION_CONFIRM_WORD, isAccountDeletionConfirmed, isAccountDeletionEnabled } from "@/lib/account-deletion-flag";
import { ownRow } from "@/lib/account-export";

describe("ACCOUNT_DELETION_ENABLED", () => {
  it("n'est actif que si la valeur vaut exactement « true »", () => {
    expect(isAccountDeletionEnabled({ ACCOUNT_DELETION_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "True", "1", " true", "true "]) {
      expect(isAccountDeletionEnabled({ ACCOUNT_DELETION_ENABLED: value }), String(value)).toBe(false);
    }
    expect(isAccountDeletionEnabled({})).toBe(false);
  });
});

describe("confirmation forte", () => {
  it("accepte le pseudo exact ou le mot SUPPRIMER, rien d'autre", () => {
    expect(isAccountDeletionConfirmed(ACCOUNT_DELETION_CONFIRM_WORD, "Alice")).toBe(true);
    expect(isAccountDeletionConfirmed("  SUPPRIMER  ", "Alice")).toBe(true);
    expect(isAccountDeletionConfirmed("Alice", "Alice")).toBe(true);
    for (const typed of ["", "   ", "supprimer", "Supprimer", "alice", "Alic", "Alice!", "oui"]) {
      expect(isAccountDeletionConfirmed(typed, "Alice"), typed).toBe(false);
    }
  });

  it("un pseudo vide ne se confirme jamais en laissant le champ vide", () => {
    expect(isAccountDeletionConfirmed("", "")).toBe(false);
  });
});

describe("MP vers un compte supprimé", () => {
  it("n'ouvre jamais de canal Discord pour un identifiant anonymisé (aucun appel réseau, échec définitif)", async () => {
    const { openDmChannel } = await import("@/lib/discord-rest");
    const result = await openDmChannel({ userId: "deleted:cuid123", deadline: new Date(Date.now() + 60_000) });
    expect(result).toMatchObject({ ok: false, kind: "invalid_request", retryable: false });
  });
});

describe("ownRow (ligne d'export)", () => {
  it("retire les colonnes secrètes et tout identifiant d'un autre membre, garde les siens", () => {
    const row = ownRow(
      { id: "r1", userId: "me", invitedById: "other", proposedById: "me", discordAccessToken: "secret", endpoint: "https://push", notifiedUserIds: ["x"], title: "ok", voterId: "other" },
      "me"
    );
    expect(row).toEqual({ id: "r1", userId: "me", proposedById: "me", title: "ok" });
  });
});
