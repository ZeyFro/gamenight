import { describe, expect, it } from "vitest";
import { inspectEtageRoles, isLegacyEtageRole } from "./tower-etage-role-rules.mjs";

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
