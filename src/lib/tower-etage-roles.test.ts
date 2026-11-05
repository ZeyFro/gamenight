import { describe, expect, it } from "vitest";
import { inspectEtageRoles, isLegacyEtageRole } from "../../scripts/tower-etage-role-rules.mjs";

describe("inventaire Etage (lecture seule)", () => {
  it("détecte les rôles étage numérotés mais pas les rôles staff", () => {
    expect(isLegacyEtageRole("Étage 100")).toBe(true);
    expect(isLegacyEtageRole("Etage 3")).toBe(true);
    expect(isLegacyEtageRole("Admin")).toBe(false);
  });
  it("marque tout rôle à conserver, et rapporte les dépendances", () => {
    const rows = inspectEtageRoles([{ id: "a", name: "Étage 30", permissions: "8", managed: false }],
      [{ id: "c", name: "secret", permission_overwrites: [{ id: "a", type: 0 }] }]);
    expect(rows[0]).toMatchObject({
      safeToDelete: false, hasGuildPermissions: true,
      dependentChannels: [{ id: "c", name: "secret" }],
    });
  });
});


describe("limites de l'inventaire des anciens étages", () => {
  it.each(["🗼 Étage 1", " floor #42", "ÉTAGE : 9999", "Etage–7"])(
    "reconnaît le nom historique %s", name => {
      expect(isLegacyEtageRole(name)).toBe(true);
    },
  );

  it.each(["", "Admin", "Ranker", "Etage", "Etage demain", "Mon Etage 3", "Etage 10000", "Etage 3abc"])(
    "écarte le nom sans étage numéroté %s", name => {
      expect(isLegacyEtageRole(name)).toBe(false);
    },
  );

  it("ignore les rôles non numérotés et ne confond pas un overwrite membre avec un rôle", () => {
    const rows = inspectEtageRoles([
      { id: "role", name: "Étage 2", permissions: "0", managed: false },
      { id: "admin", name: "Admin", permissions: "8", managed: false },
    ], [
      { id: "member-channel", name: "membre", permission_overwrites: [{ id: "role", type: 1 }] },
      { id: "other-role-channel", name: "autre rôle", permission_overwrites: [{ id: "other", type: 0 }] },
      { id: "empty-channel", name: "sans overwrite" },
    ]);
    expect(rows).toEqual([{
      id: "role", name: "Étage 2", managed: false,
      assignedMembers: "non vérifié (intents Discord requis)",
      hasGuildPermissions: false, dependentChannels: [], safeToDelete: false,
    }]);
  });

  it("conserve les rôles gérés et détecte les permissions hors de la précision Number", () => {
    const rows = inspectEtageRoles([
      { id: "managed", name: "Floor 9", permissions: "9007199254740992", managed: true },
    ], []);
    expect(rows).toMatchObject([{
      id: "managed", managed: true, hasGuildPermissions: true,
      dependentChannels: [], safeToDelete: false,
    }]);
  });

  it("renvoie un inventaire vide quand aucun ancien rôle ne correspond", () => {
    expect(inspectEtageRoles([], [])).toEqual([]);
    expect(inspectEtageRoles([{ id: "staff", name: "Staff", permissions: "8" }], [])).toEqual([]);
  });
});
