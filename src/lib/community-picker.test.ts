import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCommunityPickerEnabled, safeNextPath } from "./community-picker";

/**
 * Multi-communautés, PR5 — sélecteur de serveur, parties pures : le drapeau
 * `COMMUNITY_PICKER_ENABLED` (exactement `true`) et la validation du chemin de
 * retour (`?next=`) pour qu'il ne devienne jamais une redirection ouverte.
 */

describe("isCommunityPickerEnabled", () => {
  it("n'est actif que pour la valeur exacte `true`", () => {
    expect(isCommunityPickerEnabled({ COMMUNITY_PICKER_ENABLED: "true" })).toBe(true);
  });

  it.each([undefined, "", "TRUE", "True", "1", "yes", "false", " true", "true "])(
    "est éteint pour %j",
    (value) => {
      expect(isCommunityPickerEnabled({ COMMUNITY_PICKER_ENABLED: value })).toBe(false);
    }
  );
});

describe("safeNextPath", () => {
  it.each(["/", "/sessions", "/tournois", "/classement?periode=week", "/sessions?tab=historique"])(
    "accepte le chemin interne %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    }
  );

  it.each([
    undefined,
    null,
    "",
    "sessions",
    "//evil.example",
    "///evil.example",
    "https://evil.example",
    "http://evil.example/sessions",
    "javascript:alert(1)",
    "/\\evil.example",
    "/sessions\\..\\x",
    "/ok\nLocation: https://evil.example",
    "/ok\r\nx",
  ])("replie %j sur l'accueil", (value) => {
    expect(safeNextPath(value as string | null | undefined)).toBe("/");
  });

  it("ne renvoie jamais vers /serveurs (boucle de redirection)", () => {
    expect(safeNextPath("/serveurs")).toBe("/");
    expect(safeNextPath("/serveurs?next=%2Fsessions")).toBe("/");
    expect(safeNextPath("/serveurs/")).toBe("/");
  });
});

describe("porte du sélecteur sur les pages", () => {
  // Une page oubliée rendrait le choix de serveur contournable sans bruit.
  it.each(["src/app/page.tsx", "src/app/sessions/page.tsx", "src/app/tournois/page.tsx", "src/app/classement/page.tsx"])(
    "%s appelle requireCommunityChosen",
    (file) => {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/requireCommunityChosen\(/);
      expect(source).toMatch(/from "@\/lib\/community-picker"/);
    }
  );
});
