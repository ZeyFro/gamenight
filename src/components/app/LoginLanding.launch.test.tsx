import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginLanding } from "./LoginLanding";
import { LOGIN_MEMBERS_ONLY_NOTICE } from "@/lib/launch-texts";

const INVITE = "https://discord.gg/thetower";
const render = () => renderToStaticMarkup(createElement(LoginLanding, null, "bouton"));
const NOTICE_NO_LINK = `<p class="mt-4 text-sm text-muted">${LOGIN_MEMBERS_ONLY_NOTICE}</p>`;
const NOTICE_WITH_LINK = `<p class="mt-4 text-sm text-muted">${LOGIN_MEMBERS_ONLY_NOTICE} <a href="${INVITE}" target="_blank" rel="noopener noreferrer" class="font-semibold text-accent underline underline-offset-2">Rejoindre le serveur</a></p>`;

afterEach(() => vi.unstubAllEnvs());

describe("page de connexion : accès réservé (V3-02)", () => {
  it("éteint : ni phrase ni lien, même avec DISCORD_INVITE_URL valide", () => {
    vi.stubEnv("DISCORD_INVITE_URL", INVITE);
    const html = render();
    expect(html).not.toContain("réservé aux membres");
    expect(html).not.toContain("Rejoindre le serveur");
    expect(html).not.toContain(INVITE);
  });

  it("valeur inexacte (« TRUE ») : traité comme éteint", () => {
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "TRUE");
    vi.stubEnv("DISCORD_INVITE_URL", INVITE);
    expect(render()).not.toContain("réservé aux membres");
  });

  it("allumé avec un lien d'invitation valide : phrase et lien « Rejoindre le serveur »", () => {
    vi.stubEnv("DISCORD_INVITE_URL", INVITE);
    const off = render();
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "true");
    const on = render();
    expect(on).toContain("L’accès est réservé aux membres du serveur Discord The Tower.");
    expect(on).toContain(`href="${INVITE}"`);
    expect(on).toContain(">Rejoindre le serveur</a>");
    // Seul ajout : le paragraphe ; le reste du rendu est identique à l'éteint.
    expect(on.replace(NOTICE_WITH_LINK, "")).toBe(off);
  });

  it("allumé sans lien (variable absente) : phrase seule, sans lien", () => {
    vi.stubEnv("DISCORD_INVITE_URL", "");
    const off = render();
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "true");
    const on = render();
    expect(on).toContain("réservé aux membres du serveur Discord The Tower");
    expect(on).not.toContain("Rejoindre le serveur");
    expect(on.replace(NOTICE_NO_LINK, "")).toBe(off);
  });

  it("allumé avec un lien non conforme (autre domaine, http) : jamais affiché", () => {
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "true");
    for (const bad of ["https://exemple.com/invite/abc", "http://discord.gg/abc", "javascript:alert(1)"]) {
      vi.stubEnv("DISCORD_INVITE_URL", bad);
      const html = render();
      expect(html).toContain("réservé aux membres");
      expect(html).not.toContain("Rejoindre le serveur");
      expect(html).not.toContain(bad);
    }
  });
});
