import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfidentialitePage from "./page";

beforeEach(() => {
  vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("/confidentialite : inventaire des cookies et du stockage local", () => {
  const html = () => renderToStaticMarkup(<ConfidentialitePage />);

  it("liste les cookies de connexion Auth.js et le cookie temporaire de liaison Steam, avec leur durée", () => {
    const page = html();
    for (const name of ["authjs.session-token", "authjs.csrf-token", "authjs.callback-url", "authjs.state", "authjs.pkce.code_verifier", "steam_link_state"]) {
      expect(page).toContain(name);
    }
    expect(page).toContain("Jusqu’à 30 jours");
    expect(page).toContain("10 minutes");
  });

  it("liste les préférences gardées dans le navigateur (clés exactes du code)", () => {
    const page = html();
    expect(page).toContain("gamenight:ambient-motion");
    expect(page).toContain("gamenight:cursor-trail-enabled");
    expect(page).toContain("gn:onboarding-prompt:");
  });

  it("n'annonce ni publicité ni suivi", () => {
    expect(html()).toContain("Aucun ne sert à la publicité");
  });
});
