import { describe, it, expect } from "vitest";
import { resolveAppOrigin, resolveAbsoluteUrl } from "@/lib/app-url";

describe("resolveAppOrigin (PR lien Discord annonce tournoi)", () => {
  it("Production : utilise VERCEL_PROJECT_PRODUCTION_URL", () => {
    expect(
      resolveAppOrigin({
        VERCEL_ENV: "production",
        VERCEL_URL: "gamenight-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "gamenight.vercel.app",
      })
    ).toBe("https://gamenight.vercel.app");
  });

  it("Preview : utilise VERCEL_URL (pas VERCEL_PROJECT_PRODUCTION_URL, sinon un lien Preview pointerait vers la Prod)", () => {
    expect(
      resolveAppOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "gamenight-git-branch-abc.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "gamenight.vercel.app",
      })
    ).toBe("https://gamenight-git-branch-abc.vercel.app");
  });

  it("VERCEL_ENV absent (dev local sur Vercel CLI, ex.) : se rabat sur VERCEL_URL comme Preview", () => {
    expect(resolveAppOrigin({ VERCEL_URL: "gamenight-dev.vercel.app" })).toBe(
      "https://gamenight-dev.vercel.app"
    );
  });

  it("Aucune variable Vercel (dev local classique) : null, pas de domaine inventé", () => {
    expect(resolveAppOrigin({})).toBeNull();
  });

  it("Production déclarée mais VERCEL_PROJECT_PRODUCTION_URL absente (ne devrait jamais arriver sur Vercel) : null plutôt qu'un lien cassé", () => {
    expect(resolveAppOrigin({ VERCEL_ENV: "production" })).toBeNull();
  });
});

describe("resolveAbsoluteUrl (PR lien Discord annonce tournoi)", () => {
  it("combine l'origine résolue avec le chemin donné", () => {
    expect(
      resolveAbsoluteUrl("/tournois/abc123", {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "gamenight.vercel.app",
      })
    ).toBe("https://gamenight.vercel.app/tournois/abc123");
  });

  it("origine non résolue : null plutôt qu'un chemin sans domaine", () => {
    expect(resolveAbsoluteUrl("/tournois/abc123", {})).toBeNull();
  });
});
